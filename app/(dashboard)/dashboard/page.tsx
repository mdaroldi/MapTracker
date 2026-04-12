import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Activity,
  Car,
  Clock,
  Leaf,
  TrendingUp,
  Users,
  Zap,
  WifiOff,
} from "lucide-react";

// ── Data fetching ─────────────────────────────────────────────────────────────

async function getDashboardData() {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // A vehicle is "offline" if its last position is older than this threshold
    const STALE_MS = 10 * 60 * 1000;

    const [vehicles, latestPeriodRow, fuelAggregate, driverCount] =
      await Promise.all([
        prisma.vehicle.findMany({
          select: {
            id: true,
            positions: {
              orderBy: { createdAt: "desc" },
              take: 1,
              select: { engineOn: true, speedKmh: true, createdAt: true },
            },
          },
        }),
        prisma.driverScore.findFirst({
          orderBy: { period: "desc" },
          select: { period: true },
        }),
        prisma.fuelRecord.aggregate({
          where: { createdAt: { gte: startOfMonth } },
          _sum: { litres: true },
        }),
        prisma.driver.count(),
      ]);

    // ── Vehicle operation status ──────────────────────────────────────────────
    let active = 0;
    let idle = 0;
    let offline = 0;

    for (const v of vehicles) {
      const pos = v.positions[0];
      if (!pos) {
        offline++;
        continue;
      }
      const ageMs = now.getTime() - pos.createdAt.getTime();
      if (ageMs > STALE_MS || !pos.engineOn) {
        offline++;
      } else if (pos.speedKmh < 1) {
        idle++;
      } else {
        active++;
      }
    }

    const totalVehicles = vehicles.length;

    // ── Driver scores for the most recent period ──────────────────────────────
    const period = latestPeriodRow?.period ?? null;
    const scores = period
      ? await prisma.driverScore.findMany({
          where: { period },
          select: {
            score: true,
            harshBraking: true,
            harshAccel: true,
            speeding: true,
            idleMinutes: true,
            driver: { select: { name: true } },
          },
          orderBy: { score: "desc" },
        })
      : [];

    const n = scores.length;

    const avgScore =
      n > 0 ? scores.reduce((s: number, d) => s + d.score, 0) / n : 0;
    const avgHarshBraking =
      n > 0 ? scores.reduce((s: number, d) => s + d.harshBraking, 0) / n : 0;
    const avgHarshAccel =
      n > 0 ? scores.reduce((s: number, d) => s + d.harshAccel, 0) / n : 0;
    const avgSpeeding =
      n > 0 ? scores.reduce((s: number, d) => s + d.speeding, 0) / n : 0;
    const avgIdleMinutes =
      n > 0 ? scores.reduce((s: number, d) => s + d.idleMinutes, 0) / n : 0;

    // ── Fuel efficiency sub-scores ────────────────────────────────────────────
    // Derived from driving event counts per period. Penalty coefficients are
    // calibrated so that typical values (5–15 events/period, ~200 idle min)
    // produce scores in the 60–85 range. Replace with telematics provider
    // scores when a real integration is available.
    const clamp = (v: number) => Math.max(0, Math.min(100, v));

    // Fewer harsh braking/acceleration events → better anticipation
    const anticipationScore = clamp(
      100 - (avgHarshBraking + avgHarshAccel) * 3
    );
    // Lower idle minutes → better engine/gear use (proxy: RPM data not available)
    const engineGearScore = clamp(100 - avgIdleMinutes * 0.08);
    // Fewer speeding events → better speed adaptation
    const speedAdaptScore = clamp(100 - avgSpeeding * 4);
    // Lower idle minutes → less unnecessary standstill time
    const standstillScore = clamp(100 - avgIdleMinutes * 0.12);

    // ── CO2 emissions ─────────────────────────────────────────────────────────
    // 2.64 kg CO2 per litre of diesel (DEFRA standard factor).
    // Assumes all vehicles are diesel — update when fuel type is tracked.
    const litresThisMonth = fuelAggregate._sum.litres ?? 0;
    const co2Kg = litresThisMonth * 2.64;
    const co2Tonnes = co2Kg / 1000;

    return {
      totalVehicles,
      active,
      idle,
      offline,
      driverCount,
      period,
      avgScore,
      topDrivers: scores.slice(0, 6),
      anticipationScore,
      engineGearScore,
      speedAdaptScore,
      standstillScore,
      litresThisMonth,
      co2Tonnes,
      co2PerVehicle:
        totalVehicles > 0 ? co2Kg / totalVehicles : 0,
    };
  } catch {
    // DB not reachable or empty — page renders in a "no data" state
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreBarColor(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-400";
  return "bg-red-500";
}

function pct(part: number, total: number) {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}

function fmt(n: number, decimals = 1) {
  return n.toLocaleString("en-GB", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  valueClass,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardDescription>{label}</CardDescription>
          <Icon className="size-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <p className={cn("text-3xl font-bold tabular-nums", valueClass)}>
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreBar({
  label,
  score,
  note,
}: {
  label: string;
  score: number;
  note?: string;
}) {
  const rounded = Math.round(score);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{label}</span>
          {note && (
            <span className="ml-1.5 text-xs text-muted-foreground">{note}</span>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 text-sm font-bold tabular-nums",
            scoreColor(score)
          )}
        >
          {rounded}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", scoreBarColor(score))}
          style={{ width: `${rounded}%` }}
        />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <WifiOff className="size-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold">No data available</h2>
      <p className="max-w-xs text-sm text-muted-foreground">
        Connect to Supabase and run{" "}
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          pnpm db:seed
        </code>{" "}
        to populate the dashboard.
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const data = await getDashboardData();

  if (!data) return <EmptyState />;

  const {
    totalVehicles,
    active,
    idle,
    offline,
    driverCount,
    period,
    avgScore,
    topDrivers,
    anticipationScore,
    engineGearScore,
    speedAdaptScore,
    standstillScore,
    litresThisMonth,
    co2Tonnes,
    co2PerVehicle,
  } = data;

  const activePct = pct(active, totalVehicles);
  const idlePct = pct(idle, totalVehicles);
  const offlinePct = pct(offline, totalVehicles);

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Fleet Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {period
              ? `Scores based on period ${period}`
              : "No scoring period available yet"}
          </p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800">
          Live
        </span>
      </div>

      {/* ── Row 1: Fleet Status ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Fleet Overview
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Vehicles"
            value={totalVehicles}
            sub={`${driverCount} assigned drivers`}
            icon={Car}
          />
          <StatCard
            label="In Operation"
            value={`${activePct}%`}
            sub={`${active} of ${totalVehicles} vehicles`}
            icon={Activity}
            valueClass="text-emerald-600"
          />
          <StatCard
            label="Idle"
            value={`${idlePct}%`}
            sub={`${idle} vehicles — engine on, stationary`}
            icon={Clock}
            valueClass={idlePct > 20 ? "text-amber-600" : undefined}
          />
          <StatCard
            label="Offline"
            value={`${offlinePct}%`}
            sub={`${offline} vehicles — no recent signal`}
            icon={WifiOff}
            valueClass={offlinePct > 10 ? "text-red-600" : undefined}
          />
        </div>
      </section>

      {/* ── Row 2: Driver Performance + CO2 ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Driver performance — spans 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="size-4 text-muted-foreground" />
              <CardTitle>Driver Performance</CardTitle>
            </div>
            <CardDescription>
              Overall behaviour score (0–100) · {period ?? "—"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Fleet average */}
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
              <span className="text-sm font-medium">Fleet average</span>
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  scoreColor(avgScore)
                )}
              >
                {Math.round(avgScore)}
              </span>
            </div>

            {/* Top drivers */}
            {topDrivers.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Top drivers this period
                </p>
                {topDrivers.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3"
                  >
                    <span className="w-5 shrink-0 text-center text-xs font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="truncate text-sm font-medium">
                          {d.driver.name}
                        </span>
                        <span
                          className={cn(
                            "ml-2 shrink-0 text-sm font-bold tabular-nums",
                            scoreColor(d.score)
                          )}
                        >
                          {Math.round(d.score)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            scoreBarColor(d.score)
                          )}
                          style={{ width: `${d.score}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No driver scores recorded yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* CO2 emissions */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Leaf className="size-4 text-muted-foreground" />
              <CardTitle>CO₂ Emissions</CardTitle>
            </div>
            <CardDescription>Current calendar month</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Total emitted
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {fmt(co2Tonnes)}
                <span className="ml-1 text-base font-normal text-muted-foreground">
                  t CO₂
                </span>
              </p>
            </div>
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Per vehicle (avg)</span>
                <span className="font-semibold tabular-nums">
                  {fmt(co2PerVehicle / 1000)} t
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Fuel consumed</span>
                <span className="font-semibold tabular-nums">
                  {fmt(litresThisMonth, 0)} L
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Emission factor</span>
                <span className="font-semibold tabular-nums">
                  2.64 kg/L
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              DEFRA diesel factor. Assumes all vehicles are diesel-fuelled.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: Fuel Efficiency ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Fuel Efficiency
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Score breakdown */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-muted-foreground" />
                <CardTitle>Score Breakdown</CardTitle>
              </div>
              <CardDescription>
                Fleet averages · {period ?? "—"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <ScoreBar
                label="Fleet Total Score"
                score={avgScore}
              />
              <div className="border-t pt-4 space-y-4">
                <ScoreBar
                  label="Anticipation & Braking"
                  score={anticipationScore}
                  note="harsh brake + accel events"
                />
                <ScoreBar
                  label="Engine & Gear Utilization"
                  score={engineGearScore}
                  note="idle time proxy"
                />
                <ScoreBar
                  label="Speed Adaptation"
                  score={speedAdaptScore}
                  note="speeding events"
                />
                <ScoreBar
                  label="Standstill"
                  score={standstillScore}
                  note="idle minutes"
                />
              </div>
            </CardContent>
          </Card>

          {/* Score legend + summary */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="size-4 text-muted-foreground" />
                <CardTitle>Summary</CardTitle>
              </div>
              <CardDescription>
                How sub-scores are calculated
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Score legend */}
              <div className="space-y-2">
                {[
                  {
                    range: "80 – 100",
                    label: "Excellent",
                    color: "bg-emerald-500",
                    text: "text-emerald-700 dark:text-emerald-300",
                  },
                  {
                    range: "60 – 79",
                    label: "Needs attention",
                    color: "bg-amber-400",
                    text: "text-amber-700 dark:text-amber-300",
                  },
                  {
                    range: "0 – 59",
                    label: "Critical",
                    color: "bg-red-500",
                    text: "text-red-700 dark:text-red-300",
                  },
                ].map(({ range, label, color, text }) => (
                  <div key={range} className="flex items-center gap-3">
                    <div className={cn("size-3 rounded-full", color)} />
                    <span className={cn("text-sm font-medium", text)}>
                      {range}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      — {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Sub-score descriptions */}
              <div className="space-y-3 border-t pt-4 text-sm">
                {[
                  {
                    name: "Anticipation & Braking",
                    desc: "Penalises harsh braking and acceleration events. Smooth anticipation reduces fuel use and wear.",
                  },
                  {
                    name: "Engine & Gear Utilization",
                    desc: "Derived from idle time. High idle minutes suggest inefficient gear/engine management.",
                  },
                  {
                    name: "Speed Adaptation",
                    desc: "Penalises speeding events. Driving at appropriate speed improves fuel efficiency significantly.",
                  },
                  {
                    name: "Standstill",
                    desc: "Penalises unnecessary idle time — engine on with vehicle stationary. Turn off engine when stopped >2 min.",
                  },
                ].map(({ name, desc }) => (
                  <div key={name}>
                    <p className="font-medium">{name}</p>
                    <p className="text-muted-foreground">{desc}</p>
                  </div>
                ))}
              </div>

              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Sub-scores are derived from event counts in{" "}
                <code className="font-mono">DriverScore</code>. Penalty
                coefficients will be replaced by telematics provider values
                when integrated.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
