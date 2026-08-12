/**
 * Postgres connection singleton using the `postgres` driver.
 * Uses DATABASE_URL from environment.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@shared/db/schema";

let db: PostgresJsDatabase<typeof schema> | null = null;

export function getDb() {
  if (!db) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not set");
    }
    // The schema is pure table definitions (no side effects, no connection),
    // so importing it eagerly here is safe; the DB connection itself stays
    // lazy and is only opened on the first getDb() call.
    db = drizzle(postgres(databaseUrl, { max: 10 }), { schema });
  }
  return db;
}

export type DbClient = ReturnType<typeof postgres>;
