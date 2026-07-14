import type { Database as SqliteDatabase } from "better-sqlite3";

type ColumnInfo = {
  name: string;
};

type LegacyWorkRuleRow = {
  id: string;
  employee_id: string;
  max_shifts_per_week?: number | null;
  max_days_per_week?: number | null;
  contract_days_per_week?: number | null;
  preferred_hours_per_day?: number | null;
  contract_hours_per_week?: number | null;
  target_hours_per_week?: number | null;
  target_days_per_week?: number | null;
  can_work_weekends?: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const employeeWorkRulesV2Sql = `
CREATE TABLE employee_work_rules (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  max_shifts_per_week INTEGER NOT NULL CHECK (max_shifts_per_week >= 1),
  max_hours_per_day REAL NOT NULL CHECK (max_hours_per_day > 0),
  target_hours_per_day REAL,
  can_work_weekends INTEGER NOT NULL DEFAULT 1 CHECK (can_work_weekends IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
  UNIQUE (employee_id),
  CHECK (
    target_hours_per_day IS NULL
    OR (
      target_hours_per_day > 0
      AND target_hours_per_day <= max_hours_per_day
    )
  )
)`;

const shiftTemplatesV2Sql = `
CREATE TABLE shift_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_id TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_overnight INTEGER NOT NULL DEFAULT 0 CHECK (is_overnight IN (0, 1)),
  color TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE SET NULL
)`;

const staffingRequirementsV2Sql = `
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
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shift_template_id) REFERENCES shift_templates (id) ON DELETE SET NULL,
  FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
)`;

export function applyV2SchedulerModelMigration(db: SqliteDatabase): void {
  const longestActiveShiftHours = getLongestActiveShiftDurationHours(db);
  const migratedWorkRuleRows = rebuildEmployeeWorkRules(
    db,
    longestActiveShiftHours
  );

  rebuildShiftTemplates(db);
  rebuildStaffingRequirements(db);

  if (migratedWorkRuleRows > 0) {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('scheduler_v2_work_rules_need_review', 'true', datetime('now'))
       ON CONFLICT (key) DO UPDATE SET
         value = 'true',
         updated_at = datetime('now')`
    ).run();
  }
}

function rebuildEmployeeWorkRules(
  db: SqliteDatabase,
  longestActiveShiftHours: number
): number {
  if (!tableExists(db, "employee_work_rules")) {
    db.exec(employeeWorkRulesV2Sql);
    return 0;
  }

  const columns = getColumnNames(db, "employee_work_rules");
  const isAlreadyV2 =
    columns.has("max_hours_per_day") &&
    columns.has("target_hours_per_day") &&
    !columns.has("contract_hours_per_week") &&
    !columns.has("break_minutes");

  if (isAlreadyV2) {
    return 0;
  }

  const legacyRows = db
    .prepare("SELECT * FROM employee_work_rules")
    .all() as LegacyWorkRuleRow[];

  db.exec("ALTER TABLE employee_work_rules RENAME TO employee_work_rules_v1");
  db.exec(employeeWorkRulesV2Sql);

  const insert = db.prepare(
    `INSERT INTO employee_work_rules (
      id,
      employee_id,
      max_shifts_per_week,
      max_hours_per_day,
      target_hours_per_day,
      can_work_weekends,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const row of legacyRows) {
    const maxShiftsPerWeek = firstPositiveInteger(
      row.max_shifts_per_week,
      row.max_days_per_week,
      row.contract_days_per_week,
      5
    );
    const targetHoursPerDay = firstPositiveNumber(
      row.preferred_hours_per_day,
      divideIfPositive(row.contract_hours_per_week, row.contract_days_per_week),
      divideIfPositive(row.target_hours_per_week, row.target_days_per_week),
      8
    );
    const maxHoursPerDay = Math.max(
      targetHoursPerDay,
      8,
      longestActiveShiftHours
    );

    insert.run(
      row.id,
      row.employee_id,
      maxShiftsPerWeek,
      maxHoursPerDay,
      targetHoursPerDay,
      row.can_work_weekends === 0 ? 0 : 1,
      row.notes,
      row.created_at,
      row.updated_at
    );
  }

  db.exec("DROP TABLE employee_work_rules_v1");
  return legacyRows.length;
}

function rebuildShiftTemplates(db: SqliteDatabase): void {
  if (!tableExists(db, "shift_templates")) {
    db.exec(shiftTemplatesV2Sql);
    return;
  }

  if (!getColumnNames(db, "shift_templates").has("break_minutes")) {
    return;
  }

  db.exec("ALTER TABLE shift_templates RENAME TO shift_templates_v1");
  db.exec(shiftTemplatesV2Sql);
  db.exec(
    `INSERT INTO shift_templates (
      id,
      name,
      role_id,
      start_time,
      end_time,
      is_overnight,
      color,
      notes,
      is_active,
      created_at,
      updated_at
    )
    SELECT
      id,
      name,
      role_id,
      start_time,
      end_time,
      is_overnight,
      color,
      notes,
      is_active,
      created_at,
      updated_at
    FROM shift_templates_v1`
  );
  db.exec("DROP TABLE shift_templates_v1");
}

function rebuildStaffingRequirements(db: SqliteDatabase): void {
  if (!tableExists(db, "staffing_requirements")) {
    db.exec(staffingRequirementsV2Sql);
    return;
  }

  const columns = getColumnNames(db, "staffing_requirements");
  const priorityExpression = columns.has("priority")
    ? `CASE
        WHEN priority IN ('normal', 'high', 'critical') THEN priority
        ELSE 'normal'
      END`
    : "'normal'";

  db.exec("ALTER TABLE staffing_requirements RENAME TO staffing_requirements_v1");
  db.exec(staffingRequirementsV2Sql);
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
      priority,
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
      minimum_experience_level,
      experienced_required_count,
      ${priorityExpression},
      is_active,
      notes,
      created_at,
      updated_at
    FROM staffing_requirements_v1`
  );
  db.exec("DROP TABLE staffing_requirements_v1");
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

function getLongestActiveShiftDurationHours(db: SqliteDatabase): number {
  if (!tableExists(db, "shift_templates")) {
    return 0;
  }

  const rows = db
    .prepare(
      "SELECT start_time, end_time FROM shift_templates WHERE is_active = 1"
    )
    .all() as Array<{ start_time: string; end_time: string }>;

  return rows.reduce(
    (longest, row) =>
      Math.max(longest, getShiftDurationHours(row.start_time, row.end_time)),
    0
  );
}

function getShiftDurationHours(startTime: string, endTime: string): number {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);

  if (start === null || end === null) {
    return 0;
  }

  if (end <= start) {
    end += 24 * 60;
  }

  return (end - start) / 60;
}

function timeToMinutes(value: string): number | null {
  const [hours, minutes] = value.split(":").map(Number);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * 60 + minutes;
}

function firstPositiveInteger(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (Number.isInteger(value) && Number(value) >= 1) {
      return Number(value);
    }
  }

  return 5;
}

function firstPositiveNumber(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return 8;
}

function divideIfPositive(
  numerator: number | null | undefined,
  denominator: number | null | undefined
): number | null {
  if (
    typeof numerator !== "number" ||
    typeof denominator !== "number" ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return null;
  }

  return numerator / denominator;
}
