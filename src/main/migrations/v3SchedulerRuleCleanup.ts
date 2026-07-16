import type { Database as SqliteDatabase } from "better-sqlite3";

type ColumnInfo = {
  name: string;
};

const staffingRequirementsV3Sql = `
CREATE TABLE staffing_requirements (
  id TEXT PRIMARY KEY,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  shift_template_id TEXT,
  role_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  required_count INTEGER NOT NULL CHECK (required_count >= 0),
  minimum_experience_level TEXT NOT NULL DEFAULT 'no_experience' CHECK (minimum_experience_level IN ('no_experience', 'some_experience', 'experienced')),
  experienced_required_count INTEGER NOT NULL DEFAULT 0 CHECK (experienced_required_count >= 0),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shift_template_id) REFERENCES shift_templates (id) ON DELETE SET NULL,
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
)`;

const specialDayStaffingRequirementsV3Sql = `
CREATE TABLE special_day_staffing_requirements (
  id TEXT PRIMARY KEY,
  special_day_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  required_count INTEGER NOT NULL CHECK (required_count >= 0),
  minimum_experience_level TEXT NOT NULL DEFAULT 'no_experience' CHECK (minimum_experience_level IN ('no_experience', 'some_experience', 'experienced')),
  experienced_required_count INTEGER NOT NULL DEFAULT 0 CHECK (experienced_required_count >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (special_day_id) REFERENCES special_days (id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
)`;

export function applyV3SchedulerRuleCleanupMigration(
  db: SqliteDatabase
): void {
  rebuildStaffingRequirementsWithoutPriority(db);
  ensureSpecialDayRequirementExperienceColumns(db);
  ensureScheduleSlotSnapshotColumns(db);
}

function rebuildStaffingRequirementsWithoutPriority(db: SqliteDatabase): void {
  if (!tableExists(db, "staffing_requirements")) {
    db.exec(staffingRequirementsV3Sql);
    return;
  }

  const columns = getColumnNames(db, "staffing_requirements");
  if (!columns.has("priority")) {
    return;
  }

  db.exec("ALTER TABLE staffing_requirements RENAME TO staffing_requirements_v2");
  db.exec(staffingRequirementsV3Sql);
  db.exec(
    `INSERT INTO staffing_requirements (
      id,
      day_of_week,
      shift_template_id,
      role_id,
      start_time,
      end_time,
      required_count,
      minimum_experience_level,
      experienced_required_count,
      is_active,
      notes,
      created_at,
      updated_at
    )
    SELECT
      id,
      day_of_week,
      shift_template_id,
      role_id,
      start_time,
      end_time,
      required_count,
      CASE
        WHEN minimum_experience_level IN ('no_experience', 'some_experience', 'experienced') THEN minimum_experience_level
        ELSE 'no_experience'
      END,
      CASE
        WHEN experienced_required_count IS NULL OR experienced_required_count < 0 THEN 0
        ELSE experienced_required_count
      END,
      CASE WHEN is_active IN (0, 1) THEN is_active ELSE 1 END,
      notes,
      created_at,
      updated_at
    FROM staffing_requirements_v2`
  );
  db.exec("DROP TABLE staffing_requirements_v2");
}

function ensureSpecialDayRequirementExperienceColumns(
  db: SqliteDatabase
): void {
  if (!tableExists(db, "special_day_staffing_requirements")) {
    db.exec(specialDayStaffingRequirementsV3Sql);
    return;
  }

  const columns = getColumnNames(db, "special_day_staffing_requirements");

  if (!columns.has("minimum_experience_level")) {
    db.exec(
      `ALTER TABLE special_day_staffing_requirements
       ADD COLUMN minimum_experience_level TEXT NOT NULL DEFAULT 'no_experience'
       CHECK (minimum_experience_level IN ('no_experience', 'some_experience', 'experienced'))`
    );
  }

  if (!columns.has("experienced_required_count")) {
    db.exec(
      `ALTER TABLE special_day_staffing_requirements
       ADD COLUMN experienced_required_count INTEGER NOT NULL DEFAULT 0
       CHECK (experienced_required_count >= 0)`
    );
  }
}

function ensureScheduleSlotSnapshotColumns(db: SqliteDatabase): void {
  if (!tableExists(db, "schedule_slots")) {
    return;
  }

  const columns = getColumnNames(db, "schedule_slots");

  if (!columns.has("requirement_group_id")) {
    db.exec("ALTER TABLE schedule_slots ADD COLUMN requirement_group_id TEXT");
  }

  if (!columns.has("minimum_experience_level")) {
    db.exec(
      `ALTER TABLE schedule_slots
       ADD COLUMN minimum_experience_level TEXT NOT NULL DEFAULT 'no_experience'
       CHECK (minimum_experience_level IN ('no_experience', 'some_experience', 'experienced'))`
    );
  }

  if (!columns.has("experienced_required_count")) {
    db.exec(
      `ALTER TABLE schedule_slots
       ADD COLUMN experienced_required_count INTEGER NOT NULL DEFAULT 0
       CHECK (experienced_required_count >= 0)`
    );
  }

  if (!columns.has("slot_number")) {
    db.exec("ALTER TABLE schedule_slots ADD COLUMN slot_number INTEGER");
  }

  backfillScheduleSlotSnapshots(db);
}

function backfillScheduleSlotSnapshots(db: SqliteDatabase): void {
  db.exec(
    `UPDATE schedule_slots
     SET
       requirement_group_id = COALESCE(
         requirement_group_id,
         CASE
           WHEN source_id IS NOT NULL THEN date || '|' || COALESCE(source_type, 'requirement') || '|' || source_id
           ELSE date || '|' || role_id || '|' || start_time || '|' || end_time
         END
       ),
       slot_number = COALESCE(slot_number, 1)
     WHERE requirement_group_id IS NULL OR slot_number IS NULL`
  );

  if (tableExists(db, "staffing_requirements")) {
    db.exec(
      `UPDATE schedule_slots
       SET
         minimum_experience_level = COALESCE(
           (
             SELECT CASE
               WHEN sr.minimum_experience_level IN ('no_experience', 'some_experience', 'experienced') THEN sr.minimum_experience_level
               ELSE 'no_experience'
             END
             FROM staffing_requirements sr
             WHERE sr.id = schedule_slots.source_id
           ),
           minimum_experience_level,
           'no_experience'
         ),
         experienced_required_count = COALESCE(
           (
             SELECT CASE
               WHEN sr.experienced_required_count IS NULL OR sr.experienced_required_count < 0 THEN 0
               ELSE sr.experienced_required_count
             END
             FROM staffing_requirements sr
             WHERE sr.id = schedule_slots.source_id
           ),
           experienced_required_count,
           0
         )
       WHERE source_type IN ('staffing_requirement', 'weekly_requirement')`
    );
  }
}

function tableExists(db: SqliteDatabase, tableName: string): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
      )
      .get(tableName)
  );
}

function getColumnNames(db: SqliteDatabase, tableName: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${tableName})`).all() as ColumnInfo[]).map(
      (column) => column.name
    )
  );
}
