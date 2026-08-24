# Backend — API

Express + Prisma. Port **4000**. Start this before the frontend.

```bash
npm install
npm run db:reset
npm run dev
```

Check: http://localhost:4000/api/health → `{"ok":true}`

## Scripts

```bash
npm run db:reset
```

Wipes `prisma/dev.db`, recreates the tables, reseeds demo data.

```bash
npm run db:studio
```

Opens a browser table editor for the database.

```bash
npm run db:seed
```

Reseeds without wiping.

## Prisma

- `prisma/schema.prisma` — table definitions
- `prisma/dev.db` — the actual database (SQLite, one file)
- After editing the schema: `npx prisma db push && npx prisma generate`

## Logins seeded

| Email | Role |
| --- | --- |
| buyer@example.com | buyer |
| staff@ntpc.gov.tw | staff |
| admin@ntpc.gov.tw | admin |

Password for all: `demo1234`
