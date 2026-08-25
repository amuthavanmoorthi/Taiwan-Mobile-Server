import { db } from "../lib/db.js";

/** MODEL - all User data access. Controllers never touch `db`. */
export const UserModel = {
  findByEmail(email: string) {
    return db.user.findUnique({ where: { email }, include: { site: true } });
  },

  findById(id: string) {
    return db.user.findUnique({ where: { id }, include: { site: true } });
  },

  create(data: {
    email: string;
    passwordHash: string;
    name: string;
    phone?: string | null;
    role?: string;
    siteId?: string | null;
  }) {
    return db.user.create({ data });
  },

  update(id: string, data: { name?: string; phone?: string | null }) {
    return db.user.update({ where: { id }, data });
  },

  /** Everyone who can reach the depot area, newest first. */
  findTeam() {
    return db.user.findMany({
      where: { role: { in: ["staff", "admin"] } },
      include: { site: true },
      orderBy: { createdAt: "desc" },
    });
  },

  /** Role and depot assignment. Separate from `update` so ordinary profile
   *  edits can never reach these two fields. */
  setPosting(id: string, data: { role?: string; siteId?: string | null }) {
    return db.user.update({ where: { id }, data, include: { site: true } });
  },

  setPassword(id: string, passwordHash: string) {
    return db.user.update({ where: { id }, data: { passwordHash } });
  },

  countByRole(role: string) {
    return db.user.count({ where: { role } });
  },

  remove(id: string) {
    return db.user.delete({ where: { id } });
  },

  /** Rows that would block a delete, so the reason can name them. */
  async workload(id: string) {
    const [orders, bids, faqs] = await Promise.all([
      db.order.count({ where: { userId: id } }),
      db.bid.count({ where: { userId: id } }),
      db.faq.count({ where: { createdById: id } }),
    ]);
    return { orders, bids, faqs };
  },
};
