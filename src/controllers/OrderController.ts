import { ProductModel } from "../models/ProductModel.js";
import { OrderModel } from "../models/OrderModel.js";
import { PaymentService } from "../services/PaymentService.js";
import { HttpError } from "../lib/errors.js";

/** CONTROLLER — checkout and the buyer's own orders. */
export const OrderController = {
  async create(
    input: {
      productId?: string;
      buyerName?: string;
      buyerPhone?: string;
      buyerEmail?: string;
      slotId?: string;
    },
    session?: { sub: string; role: string },
  ) {
    // Depot staff release stock; they cannot buy it.
    if (session && session.role !== "buyer") {
      throw new HttpError("Depot accounts cannot purchase listings.", 403);
    }

    const { productId, buyerName, buyerPhone, buyerEmail, slotId } = input;
    if (!productId || !buyerName || !buyerPhone || !slotId) {
      throw new HttpError("Missing required fields.", 400);
    }

    const product = await ProductModel.findById(productId);
    if (!product) throw new HttpError("Product not found.", 404);
    if (product.status !== "listed") {
      throw new HttpError("This item is no longer available.", 409);
    }

    const payment = await PaymentService.charge({
      amountTwd: product.priceTwd,
      description: product.title,
    });

    return OrderModel.createAndReserve({
      productId,
      siteId: product.siteId,
      slotId,
      userId: session?.sub,
      buyerName,
      buyerPhone,
      buyerEmail,
      amountTwd: product.priceTwd,
      paymentRef: payment.reference,
      status: payment.status,
    });
  },

  async detail(id: string, session?: { sub: string; role: string }) {
    const order = await OrderModel.findById(id);
    if (!order) throw new HttpError("Order not found.", 404);

    // A buyer may only read their own orders; staff may read any.
    const isStaff = session?.role === "staff" || session?.role === "admin";
    if (!isStaff && order.userId && order.userId !== session?.sub) {
      throw new HttpError("You do not have access to this order.", 403);
    }
    return order;
  },

  listForUser(userId: string) {
    return OrderModel.findForUser(userId);
  },
};
