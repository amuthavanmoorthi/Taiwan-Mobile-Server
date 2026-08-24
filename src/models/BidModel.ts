import { db } from "../lib/db.js";

/** MODEL — auction bids. */
export const BidModel = {
  highestFor(productId: string) {
    return db.bid.findFirst({
      where: { productId },
      orderBy: { amountTwd: "desc" },
      include: { user: true },
    });
  },

  create(data: { productId: string; userId: string; amountTwd: number }) {
    return db.bid.create({ data });
  },

  findForUser(userId: string) {
    return db.bid.findMany({
      where: { userId },
      include: { product: { include: { site: true } } },
      orderBy: { createdAt: "desc" },
    });
  },

  countFor(productId: string) {
    return db.bid.count({ where: { productId } });
  },
};
