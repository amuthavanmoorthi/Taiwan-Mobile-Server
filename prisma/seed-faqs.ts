import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Seeds the FAQ table from the copy that used to be hardcoded in the frontend.
 * Safe to re-run: it skips seeding if any rows already exist, so staff edits
 * are never overwritten.
 */

const ZH: [string, string][] = [
  ["我沒有收到認證 e-mail，怎麼辦？", "部分免費信箱會將認證信歸類為垃圾郵件，請先檢查垃圾郵件匣。\n請將本站網域加入信任名單，再於會員頁面重新寄送認證信。"],
  ["如何確保購買到的商品堪用？", "所有商品皆由清潔隊回收後整理，並於上架前人工分級。\n商品頁附有 3D 模型與瑕疵說明，建議先以 AR 於家中預覽實際尺寸。\n得標後可於取貨前至站點現場看貨。"],
  ["可否現場看貨？", "可以。得標後請先電話預約，於服務時間內至指定站點看貨。"],
  ["如何得知是否得標？", "競標結束後系統自動決標，結果會寄至您的註冊信箱，也可於「我的出價」查詢。"],
  ["如何取貨？", "請於結帳時預約取貨時段，並於預約時間內攜帶取貨憑證至站點。\n一律自行取貨，恕不提供貨運或宅配服務。\n請自備運送車輛並協助搬運。"],
  ["可否退貨？", "二手商品售出後恕不退換。若商品與說明有重大不符，請於取貨當場向站點人員反映。"],
  ["逾期未取貨會如何處理？", "自繳費完成起 30 日內未領貨者，視同放棄，商品將重新上架，款項依環保局規定辦理。"],
  ["AR 預覽需要安裝 App 嗎？", "不需要。以手機瀏覽商品頁並點選「在您的空間中預覽」即可開啟相機。\niOS 需 Safari，Android 需 Chrome，並允許相機權限。"],
  ["AR 顯示的尺寸準確嗎？", "模型以 1:1 實際比例呈現，尺寸經人員量測確認後上架。\nAR 擺放不可縮放模型，以避免誤判空間大小。"],
  ["忘記密碼怎麼辦？", "請於登入頁點選忘記密碼，系統將寄送重設連結至您的註冊信箱。"],
  ["如何修改會員資料？", "登入後於「我的帳戶」頁面編輯姓名與聯絡電話。信箱為帳號識別，恕無法自行變更。"],
  ["商品可以開立發票或收據嗎？", "依營運單位規定辦理，請於取貨時向站點人員洽詢。"],
];

const EN: [string, string][] = [
  ["I did not receive the verification email.", "Some free mail providers file it as spam - check that folder first.\nAdd our domain to your safe senders list, then resend from your account page."],
  ["How do I know the item is usable?", "Every item is recovered and refurbished by a district cleaning team, then graded by hand before listing.\nListings include a 3D model and wear notes. Preview it at real size in AR before bidding.\nWinners may inspect the item at the depot before collection."],
  ["Can I inspect before paying?", "Yes. Call to book, then visit the depot during service hours."],
  ["How do I know if I won?", "The system closes the auction automatically. Results are emailed and shown under My bids."],
  ["How does collection work?", "Book a slot at checkout and bring your voucher to the depot in that window.\nCollection is in person only - no courier or delivery service.\nBring your own vehicle and help with loading."],
  ["Can I return an item?", "Second-hand items are sold as seen. If an item materially differs from its description, raise it with staff at collection."],
  ["What if I do not collect in time?", "Items uncollected 30 days after payment are treated as abandoned and relisted. Refunds follow Bureau policy."],
  ["Does AR preview need an app?", "No. Open the listing on your phone and tap “View in your room”.\nUse Safari on iOS or Chrome on Android, and allow camera access."],
  ["Is the AR size accurate?", "Models render at 1:1 real scale, measured and confirmed by staff before listing.\nThe model cannot be resized in AR, so the space check stays honest."],
  ["I forgot my password.", "Use the forgotten password link on the sign-in page; a reset link goes to your registered email."],
  ["How do I change my details?", "Sign in and edit your name and phone under My account. Email is your account identifier and cannot be changed here."],
  ["Can I get a receipt?", "This follows the operating unit's policy - ask depot staff at collection."],
];

async function main() {
  const existing = await db.faq.count();
  if (existing > 0) {
    console.log(`FAQ table already has ${existing} rows - skipping.`);
    return;
  }

  const rows = [
    ...ZH.map(([question, answer], i) => ({
      locale: "zh",
      question,
      answer,
      sortOrder: i,
      published: true,
    })),
    ...EN.map(([question, answer], i) => ({
      locale: "en",
      question,
      answer,
      sortOrder: i,
      published: true,
    })),
  ];

  await db.faq.createMany({ data: rows });
  console.log(`Seeded ${rows.length} FAQ entries (${ZH.length} zh, ${EN.length} en).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
