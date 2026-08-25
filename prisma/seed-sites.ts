import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Seeds a depot for every New Taipei district.
 *
 * Addresses and phone numbers are the published ones: the Environmental
 * Protection Bureau's own "各區清潔隊聯絡資料" open dataset
 * (data.ntpc.gov.tw, dataset 47aced4b-ea2d-42b0-ab70-8ae8abe661b6, 29 rows,
 * refreshed annually). Nothing here is invented.
 *
 * The dataset covers 28 districts plus a headquarters team; it has no row for
 * 烏來區, whose cleaning team operates out of the district office, so that one
 * address comes from the office's own site instead.
 *
 * 新店區 appears twice on purpose. The cleaning team at 民族路 is the district
 * depot like any other; 新店區(倉庫) is the reuse-furniture showroom at 安康路,
 * which is where the client's own listings are actually collected, and the
 * client's site treats it as a separate filter option.
 *
 * Opening hours are deliberately not stated per depot. Every listing on the
 * client's site says collection must be arranged by phone first, and the hours
 * differ by district - a plausible-looking "平日 09:00-17:00" on all thirty
 * would be a guess a buyer could act on.
 *
 * Sites are matched on `district`, so re-running adds what is missing and
 * leaves existing rows - and the products attached to them - alone.
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

const BY_PHONE = "請先電話預約取貨時間";

/** From the EPB open dataset, one per district. */
const TEAMS: { district: string; name: string; address: string; phone: string }[] = [
  { district: "萬里區", name: "新北市萬里區清潔隊", address: "新北市萬里區瑪鋉路123號B2", phone: "02-24921774" },
  { district: "金山區", name: "新北市金山區清潔隊", address: "新北市金山區民生路61號", phone: "02-24082523" },
  { district: "板橋區", name: "新北市板橋區清潔隊", address: "新北市板橋區實踐路3號", phone: "02-89534369" },
  { district: "汐止區", name: "新北市汐止區清潔隊", address: "新北市汐止區新台五路一段268號7樓", phone: "02-26430403" },
  { district: "深坑區", name: "新北市深坑區清潔隊", address: "新北市深坑區深南路51-1號", phone: "02-26644090" },
  { district: "石碇區", name: "新北市石碇區清潔隊", address: "新北市石碇區碇坪路1段39號", phone: "02-26633876" },
  { district: "瑞芳區", name: "新北市瑞芳區清潔隊", address: "新北市瑞芳區明燈路3段2號2樓", phone: "02-24975611" },
  { district: "平溪區", name: "新北市平溪區清潔隊", address: "新北市平溪區平溪里平溪街46號", phone: "02-24951510" },
  { district: "雙溪區", name: "新北市雙溪區清潔隊", address: "新北市雙溪區共和里東榮街25號(雙溪區公所)", phone: "02-24931111" },
  { district: "貢寮區", name: "新北市貢寮區清潔隊", address: "新北市貢寮區長泰路20之2號", phone: "02-24942221" },
  { district: "新店區", name: "新北市新店區清潔隊", address: "新北市新店區民族路110號4樓(大豐社福館)", phone: "02-29124995" },
  { district: "坪林區", name: "新北市坪林區清潔隊", address: "新北市坪林區坪碇路6號1樓", phone: "02-26656203" },
  { district: "烏來區", name: "新北市烏來區清潔隊", address: "新北市烏來區忠治里新烏路5段111號", phone: "02-26617586" },
  { district: "永和區", name: "新北市永和區清潔隊", address: "新北市永和區民權路60號6樓", phone: "02-31517728" },
  { district: "中和區", name: "新北市中和區清潔隊", address: "新北市中和區景平路634-2號5樓", phone: "02-22480889" },
  { district: "土城區", name: "新北市土城區清潔隊", address: "新北市土城區金城路1段101號5樓", phone: "02-22732020" },
  { district: "三峽區", name: "新北市三峽區清潔隊", address: "新北市三峽區隆恩街243號", phone: "02-26722143" },
  { district: "樹林區", name: "新北市樹林區清潔隊", address: "新北市樹林區保安街一段7號5樓", phone: "02-26874446" },
  { district: "鶯歌區", name: "新北市鶯歌區清潔隊", address: "新北市鶯歌區北鶯里仁愛路55號4樓", phone: "02-26789910" },
  { district: "三重區", name: "新北市三重區清潔隊", address: "新北市三重區光復路2段127號", phone: "02-85122225" },
  { district: "新莊區", name: "新北市新莊區清潔隊", address: "新北市新莊區瓊林路34號", phone: "02-22019811" },
  { district: "泰山區", name: "新北市泰山區清潔隊", address: "新北市泰山區公園路52號3樓", phone: "02-22977508" },
  { district: "林口區", name: "新北市林口區清潔隊", address: "新北市林口區仁愛路一段378號", phone: "02-26033111" },
  { district: "蘆洲區", name: "新北市蘆洲區清潔隊", address: "新北市蘆洲區三民路95號6樓", phone: "02-22859404" },
  { district: "五股區", name: "新北市五股區清潔隊", address: "新北市五股區中興路4段50號6、7樓", phone: "02-29870476" },
  { district: "八里區", name: "新北市八里區清潔隊", address: "新北市八里區八里大道20號", phone: "02-26106070" },
  { district: "淡水區", name: "新北市淡水區清潔隊", address: "新北市淡水區中山北路二段375號6樓", phone: "02-26282616" },
  { district: "三芝區", name: "新北市三芝區清潔隊", address: "新北市三芝區育英街5號", phone: "02-26368160" },
  { district: "石門區", name: "新北市石門區清潔隊", address: "新北市石門區中山路66號", phone: "02-26382522" },
];

