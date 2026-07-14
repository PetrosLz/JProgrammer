import type { Database as SqliteDatabase } from "better-sqlite3";

export function applyV1CompatibilityMigration(db: SqliteDatabase): void {
  addColumnIfMissing(db, "business_settings", "business_type", "TEXT");
  addColumnIfMissing(db, "business_settings", "location", "TEXT");
  addColumnIfMissing(
    db,
    "business_settings",
    "language",
    "TEXT NOT NULL DEFAULT 'el'"
  );
  addColumnIfMissing(
    db,
    "opening_hours",
    "is_overnight",
    "INTEGER NOT NULL DEFAULT 0 CHECK (is_overnight IN (0, 1))"
  );
  addColumnIfMissing(
    db,
    "shift_templates",
    "is_overnight",
    "INTEGER NOT NULL DEFAULT 0 CHECK (is_overnight IN (0, 1))"
  );
  addColumnIfMissing(db, "staffing_requirements", "shift_template_id", "TEXT");

  const addedEmployeeExperienceLevel = addColumnIfMissing(
    db,
    "employee_roles",
    "experience_level",
    "TEXT NOT NULL DEFAULT 'some_experience' CHECK (experience_level IN ('no_experience', 'some_experience', 'experienced'))"
  );
  addColumnIfMissing(
    db,
    "employee_roles",
    "skill_level",
    "INTEGER NOT NULL DEFAULT 3 CHECK (skill_level BETWEEN 1 AND 5)"
  );
  addColumnIfMissing(
    db,
    "employee_roles",
    "can_lead_role",
    "INTEGER NOT NULL DEFAULT 0 CHECK (can_lead_role IN (0, 1))"
  );
  addColumnIfMissing(
    db,
    "employee_roles",
    "is_preferred_role",
    "INTEGER NOT NULL DEFAULT 0 CHECK (is_preferred_role IN (0, 1))"
  );

  if (addedEmployeeExperienceLevel) {
    db.exec(`
      UPDATE employee_roles
      SET experience_level = CASE
        WHEN skill_level <= 2 THEN 'no_experience'
        WHEN skill_level >= 4 THEN 'experienced'
        ELSE 'some_experience'
      END
    `);
  }

  addColumnIfMissing(
    db,
    "staffing_requirements",
    "minimum_experience_level",
    "TEXT NOT NULL DEFAULT 'no_experience' CHECK (minimum_experience_level IN ('no_experience', 'some_experience', 'experienced'))"
  );
  addColumnIfMissing(
    db,
    "staffing_requirements",
    "experienced_required_count",
    "INTEGER NOT NULL DEFAULT 0 CHECK (experienced_required_count >= 0)"
  );
  addColumnIfMissing(
    db,
    "staffing_requirements",
    "priority",
    "TEXT NOT NULL DEFAULT 'normal'"
  );
  addColumnIfMissing(
    db,
    "staffing_requirements",
    "is_active",
    "INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))"
  );

  addColumnIfMissing(
    db,
    "time_off",
    "type",
    "TEXT NOT NULL DEFAULT 'day_off'"
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_shift_availability (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
      shift_template_id TEXT NOT NULL,
      availability_type TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
      FOREIGN KEY (shift_template_id) REFERENCES shift_templates (id) ON DELETE CASCADE,
      UNIQUE (employee_id, day_of_week, shift_template_id)
    );
    CREATE INDEX IF NOT EXISTS idx_employee_shift_availability_employee_shift
      ON employee_shift_availability (employee_id, day_of_week, shift_template_id);
  `);

  addColumnIfMissing(
    db,
    "schedule_slots",
    "status",
    "TEXT NOT NULL DEFAULT 'unfilled'"
  );
  addColumnIfMissing(
    db,
    "schedule_assignments",
    "is_manual_override",
    "INTEGER NOT NULL DEFAULT 0 CHECK (is_manual_override IN (0, 1))"
  );
}

function addColumnIfMissing(
  db: SqliteDatabase,
  tableName: string,
  columnName: string,
  definition: string
): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === columnName)) {
    return false;
  }

  db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
  return true;
}
