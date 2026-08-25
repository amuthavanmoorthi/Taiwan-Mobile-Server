import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

/**
 * PROVIDER - Gaussian splat (.ply) to AR-ready mesh.
 *
 * Garychou's pipeline ends at a 3DGS .ply and he does not export meshes.
 * AR Quick Look on iOS renders meshes and not splats, so this closes the gap
 * on our side rather than blocking on his.
 *
 * The script is ours (scripts/splat-to-3d.mjs), unlike the photo pipeline
 * where the command is an env-configured hook into his tooling. Same
 * contract though, so both look identical from the service upward:
 *
 *   --input <ply> --outdir <dir> --height-mm <n> --name <slug>
 *   → <dir>/<slug>.glb and <dir>/<slug>.usdz, scaled to --height-mm
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** From dist/services/providers back to the repo root. */
const SCRIPT = join(HERE, "..", "..", "..", "scripts", "splat-to-3d.mjs");

const TIMEOUT_MS = Number(process.env.SPLAT_TIMEOUT_MS ?? 20 * 60 * 1000);
const OUT_ROOT = join(process.cwd(), "uploads", "models");

export type SplatResult = { glbUrl: string; usdzUrl: string };

/** True when the converter is present. Reconstruction also needs open3d, but
 *  that only surfaces on the first run - the script says so plainly. */
export const splatConversionAvailable = () => existsSync(SCRIPT);

export async function runSplatPipeline(
  plyPath: string,
  heightMm: number,
): Promise<SplatResult> {
  if (!existsSync(SCRIPT)) {
    throw new Error(`The splat converter is missing (expected at ${SCRIPT}).`);
  }

  mkdirSync(OUT_ROOT, { recursive: true });
  const slug = `${Date.now()}-${randomBytes(4).toString("hex")}`;

  await new Promise<void>((resolve, reject) => {
    // No shell: the project path contains spaces.
    const child = spawn(
      process.execPath,
      [
        SCRIPT,
        "--input", plyPath,
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
          `Splat conversion timed out after ${Math.round(TIMEOUT_MS / 60000)} minutes. ` +
            `Very large scans need to be cropped to the single item first.`,
        ),
      );
    }, TIMEOUT_MS);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the splat converter: ${e.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // The script's last stderr line is its reason for failing; Open3D's
      // own chatter is noise above it.
      const lines = stderr
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("[Open3D"));
      reject(
        new Error(
          lines.length ? lines[lines.length - 1] : `Splat conversion failed (exit ${code}).`,
        ),
      );
    });
  });

  const glb = join(OUT_ROOT, `${slug}.glb`);
  const usdz = join(OUT_ROOT, `${slug}.usdz`);
  if (!existsSync(glb) || !existsSync(usdz)) {
    throw new Error("Splat conversion finished but did not produce both a GLB and a USDZ.");
  }

  return {
    glbUrl: `/uploads/models/${slug}.glb`,
    usdzUrl: `/uploads/models/${slug}.usdz`,
  };
}
