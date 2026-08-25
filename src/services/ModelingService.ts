import { ProductAdminModel } from "../models/ProductAdminModel.js";
import { runLocalPipeline } from "./providers/localPipeline.js";
import { runSplatPipeline, splatConversionAvailable } from "./providers/splatPipeline.js";

/**
 * SERVICE — photo-to-3D generation.
 *
 * Pluggable on purpose. `MODELING_PROVIDER` selects the backend:
 *
 *   none   — default. Queues the job and fails it with a clear message.
 *            Nothing is fabricated: a listing without a real model must never
 *            show an invented one, least of all in a government demo.
 *   meshy  — commercial single-image API (paid).
 *   local  — Garychou's own reconstruction pipeline.
 *
 * Splat conversion (.ply → GLB + USDZ) is separate from all of that. It is
 * our own script rather than a provider, so it is always available.
 *
 * Single-photo generation recovers a plausible mesh but NOT absolute scale,
 * and it invents the unseen faces. Callers pass the staff-measured height so
 * the result can be scaled to something real — without that, AR at 1:1 would
 * be confidently wrong, which is worse than no AR.
 */

export type ModelJob = {
  productId: string;
  /** Photo for single-image generation, or a 3DGS .ply to convert. */
  sourcePath: string;
  kind: "photo" | "splat";
  /** Staff-measured height in mm, used to scale the generated mesh. */
  heightMm?: number | null;
};

const PROVIDER = process.env.MODELING_PROVIDER ?? "none";

export const ModelingService = {
  provider: PROVIDER,

  /** True when a real photo generator is configured. */
  get available() {
    return PROVIDER !== "none";
  },

  /**
   * Splat conversion is ours, not a configured provider, so it works whether
   * or not MODELING_PROVIDER is set. Staff can upload a .ply from Garychou
   * even on a deployment with no photo pipeline.
   */
  get splatAvailable() {
    return splatConversionAvailable();
  },

  /**
   * Runs a job in the background. Deliberately fire-and-forget: generation
   * takes minutes and the PRD allows listing with a thumbnail first.
   */
  enqueue(job: ModelJob) {
    void ModelingService.run(job).catch(async (e) => {
      await ProductAdminModel.update(job.productId, {
        modelStatus: "failed",
        modelError: (e as Error).message,
      });
    });
  },

  async run(job: ModelJob) {
    await ProductAdminModel.update(job.productId, {
      modelStatus: "processing",
      modelError: null,
    });

    // Height anchors the model to reality on both paths. A splat file carries
    // no unit at all, so this is not optional there either.
    if (!job.heightMm || job.heightMm <= 0) {
      throw new Error(
        "Height (mm) is required so the generated model can be scaled to the real item.",
      );
    }

    if (job.kind === "splat") {
      const { glbUrl, usdzUrl } = await runSplatPipeline(job.sourcePath, job.heightMm);
      await ProductAdminModel.update(job.productId, {
        glbUrl,
        usdzUrl,
        modelStatus: "review",
        modelError: null,
      });
      return;
    }

    if (PROVIDER === "none") {
      await ProductAdminModel.update(job.productId, {
        modelStatus: "failed",
        modelError:
          "No modelling provider configured. Set MODELING_PROVIDER=local or =meshy.",
      });
      return;
    }

    if (PROVIDER === "local") {
      const { glbUrl, usdzUrl } = await runLocalPipeline(job.sourcePath, job.heightMm);
      // "review", not "ready": a generated model is never shown to buyers
      // before a person has looked at it.
      await ProductAdminModel.update(job.productId, {
        glbUrl,
        usdzUrl,
        modelStatus: "review",
        modelError: null,
      });
      return;
    }

    throw new Error(`Modelling provider "${PROVIDER}" is not implemented yet.`);
  },
};
