# CLAUDE.md — Fleet Management Platform

This file is read automatically by Claude Code at the start of every session.
Keep it concise — only include what Claude cannot infer from the code itself.

---

## Project Overview

**Product:** Enterprise Fleet Management Platform
**Purpose:** Real-time tracking and operations management for fleet companies
worldwide (trucks, buses, 50,000+ vehicles globally).
**Scope:** Web application (Next.js) + driver mobile app (React Native) +
backend microservices + real-time telemetry pipeline on AWS.

**Core capabilities:**
- Live map with real-time vehicle positions (MapLibre GL JS + Deck.gl)
- Vehicle and driver profiles, documents, and history
- Driver behaviour scoring (harsh braking, acceleration, speeding)
- Fuel consumption tracking and anomaly alerts
- Service history, upcoming workshop visits, and maintenance scheduling
- Route planning and geofence management
- Dashboards and exportable reports (PDF/CSV)
- Notifications and alerts (SNS, SES, mobile push)

---

## Architecture Overview

Five-layer architecture on AWS:

```
[Devices]    Third-party telematics APIs (Samsara, Geotab, Webfleet, …)
     ↓            webhook push / long-poll per provider
[Ingestion]  Telematics Adapter Layer → Kinesis Data Streams → ECS stream processor
     ↓                                                        → WebSocket Gateway (live push)
[Services]   Fleet API · Tracking service · Analytics service ·
             Notifications · Auth · API Gateway + WAF · Report generation
     ↓
[Data]       Aurora PostgreSQL · Timestream · ElastiCache Redis ·
             Redshift + S3 data lake · OpenSearch
     ↓
[Frontend]   Next.js web app (map · dashboards · reports) + React Native driver app
```

All backend services run on **Amazon EKS** (Kubernetes).
Service-to-service communication uses **gRPC** internally; REST/JSON externally.

---

## Tech Stack

### Frontend — Web (Next.js)
| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR, RSC, edge routing |
| Language | TypeScript (strict mode) | Type safety across the monorepo |
| Map engine | MapLibre GL JS + Deck.gl | WebGL, OSS, handles 50k markers |
| Map tiles | AWS Location Service | Stays within AWS; no third-party tile egress |
| UI system | shadcn/ui + Tailwind CSS v4 | Unstyled primitives, design-token ready |
| Charts | Apache ECharts | High-performance SVG/Canvas, good for dashboards |
| Data tables | TanStack Table v8 | Virtualised rows for large vehicle/driver lists |
| Server state | TanStack Query v5 | WebSocket + polling integration, stale-while-revalidate |
| Client state | Zustand | Lightweight; selected vehicles, map viewport, filters |
| Forms | React Hook Form + Zod | Performant, validated schemas shared with backend |
| Real-time | Native WebSocket (custom hook) | Direct connection to WebSocket Gateway |
| i18n | next-intl | ICU message format, server and client components |
| PDF export | React PDF (client) | In-browser report rendering |

### Frontend — Mobile (React Native)
| Concern | Choice |
|---|---|
| Framework | React Native (Expo) |
| Navigation | Expo Router |
| Maps | react-native-maps (MapLibre) |
| Offline | WatermelonDB (local SQLite sync) |
| Push | Expo Notifications + AWS Pinpoint |

### Backend (Node.js Microservices on EKS)
| Service | Stack |
|---|---|
| Fleet API | Fastify v5 + TypeScript + Prisma ORM |
| Tracking service | Fastify + TypeScript (writes to Timestream + Redis) |
| Analytics service | Fastify + TypeScript (reads Timestream, writes Redshift) |
| Notifications | Fastify + AWS SDK (SNS, SES, Pinpoint) |
| Report generation | Fastify + Puppeteer (headless Chromium for PDF) |
| gRPC contracts | Protocol Buffers (buf.build toolchain) |

