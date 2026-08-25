import { OrderModel } from "../models/OrderModel.js";
import { BidModel } from "../models/BidModel.js";
import { ProductViewModel } from "../models/ProductViewModel.js";

/** CONTROLLER - the buyer's account: orders, bids, recently viewed. */
export const AccountController = {
  async overview(userId: string) {
    const [orders, bids, views] = await Promise.all([
      OrderModel.findForUser(userId),
      BidModel.findForUser(userId),
      ProductViewModel.findForUser(userId),
    ]);
    return { orders, bids, views };
  },
};
