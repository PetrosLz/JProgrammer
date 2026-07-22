import type { Database as SqliteDatabase } from "better-sqlite3";

export function applyV6AssignmentLocksAndSourceMigration(
  db: SqliteDatabase
): void {
  if (!tableExists(db, "schedule_assignments")) {
    return;
  }

  addColumnIfMissing(
    db,
    "schedule_assignments",
    "is_locked",
    "INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1))"
  );
  addColumnIfMissing(
    db,
    "schedule_assignments",
    "source",
    "TEXT NOT NULL DEFAULT 'automatic_heuristic' CHECK (source IN ('automatic_cp_sat', 'automatic_heuristic', 'manual', 'locked_manual', 'imported'))"
  );

  if (hasColumn(db, "schedule_assignments", "is_manual_override")) {
    db.exec(
      `UPDATE schedule_assignments
       SET source = 'manual'
       WHERE is_manual_override = 1
         AND source = 'automatic_heuristic'`
    );
  }
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName);
  return Boolean(row);
}

function hasColumn(
  db: SqliteDatabase,
  tableName: string,
  columnName: string
): boolean {
  return getColumns(db, tableName).some((column) => column.name === columnName);
}

function addColumnIfMissing(
  db: SqliteDatabase,
  tableName: string,
  columnName: string,
  definition: string
): boolean {
  if (hasColumn(db, tableName, columnName)) {
    return false;
  }

  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  return true;
}

function getColumns(
  db: SqliteDatabase,
  tableName: string
): Array<{ name: string }> {
  return db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
}
