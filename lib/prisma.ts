import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Singleton pattern — prevents multiple PrismaClient instances during hot reload
const globalForPrisma = globalThis as unknown as {
  pool: Pool | undefined;
  prisma: PrismaClient | undefined;
};

// Use the pooler (DATABASE_URL, port 6543) for API route queries — it's designed
// for serverless environments. DIRECT_URL (port 5432) is for migrations only.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Log the host on first init so misconfiguration is immediately visible
if (!globalForPrisma.pool) {
  const host = connectionString.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`[prisma] connecting to ${host}`);
}

const pool =
  globalForPrisma.pool ??
  new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(pool),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.pool = pool;
  globalForPrisma.prisma = prisma;
}
