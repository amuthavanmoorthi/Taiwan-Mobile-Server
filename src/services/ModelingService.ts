import { ProductAdminModel } from "../models/ProductAdminModel.js";
import { runLocalPipeline } from "./providers/localPipeline.js";
import { runSplatPipeline, splatConversionAvailable } from "./providers/splatPipeline.js";
import {
  runPhotosPipeline,
  photosPipelineAvailable,
  MIN_VIEWS,
} from "./providers/photosPipeline.js";

/**
 * SERVICE - photo-to-3D generation.
 *
 * Pluggable on purpose. `MODELING_PROVIDER` selects the backend:
 *
 *   none   - default. Queues the job and fails it with a clear message.
 *            Nothing is fabricated: a listing without a real model must never
 *            show an invented one, least of all in a government demo.
 *   meshy  - commercial single-image API (paid).
 *   local  - Garychou's own reconstruction pipeline.
 *
 * Two of the three paths are ours rather than providers, so they work with no
 * configuration at all: splat conversion (.ply -> GLB + USDZ), and multi-view
 * silhouette carving from several photographs. Carving is preferred whenever
 * there are enough views, because a single photo can only be extruded.
 *
 * Single-photo generation recovers a plausible mesh but NOT absolute scale,
 * and it invents the unseen faces. Callers pass the staff-measured height so
 * the result can be scaled to something real - without that, AR at 1:1 would
 * be confidently wrong, which is worse than no AR.
 */

export type ModelJob = {
  productId: string;
  /** Lead photo, or a 3DGS .ply to convert. */
  sourcePath: string;
  /** Every photo, when there are enough to carve from. */
  photoPaths?: string[];
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

  /** Multi-view carving is ours too, so it does not need a provider set. */
  get carvingAvailable() {
    return photosPipelineAvailable();
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
      modelProgress: 0,
      modelStage: "starting",
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

    // Several photos beat one, so carving is tried first and the provider is
    // only reached when there are too few views for it. Both scale to the
    // measured height, so the result is interchangeable from here up.
    const views = job.photoPaths ?? [];
    if (views.length >= MIN_VIEWS && photosPipelineAvailable()) {
      const { glbUrl, usdzUrl } = await runPhotosPipeline(
        views,
        job.heightMm,
        (pct, stage) => {
          // Fire and forget: a failed progress write must never fail the job
          // it is reporting on.
          void ProductAdminModel.update(job.productId, {
            modelProgress: pct,
            modelStage: stage,
          }).catch(() => {});
        },
      );
      await ProductAdminModel.update(job.productId, {
        glbUrl,
        usdzUrl,
        modelStatus: "review",
        // Corrected here rather than at intake: which method runs is not known
        // until the job does, and a model carved from eight views should not
        // be labelled as coming from one photo.
        modelSource: "multi_photo",
        modelError: null,
        modelProgress: 100,
        modelStage: "done",
      });
      return;
    }

    if (PROVIDER === "none") {
      await ProductAdminModel.update(job.productId, {
        modelStatus: "failed",
        modelError:
          views.length > 0 && views.length < MIN_VIEWS
            ? `Generating 3D needs at least ${MIN_VIEWS} photos from different angles; ` +
              `${views.length} were uploaded. The outlines are compared across angles to ` +
              `carve the shape, and one angle cannot tell depth.`
            : "No modelling provider configured. Set MODELING_PROVIDER=local or =meshy.",
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
