import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

export interface DatabaseHandle {
  db: BetterSQLite3Database<typeof schema>;
  sqlite: Database.Database;
  close: () => void;
}

export function createDatabase(
  databasePath: string,
  migrationsFolder: string,
): DatabaseHandle {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  if (!existsSync(migrationsFolder)) {
    throw new Error(`Migration folder does not exist: ${migrationsFolder}`);
  }

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");
  if (databasePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  sqlite.pragma("optimize");

  return {
    db,
    sqlite,
    close: () => sqlite.close(),
  };
}

