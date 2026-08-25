#!/usr/bin/env node
/**
 * Several photos -> a 3D model, by silhouette carving.
 *
 * The multi-view counterpart to photo-to-3d.mjs. That one extrudes a single
 * outline and is flat from the side; this one carves a voxel block against
 * every outline at once, so the shape is genuinely three-dimensional.
 *
 * It is not photogrammetry. There is no feature matching and no pose solving,
 * which is the point: a white cabinet with no texture defeats feature
 * matching entirely, and it is exactly the kind of thing a depot is full of.
 * The trade is that concavities are invisible - see visual_hull.py.
 *
 * CONTRACT (see providers/localPipeline.ts, same shape as the other two)
 *   photos-to-3d.mjs --inputs a.jpg,b.jpg,... --outdir <dir>
 *                    --height-mm <n> --name <slug>
 * Writes <dir>/<slug>.glb and <dir>/<slug>.usdz, scaled to --height-mm.
 */

import sharp from "sharp";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { segment } from "./lib/segment.mjs";
import { fillHoles, smooth } from "./lib/mask.mjs";
import { readPlyMesh } from "./lib/plymesh.mjs";
import { writeGlbVertexColor, writeUsdzVertexColor } from "./lib/gltf.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.SPLAT_PYTHON ?? "python3";
const CARVER = join(HERE, "visual_hull.py");

/** Mask resolution. Carving cost scales with this, and the outline is what
 *  matters, not the texture, so it does not need to be large. */
const WORK = 512;

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
const inputs = (args.inputs ?? "").split(",").filter(Boolean);
const outdir = args.outdir;
const name = args.name;
const heightMm = Number(args["height-mm"]);

if (!inputs.length || !outdir || !name) {
  fail("Usage: --inputs a.jpg,b.jpg,... --outdir <dir> --height-mm <n> --name <slug>");
}
if (inputs.length < 3) {
  fail(
    `Silhouette carving needs at least three photos taken around the item; ` +
      `got ${inputs.length}. Use the single-photo pipeline instead, or take more shots.`,
  );
}
for (const p of inputs) if (!existsSync(p)) fail(`No such file: ${p}`);
if (!Number.isFinite(heightMm) || heightMm <= 0) {
  fail("--height-mm must be a positive number: it is what anchors the model to real size.");
}

const work = join(tmpdir(), `hull-${randomBytes(6).toString("hex")}`);
mkdirSync(work, { recursive: true });

// --- 1. one silhouette per photo -----------------------------------------

const maskPaths = [];
let weakest = null;

for (const [i, input] of inputs.entries()) {
  let result;
  try {
    result = await segment(input, WORK);
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    fail(`Photo ${i + 1}: ${(e && e.message) || e}`);
  }

  const { width, height, method } = result;
  // Same clean-up the single-photo path uses: close specular holes, then take
  // the roughness off the edge so the carve is not chewed by stray pixels.
  const mask = smooth(fillHoles(result.mask, width, height), width, height);

  const coverage = mask.reduce((n, v) => n + v, 0) / (width * height);
  if (coverage < 0.02) {
    rmSync(work, { recursive: true, force: true });
    fail(
      `Photo ${i + 1}: the item could not be separated from the background. ` +
        `Shoot against a plainer backdrop, or leave this frame out.`,
    );
  }
  if (method !== "model" && (weakest === null || coverage < weakest)) weakest = coverage;

  const grey = Buffer.alloc(width * height);
  for (let p = 0; p < mask.length; p++) grey[p] = mask[p] ? 255 : 0;

  const path = join(work, `mask-${String(i).padStart(2, "0")}.png`);
  await sharp(grey, { raw: { width, height, channels: 1 } }).png().toFile(path);
  maskPaths.push(path);

  process.stderr.write(
    `  photo ${i + 1}/${inputs.length}: ${method} segmentation, ` +
      `${(coverage * 100).toFixed(0)}% of frame\n`,
  );
}

if (weakest !== null) {
  process.stderr.write(
    "note: the segmentation model was unavailable for at least one photo and " +
      "colour fallback was used; the outline is less reliable\n",
  );
}

// --- 2. carve -------------------------------------------------------------

const meshPath = join(work, "hull.ply");
const py = spawnSync(
  PYTHON,
  [
    CARVER,
    "--masks", maskPaths.join(","),
    "--photos", inputs.join(","),
    "--output", meshPath,
  ],
  { shell: false, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);

if (py.error) {
  rmSync(work, { recursive: true, force: true });
  fail(
    `Could not run the carving step (${PYTHON}): ${py.error.message}. ` +
      `Install open3d, numpy and pillow, or point SPLAT_PYTHON at an interpreter that has them.`,
  );
}
if (py.status !== 0 || !existsSync(meshPath)) {
  const lines = (py.stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  rmSync(work, { recursive: true, force: true });
  fail(lines.length ? lines[lines.length - 1] : `Carving failed (exit ${py.status}).`);
}
process.stderr.write((py.stderr ?? "").split("\n").filter((l) => l.startsWith("  ")).join("\n") + "\n");

// --- 3. read back, scale, write ------------------------------------------

let mesh;
try {
  mesh = readPlyMesh(readFileSync(meshPath));
} catch (e) {
  rmSync(work, { recursive: true, force: true });
  fail(`Could not read the carved mesh: ${e.message}`);
}
rmSync(work, { recursive: true, force: true });

const { positions, indices } = mesh;
const normals = mesh.normals ?? new Float32Array(mesh.vertexCount * 3);
const colors = mesh.colors ?? new Float32Array(mesh.vertexCount * 3).fill(0.72);

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    if (positions[i + a] < min[a]) min[a] = positions[i + a];
    if (positions[i + a] > max[a]) max[a] = positions[i + a];
  }
}
const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
if (!extent.every((e) => e > 1e-9)) fail("Carved mesh is degenerate - zero extent on an axis.");

// The carve is normalised to unit height, so the measured height is what
// gives it real size. Centre it and sit it on the floor for AR.
const scale = heightMm / 1000 / extent[1];
const cx = (min[0] + max[0]) / 2;
const cz = (min[2] + max[2]) / 2;

const out = new Float32Array(positions.length);
for (let i = 0; i < positions.length; i += 3) {
  out[i] = (positions[i] - cx) * scale;
  out[i + 1] = (positions[i + 1] - min[1]) * scale;
  out[i + 2] = (positions[i + 2] - cz) * scale;
}

mkdirSync(outdir, { recursive: true });
const glb = writeGlbVertexColor({ positions: out, normals, colors, indices });
writeFileSync(join(outdir, `${name}.glb`), glb);
const usdz = writeUsdzVertexColor({ positions: out, normals, colors, indices, name });
writeFileSync(join(outdir, `${name}.usdz`), usdz);

const cm = (v) => (v * scale * 100).toFixed(1);
process.stderr.write(
  `ok: ${indices.length / 3} triangles from ${inputs.length} views, ` +
    `${cm(extent[0])} x ${cm(extent[2])} x ${cm(extent[1])} cm (w x d x h), ` +
    `glb ${Math.round(glb.length / 1024)} KB, usdz ${Math.round(usdz.length / 1024)} KB\n`,
);
