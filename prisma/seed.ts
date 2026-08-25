import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth.js";

const db = new PrismaClient();

/**
 * Demo data modelled on the client's live listings: district-level depots,
 * a seller unit per site, a mix of fixed-price and auction items.
 */

const PICKUP_TERMS = `1.本物件為經清潔隊〔二手回收〕後整理之堪用品，非新品(如照片所示)，購買前敬請三思。
2.購買者請一律自行取貨，恕不接受貨運載送。
3.請於結帳時預約取貨時段，並於預約時間內到場取貨。
4.每週六、日為休息日，恕不提供取貨服務。`;

async function main() {
  await db.productView.deleteMany();
  await db.bid.deleteMany();
  await db.order.deleteMany();
  await db.pickupSlot.deleteMany();
  await db.product.deleteMany();
  await db.user.deleteMany();
  await db.site.deleteMany();

  const xindian = await db.site.create({
    data: {
      name: "新北市再生家具展售中心",
      district: "新店區(倉庫)",
      address: "231 新北市新店區安康路二段120號B1",
      phone: "0908-796-705",
      openHours: "平日 09:00-18:00",
      sellerUnit: "新北市政府環境保護局",
      sellerContact: "張小姐",
      sellerEmail: "recycle@ntpc.gov.tw",
    },
  });

  const tucheng = await db.site.create({
    data: {
      name: "新北市土城區公所5樓",
      district: "土城區",
      address: "新北市土城區金城路一段101號",
      phone: "02-2273-2020#565",
      openHours: "平日 08:00-12:00、13:30-17:30",
      sellerUnit: "土城區清潔隊",
      sellerContact: "劉明衡",
      sellerEmail: "aj2739@ntpc.gov.tw",
    },
  });

  const banqiao = await db.site.create({
    data: {
      name: "新北市板橋區清潔隊",
      district: "板橋區",
      // From the EPB's published 各區清潔隊聯絡資料 dataset. The contact name
      // and mailbox that used to sit here were invented, and 02-2960-3456 is
      // the bureau switchboard, not this depot.
      address: "新北市板橋區實踐路3號",
      phone: "02-89534369",
      openHours: "請先電話預約取貨時間",
      sellerUnit: "板橋區清潔隊",
    },
  });

  await db.user.createMany({
    data: [
      {
        email: "staff@ntpc.gov.tw",
        passwordHash: hashPassword("demo1234"),
        name: "站點人員",
        role: "staff",
        siteId: xindian.id,
      },
      {
        email: "admin@ntpc.gov.tw",
        passwordHash: hashPassword("demo1234"),
        name: "平台管理者",
        role: "admin",
      },
      {
        email: "buyer@example.com",
        passwordHash: hashPassword("demo1234"),
        name: "王小明",
        phone: "0912-345-678",
        role: "buyer",
      },
    ],
  });

  const slots = [];
  for (const site of [xindian, tucheng, banqiao]) {
    for (let day = 1; day <= 7; day++) {
      for (const hour of [10, 15]) {
        const startsAt = new Date();
        startsAt.setDate(startsAt.getDate() + day);
        startsAt.setHours(hour, 0, 0, 0);
        const endsAt = new Date(startsAt);
        endsAt.setHours(hour + 2);
        slots.push({ siteId: site.id, startsAt, endsAt, capacity: 4 });
      }
    }
  }
  await db.pickupSlot.createMany({ data: slots });

  const in14Days = new Date();
  in14Days.setDate(in14Days.getDate() + 14);

  await db.product.createMany({
    data: [
      {
        title: "實木餐椅",
        description: "住家汰換之實木餐椅，結構穩固，坐墊有使用痕跡。",
        category: "kitchen-dining-chair",
        material: "實木",
        color: "胡桃木色",
        grade: "B",
        defects: "前腳有磨損；坐墊有小面積污漬。",
        widthMm: 450, depthMm: 500, heightMm: 900,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 450,
        status: "listed",
        siteId: xindian.id,
        pickupTerms: PICKUP_TERMS,
        glbUrl: "/models/chair-1.glb",
        usdzUrl: "/models/chair-1.usdz",
      },
      {
        title: "辦公電腦椅",
        description: "可調整高度之辦公椅，滾輪順暢，氣壓桿正常。",
        category: "study-computer-chair",
        material: "網布、塑鋼",
        color: "黑色",
        grade: "B",
        defects: "扶手泡棉略有塌陷。",
        widthMm: 600, depthMm: 600, heightMm: 1050,
        scaleSource: "manual",
        saleMode: "auction",
        priceTwd: 800,
        startingBidTwd: 350,
        bidEndsAt: in14Days,
        status: "listed",
        siteId: tucheng.id,
        pickupTerms: PICKUP_TERMS,
        glbUrl: "/models/chair-2.glb",
        usdzUrl: "/models/chair-2.usdz",
      },
      {
        title: "雙層收納推車",
        description: "金屬雙層推車，附滾輪，適合廚房或工作間使用。",
        category: "kitchen-storage",
        material: "烤漆鋼",
        color: "白色",
        grade: "A",
        widthMm: 600, depthMm: 400, heightMm: 800,
        scaleSource: "manual",
        saleMode: "auction",
        priceTwd: 600,
        startingBidTwd: 210,
        bidEndsAt: in14Days,
        status: "listed",
        siteId: banqiao.id,
        pickupTerms: PICKUP_TERMS,
        glbUrl: "/models/cart.glb",
        usdzUrl: "/models/cart.usdz",
      },
      {
        title: "木質茶几",
        description: "小型客廳茶几，桌面有輕微刮痕。",
        category: "living-coffee-table",
        material: "木心板",
        color: "原木色",
        grade: "B",
        defects: "桌面右側有一道刮痕。",
        widthMm: 900, depthMm: 500, heightMm: 420,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 380,
        status: "listed",
        siteId: xindian.id,
        pickupTerms: PICKUP_TERMS,
        glbUrl: "/models/coffee-table.glb",
        usdzUrl: "/models/coffee-table.usdz",
      },
      {
        title: "三層收納櫃",
        description: "三層收納櫃，抽屜滑軌正常。",
        category: "living-storage",
        material: "塑合板",
        color: "白色",
        grade: "C",
        defects: "側板有水漬痕跡，底部輕微膨脹。",
        widthMm: 400, depthMm: 400, heightMm: 700,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 250,
        status: "listed",
        siteId: tucheng.id,
        pickupTerms: PICKUP_TERMS,
        glbUrl: "/models/cabinet.glb",
        usdzUrl: "/models/cabinet.usdz",
      },
      {
        title: "單人木床架",
        description: "單人床架，無床墊，結構完整。",
        category: "study-single-bed",
        material: "實木",
        color: "深棕色",
        grade: "B",
        widthMm: 1050, depthMm: 1900, heightMm: 400,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 900,
        status: "listed",
        siteId: banqiao.id,
        pickupTerms: PICKUP_TERMS,
        glbUrl: "/models/bed.glb",
        usdzUrl: "/models/bed.usdz",
      },

      // The three below were built by scripts/photo-to-3d.mjs from actual
      // depot photographs, not modelled by hand. They are the honest sample of
      // what the intake pipeline produces: a silhouette extrusion carrying the
      // photograph as its texture. Read straight on they look right; walked
      // around, the sides are flat. That is the point of showing them.
      //
      // thumbnailUrl is the source photograph, so the listing shows the input
      // and the output side by side.
      {
        title: "收納穿鞋椅",
        description:
          "清潔隊回收之收納穿鞋椅，上層軟墊、下層開放層板與抽屜。本件 3D 由現場單張照片自動生成。",
        category: "living-shoe-rack",
        material: "木芯板、布面",
        color: "淺木色",
        grade: "B",
        defects: "檯面邊角有輕微碰撞痕；抽屜面板顏色與本體略有色差。",
        widthMm: 1000, depthMm: 320, heightMm: 450,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 600,
        status: "listed",
        siteId: banqiao.id,
        pickupTerms: PICKUP_TERMS,
        thumbnailUrl: "/models/gen-bench.jpg",
        glbUrl: "/models/gen-bench.glb",
        usdzUrl: "/models/gen-bench.usdz",
        modelStatus: "ready",
        modelSource: "single_photo",
      },
      {
        title: "紅色塑膠椅凳",
        description:
          "常見之塑膠高腳椅凳，防滑座面，堪用。本件 3D 由現場單張照片自動生成。",
        category: "living-chair",
        material: "塑膠",
        color: "紅色",
        grade: "C",
        defects: "表面褪色，椅腳有刮痕。",
        widthMm: 320, depthMm: 320, heightMm: 470,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 120,
        status: "listed",
        siteId: xindian.id,
        pickupTerms: PICKUP_TERMS,
        thumbnailUrl: "/models/gen-stool.jpg",
        glbUrl: "/models/gen-stool.glb",
        usdzUrl: "/models/gen-stool.usdz",
        modelStatus: "ready",
        modelSource: "single_photo",
      },
      {
        title: "實木方形茶几",
        description:
          "實木方形茶几，下層附置物層板，漆面完整。本件 3D 由現場單張照片自動生成。",
        category: "living-coffee-table",
        material: "實木",
        color: "紅木色",
        grade: "A",
        defects: "檯面有數處淺層刮痕。",
        widthMm: 800, depthMm: 800, heightMm: 420,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 1500,
        status: "listed",
        siteId: banqiao.id,
        pickupTerms: PICKUP_TERMS,
        thumbnailUrl: "/models/gen-table.jpg",
        glbUrl: "/models/gen-table.glb",
        usdzUrl: "/models/gen-table.usdz",
        modelStatus: "ready",
        modelSource: "single_photo",
      },

      // The only item here built from a Gaussian splat scan rather than a
      // photo. It carries both representations on purpose: the .ply is the
      // truer likeness and drives the on-page viewer, while the mesh exists
      // solely so the AR button works - AR Quick Look cannot render splats,
      // and most buyers here are on iPhone.
      {
        title: "三層收納推車",
        description:
          "三層附輪收納推車，層板完整、滾輪順暢。本件以 3D 高斯潑濺掃描建檔，可旋轉檢視掃描原檔，或切換至 3D / AR 以實際尺寸擺放於家中。",
        category: "living-storage",
        material: "塑膠、金屬",
        color: "白色",
        grade: "B",
        defects: "層板有使用痕跡；部分表面泛黃。",
        widthMm: 500, depthMm: 520, heightMm: 800,
        scaleSource: "manual",
        saleMode: "fixed",
        priceTwd: 350,
        status: "listed",
        siteId: xindian.id,
        pickupTerms: PICKUP_TERMS,
        thumbnailUrl: "/models/gen-trolley.jpg",
        glbUrl: "/models/gen-trolley.glb",
        usdzUrl: "/models/gen-trolley.usdz",
        splatUrl: "/models/gen-trolley.ply",
        modelStatus: "ready",
        modelSource: "gaussian_splat",
      },
    ],
  });

  console.log(`Seeded 3 sites, 3 users, ${slots.length} slots, 10 products.`);
  console.log("Logins - staff@ntpc.gov.tw / admin@ntpc.gov.tw / buyer@example.com, all demo1234");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
