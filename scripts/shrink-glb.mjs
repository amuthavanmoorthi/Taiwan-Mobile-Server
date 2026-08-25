#!/usr/bin/env node
/**
 * Re-encodes the textures inside a GLB.
 *
 * Models exported from asset libraries routinely carry 4K PNGs, which is
 * sensible for a render and absurd for a web page: a single sofa arrived here
 * at 34 MB with 17.5 MB of that being two uncompressed PNGs. On a phone over
 * mobile data that is the difference between a banner that loads and one that
 * does not.
 *
 * Only the images are touched. Geometry, materials, animations and the node
 * tree are copied through byte for byte, so the model that comes out is the
 * model that went in at a lower texture resolution.
 *
 * Alpha is preserved by keeping PNG for images that actually use it - a
 * cut-out leaf texture re-encoded as JPEG turns into a black rectangle.
 *
 * Normal, roughness and occlusion maps stay PNG. They are read as data, not
 * looked at: JPEG's chroma subsampling and ringing
 * become wrong surface angles rather than a slightly soft picture. A sofa here
 * tiles its normal map eight times over, which multiplied those artefacts
 * until the upholstery looked like shredded paper.
 *
 * Usage:
 *   shrink-glb.mjs --input a.glb --output b.glb [--max 1024] [--quality 82]
 */

import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
}

const input = args.input;
const output = args.output;
const MAX = Number(args.max ?? 1024);
const QUALITY = Number(args.quality ?? 82);

if (!input || !output) {
  process.stderr.write("Usage: --input <in.glb> --output <out.glb> [--max N] [--quality N]\n");
  process.exit(1);
}

const pad4 = (n) => (n + 3) & ~3;

const src = readFileSync(input);
if (src.toString("ascii", 0, 4) !== "glTF") {
  process.stderr.write("Not a GLB file.\n");
  process.exit(1);
}

const jsonLen = src.readUInt32LE(12);
const gltf = JSON.parse(src.toString("utf8", 20, 20 + jsonLen));
const binStart = 20 + pad4(jsonLen) + 8;
const bin = src.subarray(binStart, binStart + src.readUInt32LE(20 + pad4(jsonLen)));

/**
 * Which images are consumed as data rather than as colour. Walked from the
 * materials because nothing in the image itself says how it is used.
 */
const dataTextures = new Set();
for (const material of gltf.materials ?? []) {
  const slots = [
    material.normalTexture,
    material.occlusionTexture,
    material.pbrMetallicRoughness?.metallicRoughnessTexture,
  ];
  for (const slot of slots) {
    if (slot?.index == null) continue;
    const source = gltf.textures?.[slot.index]?.source;
    if (source != null) dataTextures.add(source);
  }
}

const images = gltf.images ?? [];
if (images.length === 0) {
  process.stderr.write("No embedded images; nothing to shrink.\n");
  writeFileSync(output, src);
  process.exit(0);
}

// Re-encode every image first, so the buffer can be rebuilt in one pass.
const replacements = new Map();
for (const [index, image] of images.entries()) {
  if (image.bufferView == null) continue;
  const view = gltf.bufferViews[image.bufferView];
  const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);

  const meta = await sharp(bytes).metadata();
  const isData = dataTextures.has(index);

  // hasAlpha only says the channel exists; isOpaque says whether it is used.
  const stats = await sharp(bytes).stats();
  const needsAlpha = meta.hasAlpha && !stats.isOpaque;
  const lossless = isData || needsAlpha;

  // Data maps are resized like any other - a tiled fabric weave repeats, so
  // the detail is in the tile, not the pixel count. What they must not lose is
  // the format: PNG scaled down is still exact, JPEG at any size is not.
  const limit = MAX;

  const pipeline = sharp(bytes).resize({
    width: Math.min(meta.width ?? limit, limit),
    height: Math.min(meta.height ?? limit, limit),
    fit: "inside",
    withoutEnlargement: true,
  });

  const encoded = lossless
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
    : await pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();

  replacements.set(index, {
    data: encoded,
    mimeType: lossless ? "image/png" : "image/jpeg",
    was: bytes.length,
  });

  process.stderr.write(
    `  image ${index}: ${meta.width}x${meta.height} ${meta.format} ` +
      `${(bytes.length / 1048576).toFixed(2)}MB -> ` +
      `${(encoded.length / 1048576).toFixed(2)}MB ` +
      `${lossless ? "png" : "jpeg"}${isData ? " (data map, kept lossless)" : ""}\n`,
  );
}

// Rebuild the binary chunk. Every bufferView is copied in its existing order
// so indices stay valid; only the image ones change length, and offsets after
// them shift accordingly.
const imageViews = new Map();
for (const [index, image] of images.entries()) {
  if (image.bufferView != null && replacements.has(index)) {
    imageViews.set(image.bufferView, replacements.get(index));
  }
}

const parts = [];
let offset = 0;
gltf.bufferViews.forEach((view, i) => {
  const swap = imageViews.get(i);
  const bytes = swap
    ? swap.data
    : bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);

  const padded = Buffer.alloc(pad4(bytes.length));
  Buffer.from(bytes).copy(padded);
  parts.push(padded);

  view.byteOffset = offset;
  view.byteLength = bytes.length;
  offset += padded.length;
});

for (const [index, swap] of replacements) images[index].mimeType = swap.mimeType;

const newBin = Buffer.concat(parts);
gltf.buffers = [{ byteLength: newBin.length }];

const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
const json = Buffer.concat([
  jsonBuf,
  Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20),
]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + newBin.length, 8);

const jh = Buffer.alloc(8);
jh.writeUInt32LE(json.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);

const bh = Buffer.alloc(8);
bh.writeUInt32LE(newBin.length, 0);
bh.writeUInt32LE(0x004e4942, 4);

const out = Buffer.concat([header, jh, json, bh, newBin]);
writeFileSync(output, out);

process.stderr.write(
  `ok: ${(src.length / 1048576).toFixed(1)}MB -> ${(out.length / 1048576).toFixed(1)}MB\n`,
);
