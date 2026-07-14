import type { Database as SqliteDatabase } from "better-sqlite3";

import { applyV1CompatibilityMigration } from "./v1Compatibility";

export type DatabaseMigration = {
  version: number;
  name: string;
  up: (db: SqliteDatabase) => void;
};

export const latestSchemaVersion = 1;

const migrations: DatabaseMigration[] = [
  {
    version: 1,
    name: "v1 compatibility",
    up: applyV1CompatibilityMigration
  }
];

export function applyVersionedMigrations(db: SqliteDatabase): void {
  const currentVersion = readSchemaVersion(db);

  if (currentVersion > latestSchemaVersion) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this app supports (${latestSchemaVersion}).`
    );
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue;
    }

    const runMigration = db.transaction(() => {
      migration.up(db);
      writeSchemaVersion(db, migration.version);
    });

    runMigration();
  }

  const finalVersion = readSchemaVersion(db);
  if (finalVersion < latestSchemaVersion) {
    writeSchemaVersion(db, latestSchemaVersion);
  }
}

function readSchemaVersion(db: SqliteDatabase): number {
  const pragmaVersion = Number(db.pragma("user_version", { simple: true }));

  return Number.isInteger(pragmaVersion) && pragmaVersion >= 0
    ? pragmaVersion
    : 0;
}

function writeSchemaVersion(db: SqliteDatabase, version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`Invalid schema version: ${version}`);
  }

  db.pragma(`user_version = ${version}`);
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('schema_version', ?, datetime('now'))
     ON CONFLICT (key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now')`
  ).run(String(version));
}
