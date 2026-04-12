import { z } from "zod";

// ── Vehicle ───────────────────────────────────────────────────────────────────

export const VehicleSchema = z.object({
  id: z.string().uuid(),
  registration: z.string(),
  type: z.enum(["truck", "bus", "van"]),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  fleetId: z.string().uuid(),
  driverId: z.string().uuid().nullable(),
});

export type Vehicle = z.infer<typeof VehicleSchema>;

// ── Driver ────────────────────────────────────────────────────────────────────

export const DriverSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  licence: z.string(),
  phone: z.string(),
  email: z.string().email(),
  orgId: z.string().uuid(),
});

export type Driver = z.infer<typeof DriverSchema>;

// ── Position ──────────────────────────────────────────────────────────────────

export const PositionSchema = z.object({
  id: z.string().uuid(),
  vehicleId: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  heading: z.number(),
  speedKmh: z.number(),
  engineOn: z.boolean(),
  createdAt: z.string().datetime(),
});

export type Position = z.infer<typeof PositionSchema>;

// ── API response envelope ─────────────────────────────────────────────────────

export type ApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: string };
