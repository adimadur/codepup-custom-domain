import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.NEON_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing NEON_DATABASE_URL");
}

// This is SAFE in serverless
export const sql = neon(databaseUrl);
