import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

/**
 * PROVIDER - several photos to a mesh, by silhouette carving.
 *
 * Ours, like the splat converter and unlike localPipeline, which is a hook for
 * an external command. It exists because the 3D engineer left the project and
 * the platform still needs a way to turn a depot worker's photographs into
 * something AR can place.
 *
 * It is not a rebuild of his pipeline. That was COLMAP plus Gaussian Splatting
 * training, which needs a CUDA GPU that no machine on this project has.
 * Carving needs no GPU, no camera poses and no feature matching, and it is the
 * feature matching that would have failed here anyway - a plain white cabinet
 * gives nothing to match on, and depots are full of them.
 *
 * Same contract as the others, so the service treats all three alike.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** From dist/services/providers back to the repo root. */
const SCRIPT = join(HERE, "..", "..", "..", "scripts", "photos-to-3d.mjs");

const TIMEOUT_MS = Number(process.env.PHOTOS_TIMEOUT_MS ?? 20 * 60 * 1000);
const OUT_ROOT = join(process.cwd(), "uploads", "models");

/** Three views is the minimum that carves anything meaningful; below that the
 *  hull is barely tighter than the bounding box. */
export const MIN_VIEWS = 3;

export const photosPipelineAvailable = () => existsSync(SCRIPT);

export type PhotosResult = { glbUrl: string; usdzUrl: string };

export async function runPhotosPipeline(
  photoPaths: string[],
  heightMm: number,
): Promise<PhotosResult> {
  if (!existsSync(SCRIPT)) {
    throw new Error(`The carving script is missing (expected at ${SCRIPT}).`);
  }
  if (photoPaths.length < MIN_VIEWS) {
    throw new Error(
      `Silhouette carving needs at least ${MIN_VIEWS} photos taken around the item.`,
    );
  }

  mkdirSync(OUT_ROOT, { recursive: true });
  const slug = `${Date.now()}-${randomBytes(4).toString("hex")}`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        SCRIPT,
        "--inputs", photoPaths.join(","),
        "--outdir", OUT_ROOT,
        "--height-mm", String(heightMm),
        "--name", slug,
      ],
      { shell: false },
    );

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Carving timed out after ${Math.round(TIMEOUT_MS / 60000)} minutes. ` +
            `Try fewer photos, or smaller ones.`,
        ),
      );
    }, TIMEOUT_MS);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the carving script: ${e.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // The script's last stderr line is its reason; Open3D and libvips chatter
      // is noise above it.
      const lines = stderr
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) =>
            l &&
            !l.startsWith("[Open3D") &&
            !l.startsWith("objc[") &&
            !/is implemented in both|duplicates must be removed|libvips-cpp/.test(l),
        );
      reject(new Error(lines.length ? lines[lines.length - 1] : `Carving failed (exit ${code}).`));
    });
  });

  const glb = join(OUT_ROOT, `${slug}.glb`);
  const usdz = join(OUT_ROOT, `${slug}.usdz`);
  if (!existsSync(glb) || !existsSync(usdz)) {
    throw new Error("Carving finished but did not produce both a GLB and a USDZ.");
  }

  return { glbUrl: `/uploads/models/${slug}.glb`, usdzUrl: `/uploads/models/${slug}.usdz` };
}
