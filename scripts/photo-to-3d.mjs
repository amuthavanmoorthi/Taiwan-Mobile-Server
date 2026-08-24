#!/usr/bin/env node
/**
 * Photo → 3D, single image.
 *
 * WHAT THIS IS
 * ------------
 * The object is separated from its background, its silhouette is traced, and
 * that outline is extruded into a solid with the photo mapped onto the front
 * and back. The mesh is then scaled so its height equals the measured height
 * the operator entered.
 *
 * Everything here is derived from real pixels. Nothing is hallucinated: the
 * outline is the object's actual outline and the texture is the actual photo.
 *
 * WHAT IT IS NOT
 * --------------
 * Separation uses a segmentation model, falling back to a colour flood fill
 * when the model is unavailable. The fallback needs the four corners of the
 * frame to be background and the item to differ from it in colour, which a
 * speckled depot floor often defeats.
 *
 * It is not a reconstruction of the unseen sides. Depth is an extrusion, so
 * the model reads correctly from the front and from a moderate angle, and
 * flattens out when viewed from the side. For anything where the profile
 * matters — sofas, corner units — capture multiple angles and use the
 * photogrammetry pipeline instead.
 *
 * CONTRACT (see src/services/providers/localPipeline.ts)
 *   photo-to-3d.mjs --input <photo> --outdir <dir> --height-mm <n> --name <slug>
 * Writes <dir>/<slug>.glb and <dir>/<slug>.usdz, scaled to --height-mm.
 */

import sharp from "sharp";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fillHoles, smooth } from "./lib/mask.mjs";
import { segment } from "./lib/segment.mjs";
import { traceContour, simplify, triangulate, isClockwise } from "./lib/contour.mjs";
import { writeGlb, writeUsdz } from "./lib/gltf.mjs";

// Working resolution for the mask. Big enough for a faithful outline, small
// enough that the flood fill and morphology stay fast.
const WORK = 512;
// Texture resolution baked into the model.
const TEX = 1024;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, "");
    if (k) out[k] = argv[i + 1];
  }
  return out;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
const input = args.input;
const outdir = args.outdir;
const name = args.name;
const heightMm = Number(args["height-mm"]);
const depthMm = args["depth-mm"] ? Number(args["depth-mm"]) : null;

if (!input || !outdir || !name) fail("Usage: --input <photo> --outdir <dir> --height-mm <n> --name <slug>");
if (!Number.isFinite(heightMm) || heightMm <= 0) {
  fail("--height-mm must be a positive number: it is what anchors the model to real size.");
}

const src = sharp(input).rotate(); // honour EXIF orientation
const meta = await src.metadata().catch(() => null);
if (!meta?.width) fail(`Could not read the image: ${input}`);

// --- 1. Silhouette -------------------------------------------------------

const seg = await segment(input, WORK);
const mw = seg.width;
const mh = seg.height;

let objectPixels = 0;
for (let i = 0; i < mw * mh; i++) if (seg.mask[i]) objectPixels++;
const coverage = objectPixels / (mw * mh);

if (coverage < 0.02) {
  fail(
    seg.method === "model"
      ? "The segmentation model could not find an item in this photo. Make sure " +
          "one item fills most of the frame and is clearly visible."
      : "Could not separate the item from its background. The segmentation " +
          "model was unavailable" +
          (seg.mlError ? ` (${seg.mlError})` : "") +
          ", so colour matching was used, and this photo's background is too " +
          "close in colour to the item. Shoot against a plain, contrasting " +
          "floor or wall with a clear margin on all four sides.",
  );
}
if (coverage > 0.95) {
  fail(
    "The item fills essentially the whole frame, leaving no background to " +
      "separate. Step back so all four corners show only floor or wall.",
  );
}

// Holes are closed: the outline follows the object's outer edge, and the
// photo's own pixels fill whatever sits inside it.
const mask = smooth(fillHoles(seg.mask, mw, mh, 1), mw, mh, 2);

// --- 2. Outline ----------------------------------------------------------

const raw = traceContour(mask, mw, mh);
if (raw.length < 12) fail("The detected outline was too small to build a model from.");

// ~0.4% of the longest edge: keeps chair legs while dropping pixel noise.
const contour = simplify(raw, Math.max(1.2, Math.max(mw, mh) * 0.004));
if (contour.length < 8) fail("The outline collapsed during simplification.");

const tris = triangulate(contour);
if (!tris.length) fail("Could not triangulate the outline.");

// --- 3. Geometry ---------------------------------------------------------

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const [x, y] of contour) {
  minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  minY = Math.min(minY, y); maxY = Math.max(maxY, y);
}
const bw = Math.max(1, maxX - minX);
const bh = Math.max(1, maxY - minY);

