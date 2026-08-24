import { db } from "../lib/db.js";
import type { Prisma } from "@prisma/client";

export type ProductFilters = {
  category?: string;
  q?: string;
  district?: string;
  grade?: string;
  minPrice?: number;
  maxPrice?: number;
  saleMode?: string;
  sort?: string;
  page?: number;
  perPage?: number;
};

/** MODEL — all Product data access. */
export const ProductModel = {
  buildWhere({
    category,
    q,
    district,
    grade,
    minPrice,
    maxPrice,
    saleMode,
  }: ProductFilters): Prisma.ProductWhereInput {
    return {
      status: "listed",
      ...(category && category !== "all" ? { category } : {}),
      ...(q ? { title: { contains: q } } : {}),
      ...(district && district !== "all" ? { site: { district } } : {}),
      ...(grade && grade !== "all" ? { grade } : {}),
      ...(saleMode && saleMode !== "all" ? { saleMode } : {}),
      ...(minPrice != null || maxPrice != null
        ? {
            priceTwd: {
              ...(minPrice != null ? { gte: minPrice } : {}),
              ...(maxPrice != null ? { lte: maxPrice } : {}),
            },
          }
        : {}),
    };
  },

  orderBy(sort?: string): Prisma.ProductOrderByWithRelationInput {
    if (sort === "price_asc") return { priceTwd: "asc" };
    if (sort === "price_desc") return { priceTwd: "desc" };
    if (sort === "ending_soon") return { bidEndsAt: "asc" };
    return { createdAt: "desc" };
  },

  async search(filters: ProductFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(48, filters.perPage ?? 12);
    const where = ProductModel.buildWhere(filters);

    const [items, total] = await Promise.all([
      db.product.findMany({
        where,
        include: { site: true, _count: { select: { bids: true } } },
        orderBy: ProductModel.orderBy(filters.sort),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.product.count({ where }),
    ]);

    return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
  },

  findById(id: string) {
    return db.product.findUnique({
      where: { id },
      include: {
        site: true,
        bids: { orderBy: { amountTwd: "desc" }, take: 5, include: { user: true } },
      },
    });
  },

  /** Live count per category key, for the sidebar tree. */
  async categoryCounts() {
    const rows = await db.product.groupBy({
      by: ["category"],
      where: { status: "listed" },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.category, r._count._all]));
  },

  /** Newest listings and the auctions closing soonest, for the landing page. */
  async highlights() {
    const [latest, endingSoon, popular] = await Promise.all([
      db.product.findMany({
        where: { status: "listed" },
        include: { site: true },
        orderBy: { createdAt: "desc" },
        take: 8,
      }),
      db.product.findMany({
        where: { status: "listed", saleMode: "auction", bidEndsAt: { gte: new Date() } },
        include: { site: true, _count: { select: { bids: true } } },
        orderBy: { bidEndsAt: "asc" },
        take: 4,
      }),
      db.product.findMany({
        where: { status: "listed" },
        include: { site: true, _count: { select: { views: true } } },
        orderBy: { views: { _count: "desc" } },
        take: 8,
      }),
    ]);
    return { latest, endingSoon, popular };
  },

  /** Price range across listed stock, for the filter slider bounds. */
  async priceBounds() {
    const agg = await db.product.aggregate({
      where: { status: "listed" },
      _min: { priceTwd: true },
      _max: { priceTwd: true },
    });
    return { min: agg._min.priceTwd ?? 0, max: agg._max.priceTwd ?? 0 };
  },

  setStatus(id: string, status: string) {
    return db.product.update({ where: { id }, data: { status } });
  },
};
