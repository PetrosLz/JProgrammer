import type { Database as SqliteDatabase } from "better-sqlite3";

import { applyV1CompatibilityMigration } from "./v1Compatibility";
import { applyV2SchedulerModelMigration } from "./v2SchedulerModel";
import { applyV3SchedulerRuleCleanupMigration } from "./v3SchedulerRuleCleanup";
import { applyV4OpeningHours24HourModeMigration } from "./v4OpeningHours24HourMode";

export type DatabaseMigration = {
  version: number;
  name: string;
  up: (db: SqliteDatabase) => void;
  disableForeignKeys?: boolean;
};

export const latestSchemaVersion = 4;

const migrations: DatabaseMigration[] = [
  {
    version: 1,
    name: "v1 compatibility",
    up: applyV1CompatibilityMigration
  },
  {
    version: 2,
    name: "v2 scheduler model",
    up: applyV2SchedulerModelMigration,
    disableForeignKeys: true
  },
  {
    version: 3,
    name: "v3 scheduler rule cleanup",
    up: applyV3SchedulerRuleCleanupMigration,
    disableForeignKeys: true
  },
  {
    version: 4,
    name: "v4 opening hours 24-hour mode",
    up: applyV4OpeningHours24HourModeMigration
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

    runVersionedMigration(db, migration);
  }

  const finalVersion = readSchemaVersion(db);
  if (finalVersion < latestSchemaVersion) {
    writeSchemaVersion(db, latestSchemaVersion);
  }
}

function runVersionedMigration(
  db: SqliteDatabase,
  migration: DatabaseMigration
): void {
  const previousForeignKeyState = Number(
    db.pragma("foreign_keys", { simple: true })
  );
  const previousLegacyAlterTableState = Number(
    db.pragma("legacy_alter_table", { simple: true })
  );

  if (migration.disableForeignKeys) {
    db.pragma("foreign_keys = OFF");
    db.pragma("legacy_alter_table = ON");
  }

  try {
    const runMigration = db.transaction(() => {
      migration.up(db);
      if (migration.disableForeignKeys) {
        const foreignKeyViolations = db
          .prepare("PRAGMA foreign_key_check")
          .all();

        if (foreignKeyViolations.length > 0) {
          throw new Error(
            `Migration ${migration.version} produced ${foreignKeyViolations.length} foreign-key violation(s).`
          );
        }
      }
      writeSchemaVersion(db, migration.version);
    });

    runMigration();
  } finally {
    if (migration.disableForeignKeys) {
      db.pragma(`foreign_keys = ${previousForeignKeyState ? "ON" : "OFF"}`);
      db.pragma(
        `legacy_alter_table = ${previousLegacyAlterTableState ? "ON" : "OFF"}`
      );
    }
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