// Metres per mask pixel, from the measured height.
const mpp = heightMm / 1000 / bh;
const depth = depthMm ? depthMm / 1000 : Math.min(bw * mpp, heightMm / 1000) * 0.42;
const halfD = depth / 2;
// Rim inset so the silhouette has a bevel instead of a knife edge.
const inset = 0.94;

const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;

const positions = [];
const normals = [];
const uvs = [];
const indices = [];

// Model space: X right, Y up, origin on the floor at the object's centre.
const toModel = (x, y, z) => [(x - cx) * mpp, (maxY - y) * mpp, z];
const toUv = (x, y) => [(x - minX) / bw, (y - minY) / bh];

const pushVertex = (x, y, z, nx, ny, nz, shrink) => {
  const sx = cx + (x - cx) * shrink;
  const sy = cy + (y - cy) * shrink;
  const [px, py, pz] = toModel(sx, sy, z);
  positions.push(px, py, pz);
  normals.push(nx, ny, nz);
  const [u, v] = toUv(x, y);
  uvs.push(u, v);
  return positions.length / 3 - 1;
};

// Front and back caps.
const frontIdx = contour.map(([x, y]) => pushVertex(x, y, halfD, 0, 0, 1, inset));
const backIdx = contour.map(([x, y]) => pushVertex(x, y, -halfD, 0, 0, -1, inset));

const cw = isClockwise(contour);
for (const [a, b, c] of tris) {
  // Front faces +Z, back faces -Z, so the winding is mirrored.
  if (cw) {
    indices.push(frontIdx[a], frontIdx[c], frontIdx[b]);
    indices.push(backIdx[a], backIdx[b], backIdx[c]);
  } else {
    indices.push(frontIdx[a], frontIdx[b], frontIdx[c]);
    indices.push(backIdx[a], backIdx[c], backIdx[b]);
  }
}

// Side wall: a ring at full size between the two inset caps.
const rimFront = [];
const rimBack = [];
for (let i = 0; i < contour.length; i++) {
  const [x, y] = contour[i];
  const [nx0, ny0] = contour[(i + 1) % contour.length];
  const [px0, py0] = contour[(i - 1 + contour.length) % contour.length];
  // Outward normal from the local edge direction.
  let ex = nx0 - px0;
  let ey = ny0 - py0;
  const el = Math.hypot(ex, ey) || 1;
  ex /= el;
  ey /= el;
  const nx = cw ? ey : -ey;
  const ny = cw ? -ex : ex;

  rimFront.push(pushVertex(x, y, halfD * 0.55, nx, -ny, 0, 1));
  rimBack.push(pushVertex(x, y, -halfD * 0.55, nx, -ny, 0, 1));
}

for (let i = 0; i < contour.length; i++) {
  const j = (i + 1) % contour.length;
  const quads = [
    [frontIdx[i], frontIdx[j], rimFront[j], rimFront[i]],
    [rimFront[i], rimFront[j], rimBack[j], rimBack[i]],
    [rimBack[i], rimBack[j], backIdx[j], backIdx[i]],
  ];
  for (const [a, b, c, d] of quads) {
    if (cw) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  }
}

// --- 4. Texture ----------------------------------------------------------

// Crop to the silhouette's bounding box so UVs line up with the geometry.
const cropLeft = Math.round((minX / mw) * meta.width);
const cropTop = Math.round((minY / mh) * meta.height);
const cropW = Math.max(1, Math.round((bw / mw) * meta.width));
const cropH = Math.max(1, Math.round((bh / mh) * meta.height));

const crop = {
  left: Math.min(cropLeft, meta.width - 1),
  top: Math.min(cropTop, meta.height - 1),
  width: Math.min(cropW, meta.width - cropLeft),
  height: Math.min(cropH, meta.height - cropTop),
};

// JPEG, not PNG: this is a photograph, and PNG of a photo runs to megabytes.
// A listing has to download quickly on a phone.
const texture = await src
  .clone()
  .extract(crop)
  .resize(TEX, TEX, { fit: "fill" })
  .removeAlpha()
  .jpeg({ quality: 82, mozjpeg: true })
  .toBuffer();

// --- 5. Write ------------------------------------------------------------

mkdirSync(outdir, { recursive: true });

const glb = writeGlb({ positions, normals, uvs, indices, texture });
writeFileSync(join(outdir, `${name}.glb`), glb);

const usdz = writeUsdz({ positions, normals, uvs, indices, texture, name });
writeFileSync(join(outdir, `${name}.usdz`), usdz);

process.stdout.write(
  `ok: ${contour.length} outline points, ${indices.length / 3} triangles, ` +
    `${seg.method} segmentation, ${(coverage * 100).toFixed(0)}% of frame, ` +
    `${(heightMm / 10).toFixed(1)} cm tall, ` +
    `glb ${(glb.length / 1024).toFixed(0)} KB, usdz ${(usdz.length / 1024).toFixed(0)} KB\n`,
);
