import { db } from "../lib/db.js";

/** MODEL - sites and their bookable pickup slots. */
export const SiteModel = {
  findById(id: string) {
    return db.site.findUnique({ where: { id } });
  },

  findAll() {
    return db.site.findMany({ orderBy: { district: "asc" } });
  },

  /** Future slots at a site that still have capacity. */
  async availableSlots(siteId: string, take = 14) {
    const slots = await db.pickupSlot.findMany({
      where: { siteId, startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
      take,
      include: { _count: { select: { orders: true } } },
    });
    return slots.filter((s) => s._count.orders < s.capacity);
  },
};