### Ingestion Pipeline
| Component | Purpose |
|---|---|
| Telematics Adapter Layer | Per-provider normalisation service (see below) |
| Kinesis Data Streams | High-throughput normalised position event stream |
| ECS stream consumers | Validate, fan-out to Redis + Timestream |
| WebSocket Gateway | API Gateway WebSocket for browser push |
| Amazon MSK (Kafka) | Internal event bus between microservices |

**Telematics Adapter Layer** — a dedicated ECS service per provider that
translates the provider's format into the internal `PositionEvent` schema
before publishing to Kinesis. This isolates provider-specific logic and
allows adding/swapping providers without touching the rest of the pipeline.

Supported integration patterns (varies by provider):
- **Webhook push** (Samsara, Geotab): provider POSTs events to our HTTPS
  endpoint; adapter validates signature, normalises, publishes to Kinesis
- **Long-poll / SSE** (some providers): adapter polls provider API on a
  configurable interval and publishes deltas
- **Bulk pull** (historical backfill): scheduled Lambda pulls historical
  trip data and replays it into Kinesis with a `backfill: true` flag

Internal canonical event schema (all providers normalise to this):
```ts
interface PositionEvent {
  provider: string        // "samsara" | "geotab" | "webfleet" | ...
  externalVehicleId: string
  vehicleId: string       // our internal UUID (resolved by adapter)
  orgId: string
  lat: number
  lng: number
  heading: number         // degrees 0-359
  speedKmh: number
  odometer: number        // km
  engineOn: boolean
  ts: number              // Unix ms (from device, not server)
  backfill: boolean
  raw?: Record<string, unknown>  // original payload (stored in S3, not Timestream)
}
```

New provider checklist (add to `apps/api-adapter-{provider}/`):
1. Implement `normalise(raw): PositionEvent`
2. Implement signature/auth verification for webhooks
3. Add vehicle ID mapping to `vehicle_telematics_ids` table in Aurora
4. Add provider credentials to AWS Secrets Manager
5. Write integration tests against provider's sandbox environment
6. Document rate limits and webhook retry behaviour in the adapter's README

### Data Stores
| Store | Usage |
|---|---|
| Amazon Aurora PostgreSQL v16 | Companies, fleets, vehicles, drivers, services, plans |
| Amazon Timestream | Time-series: location history, fuel, telemetry |
| ElastiCache Redis 7 | Live position cache, sessions, rate-limit counters |
| Amazon OpenSearch | Full-text search, driver behaviour analytics, log queries |
| Amazon Redshift | Data warehouse: KPIs, historical reports, BI |
| Amazon S3 + Iceberg | Raw event lake, long-term retention, Athena ad-hoc |

### Auth & Security
| Concern | Solution |
|---|---|
| Identity | Amazon Cognito (multi-tenant, one user pool per environment) |
| Enterprise SSO | **SAML 2.0 / OIDC federation — required from day one** |
| SSO providers | Azure AD, Okta, Google Workspace, any SAML 2.0 IdP |
| Authorization | RBAC: roles = SuperAdmin, OrgAdmin, FleetManager, Driver |
| API protection | AWS WAF + Shield Advanced + API Gateway throttling |
| Secrets | AWS Secrets Manager (rotated automatically) |
| Encryption | AWS KMS (envelope encryption for PII fields) |
| TLS | TLS 1.3 everywhere; HSTS; mTLS for webhook inbound endpoints |

**SSO setup per organisation:**
- Each org configures their own SAML IdP metadata URL in their org settings
- Cognito Identity Provider is created per org; users are federated on first login
- `custom:org_id` and `custom:role` are mapped from SAML assertions
  (attribute mapping is configured per org — document the expected assertion attributes)
- Just-in-time (JIT) provisioning: user record is created in Aurora on first SSO login
- Fallback: email/password login remains available for orgs without SSO and for SuperAdmins

