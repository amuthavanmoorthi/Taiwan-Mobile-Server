import { FaqModel } from "../models/FaqModel.js";
import { HttpError } from "../lib/errors.js";

/** CONTROLLER - public reads plus staff-managed writes. */
export const FaqController = {
  list(locale?: string) {
    return FaqModel.published(locale === "en" ? "en" : "zh");
  },

  listAll(locale?: string) {
    return FaqModel.all(locale);
  },

  async create(
    userId: string,
    body: {
      locale?: string;
      question?: string;
      answer?: string;
      sortOrder?: number;
      published?: boolean;
    },
  ) {
    if (!body.question?.trim()) throw new HttpError("A question is required.", 400);
    if (!body.answer?.trim()) throw new HttpError("An answer is required.", 400);

    return FaqModel.create({
      locale: body.locale === "en" ? "en" : "zh",
      question: body.question.trim(),
      answer: body.answer.trim(),
      sortOrder: Number(body.sortOrder) || 0,
      published: body.published !== false,
      createdById: userId,
    });
  },

  async update(id: string, body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    if (typeof body.question === "string") data.question = body.question.trim();
    if (typeof body.answer === "string") data.answer = body.answer.trim();
    if (body.sortOrder != null) data.sortOrder = Number(body.sortOrder) || 0;
    if (typeof body.published === "boolean") data.published = body.published;

    if (Object.keys(data).length === 0) throw new HttpError("Nothing to update.", 400);
    return FaqModel.update(id, data);
  },

  remove(id: string) {
    return FaqModel.remove(id);
  },
};
