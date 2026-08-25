#!/usr/bin/env node
/**
 * Gaussian splat → 3D, for AR.
 *
 * WHY THIS EXISTS
 * ---------------
 * Garychou's pipeline ends at a 3DGS .ply. iOS places AR through AR Quick
 * Look, which renders meshes and — confirmed by Apple — does not render
 * Gaussian splats. Most buyers here are on iPhone, so without a mesh there is
 * no AR at all. This is the bridge.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a replacement for the splat. Poisson over the splat centres throws away
 * the anisotropy and the view-dependent colour that make 3DGS look good, so
 * the mesh is always the poorer likeness. Keep the .ply for the on-page
 * viewer; this output is the AR proxy.
 *
 * Reconstruction quality follows input quality exactly. A whole scene with
 * floaters becomes blobs. One object with the background removed in
 * SuperSplat becomes a usable mesh.
 *
 * CONTRACT (same as photo-to-3d.mjs, see providers/localPipeline.ts)
 *   splat-to-3d.mjs --input <3dgs.ply> --outdir <dir> --height-mm <n> --name <slug>
 * Writes <dir>/<slug>.glb and <dir>/<slug>.usdz, scaled so the model's height
 * equals --height-mm.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { readPlyMesh } from "./lib/plymesh.mjs";
import { writeGlbVertexColor, writeUsdzVertexColor } from "./lib/gltf.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Interpreter with open3d installed. Overridable — CI and the container differ. */
const PYTHON = process.env.SPLAT_PYTHON ?? "python3";
const RECONSTRUCT = join(HERE, "splat_reconstruct.py");

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
const targetTris = Number(args["target-tris"] ?? 60000);

if (!input || !outdir || !name) {
  fail("Usage: --input <3dgs.ply> --outdir <dir> --height-mm <n> --name <slug>");
}
if (!existsSync(input)) fail(`No such file: ${input}`);
if (!Number.isFinite(heightMm) || heightMm <= 0) {
  fail("--height-mm must be a positive number: it is what anchors the model to real size.");
}

// --- 1. reconstruct -------------------------------------------------------

const work = join(tmpdir(), `splat-${randomBytes(6).toString("hex")}.ply`);

const py = spawnSync(
  PYTHON,
  [RECONSTRUCT, "--input", input, "--output", work, "--target-tris", String(targetTris)],
  { shell: false, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
);

if (py.error) {
  fail(
    `Could not run the reconstruction step (${PYTHON}): ${py.error.message}. ` +
      `Install open3d, or point SPLAT_PYTHON at an interpreter that has it.`,
  );
}
if (py.status !== 0) {
  // splat_reconstruct.py writes its failure reason as the last stderr line.
  const lines = (py.stderr ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  fail(lines.length ? lines[lines.length - 1] : `Reconstruction failed (exit ${py.status}).`);
}
if (!existsSync(work)) fail("Reconstruction reported success but wrote no mesh.");

// --- 2. read it back ------------------------------------------------------

let mesh;
try {
  mesh = readPlyMesh(readFileSync(work));
} catch (e) {
  rmSync(work, { force: true });
  fail(`Could not read the reconstructed mesh: ${e.message}`);
}
rmSync(work, { force: true });

const { positions, indices } = mesh;
let { normals, colors } = mesh;

if (!normals) fail("Reconstructed mesh has no normals.");
if (!colors) {
  // Better a plain grey model than none — the shape is still the useful part.
  process.stderr.write("note: mesh has no vertex colours; falling back to flat grey\n");
  colors = new Float32Array(mesh.vertexCount * 3).fill(0.72);
}

// --- 3. scale and orient --------------------------------------------------

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let a = 0; a < 3; a++) {
    if (positions[i + a] < min[a]) min[a] = positions[i + a];
    if (positions[i + a] > max[a]) max[a] = positions[i + a];
  }
}
const extent = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
if (!extent.every((e) => e > 1e-9)) fail("Reconstructed mesh is degenerate — zero extent on an axis.");

// A splat file carries no unit, so the file's own numbers mean nothing. The
// measured height is the only real dimension we have; everything scales off
// it. This is why --height-mm is mandatory rather than a hint.
const scale = heightMm / 1000 / extent[1];

// Sit the model on the origin, centred: AR anchors to a plane, so a model
// whose feet are not at y=0 hovers or sinks into the floor.
const cx = (min[0] + max[0]) / 2;
const cz = (min[2] + max[2]) / 2;

const out = new Float32Array(positions.length);
for (let i = 0; i < positions.length; i += 3) {
  out[i] = (positions[i] - cx) * scale;
  out[i + 1] = (positions[i + 1] - min[1]) * scale;
  out[i + 2] = (positions[i + 2] - cz) * scale;
}

// --- 4. write ------------------------------------------------------------

mkdirSync(outdir, { recursive: true });

const glb = writeGlbVertexColor({ positions: out, normals, colors, indices });
writeFileSync(join(outdir, `${name}.glb`), glb);

const usdz = writeUsdzVertexColor({ positions: out, normals, colors, indices, name });
writeFileSync(join(outdir, `${name}.usdz`), usdz);

const cm = (v) => (v * scale * 100).toFixed(1);
process.stderr.write(
  `ok: ${indices.length / 3} triangles, ${mesh.vertexCount} vertices, ` +
    `${cm(extent[0])} x ${cm(extent[2])} x ${cm(extent[1])} cm (w x d x h), ` +
    `glb ${Math.round(glb.length / 1024)} KB, usdz ${Math.round(usdz.length / 1024)} KB\n`,
);
