import type { Database as SqliteDatabase } from "better-sqlite3";

export function applyV5LegacyEqualTimeShiftSafetyMigration(
  db: SqliteDatabase
): void {
  if (!tableExists(db, "shift_templates")) {
    return;
  }

  const invalidCount = Number(
    (
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM shift_templates WHERE start_time = end_time"
        )
        .get() as { count: number }
    ).count
  );

  if (invalidCount === 0) {
    return;
  }

  db.exec(
    `UPDATE shift_templates
     SET
       is_overnight = 0,
       is_active = 0
     WHERE start_time = end_time`
  );

  if (!tableExists(db, "settings")) {
    return;
  }

  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('scheduler_v4_invalid_equal_time_shifts_need_review', 'true', datetime('now'))
     ON CONFLICT (key) DO UPDATE SET
       value = excluded.value,
       updated_at = datetime('now')`
  ).run();
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
    )
    .get(tableName);
  return Boolean(row);
}
