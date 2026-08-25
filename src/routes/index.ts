import { Router } from "express";
import { AuthController } from "../controllers/AuthController.js";
import { ProductController } from "../controllers/ProductController.js";
import { OrderController } from "../controllers/OrderController.js";
import { StaffController } from "../controllers/StaffController.js";
import { TeamController } from "../controllers/TeamController.js";
import { AccountController } from "../controllers/AccountController.js";
import { SiteModel } from "../models/SiteModel.js";
import { InventoryController } from "../controllers/InventoryController.js";
import { ModelingService } from "../services/ModelingService.js";
import { FaqController } from "../controllers/FaqController.js";
import { upload, UploadService } from "../services/UploadService.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

/**
 * ROUTES - thin. Parse the request, call a controller, return JSON.
 * No business logic and no Prisma calls live here.
 */
export const router = Router();

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Sends whatever the controller returns; funnels throws to the error handler. */
const wrap =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  async (req: any, res: any, next: any) => {
    try {
      res.json(await fn(req, res));
    } catch (e) {
      next(e);
    }
  };

router.get("/health", (_req, res) =>
  res.json({
    ok: true,
    modelling: ModelingService.available,
    provider: ModelingService.provider,
    splat: ModelingService.splatAvailable,
  }),
);

// --- auth ---------------------------------------------------------------
router.post(
  "/auth/register",
  wrap(async (req: any) => AuthController.register(req.body)),
);
router.post(
  "/auth/login",
  wrap(async (req: any) => AuthController.login(req.body?.email, req.body?.password)),
);
router.get(
  "/auth/me",
  requireAuth,
  wrap(async (req: any) => AuthController.me(req.session.sub)),
);
router.patch(
  "/auth/me",
  requireAuth,
  wrap(async (req: any) => AuthController.updateProfile(req.session.sub, req.body)),
);

// --- catalogue ----------------------------------------------------------
router.get(
  "/products",
  wrap(async (req: any) =>
    ProductController.search({
      category: req.query.category,
      q: req.query.q,
      district: req.query.district,
      grade: req.query.grade,
      saleMode: req.query.saleMode,
      sort: req.query.sort,
      minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      perPage: req.query.perPage ? Number(req.query.perPage) : 12,
    }),
  ),
);
router.get("/facets", wrap(async () => ProductController.facets()));
router.get("/highlights", wrap(async () => ProductController.highlights()));
router.get(
  "/products/:id",
  wrap(async (req: any) => ProductController.detail(req.params.id, req.session?.sub)),
);
router.post(
  "/products/:id/bids",
  requireAuth,
  wrap(async (req: any) =>
    ProductController.placeBid(
      req.params.id,
      req.session.sub,
      req.session.role,
      Number(req.body?.amountTwd),
    ),
  ),
);

// --- sites and slots ----------------------------------------------------
router.get("/sites", wrap(async () => SiteModel.findAll()));
router.get(
  "/sites/:id/slots",
  wrap(async (req: any) => SiteModel.availableSlots(req.params.id)),
);

// --- orders -------------------------------------------------------------
router.post(
  "/orders",
  wrap(async (req: any) => OrderController.create(req.body, req.session)),
);
router.get(
  "/orders/:id",
  wrap(async (req: any) => OrderController.detail(req.params.id, req.session)),
);

// --- buyer account ------------------------------------------------------
router.get(
  "/account",
  requireAuth,
  wrap(async (req: any) => AccountController.overview(req.session.sub)),
);

// --- staff --------------------------------------------------------------
router.get(
  "/staff/dashboard",
  requireRole("staff", "admin"),
  wrap(async (req: any) => StaffController.dashboard(req.session.sub)),
);
// --- depot inventory (upload) -------------------------------------------
router.get(
  "/staff/inventory",
  requireRole("staff", "admin"),
  wrap(async (req: any) =>
    InventoryController.list(req.session.sub, {
      q: req.query.q,
      status: req.query.status,
      modelStatus: req.query.modelStatus,
      category: req.query.category,
      grade: req.query.grade,
      district: req.query.district,
      issue: req.query.issue,
      sort: req.query.sort,
      page: req.query.page ? Number(req.query.page) : 1,
      perPage: req.query.perPage ? Number(req.query.perPage) : 20,
    }),
  ),
);
router.get(
  "/staff/orders",
  requireRole("staff", "admin"),
  wrap(async (req: any) =>
    StaffController.orders(req.session.sub, {
      q: req.query.q,
      status: req.query.status,
      district: req.query.district,
      from: req.query.from,
      to: req.query.to,
      sort: req.query.sort,
      page: req.query.page ? Number(req.query.page) : 1,
      perPage: req.query.perPage ? Number(req.query.perPage) : 20,
    }),
  ),
);

