import { ProductAdminModel, type InventoryFilters } from "../models/ProductAdminModel.js";
import { UserModel } from "../models/UserModel.js";
import { ProductModel } from "../models/ProductModel.js";
import { UploadService } from "../services/UploadService.js";
import { ModelingService } from "../services/ModelingService.js";
import { HttpError } from "../lib/errors.js";

type Files = Record<string, Express.Multer.File[]>;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** CONTROLLER — depot staff creating and editing listings. */
export const InventoryController = {
  /** Scope: staff are pinned to their depot, admins see every site. */
  async scopeFor(userId: string) {
    const staff = await UserModel.findById(userId);
    return staff?.role === "admin" ? null : (staff?.siteId ?? null);
  },

  async list(userId: string, filters: InventoryFilters = {}) {
    const siteId = await InventoryController.scopeFor(userId);
    return ProductAdminModel.search({ ...filters, siteId });
  },

  async create(userId: string, body: Record<string, string>, files: Files) {
    const staff = await UserModel.findById(userId);
    const siteId = body.siteId || staff?.siteId;
    if (!siteId) {
      throw new HttpError("No depot assigned. Choose a site for this listing.", 400);
    }
    if (!body.title?.trim()) throw new HttpError("Title is required.", 400);

    const price = num(body.priceTwd);
    if (price == null || price < 0) throw new HttpError("A valid price is required.", 400);

    // 1:1 AR placement is the whole point, so a listing cannot go live
    // without real measurements.
    const widthMm = num(body.widthMm);
    const depthMm = num(body.depthMm);
    const heightMm = num(body.heightMm);
    const status = body.status === "listed" ? "listed" : "draft";
    if (status === "listed" && (!widthMm || !depthMm || !heightMm)) {
      throw new HttpError(
        "Width, depth and height are required before an item can be listed.",
        400,
      );
    }

    const uploadedModel = !!files.glb?.[0];
    const photo = files.photo?.[0];
    // Generation only makes sense from a photo, and only when no model was
    // uploaded outright.
    const wantsGeneration = body.generateModel === "true" && !!photo && !uploadedModel;

    const saleMode = body.saleMode === "auction" ? "auction" : "fixed";
    const startingBidTwd = saleMode === "auction" ? num(body.startingBidTwd) : null;
    if (saleMode === "auction" && startingBidTwd == null) {
      throw new HttpError("An auction needs a starting bid.", 400);
    }

    return ProductAdminModel.create({
      title: body.title.trim(),
      description: body.description || null,
      category: body.category || "misc-other",
      material: body.material || null,
      color: body.color || null,
      grade: ["A", "B", "C"].includes(body.grade) ? body.grade : "B",
      defects: body.defects || null,
      widthMm,
      depthMm,
      heightMm,
      // Recorded so it is clear how absolute scale was established —
      // photogrammetry alone cannot recover it.
      scaleSource: body.scaleSource || "manual",
      saleMode,
      priceTwd: price,
      startingBidTwd,
      bidEndsAt: body.bidEndsAt ? new Date(body.bidEndsAt) : null,
      pickupTerms: body.pickupTerms || null,
      siteId,
      thumbnailUrl: UploadService.urlFor(files.photo?.[0]?.filename),
      glbUrl: UploadService.urlFor(files.glb?.[0]?.filename),
      usdzUrl: UploadService.urlFor(files.usdz?.[0]?.filename),
      // A generated listing is held as a draft until its model is reviewed,
      // so an unchecked model can never reach a buyer.
      status: wantsGeneration ? "draft" : status,
      publishAfterReview: wantsGeneration && status === "listed",
      modelStatus: uploadedModel ? "ready" : wantsGeneration ? "queued" : "none",
      modelSource: uploadedModel ? "upload" : wantsGeneration ? "single_photo" : null,
    }).then(async (product) => {
      if (wantsGeneration && photo) {
        await InventoryController.requestModel(product.id, photo.path, heightMm);
      }
      return product;
    });
  },

  /** Accepts the generated model and applies the operator's original intent. */
  async approveModel(id: string) {
    const product = await ProductModel.findById(id);
    if (!product) throw new HttpError("Product not found.", 404);
    if (product.modelStatus !== "review") {
      throw new HttpError("This item has no model awaiting review.", 409);
    }
    return ProductAdminModel.update(id, {
      modelStatus: "ready",
      status: product.publishAfterReview ? "listed" : "draft",
    });
  },

  /**
   * Discards the generated model and lists the item with its photo only.
   * The files are left on disk; only the references are cleared, so a
   * rejected result can still be inspected if someone asks why.
   */
  async rejectModel(id: string, reason?: string) {
    const product = await ProductModel.findById(id);
    if (!product) throw new HttpError("Product not found.", 404);
    if (product.modelStatus !== "review" && product.modelStatus !== "failed") {
      throw new HttpError("This item has no model awaiting review.", 409);
    }
    return ProductAdminModel.update(id, {
      glbUrl: null,
      usdzUrl: null,
      modelStatus: "rejected",
      modelError: reason?.trim() || null,
      status: product.publishAfterReview ? "listed" : "draft",
    });
  },

  /** Lists the item with photo only after a failed generation. */
  async listWithoutModel(id: string) {
    const product = await ProductModel.findById(id);
    if (!product) throw new HttpError("Product not found.", 404);
    return ProductAdminModel.update(id, {
      status: product.publishAfterReview ? "listed" : "draft",
    });
  },

  /** Kicks off generation after the product row exists. */
  async requestModel(productId: string, photoPath: string, heightMm?: number | null) {
    ModelingService.enqueue({ productId, photoPath, heightMm });
  },

  async setStatus(id: string, status: string) {
    const allowed = ["draft", "pending_review", "listed", "delisted"];
    if (!allowed.includes(status)) throw new HttpError("Unknown status.", 400);
    return ProductAdminModel.update(id, { status });
  },
};
