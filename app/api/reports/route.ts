import { NextResponse } from "next/server";
import type { ApiResponse } from "@/types";

export async function GET(): Promise<NextResponse<ApiResponse<unknown[]>>> {
  return NextResponse.json({ data: [], error: null });
}
