import { db } from "../lib/db.js";

/** MODEL — recently-viewed history for the buyer account page. */
export const ProductViewModel = {
  /** One row per user/product; re-viewing bumps the timestamp. */
  record(userId: string, productId: string) {
    return db.productView.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: { viewedAt: new Date() },
    });
  },

  findForUser(userId: string, take = 12) {
    return db.productView.findMany({
      where: { userId },
      include: { product: { include: { site: true } } },
      orderBy: { viewedAt: "desc" },
      take,
    });
  },
};
