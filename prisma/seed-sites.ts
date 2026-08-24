import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Seeds a depot for every New Taipei district.
 *
 * The client's live site filters by these 30 entries, and each district's
 * cleaning team acts as its own seller and collection point. Sites are matched
 * on `district`, so re-running this adds what is missing and leaves existing
 * rows — and the products attached to them — alone.
 *
 * Addresses and phone numbers here are placeholders except for the three that
 * came from the client's own pages. Replace them with the real district office
 * details before anything goes live.
 */

type Seed = {
  district: string;
  name: string;
  address: string;
  phone?: string;
  openHours?: string;
  sellerUnit: string;
  sellerContact?: string;
  sellerEmail?: string;
};

/** The three taken from the client's site, kept exactly as published. */
const KNOWN: Seed[] = [
  {
    district: "新店區(倉庫)",
    name: "新北市再生家具展售中心",
    address: "231 新北市新店區安康路二段120號B1",
    phone: "0908-796-705",
    openHours: "平日 09:00-18:00",
    sellerUnit: "新北市政府環境保護局",
    sellerContact: "張小姐",
    sellerEmail: "recycle@ntpc.gov.tw",
  },
  {
    district: "土城區",
    name: "新北市土城區公所5樓",
    address: "新北市土城區金城路一段101號",
    phone: "02-2273-2020#565",
    openHours: "平日 08:00-12:00、13:30-17:30",
    sellerUnit: "土城區清潔隊",
    sellerContact: "劉明衡",
    sellerEmail: "aj2739@ntpc.gov.tw",
  },
  {
    district: "板橋區",
    name: "新北市板橋區清潔隊",
    address: "新北市板橋區中正路１號",
    phone: "02-2960-3456",
    openHours: "平日 09:00-17:00",
    sellerUnit: "板橋區清潔隊",
    sellerContact: "陳先生",
    sellerEmail: "banqiao@ntpc.gov.tw",
  },
];

const ALL_DISTRICTS = [
  "萬里區", "金山區", "板橋區", "汐止區", "深坑區", "石碇區", "瑞芳區",
  "平溪區", "雙溪區", "貢寮區", "新店區", "坪林區", "烏來區", "永和區",
  "中和區", "土城區", "三峽區", "樹林區", "鶯歌區", "三重區", "新莊區",
  "泰山區", "林口區", "蘆洲區", "五股區", "八里區", "淡水區", "三芝區",
  "石門區", "新店區(倉庫)",
];

function placeholder(district: string): Seed {
  const bare = district.replace(/區.*$/, "區");
  return {
    district,
    name: `新北市${bare}清潔隊`,
    // Marked so nobody mistakes it for a verified address.
    address: `新北市${bare}（地址待確認）`,
    openHours: "平日 09:00-17:00",
    sellerUnit: `${bare}清潔隊`,
  };
}

async function main() {
  const existing = await db.site.findMany({ select: { district: true } });
  const have = new Set(existing.map((s) => s.district));

  const known = new Map(KNOWN.map((k) => [k.district, k]));
  const toCreate = ALL_DISTRICTS.filter((d) => !have.has(d)).map(
    (d) => known.get(d) ?? placeholder(d),
  );

  if (toCreate.length === 0) {
    console.log(`All ${ALL_DISTRICTS.length} districts already have a depot.`);
    return;
  }

  await db.site.createMany({ data: toCreate });

  // Two pickup slots a day for the next week at each new depot, matching the
  // pattern the original seed uses.
  const created = await db.site.findMany({
    where: { district: { in: toCreate.map((t) => t.district) } },
    select: { id: true },
  });

  const slots = [];
  for (const site of created) {
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

  console.log(
    `Added ${toCreate.length} depots and ${slots.length} pickup slots. ` +
      `${ALL_DISTRICTS.length} districts now covered.`,
  );
  console.log("Placeholder addresses are marked 地址待確認 — replace before launch.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
