/**
 * Postgres connection singleton using the `postgres` driver.
 * Uses DATABASE_URL from environment.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let db: PostgresJsDatabase | null = null;

export function getDb() {
  if (!db) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    // Import schema lazily to avoid circular deps
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: schema } = require("@shared/db/schema");
    db = drizzle(postgres(databaseUrl, { max: 10 }), { schema });
  }
  return db;
}

export type DbClient = ReturnType<typeof postgres>;
