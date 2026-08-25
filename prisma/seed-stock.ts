import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Gives every district something to show.
 *
 * The district picker offers thirty depots while the demo data sat in three,
 * so twenty-seven of them returned an empty grid. That reads as a broken site
 * rather than an empty depot, and it is the first thing anyone clicking around
 * the demo runs into.
 *
 * Additive and idempotent: a depot that already has a listed item is left
 * alone, so this can be re-run after seed.ts without duplicating anything and
 * without touching stock staff have entered themselves.
 */

const PICKUP_TERMS = `1.本物件為經清潔隊〔二手回收〕後整理之堪用品，非新品(如照片所示)，購買前敬請三思。
2.購買者請一律自行取貨，恕不接受貨運載送。
3.請於結帳時預約取貨時段，並於預約時間內到場取貨。
4.每週六、日為休息日，恕不提供取貨服務。`;

/**
 * Every entry points at a model that actually ships in the frontend's
 * public/models, so each listing gets a working 3D view and AR button.
 * Dimensions are the ones the models were built to.
 */
type Template = {
  title: string;
  description: string;
  category: string;
  material: string;
  color: string;
  grade: string;
  defects: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  priceTwd: number;
  model: string;
};

const CATALOGUE: Template[] = [
  {
    title: "實木餐椅",
    description: "住家汰換之實木餐椅，結構穩固，坐墊有使用痕跡。",
    category: "kitchen-dining-chair",
    material: "實木", color: "胡桃木色", grade: "B",
    defects: "前腳有磨損；坐墊有小面積污漬。",
    widthMm: 450, depthMm: 500, heightMm: 900, priceTwd: 450, model: "chair-1",
  },
  {
    title: "辦公電腦椅",
    description: "可調整高度之辦公椅，滾輪順暢，氣壓桿正常。",
    category: "study-computer-chair",
    material: "網布、塑鋼", color: "黑色", grade: "B",
    defects: "扶手泡棉略有塌陷。",
    widthMm: 600, depthMm: 600, heightMm: 1050, priceTwd: 800, model: "chair-2",
  },
  {
    title: "二層置物推車",
    description: "附輪置物推車，推行順暢，層板完整。",
    category: "living-storage",
    material: "金屬", color: "銀灰色", grade: "B",
    defects: "側邊有輕微刮痕。",
    widthMm: 600, depthMm: 400, heightMm: 800, priceTwd: 300, model: "cart",
  },
  {
    title: "木質茶几",
    description: "客廳用木質茶几，桌面平整，無結構性損傷。",
    category: "living-coffee-table",
    material: "木心板", color: "淺木色", grade: "B",
    defects: "桌面有數處淺層刮痕。",
    widthMm: 900, depthMm: 500, heightMm: 420, priceTwd: 600, model: "coffee-table",
  },
  {
    title: "三門收納櫃",
    description: "三門收納櫃，門片開闔正常，層板可調整。",
    category: "living-entry-cabinet",
    material: "木心板", color: "白色", grade: "B",
    defects: "櫃體底部有輕微受潮痕跡。",
    widthMm: 1200, depthMm: 400, heightMm: 800, priceTwd: 900, model: "cabinet",
  },
  {
    title: "單人床架",
    description: "單人床架，結構穩固，不含床墊。",
    category: "study-single-bed",
    material: "實木", color: "原木色", grade: "B",
    defects: "床頭板有使用痕跡。",
    widthMm: 1050, depthMm: 1900, heightMm: 400, priceTwd: 1200, model: "bed",
  },
  {
    title: "收納穿鞋椅",
    description: "上層軟墊、下層開放層板與抽屜，適合玄關使用。",
    category: "living-shoe-rack",
    material: "木芯板、布面", color: "淺木色", grade: "B",
    defects: "檯面邊角有輕微碰撞痕。",
    widthMm: 1000, depthMm: 320, heightMm: 450, priceTwd: 600, model: "gen-bench",
  },
  {
    title: "塑膠椅凳",
    description: "常見之塑膠高腳椅凳，防滑座面，堪用。",
    category: "living-chair",
    material: "塑膠", color: "紅色", grade: "C",
    defects: "表面褪色，椅腳有刮痕。",
    widthMm: 320, depthMm: 320, heightMm: 470, priceTwd: 120, model: "gen-stool",
  },
  {
    title: "實木方形茶几",
    description: "實木方形茶几，下層附置物層板，漆面完整。",
    category: "living-coffee-table",
    material: "實木", color: "紅木色", grade: "A",
    defects: "檯面有數處淺層刮痕。",
    widthMm: 800, depthMm: 800, heightMm: 420, priceTwd: 1500, model: "gen-table",
  },
];

/**
 * Deterministic pick, so re-running against a fresh database produces the same
 * catalogue rather than a different random one each time.
 */
const pick = <T,>(list: T[], seed: number) => list[seed % list.length];

async function main() {
  const sites = await db.site.findMany({
    select: { id: true, district: true, _count: { select: { products: true } } },
    orderBy: { district: "asc" },
  });

  if (sites.length === 0) {
    console.error("No depots yet. Run seed-sites.ts first.");
    process.exit(1);
  }

  const empty = sites.filter((s) => s._count.products === 0);
  if (empty.length === 0) {
    console.log(`All ${sites.length} depots already have stock. Nothing to add.`);
    return;
  }

  const rows = empty.flatMap((site, siteIndex) =>
    // Three per depot: enough that a filtered page looks like a catalogue
    // rather than a placeholder, without burying the hand-made listings.
    [0, 1, 2].map((n) => {
      const t = pick(CATALOGUE, siteIndex * 3 + n);

      return {
        title: t.title,
        description: t.description,
        category: t.category,
        material: t.material,
        color: t.color,
        grade: t.grade,
        defects: t.defects,
        widthMm: t.widthMm,
        depthMm: t.depthMm,
        heightMm: t.heightMm,
        scaleSource: "manual",
        // Fixed price only: Carl asked for that mode first. Auctions still
        // work, they are just not what the demo leads with.
        saleMode: "fixed",
        priceTwd: t.priceTwd,
        status: "listed",
        siteId: site.id,
        pickupTerms: PICKUP_TERMS,
        glbUrl: `/models/${t.model}.glb`,
        usdzUrl: `/models/${t.model}.usdz`,
        modelStatus: "ready",
        modelSource: "upload",
      };
    }),
  );

  await db.product.createMany({ data: rows });

  console.log(
    `Added ${rows.length} listings across ${empty.length} depots. ` +
      `${sites.length} districts now have stock.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