// --- FAQ ----------------------------------------------------------------
router.get("/faqs", wrap(async (req: any) => FaqController.list(req.query.locale)));
router.get(
  "/staff/faqs",
  requireRole("staff", "admin"),
  wrap(async (req: any) => FaqController.listAll(req.query.locale)),
);
router.post(
  "/staff/faqs",
  requireRole("staff", "admin"),
  wrap(async (req: any) => FaqController.create(req.session.sub, req.body)),
);
router.patch(
  "/staff/faqs/:id",
  requireRole("staff", "admin"),
  wrap(async (req: any) => FaqController.update(req.params.id, req.body)),
);
router.delete(
  "/staff/faqs/:id",
  requireRole("staff", "admin"),
  wrap(async (req: any) => FaqController.remove(req.params.id)),
);
router.post(
  "/staff/inventory",
  requireRole("staff", "admin"),
  upload.fields([
    // Frames pulled from a video land here too, so the ceiling is generous.
    { name: "photo", maxCount: 12 },
    { name: "glb", maxCount: 1 },
    { name: "usdz", maxCount: 1 },
    { name: "splat", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  wrap(async (req: any) =>
    InventoryController.create(req.session.sub, req.body, req.files ?? {}),
  ),
);
router.get(
  "/staff/inventory/:id",
  requireRole("staff", "admin"),
  wrap(async (req: any) => ProductController.detail(req.params.id)),
);
router.post(
  "/staff/inventory/:id/model/approve",
  requireRole("staff", "admin"),
  wrap(async (req: any) => InventoryController.approveModel(req.params.id)),
);
router.post(
  "/staff/inventory/:id/model/reject",
  requireRole("staff", "admin"),
  wrap(async (req: any) =>
    InventoryController.rejectModel(req.params.id, req.body?.reason),
  ),
);
router.post(
  "/staff/inventory/:id/list-without-model",
  requireRole("staff", "admin"),
  wrap(async (req: any) => InventoryController.listWithoutModel(req.params.id)),
);
router.patch(
  "/staff/inventory/:id/status",
  requireRole("staff", "admin"),
  wrap(async (req: any) => InventoryController.setStatus(req.params.id, req.body?.status)),
);

// Staff-only rather than on /health: it reports a filesystem path, and there
// is no reason for that to be public.
router.get(
  "/staff/storage",
  requireRole("staff", "admin"),
  wrap(async () => UploadService.storage()),
);

router.post(
  "/staff/verify",
  requireRole("staff", "admin"),
  wrap(async (req: any) => StaffController.verify(req.body?.code, req.body?.staffName)),
);

// --- team provisioning (admin only) -------------------------------------
// Deliberately not under /staff: depot workers must not be able to grant
// themselves a different depot, or promote themselves to admin.
router.get(
  "/admin/team",
  requireRole("admin"),
  wrap(async () => TeamController.list()),
);
router.post(
  "/admin/team",
  requireRole("admin"),
  wrap(async (req: any) => TeamController.create(req.body)),
);
router.patch(
  "/admin/team/:id",
  requireRole("admin"),
  wrap(async (req: any) => TeamController.update(req.session.sub, req.params.id, req.body)),
);
router.post(
  "/admin/team/:id/password",
  requireRole("admin"),
  wrap(async (req: any) => TeamController.resetPassword(req.params.id, req.body?.password)),
);
router.delete(
  "/admin/team/:id",
  requireRole("admin"),
  wrap(async (req: any) => TeamController.remove(req.session.sub, req.params.id)),
);
