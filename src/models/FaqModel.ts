import { db } from "../lib/db.js";

/** MODEL — FAQ entries. */
export const FaqModel = {
  published(locale: string) {
    return db.faq.findMany({
      where: { locale, published: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },

  all(locale?: string) {
    return db.faq.findMany({
      where: locale ? { locale } : {},
      orderBy: [{ locale: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
  },

  create(data: {
    locale: string;
    question: string;
    answer: string;
    sortOrder: number;
    published: boolean;
    createdById?: string | null;
  }) {
    return db.faq.create({ data });
  },

  update(
    id: string,
    data: Partial<{
      question: string;
      answer: string;
      sortOrder: number;
      published: boolean;
    }>,
  ) {
    return db.faq.update({ where: { id }, data });
  },

  remove(id: string) {
    return db.faq.delete({ where: { id } });
  },

  count() {
    return db.faq.count();
  },
};
