import { describe, it, expect } from "vitest";
import { dotColor, dotRadius } from "@/lib/vehicle-display";
import type { VehiclePositionData } from "@/app/api/positions/route";

function makeVehicle(
  overrides: Partial<VehiclePositionData> = {},
): VehiclePositionData {
  return {
    vehicleId: "v-1",
    registration: "ABC 123",
    type: "truck",
    lat: 59.3293,
    lng: 18.0686,
    heading: 0,
    speedKmh: 0,
    engineOn: false,
    ...overrides,
  };
}

// ── dotColor ──────────────────────────────────────────────────────────────────

describe("dotColor", () => {
  it("returns grey when engine is off", () => {
    const v = makeVehicle({ engineOn: false, speedKmh: 60 });
    expect(dotColor(v)).toEqual([148, 163, 184, 200]);
  });

  it("returns amber when engine is on but speed < 1 (idling)", () => {
    const v = makeVehicle({ engineOn: true, speedKmh: 0 });
    expect(dotColor(v)).toEqual([251, 191, 36, 230]);
  });

  it("returns amber at exactly speedKmh = 0.99 (boundary)", () => {
    const v = makeVehicle({ engineOn: true, speedKmh: 0.99 });
    expect(dotColor(v)).toEqual([251, 191, 36, 230]);
  });

  it("returns green when engine is on and speed >= 1 (moving)", () => {
    const v = makeVehicle({ engineOn: true, speedKmh: 50 });
    expect(dotColor(v)).toEqual([34, 197, 94, 230]);
  });

  it("returns green at exactly speedKmh = 1 (boundary)", () => {
    const v = makeVehicle({ engineOn: true, speedKmh: 1 });
    expect(dotColor(v)).toEqual([34, 197, 94, 230]);
  });
});

// ── dotRadius ─────────────────────────────────────────────────────────────────

describe("dotRadius", () => {
  it("returns 140 for buses", () => {
    const v = makeVehicle({ type: "bus" });
    expect(dotRadius(v)).toBe(140);
  });

  it("returns 100 for vans", () => {
    const v = makeVehicle({ type: "van" });
    expect(dotRadius(v)).toBe(100);
  });

  it("returns 160 for trucks", () => {
    const v = makeVehicle({ type: "truck" });
    expect(dotRadius(v)).toBe(160);
  });

  it("returns 160 for unknown vehicle types", () => {
    const v = makeVehicle({ type: "unknown" });
    expect(dotRadius(v)).toBe(160);
  });
});
