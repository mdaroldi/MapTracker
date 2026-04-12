import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

// DATABASE_URL  — Supabase pooler (port 6543), used by PrismaClient at runtime
// DIRECT_URL    — Supabase direct (port 5432), used by Prisma Migrate / db push

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
