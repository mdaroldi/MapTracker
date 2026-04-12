import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ApiResponse } from "@/types";

export interface VehiclePositionData {
  vehicleId: string;
  registration: string;
  type: string;
  lat: number;
  lng: number;
  heading: number;
  speedKmh: number;
  engineOn: boolean;
}

/**
 * GET /api/positions
 * Returns the most recent position for every vehicle.
 * Used by the live map on initial load; subsequent updates come via
 * Supabase Realtime (postgres_changes INSERT on the "Position" table).
 */
export async function GET(): Promise<
  NextResponse<ApiResponse<VehiclePositionData[]>>
> {
  try {
    const vehicles = await prisma.vehicle.findMany({
      select: {
        id: true,
        registration: true,
        type: true,
        positions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            lat: true,
            lng: true,
            heading: true,
            speedKmh: true,
            engineOn: true,
          },
        },
      },
    });

    type VehicleRow = (typeof vehicles)[number];
    const data: VehiclePositionData[] = vehicles
      .filter((v: VehicleRow) => v.positions.length > 0)
      .map((v: VehicleRow) => ({
        vehicleId: v.id,
        registration: v.registration,
        type: v.type,
        lat: v.positions[0].lat,
        lng: v.positions[0].lng,
        heading: v.positions[0].heading,
        speedKmh: v.positions[0].speedKmh,
        engineOn: v.positions[0].engineOn,
      }));

    return NextResponse.json({ data, error: null });
  } catch {
    return NextResponse.json(
      { data: null, error: "Failed to load positions" },
      { status: 500 }
    );
  }
}
