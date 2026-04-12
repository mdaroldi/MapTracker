/**
 * GET /api/cron/simulate
 *
 * Vercel Cron Job — runs every minute.
 * Writes one position update per vehicle using a deterministic, time-based
 * formula so the route is stateless (no in-memory state between invocations).
 *
 * Each vehicle loops its assigned route continuously. Given the current
 * timestamp we compute exactly where it would be on the route — the same
 * position is always produced for the same timestamp, so the animation is
 * smooth even if invocations are slightly irregular.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// ── Waypoint routes (Stockholm) ───────────────────────────────────────────────

interface Waypoint {
  lat: number;
  lng: number;
  speedLimit: number; // km/h
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

const ROUTES: Record<RouteKey, Waypoint[]> = {
  truck_e4_north: [
    { lat: 59.1950, lng: 17.6270, speedLimit: 110 },
    { lat: 59.2520, lng: 17.7810, speedLimit: 110 },
    { lat: 59.2960, lng: 17.8850, speedLimit: 110 },
    { lat: 59.3090, lng: 17.9250, speedLimit: 110 },
    { lat: 59.3200, lng: 17.9900, speedLimit: 100 },
    { lat: 59.3320, lng: 18.0050, speedLimit: 90 },
    { lat: 59.3420, lng: 18.0200, speedLimit: 90 },
    { lat: 59.3550, lng: 18.0420, speedLimit: 90 },
    { lat: 59.3680, lng: 18.0300, speedLimit: 100 },
    { lat: 59.4200, lng: 17.9800, speedLimit: 110 },
    { lat: 59.4900, lng: 17.9250, speedLimit: 110 },
    { lat: 59.5810, lng: 17.8850, speedLimit: 110 },
  ],
  truck_e4_south: [
    { lat: 59.5810, lng: 17.8850, speedLimit: 110 },
    { lat: 59.4900, lng: 17.9250, speedLimit: 110 },
    { lat: 59.4200, lng: 17.9800, speedLimit: 110 },
    { lat: 59.3680, lng: 18.0300, speedLimit: 100 },
    { lat: 59.3550, lng: 18.0420, speedLimit: 90 },
    { lat: 59.3420, lng: 18.0200, speedLimit: 90 },
    { lat: 59.3320, lng: 18.0050, speedLimit: 90 },
    { lat: 59.3200, lng: 17.9900, speedLimit: 100 },
    { lat: 59.3090, lng: 17.9250, speedLimit: 110 },
    { lat: 59.2960, lng: 17.8850, speedLimit: 110 },
    { lat: 59.2520, lng: 17.7810, speedLimit: 110 },
    { lat: 59.1950, lng: 17.6270, speedLimit: 110 },
  ],
  truck_e18_west: [
    { lat: 59.3100, lng: 18.1650, speedLimit: 100 },
    { lat: 59.3250, lng: 18.1100, speedLimit: 100 },
    { lat: 59.3380, lng: 18.0700, speedLimit: 90 },
    { lat: 59.3320, lng: 18.0500, speedLimit: 80 },
    { lat: 59.3300, lng: 18.0250, speedLimit: 80 },
    { lat: 59.3350, lng: 17.9900, speedLimit: 90 },
    { lat: 59.3450, lng: 17.9500, speedLimit: 100 },
    { lat: 59.3580, lng: 17.9150, speedLimit: 100 },
    { lat: 59.3700, lng: 17.8800, speedLimit: 110 },
    { lat: 59.3920, lng: 17.8200, speedLimit: 110 },
    { lat: 59.3700, lng: 17.8800, speedLimit: 110 },
    { lat: 59.3100, lng: 18.1650, speedLimit: 100 },
  ],
  van_inner: [
    { lat: 59.3328, lng: 18.0649, speedLimit: 30 },
    { lat: 59.3293, lng: 18.0686, speedLimit: 30 },
    { lat: 59.3180, lng: 18.0720, speedLimit: 40 },
    { lat: 59.3100, lng: 18.0610, speedLimit: 40 },
    { lat: 59.3200, lng: 18.0380, speedLimit: 40 },
    { lat: 59.3350, lng: 18.0300, speedLimit: 30 },
    { lat: 59.3420, lng: 18.0450, speedLimit: 30 },
    { lat: 59.3360, lng: 18.0630, speedLimit: 30 },
    { lat: 59.3328, lng: 18.0649, speedLimit: 30 },
  ],
  bus_sodermalm: [
    { lat: 59.3293, lng: 18.0686, speedLimit: 40 },
    { lat: 59.3220, lng: 18.0770, speedLimit: 40 },
    { lat: 59.3150, lng: 18.0820, speedLimit: 35 },
    { lat: 59.3070, lng: 18.0720, speedLimit: 35 },
    { lat: 59.3020, lng: 18.0580, speedLimit: 35 },
    { lat: 59.3080, lng: 18.0420, speedLimit: 40 },
    { lat: 59.3180, lng: 18.0380, speedLimit: 40 },
    { lat: 59.3250, lng: 18.0490, speedLimit: 40 },
    { lat: 59.3293, lng: 18.0686, speedLimit: 40 },
  ],
  bus_ostermalm: [
    { lat: 59.3360, lng: 18.0630, speedLimit: 40 },
    { lat: 59.3380, lng: 18.0720, speedLimit: 40 },
    { lat: 59.3340, lng: 18.0820, speedLimit: 35 },
    { lat: 59.3370, lng: 18.0960, speedLimit: 35 },
    { lat: 59.3440, lng: 18.0990, speedLimit: 35 },
    { lat: 59.3510, lng: 18.0870, speedLimit: 40 },
    { lat: 59.3490, lng: 18.0710, speedLimit: 40 },
    { lat: 59.3420, lng: 18.0640, speedLimit: 40 },
    { lat: 59.3360, lng: 18.0630, speedLimit: 40 },
  ],
  bus_kungsholmen: [
    { lat: 59.3350, lng: 18.0490, speedLimit: 35 },
    { lat: 59.3400, lng: 18.0410, speedLimit: 35 },
    { lat: 59.3370, lng: 18.0310, speedLimit: 35 },
    { lat: 59.3300, lng: 18.0280, speedLimit: 35 },
    { lat: 59.3220, lng: 18.0310, speedLimit: 35 },
    { lat: 59.3230, lng: 18.0440, speedLimit: 35 },
    { lat: 59.3290, lng: 18.0490, speedLimit: 35 },
    { lat: 59.3350, lng: 18.0490, speedLimit: 35 },
  ],
  bus_vasastan: [
    { lat: 59.3420, lng: 18.0450, speedLimit: 35 },
    { lat: 59.3480, lng: 18.0510, speedLimit: 35 },
    { lat: 59.3550, lng: 18.0450, speedLimit: 40 },
    { lat: 59.3580, lng: 18.0340, speedLimit: 40 },
    { lat: 59.3520, lng: 18.0250, speedLimit: 35 },
    { lat: 59.3450, lng: 18.0280, speedLimit: 35 },
    { lat: 59.3390, lng: 18.0350, speedLimit: 35 },
    { lat: 59.3420, lng: 18.0450, speedLimit: 35 },
  ],
};

const TRUCK_ROUTES: RouteKey[] = ["truck_e4_north", "truck_e4_south", "truck_e18_west"];
const BUS_ROUTES: RouteKey[]   = ["bus_sodermalm", "bus_ostermalm", "bus_kungsholmen", "bus_vasastan"];
const VAN_ROUTES: RouteKey[]   = ["van_inner"];

// ── Geometry helpers ──────────────────────────────────────────────────────────

function distanceKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(latA: number, lngA: number, latB: number, lngB: number): number {
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

/** Total route length in km (treating it as a closed loop). */
function routeLengthKm(route: Waypoint[]): number {
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    const a = route[i];
    const b = route[(i + 1) % route.length];
    total += distanceKm(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

interface SimPosition {
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  engineOn: boolean;
}

/**
 * Given a route and a distance travelled (km, wrapping around the loop),
 * returns the interpolated lat/lng, heading, and blended speed.
 */
function positionAtDistance(route: Waypoint[], distKm: number): SimPosition {
  const totalKm = routeLengthKm(route);
  const wrapped = ((distKm % totalKm) + totalKm) % totalKm;

  let remaining = wrapped;
  for (let i = 0; i < route.length; i++) {
    const a = route[i];
    const b = route[(i + 1) % route.length];
    const segLen = distanceKm(a.lat, a.lng, b.lat, b.lng);
    if (remaining <= segLen || i === route.length - 1) {
      const t = segLen > 0 ? Math.min(remaining / segLen, 1) : 0;
      const lat = a.lat + (b.lat - a.lat) * t;
      const lng = a.lng + (b.lng - a.lng) * t;
      const hdg = bearing(lat, lng, b.lat, b.lng);
      const spd = a.speedLimit + (b.speedLimit - a.speedLimit) * t;
      // Small variation: ±5 km/h noise based on segment index
      const noise = (i % 3 - 1) * 3;
      return { lat, lng, heading: hdg, speedKmh: Math.max(10, spd + noise), engineOn: true };
    }
    remaining -= segLen;
  }

  // Fallback (should not reach here)
  const last = route[route.length - 1];
  const first = route[0];
  return {
    lat: last.lat,
    lng: last.lng,
    heading: bearing(last.lat, last.lng, first.lat, first.lng),
    speedKmh: last.speedLimit,
    engineOn: true,
  };
}

/**
 * Deterministic route assignment based on vehicle type and a numeric offset
 * derived from the vehicle's registration string.
 */
function routeKey(type: string, registrationHash: number): RouteKey {
  if (type === "bus") return BUS_ROUTES[registrationHash % BUS_ROUTES.length];
  if (type === "van") return VAN_ROUTES[registrationHash % VAN_ROUTES.length];
  return TRUCK_ROUTES[registrationHash % TRUCK_ROUTES.length];
}

/** Simple stable hash of a string to a non-negative integer. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// ── Cron handler ──────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Verify this is a legitimate Vercel cron call (or an authorised manual trigger)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const vehicles = await prisma.vehicle.findMany({
      select: { id: true, registration: true, type: true },
      orderBy: { registration: "asc" },
    });

    if (vehicles.length === 0) {
      return NextResponse.json({ data: { written: 0, message: "No vehicles — run db:seed first" }, error: null });
    }

    // Use the current second as the "elapsed time" reference.
    // Each vehicle gets a unique starting offset so they spread around their route.
    const nowSec = Math.floor(Date.now() / 1000);
    const AVG_SPEED_KMH = { truck: 80, bus: 35, van: 30 } as const;

    const positions = vehicles.map((v) => {
      const hash = hashString(v.registration);
      const key = routeKey(v.type, hash);
      const route = ROUTES[key];
      const speed = AVG_SPEED_KMH[v.type as keyof typeof AVG_SPEED_KMH] ?? 50;
      const totalKm = routeLengthKm(route);

      // Unique per-vehicle time offset: spreads vehicles evenly around the loop
      const loopSeconds = (totalKm / speed) * 3600;
      const offsetSec = (hash % Math.round(loopSeconds));
      const elapsedSec = (nowSec + offsetSec) % Math.round(loopSeconds);
      const distKm = (elapsedSec / 3600) * speed;

      const pos = positionAtDistance(route, distKm);

      return {
        vehicleId: v.id,
        lat:       pos.lat,
        lng:       pos.lng,
        heading:   pos.heading,
        speedKmh:  pos.speedKmh,
        engineOn:  pos.engineOn,
      };
    });

    await prisma.position.createMany({ data: positions });

    return NextResponse.json({
      data: { written: positions.length, timestamp: new Date().toISOString() },
      error: null,
    });
  } catch (err) {
    console.error("[cron/simulate] error:", err);
    return NextResponse.json({ data: null, error: "Simulation tick failed" }, { status: 500 });
  }
}
