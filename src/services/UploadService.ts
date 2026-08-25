import multer from "multer";
import { extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  accessSync,
  constants,
  readdirSync,
  statSync,
  statfsSync,
} from "node:fs";

/**
 * SERVICE - file intake for depot staff.
 *
 * Local disk is fine for the demo. Move to object storage before this runs
 * anywhere real: 3D models are large, and the API server should not be the
 * thing holding them.
 */
// Zeabur container storage is ephemeral unless we point at a mounted volume.
// Default to a local folder for dev, but allow an override in production.
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");

/**
 * Why this is not allowed to throw.
 *
 * This runs at import, so an exception here takes the whole API down before it
 * serves a single request - and the cause would be an upload directory, which
 * nothing else depends on. A crash loop over storage means the catalogue, the
 * login and the depot queue all go dark because a volume was mounted with the
 * wrong permissions. The failure is recorded and reported through
 * /staff/storage instead, so the API stays up and says what is wrong.
 */
let mkdirError: string | null = null;
try {
  mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  mkdirError = (e as Error).message;
}

// Images for the listing, GLB/USDZ for the AR pipeline, .ply for a Gaussian
// splat scan we convert ourselves. Anything else is rejected rather than
// stored and served back to browsers.
const ALLOWED: Record<string, string[]> = {
  // One field, several files. A second-hand listing lives or dies on showing
  // the wear, and one angle hides most of it.
  photo: [".jpg", ".jpeg", ".png", ".webp"],
  glb: [".glb"],
  usdz: [".usdz"],
  splat: [".ply"],
  video: [".mp4", ".mov", ".webm", ".m4v"],
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Never trust the client filename - generate our own.
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`);
  },
});

export const upload = multer({
  storage,
  // Splat exports are far larger than a mesh: a trained scene runs to
  // hundreds of MB before it is cropped to one item.
  limits: { fileSize: 400 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    const permitted = ALLOWED[file.fieldname] ?? [];
    if (!permitted.includes(ext)) {
      return cb(new Error(`${file.fieldname} must be one of ${permitted.join(", ")}`));
    }
    cb(null, true);
  },
});

export const UploadService = {
  /** Public URL for a stored file. */
  urlFor(filename?: string) {
    return filename ? `/uploads/${filename}` : null;
  },

  /** Public URLs for a whole field, in the order they were uploaded. */
  urlsFor(files?: Express.Multer.File[]) {
    return (files ?? []).map((f) => `/uploads/${f.filename}`);
  },

  /**
   * Where uploads actually land, and whether that survives a redeploy.
   *
   * Container filesystems are wiped on every deploy. If UPLOAD_DIR is not
   * pointed at a mounted volume then every photo, video and model staff have
   * uploaded disappears the next time the service restarts - silently, and
   * usually discovered in front of someone. There is no way to detect a mount
   * from inside the process with certainty, so this reports what it can and
   * treats "UPLOAD_DIR was not set" as the warning sign, because the default
   * is a path inside the container.
   */
  storage() {
    const configured = !!process.env.UPLOAD_DIR;

    let writable = false;
    try {
      accessSync(UPLOAD_DIR, constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }

    let files = 0;
    let bytes = 0;
    try {
      for (const name of readdirSync(UPLOAD_DIR, { withFileTypes: true })) {
        if (!name.isFile()) continue;
        files++;
        try {
          bytes += statSync(join(UPLOAD_DIR, name.name)).size;
        } catch {
          // A file can vanish between listing and stat; it just does not count.
        }
      }
    } catch {
      files = -1;
    }

    let freeBytes: number | null = null;
    try {
      const fs = statfsSync(UPLOAD_DIR);
      freeBytes = Number(fs.bavail) * Number(fs.bsize);
    } catch {
      freeBytes = null;
    }

    return {
      dir: UPLOAD_DIR,
      error: mkdirError,
      // The only signal available: an explicit UPLOAD_DIR means somebody
      // chose the location, which is what mounting a volume requires.
      persistent: configured,
      writable,
      files,
      bytes,
      freeBytes,
    };
  },
};
