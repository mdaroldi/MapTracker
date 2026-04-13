/**
 * Vehicle movement simulator — Fleet Management Platform MVP
 *
 * Loads all vehicles from the database, assigns each one a waypoint route
 * (trucks on Stockholm's E4/E18 ring, buses on urban loops), then writes a
 * new Position row every 5 seconds so Supabase Realtime can broadcast the
 * update to the live map.
 *
 * Run:   pnpm simulate
 * Stop:  Ctrl+C  (exits cleanly — disconnects DB, ends pool)
 */

import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// ── Database ──────────────────────────────────────────────────────────────────

// Use the pooler (DATABASE_URL, port 6543) — the direct connection (port 5432)
// is unreachable from some local network configurations due to IPv6 routing.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
  log: ["error"],
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface Waypoint {
  lat: number;
  lng: number;
  /** Maximum speed allowed at this waypoint (km/h). Interpolated between points. */
  speedLimit: number;
}

interface VehicleState {
  id: string;
  registration: string;
  type: string;
  /** Current waypoint index the vehicle is travelling *toward* */
  targetWpIdx: number;
  /** Progress along the segment to the target waypoint (0–1) */
  segmentProgress: number;
  /** Current lat/lng */
  lat: number;
  lng: number;
  /** Current speed in km/h */
  speedKmh: number;
  /** Current heading in degrees (0 = North, clockwise) */
  heading: number;
  engineOn: boolean;
  /** If engine is off: timestamp when it should switch back on */
  engineRestoreAt: number | null;
  /** Which route this vehicle is assigned to */
  routeKey: RouteKey;
}

type RouteKey =
  | "truck_e4_north"
  | "truck_e4_south"
  | "truck_e18_west"
  | "van_inner"
  | "bus_sodermalm"
  | "bus_ostermalm"
  | "bus_kungsholmen"
  | "bus_vasastan";

// ── Waypoint routes ───────────────────────────────────────────────────────────
//
// All coordinates verified against OpenStreetMap.
// Trucks: E4 motorway north/south of Stockholm + E18 westbound ring.
// Buses:  Urban loops through Södermalm, Östermalm, Kungsholmen, Vasastan.
// Each route is a closed loop — the vehicle wraps from the last waypoint
// back to the first.