### Infrastructure & DevOps
| Concern | Tool |
|---|---|
| IaC | Terraform (modules per service) |
| Container orchestration | Amazon EKS + Fargate for burstable workloads |
| CI/CD | GitHub Actions → ECR → ArgoCD (GitOps) |
| CDN | Amazon CloudFront (web app + map tiles) |
| DNS + routing | Route 53 (latency-based routing, global) |
| Observability | OpenTelemetry → AWS X-Ray + CloudWatch + Grafana |
| Secrets injection | External Secrets Operator (ESO) on EKS |
| Container registry | Amazon ECR |

### Data & Analytics
| Concern | Tool |
|---|---|
| ETL pipelines | Amazon MWAA (managed Airflow) |
| Transformations | dbt (runs against Redshift) |
| BI / self-service | Amazon QuickSight (optional: Metabase OSS) |

---

## Monorepo Structure

```
/
├── apps/
│   ├── web/                      # Next.js web application
│   ├── mobile/                   # React Native (Expo) driver app
│   ├── api-fleet/                # Fleet API microservice
│   ├── api-tracking/             # Tracking microservice
│   ├── api-analytics/            # Analytics microservice
│   ├── api-notifications/        # Notifications microservice
│   ├── api-reports/              # Report generation microservice
│   └── adapters/
│       ├── adapter-samsara/      # Samsara telematics adapter
│       ├── adapter-geotab/       # Geotab telematics adapter
│       ├── adapter-webfleet/     # Webfleet telematics adapter
│       └── adapter-base/         # Shared adapter types + Kinesis publisher
├── packages/
│   ├── ui/                       # Shared shadcn/ui components
│   ├── types/                    # Shared TypeScript types + Zod schemas
│   ├── proto/                    # Protocol Buffer definitions (buf.build)
│   ├── db/                       # Prisma schema + migrations
│   └── config/                   # Shared ESLint, TS, Tailwind configs
├── infra/
│   ├── terraform/                # All AWS infrastructure as code
│   └── k8s/                      # Kubernetes manifests (ArgoCD GitOps)
├── scripts/                      # Dev seed scripts, local setup helpers
├── .github/workflows/            # CI/CD pipelines
└── CLAUDE.md
```

Managed with **Turborepo**. Never run `npm install` at a package level — always
from the root with `pnpm install`.

---

## Essential Commands

```bash
# Install all workspace dependencies (from root only)
pnpm install

# Start all services locally (Docker Compose)
pnpm dev

# Start only the web app
pnpm --filter web dev

# Start a specific API service
pnpm --filter api-fleet dev

# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter api-tracking test

# Type-check the entire monorepo
pnpm typecheck

# Lint the entire monorepo
pnpm lint

# Build everything
pnpm build

# Apply database migrations (dev)
pnpm --filter db migrate:dev

# Generate Prisma client after schema changes
pnpm --filter db generate

# Generate gRPC/Protobuf types
pnpm --filter proto generate

# Terraform plan (infra changes)
cd infra/terraform && terraform plan -var-file=envs/staging.tfvars

# Run dbt transformations locally
cd packages/dbt && dbt run --profiles-dir .
```

---

## Coding Conventions

### General
- TypeScript strict mode in every package — no `any`, no `@ts-ignore`
- `const` by default; `let` only when reassignment is required; never `var`
- `async/await` over `.then()` chains
- Zod for all runtime validation at API boundaries; schemas live in `packages/types`
- Shared schemas are the single source of truth — never duplicate types between services

### Naming
- Files: `kebab-case` for all files
- React components: `PascalCase` (e.g. `VehicleCard.tsx`)
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Database tables: `snake_case`; columns: `snake_case`
- gRPC services: `PascalCase`; methods: `PascalCase`

### API contracts
- All external REST responses follow this envelope:
  ```json
  { "data": { ... }, "meta": { ... }, "error": null }
  { "data": null, "error": { "code": "VEHICLE_NOT_FOUND", "message": "..." } }
  ```
- Never expose raw database errors or stack traces to clients
- Error codes are `SCREAMING_SNAKE_CASE` strings (not numeric HTTP status only)
- Paginated lists always return `{ data: T[], meta: { total, page, perPage } }`

### Map & real-time
- Never store live vehicle positions in Aurora — Redis only for current state;
  Timestream for history
