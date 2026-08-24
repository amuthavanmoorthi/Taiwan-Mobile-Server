import { db } from "../lib/db.js";
import type { Prisma } from "@prisma/client";

export type InventoryFilters = {
  siteId?: string | null;
  q?: string;
  status?: string;
  modelStatus?: string;
  category?: string;
  grade?: string;
  district?: string;
  /** "missing_model" | "missing_usdz" | "missing_size" — data-quality gaps. */
  issue?: string;
  sort?: string;
  page?: number;
  perPage?: number;
};

/** MODEL — writes and admin-side reads for Product. */
export const ProductAdminModel = {
  create(data: Prisma.ProductUncheckedCreateInput) {
    return db.product.create({ data, include: { site: true } });
  },

  update(id: string, data: Prisma.ProductUncheckedUpdateInput) {
    return db.product.update({ where: { id }, data, include: { site: true } });
  },

  /**
   * Depot inventory with filters and pagination. Written to stay usable once
   * a site holds thousands of rows rather than a demo handful.
   */
  async search(f: InventoryFilters) {
    const page = Math.max(1, f.page ?? 1);
    const perPage = Math.min(100, f.perPage ?? 20);

    const where: Prisma.ProductWhereInput = {
      // Staff are pinned to their own depot; admins pass null and see all.
      ...(f.siteId ? { siteId: f.siteId } : {}),
      ...(f.q ? { title: { contains: f.q } } : {}),
      ...(f.status && f.status !== "all" ? { status: f.status } : {}),
      ...(f.modelStatus && f.modelStatus !== "all" ? { modelStatus: f.modelStatus } : {}),
      ...(f.category && f.category !== "all" ? { category: f.category } : {}),
      ...(f.grade && f.grade !== "all" ? { grade: f.grade } : {}),
      ...(f.district && f.district !== "all" ? { site: { district: f.district } } : {}),
      ...(f.issue === "missing_model" ? { glbUrl: null } : {}),
      ...(f.issue === "missing_usdz" ? { usdzUrl: null, NOT: { glbUrl: null } } : {}),
      ...(f.issue === "missing_size"
        ? { OR: [{ widthMm: null }, { depthMm: null }, { heightMm: null }] }
        : {}),
    };

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      f.sort === "oldest"
        ? { createdAt: "asc" }
        : f.sort === "price_asc"
          ? { priceTwd: "asc" }
          : f.sort === "price_desc"
            ? { priceTwd: "desc" }
            : f.sort === "title"
              ? { title: "asc" }
              : { createdAt: "desc" };

    const [items, total, statusRows] = await Promise.all([
      db.product.findMany({
        where,
        include: { site: true },
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.product.count({ where }),
      // Counts ignore the status filter so the tabs always show real totals.
      db.product.groupBy({
        by: ["status"],
        where: { ...where, status: undefined },
        _count: { _all: true },
      }),
    ]);

    return {
      items,
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
      statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, r._count._all])),
    };
  },
};
