/**
 * Seed script — Fleet Management Platform MVP
 *
 * Creates:
 *   - 2 demo organisations (EU trucking + city bus operator)
 *   - 3 demo users (admin, manager, driver)
 *   - 5 fleets across the two orgs
 *   - 50 vehicles (trucks + buses + vans)
 *   - 30 drivers with licences, contacts, scores
 *   - 6 months of weekly DriverScore records
 *   - 6 months of FuelRecord entries per vehicle
 *   - ServiceRecord history per vehicle
 *   - ServiceSchedule items (some overdue, some upcoming)
 *   - One recent Position per vehicle
 *
 * Run: pnpm db:seed
 * Safe to re-run: clears all tables before inserting.
 */

import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const pool = new Pool({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Supabase Admin client — used to create Auth users during seeding
const supabaseAdmin = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function rnd(min: number, max: number) {
  return Math.random() * (max - min) + min;
}
function rndInt(min: number, max: number) {
  return Math.floor(rnd(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

// ISO week string e.g. "2025-W12"
function isoWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = Math.round(
    ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
  ) + 1;
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

// ── Static data ───────────────────────────────────────────────────────────────

const DRIVER_NAMES = [
  "Aleksander Nowak", "Björn Eriksson", "Carlos Mendes", "Dmitri Volkov",
  "Emil Larsson", "Fatima Al-Hassan", "Grzegorz Kowalski", "Hans Müller",
  "Ingrid Svensson", "Jan Horáček", "Katarzyna Wiśniewska", "Luca Romano",
  "Marek Novotný", "Nikolaj Petersen", "Olga Ivanova", "Piotr Zając",
  "Quentin Dubois", "Ragnhild Berg", "Stefan Bauer", "Tomas Kučera",
  "Ursula Schmitt", "Viktor Horvat", "Wojciech Dąbrowski", "Xenia Papadopoulos",
  "Yannick Leroy", "Zuzanna Wróbel", "Anders Lindqvist", "Beata Kowalczyk",
  "Cristiano Ferreira", "Dagmar Hofmann",
];

const WORKSHOPS = [
  "MAN Service Centre Hamburg",
  "Volvo Trucks Copenhagen",
  "DAF Workshop Rotterdam",
  "Scania Service Berlin",
  "Iveco Fleet Services Warsaw",
  "Mercedes-Benz Trucks Vienna",
  "City Bus Depot – North",
  "City Bus Depot – South",
];

const SERVICE_TYPES = [
  "Oil & filter change",
  "Tyre rotation & balance",
  "Brake inspection & pad replacement",
  "Full annual service",
  "Transmission fluid change",
  "Air filter replacement",
  "Coolant flush",
  "AdBlue system check",
  "Tachograph calibration",
  "Safety inspection (§57a)",
];

// Approx bounding box: Central Europe (trucking) and a Nordic city (bus)
const TRUCKING_AREA = { latMin: 50.5, latMax: 54.5, lngMin: 9.0, lngMax: 18.5 };
const BUS_AREA      = { latMin: 57.6, latMax: 57.8, lngMin: 11.9, lngMax: 12.1 };

function randomPos(area: typeof TRUCKING_AREA) {
  return {
    lat: rnd(area.latMin, area.latMax),
    lng: rnd(area.lngMin, area.lngMax),
  };
}

// ── Seed ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱  Seeding database…");

  // ── Wipe existing data (order respects FK constraints) ────────────────────
  await prisma.driverScore.deleteMany();
  await prisma.serviceSchedule.deleteMany();
  await prisma.serviceRecord.deleteMany();
  await prisma.fuelRecord.deleteMany();
  await prisma.position.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.fleet.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();
  console.log("   ✓ Cleared existing records");

  // ── Organisations ─────────────────────────────────────────────────────────
  const orgTrucking = await prisma.organisation.create({
    data: { name: "EuroFreight Logistics GmbH" },
  });
  const orgBus = await prisma.organisation.create({
    data: { name: "Göteborgs Stadsbuss AB" },
  });
  console.log("   ✓ Created 2 organisations");

  // ── Demo users ────────────────────────────────────────────────────────────
  await prisma.user.createMany({
    data: [
      { email: "admin@demo-fleet.com",   orgId: orgTrucking.id },
      { email: "manager@demo-fleet.com", orgId: orgTrucking.id },
      { email: "driver@demo-fleet.com",  orgId: orgBus.id },
    ],
  });

  // Create the same users in Supabase Auth so they can sign in.
  // Uses upsert (email_confirm: true) so re-running seed doesn't fail on duplicates.
  const demoAuthUsers = [
    { email: "admin@demo-fleet.com",   password: "Demo1234!" },
    { email: "manager@demo-fleet.com", password: "Demo1234!" },
    { email: "driver@demo-fleet.com",  password: "Demo1234!" },
  ];
  for (const u of demoAuthUsers) {
    const { error } = await supabaseAdmin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
    });
    // Ignore "already exists" errors so seed is idempotent
    if (error && !error.message.includes("already been registered")) {
      throw new Error(`Failed to create auth user ${u.email}: ${error.message}`);
    }
  }
  console.log("   ✓ Created 3 demo users (DB + Supabase Auth)");

  // ── Fleets ────────────────────────────────────────────────────────────────
  const [fleetDE, fleetPL, fleetDK, fleetBusA, fleetBusB] =
    await Promise.all([
      prisma.fleet.create({ data: { name: "Germany & Austria",  orgId: orgTrucking.id } }),
      prisma.fleet.create({ data: { name: "Poland & Baltics",   orgId: orgTrucking.id } }),
      prisma.fleet.create({ data: { name: "Scandinavia",        orgId: orgTrucking.id } }),
      prisma.fleet.create({ data: { name: "City Bus – Line A",  orgId: orgBus.id } }),
      prisma.fleet.create({ data: { name: "City Bus – Line B",  orgId: orgBus.id } }),
    ]);
  console.log("   ✓ Created 5 fleets");

  // ── Drivers ───────────────────────────────────────────────────────────────
  const driverOrgMap = [
    // 18 trucking drivers
    ...Array.from({ length: 18 }, (_, i) => orgTrucking.id),
    // 12 bus drivers
    ...Array.from({ length: 12 }, (_, i) => orgBus.id),
  ];

  const drivers = await Promise.all(
    DRIVER_NAMES.map((name, i) =>
      prisma.driver.create({
        data: {
          name,
          orgId: driverOrgMap[i],
          licence: `LIC-${100000 + i}`,
          phone:   `+${rndInt(30, 49)}${rndInt(100000000, 999999999)}`,
          email:   `${name.split(" ")[0].toLowerCase()}.${name.split(" ")[1].toLowerCase()}@demo-fleet.com`,
        },
      })
    )
  );
  console.log(`   ✓ Created ${drivers.length} drivers`);

  // ── Vehicles ──────────────────────────────────────────────────────────────
  const truckingDrivers = drivers.filter((_, i) => i < 18);
  const busDrivers      = drivers.filter((_, i) => i >= 18);

  const truckSpecs = [
    { make: "MAN",           model: "TGX 18.510",   type: "truck" },
    { make: "Volvo",         model: "FH 500",        type: "truck" },
    { make: "Scania",        model: "R 450",         type: "truck" },
    { make: "DAF",           model: "XF 480",        type: "truck" },
    { make: "Mercedes-Benz", model: "Actros 1845",   type: "truck" },
    { make: "Iveco",         model: "S-Way 480",     type: "truck" },
    { make: "Renault",       model: "T 480",         type: "truck" },
    { make: "Mercedes-Benz", model: "Sprinter 316",  type: "van"   },
    { make: "Volkswagen",    model: "Crafter 35",    type: "van"   },
  ];
  const busSpecs = [
    { make: "Volvo",   model: "7900 Hybrid", type: "bus" },
    { make: "Scania",  model: "Citywide LE", type: "bus" },
    { make: "Solaris", model: "Urbino 12",   type: "bus" },
    { make: "MAN",     model: "Lion's City", type: "bus" },
  ];

  const truckFleets = [fleetDE, fleetPL, fleetDK];
  const busFleets   = [fleetBusA, fleetBusB];

  const vehicleData: {
    registration: string;
    type: string;
    make: string;
    model: string;
    year: number;
    fleetId: string;
    driverId: string | null;
    area: typeof TRUCKING_AREA;
  }[] = [];

  // 36 trucking vehicles (trucks + vans)
  for (let i = 0; i < 36; i++) {
    const spec = truckSpecs[i % truckSpecs.length];
    vehicleData.push({
      registration: `DE-${String(100 + i).padStart(3, "0")}-TRK`,
      type: spec.type,
      make: spec.make,
      model: spec.model,
      year: rndInt(2018, 2024),
      fleetId: truckFleets[i % truckFleets.length].id,
      driverId: i < truckingDrivers.length ? truckingDrivers[i].id : null,
      area: TRUCKING_AREA,
    });
  }

  // 14 bus vehicles
  for (let i = 0; i < 14; i++) {
    const spec = busSpecs[i % busSpecs.length];
    vehicleData.push({
      registration: `SE-${String(200 + i).padStart(3, "0")}-BUS`,
      type: spec.type,
      make: spec.make,
      model: spec.model,
      year: rndInt(2017, 2024),
      fleetId: busFleets[i % busFleets.length].id,
      driverId: i < busDrivers.length ? busDrivers[i].id : null,
      area: BUS_AREA,
    });
  }

  const vehicles = await Promise.all(
    vehicleData.map(({ area: _area, ...v }) => prisma.vehicle.create({ data: v }))
  );
  console.log(`   ✓ Created ${vehicles.length} vehicles`);

  // ── Latest positions (one per vehicle) ───────────────────────────────────
  // Mix of active (engine on, moving), idle (engine on, stationary), and
  // offline (engine off / stale — simulated by using an old timestamp).
  const positionRows = vehicles.map((v, i) => {
    const area = i < 36 ? TRUCKING_AREA : BUS_AREA;
    const { lat, lng } = randomPos(area);
    const status = i % 5 === 0 ? "offline" : i % 4 === 0 ? "idle" : "active";
    const minsAgo = status === "offline" ? rndInt(30, 240) : rndInt(0, 4);
    const createdAt = new Date(Date.now() - minsAgo * 60 * 1000);
    return {
      vehicleId: v.id,
      lat,
      lng,
      heading: rnd(0, 360),
      speedKmh: status === "active" ? rnd(40, 110) : 0,
      engineOn: status !== "offline",
      createdAt,
    };
  });

  await prisma.position.createMany({ data: positionRows });
  console.log(`   ✓ Created ${positionRows.length} latest positions`);

  // ── 6 months of fuel records ──────────────────────────────────────────────
  // One refuel every 7–10 days per vehicle, at realistic volumes and costs.
  const fuelRows: {
    vehicleId: string;
    litres: number;
    costEur: number;
    odometer: number;
    createdAt: Date;
  }[] = [];

  for (const v of vehicles) {
    let odometer = rndInt(80_000, 250_000);
    let cursor = daysAgo(180);
    while (cursor < new Date()) {
      const isTruck = v.type === "truck";
      const litres = isTruck ? rnd(300, 550) : rnd(100, 180);
      const pricePerLitre = rnd(1.55, 1.85);
      const kmSinceLast = isTruck ? rndInt(1200, 2200) : rndInt(400, 900);
      odometer += kmSinceLast;
      fuelRows.push({
        vehicleId: v.id,
        litres: Math.round(litres * 10) / 10,
        costEur: Math.round(litres * pricePerLitre * 100) / 100,
        odometer,
        createdAt: new Date(cursor),
      });
      cursor = new Date(cursor.getTime() + rndInt(7, 10) * 86400000);
    }
  }

  // Insert in batches of 500 to avoid hitting Supabase limits
  for (let i = 0; i < fuelRows.length; i += 500) {
    await prisma.fuelRecord.createMany({ data: fuelRows.slice(i, i + 500) });
  }
  console.log(`   ✓ Created ${fuelRows.length} fuel records`);

  // ── Service records (historical) ─────────────────────────────────────────
  const serviceRows: {
    vehicleId: string;
    description: string;
    costEur: number;
    workshop: string;
    completedAt: Date;
  }[] = [];

  for (const v of vehicles) {
    const count = rndInt(2, 5);
    for (let i = 0; i < count; i++) {
      serviceRows.push({
        vehicleId: v.id,
        description: pick(SERVICE_TYPES),
        costEur: Math.round(rnd(180, 2400) * 100) / 100,
        workshop: pick(WORKSHOPS),
        completedAt: daysAgo(rndInt(10, 175)),
      });
    }
  }

  await prisma.serviceRecord.createMany({ data: serviceRows });
  console.log(`   ✓ Created ${serviceRows.length} service records`);

  // ── Service schedules ─────────────────────────────────────────────────────
  // Every vehicle gets 1–3 scheduled services:
  //   ~30% overdue (dueAt in the past, done = false)
  //   ~40% due soon (within 30 days)
  //   ~30% upcoming (30–90 days away)
  const scheduleRows: {
    vehicleId: string;
    description: string;
    dueAt: Date;
    dueMileage: number | null;
    done: boolean;
  }[] = [];

  for (const v of vehicles) {
    const count = rndInt(1, 3);
    for (let i = 0; i < count; i++) {
      const bucket = Math.random();
      let dueAt: Date;
      if (bucket < 0.3) {
        dueAt = daysAgo(rndInt(1, 45));      // overdue
      } else if (bucket < 0.7) {
        dueAt = daysFromNow(rndInt(1, 30));  // due soon
      } else {
        dueAt = daysFromNow(rndInt(31, 90)); // upcoming
      }
      scheduleRows.push({
        vehicleId: v.id,
        description: pick(SERVICE_TYPES),
        dueAt,
        dueMileage: Math.random() > 0.5 ? rndInt(10_000, 50_000) * 10 : null,
        done: false,
      });
    }
  }

  await prisma.serviceSchedule.createMany({ data: scheduleRows });
  console.log(`   ✓ Created ${scheduleRows.length} service schedule items`);

  // ── Driver scores — weekly for 26 weeks ───────────────────────────────────
  // Each driver gets one DriverScore per ISO week for the last 26 weeks.
  // Scores vary per driver (each has a "base" tendency) and fluctuate weekly.
  const scoreRows: {
    driverId: string;
    period: string;
    score: number;
    harshBraking: number;
    harshAccel: number;
    speeding: number;
    idleMinutes: number;
  }[] = [];

  for (const driver of drivers) {
    // Each driver has a persistent skill level (50–90)
    const baseTendency = rnd(50, 90);

    for (let w = 25; w >= 0; w--) {
      const weekDate = daysAgo(w * 7);
      const period = isoWeek(weekDate);

      const harshBraking = Math.max(0, Math.round(rnd(0, 20) * (1 - baseTendency / 120)));
      const harshAccel   = Math.max(0, Math.round(rnd(0, 18) * (1 - baseTendency / 120)));
      const speeding     = Math.max(0, Math.round(rnd(0, 15) * (1 - baseTendency / 120)));
      const idleMinutes  = Math.max(0, Math.round(rnd(60, 400) * (1 - baseTendency / 150)));

      // Score: base tendency ± weekly noise, penalised by events
      const eventPenalty = (harshBraking + harshAccel) * 1.5 + speeding * 2 + idleMinutes * 0.04;
      const score = Math.max(
        0,
        Math.min(100, baseTendency + rnd(-8, 8) - eventPenalty * 0.3)
      );

      scoreRows.push({
        driverId: driver.id,
        period,
        score: Math.round(score * 10) / 10,
        harshBraking,
        harshAccel,
        speeding,
        idleMinutes,
      });
    }
  }

  for (let i = 0; i < scoreRows.length; i += 500) {
    await prisma.driverScore.createMany({ data: scoreRows.slice(i, i + 500) });
  }
  console.log(`   ✓ Created ${scoreRows.length} driver score records`);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n✅  Seed complete!\n");
  console.log("   Demo accounts:");
  console.log("   admin@demo-fleet.com   / Demo1234!  (OrgAdmin — EuroFreight)");
  console.log("   manager@demo-fleet.com / Demo1234!  (FleetManager — EuroFreight)");
  console.log("   driver@demo-fleet.com  / Demo1234!  (Driver — Göteborgs Stadsbuss)\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
