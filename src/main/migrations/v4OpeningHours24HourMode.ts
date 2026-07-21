import type { Database as SqliteDatabase } from "better-sqlite3";

type ColumnInfo = {
  name: string;
};

export function applyV4OpeningHours24HourModeMigration(
  db: SqliteDatabase
): void {
  ensureOpeningHours24HourColumn(db);
  normalizeOpeningHoursOvernightFlags(db);
  normalizeShiftTemplateOvernightFlags(db);
}

function ensureOpeningHours24HourColumn(db: SqliteDatabase): void {
  if (!tableExists(db, "opening_hours")) {
    return;
  }

  const columns = getColumnNames(db, "opening_hours");
  if (!columns.has("is_24_hours")) {
    db.exec(
      "ALTER TABLE opening_hours ADD COLUMN is_24_hours INTEGER NOT NULL DEFAULT 0 CHECK (is_24_hours IN (0, 1))"
    );
  }

  db.exec(
    `UPDATE opening_hours
     SET is_24_hours = 0
     WHERE is_24_hours IS NULL OR is_24_hours NOT IN (0, 1)`
  );
}

function normalizeOpeningHoursOvernightFlags(db: SqliteDatabase): void {
  if (!tableExists(db, "opening_hours")) {
    return;
  }

  db.exec(
    `UPDATE opening_hours
     SET is_overnight = CASE
       WHEN is_open = 1
        AND is_24_hours = 0
        AND open_time IS NOT NULL
        AND close_time IS NOT NULL
        AND close_time < open_time THEN 1
       ELSE 0
     END`
  );
}

function normalizeShiftTemplateOvernightFlags(db: SqliteDatabase): void {
  if (!tableExists(db, "shift_templates")) {
    return;
  }

  db.exec(
    `UPDATE shift_templates
     SET is_overnight = CASE
       WHEN end_time < start_time THEN 1
       ELSE 0
     END`
  );
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName);
  return Boolean(row);
}

function getColumnNames(db: SqliteDatabase, tableName: string): Set<string> {
  return new Set(
    db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => (column as ColumnInfo).name)
  );
}
