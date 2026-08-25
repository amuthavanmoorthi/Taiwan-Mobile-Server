/**
 * One command to bring a fresh deployment up: `npm run bootstrap`.
 *
 * Syncs the schema, then seeds — but only when the database has no users.
 * prisma/seed.ts deletes every table before it writes, so running it against
 * a database staff have already added listings to would destroy their work.
 * The user count is what stands between the demo data and that.
 *
 * Deliberately not wired into `start`. A schema push on every boot can drop a
 * column without anyone asking for it, and a push that refuses would take the
 * whole service down instead.
 */
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false });
  if (r.status !== 0) {
    console.error(`bootstrap: \`${cmd} ${args.join(" ")}\` exited ${r.status}`);
    process.exit(1);
  }
};

// Bring the database up to the current schema. Safe to repeat: with no
// destructive change pending it is a no-op.
run("npx", ["prisma", "db", "push", "--skip-generate"]);

const db = new PrismaClient();
let users;
try {
  users = await db.user.count();
} finally {
  await db.$disconnect();
}

if (users > 0) {
  console.log(`bootstrap: ${users} users already present, not seeding.`);
} else {
  console.log("bootstrap: empty database, seeding demo data…");
  for (const file of ["prisma/seed.ts", "prisma/seed-faqs.ts", "prisma/seed-sites.ts"]) {
    run("npx", ["tsx", file]);
  }
  console.log("bootstrap: seeded.");
}
