import { OrderModel } from "../models/OrderModel.js";
import { OrderAdminModel, type OrderFilters } from "../models/OrderAdminModel.js";
import { UserModel } from "../models/UserModel.js";
import { HttpError } from "../lib/errors.js";

/** CONTROLLER - depot queue and voucher verification. */
export const StaffController = {
  async dashboard(userId: string) {
    const staff = await UserModel.findById(userId);
    // Staff see only their own depot; admins see everything.
    const siteId = staff?.role === "admin" ? null : staff?.siteId ?? null;

    const [pending, collected] = await Promise.all([
      OrderModel.findByStatus("paid", siteId),
      OrderModel.findByStatus("collected", siteId, 8),
    ]);
    return { pending, collected, site: staff?.site ?? null };
  },

  /** Filtered, paginated order list for the depot. */
  async orders(userId: string, filters: OrderFilters = {}) {
    const staff = await UserModel.findById(userId);
    const siteId = staff?.role === "admin" ? null : (staff?.siteId ?? null);
    return OrderAdminModel.search({ ...filters, siteId });
  },

  async verify(code: string | undefined, staffName?: string) {
    if (!code) throw new HttpError("No code supplied.", 400);

    const order = await OrderModel.findByCode(code.trim().toUpperCase());
    if (!order) throw new HttpError(`Unknown code ${code}.`, 404);
    if (order.status === "collected") throw new HttpError("Already collected.", 409);
    if (order.status !== "paid") {
      throw new HttpError(`Cannot release: order is ${order.status}.`, 409);
    }

    await OrderModel.markCollected(order.id, order.productId, staffName);
    return { ok: true, product: order.product.title, code: order.code };
  },
};
