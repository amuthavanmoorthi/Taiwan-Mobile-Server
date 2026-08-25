import { ProductModel, type ProductFilters } from "../models/ProductModel.js";
import { ProductViewModel } from "../models/ProductViewModel.js";
import { BidModel } from "../models/BidModel.js";
import { SiteModel } from "../models/SiteModel.js";
import { HttpError } from "../lib/errors.js";

/** CONTROLLER - storefront reads plus bidding. */
export const ProductController = {
  search(filters: ProductFilters) {
    return ProductModel.search(filters);
  },

  async facets() {
    const [bounds, sites, categoryCounts] = await Promise.all([
      ProductModel.priceBounds(),
      SiteModel.findAll(),
      ProductModel.categoryCounts(),
    ]);
    return { priceBounds: bounds, sites, categoryCounts };
  },

  highlights() {
    return ProductModel.highlights();
  },

  async detail(id: string, userId?: string) {
    const product = await ProductModel.findById(id);
    if (!product) throw new HttpError("Product not found.", 404);

    // Recording the view is best-effort; a failure here must not break the page.
    if (userId) {
      await ProductViewModel.record(userId, id).catch(() => {});
    }

    const highest = await BidModel.highestFor(id);
    return {
      ...product,
      highestBid: highest?.amountTwd ?? null,
      bidCount: await BidModel.countFor(id),
    };
  },

  async placeBid(productId: string, userId: string, role: string, amountTwd: number) {
    // Depot staff run the auctions, so they cannot bid in them.
    if (role !== "buyer") {
      throw new HttpError("Depot accounts cannot bid on listings.", 403);
    }

    const product = await ProductModel.findById(productId);
    if (!product) throw new HttpError("Product not found.", 404);
    if (product.saleMode !== "auction") {
      throw new HttpError("This item is not up for auction.", 400);
    }
    if (product.status !== "listed") {
      throw new HttpError("This item is no longer available.", 409);
    }
    if (product.bidEndsAt && product.bidEndsAt < new Date()) {
      throw new HttpError("Bidding has closed on this item.", 409);
    }

    const highest = await BidModel.highestFor(productId);
    const floor = highest?.amountTwd ?? product.startingBidTwd ?? product.priceTwd;
    if (!Number.isFinite(amountTwd) || amountTwd <= floor) {
      throw new HttpError(`Your bid must be higher than NT$${floor}.`, 400);
    }

    return BidModel.create({ productId, userId, amountTwd });
  },
};
