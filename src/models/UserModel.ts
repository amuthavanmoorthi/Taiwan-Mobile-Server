import { db } from "../lib/db.js";

/** MODEL — all User data access. Controllers never touch `db`. */
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
};