const ROUTES: Record<RouteKey, Waypoint[]> = {
  // ── E4 northbound/southbound loop (Södertälje → Arlanda via Essingeleden) ──
  truck_e4_north: [
    { lat: 59.1950, lng: 17.6270, speedLimit: 110 }, // Södertälje E4 on-ramp
    { lat: 59.2520, lng: 17.7810, speedLimit: 110 }, // E4 Hallunda
    { lat: 59.2960, lng: 17.8850, speedLimit: 110 }, // E4 Kungens kurva
    { lat: 59.3090, lng: 17.9250, speedLimit: 110 }, // Skärholmen interchange
    { lat: 59.3200, lng: 17.9900, speedLimit: 100 }, // Essingeleden entry
    { lat: 59.3320, lng: 18.0050, speedLimit: 90  }, // Lilla Essingen
    { lat: 59.3420, lng: 18.0200, speedLimit: 90  }, // Stora Essingen
    { lat: 59.3550, lng: 18.0420, speedLimit: 90  }, // Klarastrandsleden
    { lat: 59.3680, lng: 18.0300, speedLimit: 100 }, // E4 north of city
    { lat: 59.4200, lng: 17.9800, speedLimit: 110 }, // Sollentuna
    { lat: 59.4900, lng: 17.9250, speedLimit: 110 }, // Upplands Väsby
    { lat: 59.5810, lng: 17.8850, speedLimit: 110 }, // Arlanda approach
  ],

  // ── E4 southbound (reversed loop — same waypoints, reversed) ─────────────
  truck_e4_south: [
    { lat: 59.5810, lng: 17.8850, speedLimit: 110 }, // Arlanda
    { lat: 59.4900, lng: 17.9250, speedLimit: 110 }, // Upplands Väsby
    { lat: 59.4200, lng: 17.9800, speedLimit: 110 }, // Sollentuna
    { lat: 59.3680, lng: 18.0300, speedLimit: 100 }, // E4 north of city
    { lat: 59.3550, lng: 18.0420, speedLimit: 90  }, // Klarastrandsleden
    { lat: 59.3420, lng: 18.0200, speedLimit: 90  }, // Stora Essingen
    { lat: 59.3320, lng: 18.0050, speedLimit: 90  }, // Lilla Essingen
    { lat: 59.3200, lng: 17.9900, speedLimit: 100 }, // Essingeleden exit
    { lat: 59.3090, lng: 17.9250, speedLimit: 110 }, // Skärholmen interchange
    { lat: 59.2960, lng: 17.8850, speedLimit: 110 }, // Kungens kurva
    { lat: 59.2520, lng: 17.7810, speedLimit: 110 }, // Hallunda
    { lat: 59.1950, lng: 17.6270, speedLimit: 110 }, // Södertälje
  ],

  // ── E18 westbound ring (Nacka → Järfälla) ────────────────────────────────
  truck_e18_west: [
    { lat: 59.3100, lng: 18.1650, speedLimit: 100 }, // Nacka E18 on-ramp
    { lat: 59.3250, lng: 18.1100, speedLimit: 100 }, // Värmdöleden junction
    { lat: 59.3380, lng: 18.0700, speedLimit: 90  }, // Stadsgårdsleden
    { lat: 59.3320, lng: 18.0500, speedLimit: 80  }, // Slussen area
    { lat: 59.3300, lng: 18.0250, speedLimit: 80  }, // Centralbron
    { lat: 59.3350, lng: 17.9900, speedLimit: 90  }, // Kungsholmen west
    { lat: 59.3450, lng: 17.9500, speedLimit: 100 }, // Tranebergsbron
    { lat: 59.3580, lng: 17.9150, speedLimit: 100 }, // Brommaplan
    { lat: 59.3700, lng: 17.8800, speedLimit: 110 }, // E18 Drottningholmsvägen
    { lat: 59.3920, lng: 17.8200, speedLimit: 110 }, // Järfälla
    { lat: 59.3700, lng: 17.8800, speedLimit: 110 }, // (back east)
    { lat: 59.3100, lng: 18.1650, speedLimit: 100 }, // Nacka — loop closes
  ],

  // ── Van inner city (city-centre deliveries) ───────────────────────────────
  van_inner: [
    { lat: 59.3328, lng: 18.0649, speedLimit: 30  }, // Gamla Stan
    { lat: 59.3293, lng: 18.0686, speedLimit: 30  }, // Slussen
    { lat: 59.3180, lng: 18.0720, speedLimit: 40  }, // Södermalm Götgatan
    { lat: 59.3100, lng: 18.0610, speedLimit: 40  }, // Hornstull
    { lat: 59.3200, lng: 18.0380, speedLimit: 40  }, // Liljeholmen
    { lat: 59.3350, lng: 18.0300, speedLimit: 30  }, // Kungsholmen south
    { lat: 59.3420, lng: 18.0450, speedLimit: 30  }, // City Hall (Stadshuset)
    { lat: 59.3360, lng: 18.0630, speedLimit: 30  }, // Centralen (Central Station)
    { lat: 59.3328, lng: 18.0649, speedLimit: 30  }, // back to Gamla Stan
  ],

  // ── Bus loop: Södermalm ───────────────────────────────────────────────────
  bus_sodermalm: [
    { lat: 59.3293, lng: 18.0686, speedLimit: 40  }, // Slussen
    { lat: 59.3220, lng: 18.0770, speedLimit: 40  }, // Medborgarplatsen
    { lat: 59.3150, lng: 18.0820, speedLimit: 35  }, // Skanstull
    { lat: 59.3070, lng: 18.0720, speedLimit: 35  }, // Skanskvarn
    { lat: 59.3020, lng: 18.0580, speedLimit: 35  }, // Zinkensdamm
    { lat: 59.3080, lng: 18.0420, speedLimit: 40  }, // Hornstull
    { lat: 59.3180, lng: 18.0380, speedLimit: 40  }, // Liljeholmstorget
    { lat: 59.3250, lng: 18.0490, speedLimit: 40  }, // Mariatorget
    { lat: 59.3293, lng: 18.0686, speedLimit: 40  }, // Slussen — loop closes
  ],

  // ── Bus loop: Östermalm ───────────────────────────────────────────────────
  bus_ostermalm: [
    { lat: 59.3360, lng: 18.0630, speedLimit: 40  }, // T-Centralen
    { lat: 59.3380, lng: 18.0720, speedLimit: 40  }, // Kungsträdgården
    { lat: 59.3340, lng: 18.0820, speedLimit: 35  }, // Berzelii Park
    { lat: 59.3370, lng: 18.0960, speedLimit: 35  }, // Östermalmstorg
    { lat: 59.3440, lng: 18.0990, speedLimit: 35  }, // Karlaplan
    { lat: 59.3510, lng: 18.0870, speedLimit: 40  }, // Lidingövägen
    { lat: 59.3490, lng: 18.0710, speedLimit: 40  }, // Valhallavägen
    { lat: 59.3420, lng: 18.0640, speedLimit: 40  }, // Stureplan
    { lat: 59.3360, lng: 18.0630, speedLimit: 40  }, // T-Centralen — loop closes
  ],

  // ── Bus loop: Kungsholmen ─────────────────────────────────────────────────
  bus_kungsholmen: [
    { lat: 59.3350, lng: 18.0490, speedLimit: 35  }, // Rådhuset
    { lat: 59.3400, lng: 18.0410, speedLimit: 35  }, // Fridhemsplan
    { lat: 59.3370, lng: 18.0310, speedLimit: 35  }, // S:t Eriksplan
    { lat: 59.3300, lng: 18.0280, speedLimit: 35  }, // Västerbroplan
    { lat: 59.3220, lng: 18.0310, speedLimit: 35  }, // Hornsbergs strand
    { lat: 59.3230, lng: 18.0440, speedLimit: 35  }, // Kristineberg
    { lat: 59.3290, lng: 18.0490, speedLimit: 35  }, // Thorildsplan
    { lat: 59.3350, lng: 18.0490, speedLimit: 35  }, // Rådhuset — loop closes
  ],

  // ── Bus loop: Vasastan ────────────────────────────────────────────────────
  bus_vasastan: [
    { lat: 59.3420, lng: 18.0450, speedLimit: 35  }, // Odenplan
    { lat: 59.3480, lng: 18.0510, speedLimit: 35  }, // Norrtull
    { lat: 59.3550, lng: 18.0450, speedLimit: 40  }, // Wenner-Gren Center
    { lat: 59.3580, lng: 18.0340, speedLimit: 40  }, // Frescati
    { lat: 59.3520, lng: 18.0250, speedLimit: 35  }, // Haga Norra
    { lat: 59.3450, lng: 18.0280, speedLimit: 35  }, // Vanadislunden
    { lat: 59.3390, lng: 18.0350, speedLimit: 35  }, // Rörstrandsgatan
    { lat: 59.3420, lng: 18.0450, speedLimit: 35  }, // Odenplan — loop closes
  ],
};

