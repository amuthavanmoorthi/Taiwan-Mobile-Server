import { db } from "../lib/db.js";
import { makeOrderCode } from "../lib/auth.js";

/** MODEL - all Order data access. */
export const OrderModel = {
  findById(id: string) {
    return db.order.findUnique({
      where: { id },
      include: { product: true, site: true, slot: true },
    });
  },

  findByCode(code: string) {
    return db.order.findUnique({
      where: { code },
      include: { product: true, site: true, slot: true },
    });
  },

  findForUser(userId: string) {
    return db.order.findMany({
      where: { userId },
      include: { product: true, site: true, slot: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Depot queue, optionally scoped to the staff member's own site. */
  findByStatus(status: string, siteId?: string | null, take?: number) {
    return db.order.findMany({
      where: { status, ...(siteId ? { siteId } : {}) },
      include: { product: true, slot: true, site: true },
      orderBy: status === "collected" ? { collectedAt: "desc" } : { createdAt: "asc" },
      ...(take ? { take } : {}),
    });
  },

  /** Creates the order and reserves the product in one transaction. */
  createAndReserve(data: {
    productId: string;
    siteId: string;
    slotId: string;
    userId?: string | null;
    buyerName: string;
    buyerPhone: string;
    buyerEmail?: string | null;
    amountTwd: number;
    paymentRef: string;
    status: string;
  }) {
    return db.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          ...data,
          code: makeOrderCode(),
          buyerEmail: data.buyerEmail ?? null,
          userId: data.userId ?? null,
        },
        include: { product: true, site: true, slot: true },
      });
      await tx.product.update({
        where: { id: data.productId },
        data: { status: "reserved" },
      });
      return order;
    });
  },

  markCollected(orderId: string, productId: string, staff?: string) {
    return db.$transaction([
      db.order.update({
        where: { id: orderId },
        data: {
          status: "collected",
          collectedAt: new Date(),
          collectedBy: staff ?? null,
        },
      }),
      db.product.update({ where: { id: productId }, data: { status: "sold" } }),
    ]);
  },
};
