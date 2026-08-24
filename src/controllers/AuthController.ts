import { UserModel } from "../models/UserModel.js";
import { hashPassword, verifyPassword, signToken } from "../lib/auth.js";
import { HttpError } from "../lib/errors.js";

const publicUser = (u: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  siteId: string | null;
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  role: u.role,
  siteId: u.siteId,
});

/** CONTROLLER — registration, login, and the current session. */
export const AuthController = {
  async register(input: {
    email?: string;
    password?: string;
    name?: string;
    phone?: string;
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

    // Public registration only ever creates buyers. Staff are provisioned
    // by an operator, never self-service.
    const user = await UserModel.create({
      email,
      passwordHash: hashPassword(password),
      name,
      phone: phone ?? null,
      role: "buyer",
    });

    return { user: publicUser(user), token: signToken({ sub: user.id, role: user.role }) };
  },

  async login(email?: string, password?: string) {
    if (!email || !password) throw new HttpError("Email and password are required.", 400);

    const user = await UserModel.findByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError("Incorrect email or password.", 401);
    }

    return { user: publicUser(user), token: signToken({ sub: user.id, role: user.role }) };
  },

  async me(userId: string) {
    const user = await UserModel.findById(userId);
    if (!user) throw new HttpError("Not found.", 404);
    return publicUser(user);
  },

  async updateProfile(userId: string, input: { name?: string; phone?: string }) {
    const user = await UserModel.update(userId, {
      name: input.name,
      phone: input.phone ?? null,
    });
    return publicUser(user);
  },
};
