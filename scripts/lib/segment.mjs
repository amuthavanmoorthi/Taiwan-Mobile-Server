import sharp from "sharp";
import { buildMask, largestComponent } from "./mask.mjs";

/**
 * Separates the item from its background.
 *
 * Primary path is a segmentation model (@imgly/background-removal-node, U²-Net
 * class). It copes with what colour thresholding cannot: a speckled granite
 * depot floor that happens to be the same grey as the item, mixed lighting,
 * clutter in frame, and items running off the edge of the shot.
 *
 * The colour flood fill is kept as a fallback for when the model is
 * unavailable — no network on first run, or a restricted machine. It is
 * markedly weaker, so the caller is told which one produced the mask.
 *
 * @returns { mask, width, height, method }
 */
export async function segment(inputPath, workSize) {
  try {
    return await mlMask(inputPath, workSize);
  } catch (e) {
    const reason = (e && e.message) || String(e);
    const fallback = await colourMask(inputPath, workSize);
    return { ...fallback, mlError: reason };
  }
}

async function mlMask(inputPath, workSize) {
  const { removeBackground } = await import("@imgly/background-removal-node");

  const blob = await removeBackground(inputPath);
  const cut = Buffer.from(await blob.arrayBuffer());

  // The model returns RGBA with the background fully transparent, so its
  // alpha channel is the mask.
  const img = sharp(cut).ensureAlpha();
  const meta = await img.metadata();
  const scale = workSize / Math.max(meta.width, meta.height);
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));

  const { data } = await img
    .resize(w, h, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;

  const comp = largestComponent(mask, w, h);
  if (comp.size / (w * h) < 0.01) {
    throw new Error("The segmentation model found no item in this photo.");
  }

  return { mask: comp.mask, width: w, height: h, method: "model" };
}

async function colourMask(inputPath, workSize) {
  const src = sharp(inputPath).rotate();
  const meta = await src.metadata();
  const scale = workSize / Math.max(meta.width, meta.height);
  const w = Math.max(1, Math.round(meta.width * scale));
  const h = Math.max(1, Math.round(meta.height * scale));

  const { data } = await src
    .clone()
    .resize(w, h, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const built = buildMask(data, w, h);
  if (!built) throw new Error("Could not analyse the photo.");

  const comp = largestComponent(built.mask, w, h);
  return {
    mask: comp.mask,
    width: w,
    height: h,
    method: "colour",
    coverage: comp.size / (w * h),
  };
}
