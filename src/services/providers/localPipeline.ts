import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * PROVIDER - Garychou's reconstruction pipeline.
 *
 * The app does not know how the pipeline works; it only knows this contract.
 * That keeps his tooling free to change without touching the platform.
 *
 * CONTRACT
 * --------
 * The command in MODELING_LOCAL_CMD is run with four arguments:
 *
 *   <cmd> --input <photoPath> --outdir <dir> --height-mm <n> --name <slug>
 *
 * On success it must exit 0 having written BOTH of:
 *
 *   <dir>/<slug>.glb    mesh, Y-up, metres, already scaled so the model's
 *                       height equals --height-mm
 *   <dir>/<slug>.usdz   same mesh for iOS AR Quick Look
 *
 * Anything on stderr from a failed run is surfaced to staff as the reason,
 * so keep those messages readable.
 *
 * Scale is the pipeline's responsibility because only it knows the mesh
 * bounds. If it cannot honour --height-mm it must fail rather than emit an
 * unscaled model - a confidently wrong size is worse than no model.
 */

/**
 * Lines the runtime emits that are not the pipeline's own message. Two copies
 * of libvips end up loaded (sharp's, and the one bundled inside the
 * segmentation package) and macOS warns about it on every run. Storing that as
 * the failure reason would show staff a dylib warning instead of "the photo's
 * background is too similar to the item".
 */
const NOISE = [
  /^objc\[\d+\]:/,
  /Class .+ is implemented in both/,
  /One of the duplicates must be removed/,
  /libvips-cpp/,
  /^\s*$/,
];

function meaningfulError(stderr: string, code: number | null) {
  const lines = stderr
    .split("\n")
    .filter((line) => !NOISE.some((n) => n.test(line)))
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length) return lines.join("\n");
  return `The reconstruction step failed (exit code ${code}).`;
}

const CMD = process.env.MODELING_LOCAL_CMD ?? "";
const TIMEOUT_MS = Number(process.env.MODELING_TIMEOUT_MS ?? 30 * 60 * 1000);
const OUT_ROOT = join(process.cwd(), "uploads", "models");

export type LocalResult = { glbUrl: string; usdzUrl: string };

export async function runLocalPipeline(
  photoPath: string,
  heightMm: number,
): Promise<LocalResult> {
  if (!CMD) {
    throw new Error(
      "MODELING_LOCAL_CMD is not set. Point it at the reconstruction script.",
    );
  }

  mkdirSync(OUT_ROOT, { recursive: true });
  const slug = `${Date.now()}-${randomBytes(4).toString("hex")}`;

  const args = [
    "--input", photoPath,
    "--outdir", OUT_ROOT,
    "--height-mm", String(heightMm),
    "--name", slug,
  ];

  // Split the command so "python /path/run.py" works, but spawn WITHOUT a
  // shell: the project path contains spaces and a shell would word-split the
  // arguments. Quote MODELING_LOCAL_CMD parts only if a path itself has spaces.
  const [bin, ...baseArgs] = CMD.trim().split(/\s+/);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, [...baseArgs, ...args], { shell: false });

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += String(d);
      // Keep only the tail; a photogrammetry run can be very chatty.
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(`Pipeline timed out after ${Math.round(TIMEOUT_MS / 60000)} minutes.`),
      );
    }, TIMEOUT_MS);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the pipeline: ${e.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(meaningfulError(stderr, code)));
    });
  });

  const glb = join(OUT_ROOT, `${slug}.glb`);
  const usdz = join(OUT_ROOT, `${slug}.usdz`);

  if (!existsSync(glb)) {
    throw new Error(`Pipeline finished but produced no ${slug}.glb.`);
  }
  if (!existsSync(usdz)) {
    throw new Error(
      `Pipeline produced a GLB but no ${slug}.usdz - iOS AR would be unavailable.`,
    );
  }

  return {
    glbUrl: `/uploads/models/${slug}.glb`,
    usdzUrl: `/uploads/models/${slug}.usdz`,
  };
}
