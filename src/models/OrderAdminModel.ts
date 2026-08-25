import { db } from "../lib/db.js";
import type { Prisma } from "@prisma/client";

export type OrderFilters = {
  siteId?: string | null;
  q?: string;
  status?: string;
  district?: string;
  from?: string;
  to?: string;
  sort?: string;
  page?: number;
  perPage?: number;
};

/** MODEL - admin-side order queries: the pickup queue and collected history. */
export const OrderAdminModel = {
  async search(f: OrderFilters) {
    const page = Math.max(1, f.page ?? 1);
    const perPage = Math.min(100, f.perPage ?? 20);

    // One box searches code, buyer name and phone - staff have a person at
    // the counter and whichever detail they have to hand should work.
    const where: Prisma.OrderWhereInput = {
      ...(f.siteId ? { siteId: f.siteId } : {}),
      ...(f.status && f.status !== "all" ? { status: f.status } : {}),
      ...(f.district && f.district !== "all" ? { site: { district: f.district } } : {}),
      ...(f.q
        ? {
            OR: [
              { code: { contains: f.q.toUpperCase() } },
              { buyerName: { contains: f.q } },
              { buyerPhone: { contains: f.q } },
              { product: { title: { contains: f.q } } },
            ],
          }
        : {}),
      ...(f.from || f.to
        ? {
            createdAt: {
              ...(f.from ? { gte: new Date(f.from) } : {}),
              ...(f.to ? { lte: new Date(`${f.to}T23:59:59`) } : {}),
            },
          }
        : {}),
    };

    const orderBy: Prisma.OrderOrderByWithRelationInput =
      f.sort === "oldest"
        ? { createdAt: "asc" }
        : f.sort === "collected"
          ? { collectedAt: "desc" }
          : { createdAt: "desc" };

    const [items, total, statusRows, sum] = await Promise.all([
      db.order.findMany({
        where,
        include: { product: true, site: true, slot: true },
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.order.count({ where }),
      db.order.groupBy({
        by: ["status"],
        where: { ...where, status: undefined },
        _count: { _all: true },
      }),
      db.order.aggregate({ where, _sum: { amountTwd: true } }),
    ]);

    return {
      items,
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
      statusCounts: Object.fromEntries(statusRows.map((r) => [r.status, r._count._all])),
      totalTwd: sum._sum.amountTwd ?? 0,
    };
  },
};