- WebSocket messages follow this schema: `{ type: string, payload: T, ts: number }`
- Deck.gl layers must use `updateTriggers` to avoid full re-renders on position updates
- Map interactions (click, hover) must debounce at 100ms minimum

### Frontend
- No `default` exports except Next.js pages/layouts
- All imports use `@/` alias (e.g. `@/components/map/VehicleMarker`)
- Server Components by default; add `"use client"` only when hooks or browser APIs are needed
- Data fetching on the server via TanStack Query `prefetchQuery` pattern
- No hardcoded colour values — use Tailwind tokens from the design system

### Backend
- Fastify plugins for cross-cutting concerns (auth, rate-limit, logging) — not middleware chains
- Validate all incoming request bodies via Zod before any business logic
- Database queries via Prisma only — no raw SQL in application code
  (exceptions: complex analytics queries via Redshift/Timestream SDK)
- All services must expose `/health` (liveness) and `/ready` (readiness) endpoints
- Log structured JSON to stdout — never to file inside containers
- Use the shared Pino logger from `packages/config` — never `console.log`

---

## Data Governance & Security

These rules are non-negotiable and apply to every service.

### PII handling
- PII fields (driver name, licence number, phone, email, precise home location)
  must be **encrypted at rest** using AWS KMS envelope encryption
- PII must never appear in log output — use `[REDACTED]` placeholders
- Driver location data must not be retained beyond the configured retention policy
  (default: 90 days for raw history, 2 years for aggregated KPIs)
- AWS Macie is enabled on all S3 buckets — do not disable

### Access control
- Every API endpoint requires an authenticated JWT from Cognito
- Authorization is checked at the service layer (not just the gateway):
  a FleetManager can only access vehicles within their assigned fleets
- Org isolation: every database query must include `org_id` scoping —
  never query across org boundaries
- Drivers can only access their own data via the mobile API

### Audit logging
- Every write operation (create/update/delete) must emit an audit event to the
  `audit_log` table: `{ org_id, user_id, action, entity, entity_id, before, after, ts }`
- AWS CloudTrail is enabled in all regions — do not disable

### Secrets
- No secrets in source code, `.env` files committed to git, or container images
- All secrets are injected at runtime via External Secrets Operator from AWS Secrets Manager
- Use `.env.example` for required variable names (no values)

### Data residency
- EU fleet data must remain in `eu-west-1` (Ireland) — do not replicate to non-EU regions
  without explicit legal sign-off
- Data residency is enforced via Terraform workspace (`eu`, `us`, `apac`)

---

## Multi-Tenancy Model

- One **Organisation** = one fleet company
- Organisation data is isolated at the database level via `org_id` foreign keys
  on every major table
- Cognito: one User Pool per environment; `custom:org_id` and `custom:role`
  are mandatory custom attributes on every token
- Redis key prefix: `org:{org_id}:vehicle:{vehicle_id}:position`
- Never use a shared Redis `KEYS *` scan — always use prefixed patterns

---

## Key Domain Entities

| Entity | Description |
|---|---|
| `Organisation` | A fleet company (the customer) |
| `Fleet` | A named group of vehicles within an org |
| `Vehicle` | A truck or bus with registration, type, specs |
| `Driver` | A person assigned to operate vehicles |
| `Trip` | A recorded journey from start to end with telemetry |
| `Position` | A timestamped GPS coordinate (stored in Timestream + Redis) |
| `FuelRecord` | Fuel fill event with volume, cost, odometer |
| `ServiceRecord` | Completed workshop visit with work done |
| `ServiceSchedule` | Upcoming maintenance plan for a vehicle |
| `DriverScore` | Aggregated behaviour score (daily/weekly/monthly) |
| `Alert` | A triggered notification (speeding, geofence, maintenance due) |
| `Geofence` | A named geographic boundary for alert rules |

---

## Git & Branch Conventions