// ── Heading calculation ───────────────────────────────────────────────────────

/**
 * Returns the bearing in degrees (0 = North, clockwise) from point A to point B.
 * Uses the spherical law of cosines — accurate enough for city-scale distances.
 */
function bearing(
  latA: number, lngA: number,
  latB: number, lngB: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const dLng = toRad(lngB - lngA);
  const lat1 = toRad(latA);
  const lat2 = toRad(latB);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Returns the great-circle distance in kilometres between two lat/lng points.
 */
function distanceKm(
  latA: number, lngA: number,
  latB: number, lngB: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Route assignment ──────────────────────────────────────────────────────────

const TRUCK_ROUTES: RouteKey[] = ["truck_e4_north", "truck_e4_south", "truck_e18_west"];
const BUS_ROUTES:   RouteKey[] = ["bus_sodermalm", "bus_ostermalm", "bus_kungsholmen", "bus_vasastan"];
const VAN_ROUTES:   RouteKey[] = ["van_inner"];

function routeForVehicle(type: string, index: number): RouteKey {
  if (type === "bus")   return BUS_ROUTES[index % BUS_ROUTES.length];
  if (type === "van")   return VAN_ROUTES[index % VAN_ROUTES.length];
  return TRUCK_ROUTES[index % TRUCK_ROUTES.length];
}

// ── State initialisation ──────────────────────────────────────────────────────

function initState(
  vehicle: { id: string; registration: string; type: string },
  index: number
): VehicleState {
  const routeKey = routeForVehicle(vehicle.type, index);
  const route = ROUTES[routeKey];

  // Stagger starting position around the route so vehicles don't bunch up
  const startWpIdx = index % route.length;
  const wp = route[startWpIdx];
  const nextWpIdx = (startWpIdx + 1) % route.length;
  const nextWp = route[nextWpIdx];

  return {
    id:              vehicle.id,
    registration:    vehicle.registration,
    type:            vehicle.type,
    routeKey,
    targetWpIdx:     nextWpIdx,
    segmentProgress: 0,
    lat:             wp.lat,
    lng:             wp.lng,
    speedKmh:        wp.speedLimit * (0.75 + Math.random() * 0.2),
    heading:         bearing(wp.lat, wp.lng, nextWp.lat, nextWp.lng),
    engineOn:        true,
    engineRestoreAt: null,
  };
}

// ── Simulation tick ───────────────────────────────────────────────────────────

const TICK_SECONDS = 5;
const STOP_PROBABILITY_PER_TICK = 0.003; // ~0.3% chance of stopping each tick
const STOP_MIN_MS = 2 * 60 * 1000;       // 2 minutes
const STOP_MAX_MS = 5 * 60 * 1000;       // 5 minutes

function tick(state: VehicleState): VehicleState {
  const now = Date.now();

  // ── Engine restore check ─────────────────────────────────────────────────
  if (!state.engineOn && state.engineRestoreAt !== null) {
    if (now >= state.engineRestoreAt) {
      return { ...state, engineOn: true, engineRestoreAt: null };
    }
    // Still stopped — don't move, but keep the position current
    return state;
  }

  // ── Random stop trigger ──────────────────────────────────────────────────
  if (state.engineOn && Math.random() < STOP_PROBABILITY_PER_TICK) {
    const stopMs = STOP_MIN_MS + Math.random() * (STOP_MAX_MS - STOP_MIN_MS);
    return {
      ...state,
      engineOn:        false,
      speedKmh:        0,
      engineRestoreAt: now + stopMs,
    };
  }

  // ── Move along the route ─────────────────────────────────────────────────
  const route = ROUTES[state.routeKey];
  const prevWpIdx = (state.targetWpIdx - 1 + route.length) % route.length;
  const prevWp    = route[prevWpIdx];
  const targetWp  = route[state.targetWpIdx];

  const segmentLengthKm = distanceKm(
    prevWp.lat, prevWp.lng,
    targetWp.lat, targetWp.lng
  );

  // Target speed: interpolate between the two waypoints' speed limits, add
  // small per-tick noise (±5 km/h) to avoid perfectly constant speed.
  const blendedLimit =
    prevWp.speedLimit * (1 - state.segmentProgress) +
    targetWp.speedLimit * state.segmentProgress;
  const noise = (Math.random() - 0.5) * 10;
  const targetSpeed = Math.max(10, blendedLimit + noise);

  // Gently converge current speed toward target (acceleration/deceleration)
  const speedDelta = (targetSpeed - state.speedKmh) * 0.25;
  const newSpeed = Math.max(0, state.speedKmh + speedDelta);

  // Distance covered in this tick (km)
  const distCovered = (newSpeed / 3600) * TICK_SECONDS;

  // Advance progress along the current segment
  const progressDelta =
    segmentLengthKm > 0 ? distCovered / segmentLengthKm : 1;
  let newProgress = state.segmentProgress + progressDelta;

  let newTargetIdx = state.targetWpIdx;

  // Handle waypoint overshoot — advance to the next waypoint(s)
  while (newProgress >= 1) {
    newProgress -= 1;
    newTargetIdx = (newTargetIdx + 1) % route.length;
  }

  const newPrevWpIdx = (newTargetIdx - 1 + route.length) % route.length;
  const newPrevWp    = route[newPrevWpIdx];
  const newTargetWp  = route[newTargetIdx];

  // Interpolate lat/lng along the new segment
  const newLat = newPrevWp.lat + (newTargetWp.lat - newPrevWp.lat) * newProgress;
  const newLng = newPrevWp.lng + (newTargetWp.lng - newPrevWp.lng) * newProgress;

  // Heading: direction toward the current target waypoint
  const newHeading = bearing(newLat, newLng, newTargetWp.lat, newTargetWp.lng);

  return {
    ...state,
    targetWpIdx:     newTargetIdx,
    segmentProgress: newProgress,
    lat:             newLat,
    lng:             newLng,
    speedKmh:        newSpeed,
    heading:         newHeading,
  };
}

// ── Console formatting ────────────────────────────────────────────────────────

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const GREY   = "\x1b[90m";
const CYAN   = "\x1b[36m";

function logUpdate(state: VehicleState) {
  const lat  = state.lat.toFixed(4);
  const lng  = state.lng.toFixed(4);
  const spd  = state.speedKmh.toFixed(0).padStart(3);
  const hdg  = state.heading.toFixed(0).padStart(3);
  const reg  = state.registration.padEnd(14);

  if (!state.engineOn) {
    const restoreIn = state.engineRestoreAt
      ? Math.ceil((state.engineRestoreAt - Date.now()) / 1000)
      : 0;
    console.log(
      `${GREY}  ${reg} ⏸  stopped (engine off) — resumes in ${restoreIn}s${RESET}`
    );
  } else {
    const color = state.speedKmh > 70 ? CYAN : GREEN;
    console.log(
      `${color}  ${reg}${RESET} → ${lat}, ${lng} ${YELLOW}|${RESET} ${spd} km/h ${YELLOW}|${RESET} heading ${hdg}°`
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🚛  Fleet Simulator — Stockholm\n");

  // Load all vehicles
  const vehicles = await prisma.vehicle.findMany({
    select: { id: true, registration: true, type: true },
    orderBy: { registration: "asc" },
  });

  if (vehicles.length === 0) {
    console.error("No vehicles found. Run pnpm db:seed first.");
    process.exit(1);
  }

  console.log(`   Loaded ${vehicles.length} vehicles from database`);
  console.log(`   Tick interval: ${TICK_SECONDS}s\n`);
  console.log("─".repeat(70));

  // Initialise state for every vehicle, staggered around their routes
  let states: VehicleState[] = vehicles.map((v, i) => initState(v, i));

  // ── Tick loop ────────────────────────────────────────────────────────────
  async function runTick() {
    const timestamp = new Date().toISOString().slice(11, 19); // HH:MM:SS
    console.log(`\n${GREY}${timestamp}${RESET}`);

    // Advance each vehicle
    states = states.map(tick);

    // Write all positions in parallel
    await Promise.all(
      states.map((s) =>
        prisma.position.create({
          data: {
            vehicleId: s.id,
            lat:       s.lat,
            lng:       s.lng,
            heading:   s.heading,
            speedKmh:  s.speedKmh,
            engineOn:  s.engineOn,
          },
        })
      )
    );

    // Log each vehicle
    for (const s of states) {
      logUpdate(s);
    }
  }

  // Run first tick immediately, then every 5 seconds
  await runTick();
  const interval = setInterval(async () => {
    try {
      await runTick();
    } catch (err) {
      console.error("Tick error:", err);
    }
  }, TICK_SECONDS * 1000);

  // ── Clean shutdown on Ctrl+C ─────────────────────────────────────────────
  async function shutdown(signal: string) {
    console.log(`\n\n⏹  Received ${signal}. Shutting down…`);
    clearInterval(interval);
    await prisma.$disconnect();
    await pool.end();
    console.log("   Database connections closed. Goodbye.\n");
    process.exit(0);
  }

  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
