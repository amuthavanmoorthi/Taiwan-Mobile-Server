import { UserModel } from "../models/UserModel.js";
import { SiteModel } from "../models/SiteModel.js";
import { hashPassword } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

/**
 * CONTROLLER — provisioning the depot team.
 *
 * Public registration only ever creates buyers, so without this an operator
 * had no way to add a depot worker or move one between depots: staff existed
 * only because the seed put them there.
 *
 * Admin-only, enforced on the route. Every check here is repeated server-side
 * rather than trusted to the UI that calls it.
 */

/** What an account can be set to. "buyer" is the offboarding path: it strips
 *  depot access while leaving the person's orders and bids intact, which
 *  deleting them cannot do. */
const ROLES = ["staff", "admin", "buyer"] as const;
type Role = (typeof ROLES)[number];

type Member = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  siteId: string | null;
  site: { id: string; name: string; district: string } | null;
  createdAt: Date;
};

const publicMember = (u: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  siteId: string | null;
  site?: { id: string; name: string; district: string } | null;
  createdAt: Date;
}): Member => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  role: u.role,
  siteId: u.siteId,
  site: u.site ? { id: u.site.id, name: u.site.name, district: u.site.district } : null,
  createdAt: u.createdAt,
});

/**
 * Staff see only their own depot's orders and inventory, so a staff account
 * without one sees nothing at all and looks broken. Admins are deliberately
 * unscoped and must not carry a depot.
 */
async function resolvePosting(role: Role, siteId?: string | null) {
  if (role !== "staff") return null;
  if (!siteId) throw new HttpError("Choose the depot this person works at.", 400);
  if (!(await SiteModel.findById(siteId))) throw new HttpError("Unknown depot.", 400);
  return siteId;
}

function checkRole(role: string | undefined, allowed: readonly Role[]): Role {
  if (!role || !allowed.includes(role as Role)) {
    throw new HttpError(`Role must be one of: ${allowed.join(", ")}.`, 400);
  }
  return role as Role;
}

export const TeamController = {
  async list() {
    const [team, sites] = await Promise.all([UserModel.findTeam(), SiteModel.findAll()]);
    return { team: team.map(publicMember), sites };
  },

  async create(input: {
    email?: string;
    password?: string;
    name?: string;
    phone?: string;
    role?: string;
    siteId?: string | null;
  }) {
    const { email, password, name, phone } = input;
    if (!email || !password || !name) {
      throw new HttpError("Email, password and name are required.", 400);
    }
    if (password.length < 8) {
      throw new HttpError("Password must be at least 8 characters.", 400);
    }
    if (await UserModel.findByEmail(email)) {
      throw new HttpError("That email is already registered.", 409);
    }

    // A new account created here is always a team member; buyers sign
    // themselves up.
    const role = checkRole(input.role, ["staff", "admin"]);
    const siteId = await resolvePosting(role, input.siteId);

    const user = await UserModel.create({
      email,
      passwordHash: hashPassword(password),
      name,
      phone: phone ?? null,
      role,
      siteId,
    });
    return publicMember(await UserModel.findById(user.id).then((u) => u!));
  },

  /** Change someone's role or move them to another depot. */
  async update(
    actingUserId: string,
    id: string,
    input: { role?: string; siteId?: string | null },
  ) {
    const target = await UserModel.findById(id);
    if (!target) throw new HttpError("Not found.", 404);
    if (target.role === "buyer") {
      throw new HttpError("That account is a buyer, not a team member.", 400);
    }

    const role = checkRole(input.role ?? target.role, ROLES);
    const siteId = await resolvePosting(role, input.siteId ?? target.siteId);

    // Demoting the last admin would lock everyone out of this page, and there
    // is no other way back in short of editing the database by hand.
    if (target.role === "admin" && role !== "admin") {
      if (target.id === actingUserId) {
        throw new HttpError("You cannot remove your own administrator access.", 400);
      }
      if ((await UserModel.countByRole("admin")) <= 1) {
        throw new HttpError("This is the only administrator left.", 400);
      }
    }

    return publicMember(await UserModel.setPosting(id, { role, siteId }));
  },

  /** Issue a new password. The old one is never shown or recoverable. */
  async resetPassword(id: string, password?: string) {
    if (!password || password.length < 8) {
      throw new HttpError("Password must be at least 8 characters.", 400);
    }
    const target = await UserModel.findById(id);
    if (!target) throw new HttpError("Not found.", 404);

    await UserModel.setPassword(id, hashPassword(password));
    return { ok: true };
  },

  async remove(actingUserId: string, id: string) {
    if (id === actingUserId) throw new HttpError("You cannot delete your own account.", 400);

    const target = await UserModel.findById(id);
    if (!target) throw new HttpError("Not found.", 404);
    if (target.role === "admin" && (await UserModel.countByRole("admin")) <= 1) {
      throw new HttpError("This is the only administrator left.", 400);
    }

    // Orders, bids and FAQ rows reference the user, so deleting would either
    // fail at the database or orphan a record someone still needs. Say which,
    // instead of returning a foreign-key error.
    const { orders, bids, faqs } = await UserModel.workload(id);
    if (orders + bids + faqs > 0) {
      throw new HttpError(
        `Cannot delete: this account is attached to ${orders} order(s), ` +
          `${bids} bid(s) and ${faqs} FAQ entr(ies). Set the role to buyer ` +
          `instead — that removes depot access and keeps the records.`,
        409,
      );
    }

    await UserModel.remove(id);
    return { ok: true };
  },
};
