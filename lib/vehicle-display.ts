import type { VehiclePositionData } from "@/app/api/positions/route";

/**
 * Returns an RGBA tuple for the vehicle dot.
 *   Green  — moving  (engineOn && speedKmh > 1)
 *   Amber  — idling  (engineOn && speedKmh ≤ 1)
 *   Grey   — offline (engine off)
 */
export function dotColor(
  v: VehiclePositionData,
): [number, number, number, number] {
  if (!v.engineOn) return [148, 163, 184, 200]; // slate-400
  if (v.speedKmh < 1) return [251, 191, 36, 230]; // amber-400
  return [34, 197, 94, 230]; // green-500
}

export function dotRadius(v: VehiclePositionData): number {
  return v.type === "bus" ? 140 : v.type === "van" ? 100 : 160;
}