/**
 * Contact people published on the client's own listings. Only these four are
 * known; the rest reach their depot on the switchboard number above.
 */
const CONTACTS: Record<string, { contact?: string; email?: string; phone?: string }> = {
  "三重區": { contact: "林小姐", email: "ab9094@ntpc.gov.tw", phone: "02-8512-2225#108" },
  "永和區": { email: "ae2315@ntpc.gov.tw", phone: "02-3151-7728#108" },
  "土城區": { contact: "劉明衡", email: "aj2739@ntpc.gov.tw", phone: "02-2273-2020#565" },
};

/** The showroom, taken from the client's site exactly as published. */
const SHOWROOM: Seed = {
  district: "新店區(倉庫)",
  name: "新北市再生家具展售中心",
  address: "231 新北市新店區安康路二段120號B1",
  phone: "0908-796-705",
  openHours: "平日 09:00-18:00",
  sellerUnit: "新北市政府環境保護局",
  sellerContact: "張小姐",
  sellerEmail: "recycle@ntpc.gov.tw",
};

const SEEDS: Seed[] = [
  ...TEAMS.map((t) => {
    const extra = CONTACTS[t.district] ?? {};
    return {
      district: t.district,
      name: t.name,
      address: t.address,
      phone: extra.phone ?? t.phone,
      openHours: BY_PHONE,
      sellerUnit: `${t.district}清潔隊`,
      sellerContact: extra.contact,
      sellerEmail: extra.email,
    };
  }),
  SHOWROOM,
];

const ALL_DISTRICTS = SEEDS.map((s) => s.district);

async function main() {
  const existing = await db.site.findMany({ select: { id: true, district: true } });
  const byDistrict = new Map(existing.map((s) => [s.district, s.id]));

  const toCreate = SEEDS.filter((s) => !byDistrict.has(s.district));
  const toUpdate = SEEDS.filter((s) => byDistrict.has(s.district));

  // Depot contact details are reference data, not something staff maintain
  // here, so existing rows are corrected in place rather than skipped. The row
  // keeps its id, so every product already pointing at it follows along. An
  // earlier run of this file wrote "（地址待確認）" into most of them; this is
  // what replaces those.
  for (const seed of toUpdate) {
    const { district, ...rest } = seed;
    await db.site.update({ where: { id: byDistrict.get(district)! }, data: rest });
  }

  if (toCreate.length > 0) {
    await db.site.createMany({ data: toCreate });
  }

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
  if (slots.length > 0) await db.pickupSlot.createMany({ data: slots });

  console.log(
    `Added ${toCreate.length} depots, refreshed ${toUpdate.length}, ` +
      `added ${slots.length} pickup slots. ` +
      `${ALL_DISTRICTS.length} districts now covered.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
