import multer from "multer";
import { extname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";

/**
 * SERVICE — file intake for depot staff.
 *
 * Local disk is fine for the demo. Move to object storage before this runs
 * anywhere real: 3D models are large, and the API server should not be the
 * thing holding them.
 */
// Zeabur container storage is ephemeral unless we point at a mounted volume.
// Default to a local folder for dev, but allow an override in production.
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
mkdirSync(UPLOAD_DIR, { recursive: true });

// Images for the listing, GLB/USDZ for the AR pipeline. Anything else is
// rejected rather than stored and served back to browsers.
const ALLOWED: Record<string, string[]> = {
  photo: [".jpg", ".jpeg", ".png", ".webp"],
  glb: [".glb"],
  usdz: [".usdz"],
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Never trust the client filename — generate our own.
    const ext = extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024 }, // 60 MB — a real scan export fits
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
};
