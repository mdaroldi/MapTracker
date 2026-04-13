# MapTracker — Fleet Management Platform

MVP demo for a real-time fleet management platform. 50 simulated vehicles moving
across Stockholm, Sweden on an interactive live map. Built to validate the product
concept with stakeholders before investing in the full AWS production stack.

Live: **https://project-tmtul.vercel.app**

---

## What it does

- **Live map** — vehicles move in real time via Supabase Realtime; click any dot
  for speed, heading, and engine status
- **Vehicle list** — searchable table with moving / idle / offline status badges
- **Driver profiles** — behaviour scores, harsh-event history, score trend chart
- **Service schedule** — upcoming workshops, overdue items highlighted
- **Fleet dashboard** — KPIs: active vehicles, fuel spend, alerts, avg driver score
- **Reports** — fuel consumption chart, driver performance ranking

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript strict mode |
| Database | Supabase (PostgreSQL) |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Real-time | Supabase Realtime (`postgres_changes`) |
| Auth | Supabase Auth (email/password) |
| Map | MapLibre GL JS v5 + deck.gl 9 (ScatterplotLayer, TextLayer) |
| Tiles | OpenFreeMap (no API key) |
| UI | shadcn/ui + Tailwind CSS v4 |
| Charts | Apache ECharts |
| Tables | TanStack Table v8 |
| Hosting | Vercel Hobby |
| Simulator | `scripts/simulate.ts` — runs locally, writes positions every 5 s |

---

## Getting started

### Prerequisites

- Node.js 20+
- pnpm
- A free [Supabase](https://supabase.com) project

### 1. Clone and install

```bash
git clone <repo-url>
cd MapTracker
pnpm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
DATABASE_URL=postgresql://postgres.<project>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DIRECT_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
```

> `DATABASE_URL` must point to the **pooler** (port 6543) — used by the app and
> simulator. `DIRECT_URL` must point to the **direct** connection (port 5432) —
> used only by `prisma migrate`.

### 3. Push schema and seed data

```bash
pnpm db:push      # push Prisma schema to Supabase
pnpm db:generate  # generate Prisma client
pnpm db:seed      # create orgs, fleets, vehicles, drivers, demo users
```

The seed script creates three demo accounts:

| Email | Password | Role |
|---|---|---|
| admin@demo-fleet.com | Demo1234! | OrgAdmin |
| manager@demo-fleet.com | Demo1234! | FleetManager |
| driver@demo-fleet.com | Demo1234! | Driver |

### 4. Enable Supabase Realtime

Run once in **Supabase Dashboard → SQL Editor**:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE "Position";
```

### 5. Start the app

In one terminal:

```bash
pnpm dev
```

In a second terminal (starts the vehicle simulator):

```bash
pnpm simulate
```

Open http://localhost:3000 and log in. Navigate to `/map` to see vehicles moving.

---

## Deployment (Vercel)

```bash
vercel --prod
```

Set the same five environment variables in **Vercel → Project → Settings →
Environment Variables** before deploying.

> **Hobby plan note:** Per-minute cron jobs are not supported. Run `pnpm simulate`
> locally during demos. Upgrade to Vercel Pro to enable the automated cron at
> `app/api/cron/simulate/route.ts`.

---

## Project structure

```
app/
  (auth)/login/          Login page
  (dashboard)/
    map/                 Live map (this is the hero screen)
    vehicles/            Vehicle list + detail
    drivers/             Driver list + detail
    services/            Service schedule
    reports/             Fuel + performance reports
    dashboard/           KPI overview
  api/
    positions/           GET latest position per vehicle
    vehicles/            CRUD
    drivers/             CRUD
    services/            Service records + schedules
    reports/             Aggregated report data
    cron/simulate/       Stateless position writer (Vercel Cron, Pro plan)
components/
  map/LiveMap.tsx        MapLibre + deck.gl live map component
  charts/                ECharts wrappers
  tables/                TanStack Table instances
  ui/                    shadcn/ui components
lib/
  prisma.ts              Prisma singleton (pooler connection)
  supabase/client.ts     Browser Supabase client
  supabase/server.ts     Server Supabase client (API routes + RSC)
scripts/
  simulate.ts            Local vehicle movement simulator
prisma/
  schema.prisma          Data model
  seed.ts                Demo data + Supabase Auth user creation
```

---

## Common commands

```bash
pnpm dev          # start Next.js dev server
pnpm simulate     # run vehicle simulator (separate terminal)
pnpm build        # production build (runs prisma generate first)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm db:push      # push schema changes to Supabase (no migration file)
pnpm db:migrate   # create a migration file and apply it
pnpm db:generate  # regenerate Prisma client after schema changes
pnpm db:seed      # seed demo data
```

---

## Architecture notes

### How real-time works

```
scripts/simulate.ts  →  INSERT into Position table (every 5 s)
                      ↓
Supabase Realtime  →  postgres_changes broadcast (INSERT on "Position")
                      ↓
LiveMap.tsx        →  updates position state → deck.gl re-renders dots
```

No WebSocket server, no Redis, no Kinesis. In production this pipeline is replaced
by a telematics adapter → Kinesis → WebSocket Gateway, but the browser-side
subscription code stays almost identical.

### Connection strings

Prisma 7 with `@prisma/adapter-pg` requires a `pg.Pool`. Always construct the pool
with `DATABASE_URL` (pooler, port 6543). Never use `DIRECT_URL` at runtime — it is
unreachable from Vercel serverless and some local networks. `DIRECT_URL` is only
read by `prisma migrate` / `prisma db push`.

### Supabase Auth vs database users

`prisma.user.createMany()` writes rows to the application `User` table. It does
**not** create Supabase Auth accounts. Login (`supabase.auth.signInWithPassword`)
authenticates against the Supabase Auth schema. The seed script calls
`supabaseAdmin.auth.admin.createUser()` to create both records in sync.

---

## Migration path to production (AWS)

When stakeholders approve, the upgrade order is:

1. Split API routes into Fastify microservices (keep Prisma)
2. Replace Supabase with Aurora PostgreSQL (connection string swap)
3. Add Timestream for position history
4. Add ElastiCache Redis for live position cache
5. Replace Supabase Realtime with Kinesis → WebSocket Gateway
6. Replace OpenFreeMap tiles with AWS Location Service
7. Replace Supabase Auth with Cognito + SAML federation
8. Add telematics adapters
9. Containerise and deploy to EKS

Steps 1–4 require no frontend changes. Full detail in `CLAUDE.enterprise.md`.