- **Branching:** `feat/`, `fix/`, `chore/`, `refactor/`, `infra/` prefixes
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`)
- **PR rules:** All PRs require at least one review + passing CI before merge
- Never commit directly to `main` or `develop`
- Infra changes (`infra/terraform/`) require a second review from the infra owner
- Include the issue number in the PR title (e.g. `feat(tracking): add geofence alerts [FM-142]`)

---

## Architectural Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Time-series DB | Amazon Timestream | Purpose-built, serverless, integrates with Kinesis natively |
| Live position store | Redis (ElastiCache) | Sub-millisecond reads for map queries at 50k vehicles |
| Map library | MapLibre GL JS + Deck.gl | WebGL rendering; Deck.gl handles 50k+ animated markers |
| Map tiles | AWS Location Service | No data leaves AWS; cheaper at scale vs third-party |
| Message bus | Amazon MSK (Kafka) | Durable event log; replay capability for analytics |
| gRPC between services | Protobuf over gRPC | Typed contracts, lower overhead than REST for internal comms |
| Monorepo | Turborepo + pnpm workspaces | Shared types, consistent tooling, atomic deployments |
| Mobile offline | WatermelonDB | SQLite sync for offline trip recording by drivers |
| Telematics | Third-party adapter layer | Normalise provider schemas to internal PositionEvent before Kinesis; isolates provider coupling |
| No AWS IoT Core | Deliberately omitted | Not needed without own GPS hardware; adapters handle inbound from providers |
| Enterprise SSO | Cognito SAML 2.0 federation | Required by enterprise IT; JIT provisioning; per-org IdP configuration |

---

## Suggested Features Not Yet Scoped

Discuss with the team before implementing:

- **Geofencing engine** — alert when a vehicle enters/exits a defined zone
  (AWS Location Service geofences or custom PostGIS polygons in Aurora)
- **Driver fatigue monitoring** — integrate rest-period rule enforcement (EU Reg. 561/2006)
- **Predictive maintenance** — ML model (Amazon SageMaker) trained on service + telemetry history
- **Carbon/ESG reporting** — CO₂ emissions per trip, fleet, and driver
- **Route optimisation** — AWS Location Service route matrix for dispatch planning
- **GDPR right-to-erasure workflow** — automated driver data deletion pipeline
- **Offline map tiles** — pre-cached tiles for drivers in low-connectivity areas
- **White-label theming** — per-org brand colours and logo in the web app

---

## Known Gotchas

- Timestream `MEASURE_VALUE` columns are strictly typed — schema changes require
  a new table version; do not alter existing measure schemas in place
- MapLibre GL JS `flyTo` during a Deck.gl layer update causes a brief visual
  artefact — always update layers after the camera animation completes
- Cognito `custom:org_id` is a string — always cast before using as a UUID in queries
- EKS Fargate does not support DaemonSets — use a sidecar pattern for log shipping
- Aurora writer endpoint is DNS-cached by Prisma — restart pods after a failover event
- `pnpm --filter` requires exact package names from `package.json` (not directory names)
- Telematics provider webhooks may deliver events **out of order** — always use
  the device timestamp (`ts`) for Timestream writes, never the server arrival time
- Geotab and some providers send odometer in **miles**, not km — normalise in the adapter,
  never in the tracking service
- Samsara webhook retries on non-2xx — adapter must be idempotent; use
  `externalVehicleId + ts` as a deduplication key before publishing to Kinesis
- Cognito SAML federation: the `RelayState` parameter must round-trip through the IdP —
  some older enterprise IdPs strip it; test this during org onboarding
- JIT-provisioned SSO users have no password in Cognito — do not prompt them
  for password reset; route them back to their IdP

---

## Out of Scope (do not implement without explicit approval)

- Do not add new AWS services without updating the Terraform modules first
- Do not store position history in Aurora — Timestream only
- Do not use `console.log` in any service — use the shared Pino logger from `packages/config`
- Do not query Redshift from real-time request paths — it is for batch/reporting only
- Do not store any credentials in environment variables committed to the repo
- Do not replicate EU personal data to non-EU regions
