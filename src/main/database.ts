import { app } from "electron";
import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSql from "./migrations/init.sql?raw";
import {
  databaseTableNames,
  type CrudTableName,
  type DatabaseEntityMap,
  type DatabaseRecordInput,
  type DatabaseRecordUpdate,
  type DatabaseStatus,
  type DatabaseTableName,
  type DbStoredValue,
  type DbValue,
  type ListRecordsOptions,
  type SettingRecord
} from "../shared/types";

type CrudTableMetadata = {
  writableColumns: readonly string[];
  defaultOrderBy: string;
};

const defaultListLimit = 100;
const maxListLimit = 10000;

const crudTables: Record<CrudTableName, CrudTableMetadata> = {
  business_settings: {
    writableColumns: [
      "business_name",
      "business_type",
      "location",
      "timezone",
      "week_starts_on",
      "language",
      "locale",
      "currency"
    ],
    defaultOrderBy: "created_at DESC"
  },
  opening_hours: {
    writableColumns: [
      "day_of_week",
      "is_open",
      "open_time",
      "close_time",
      "is_overnight",
      "notes"
    ],
    defaultOrderBy: "day_of_week ASC"
  },
  roles: {
    writableColumns: ["name", "color", "description", "is_active"],
    defaultOrderBy: "name ASC"
  },
  shift_templates: {
    writableColumns: [
      "name",
      "role_id",
      "start_time",
      "end_time",
      "is_overnight",
      "break_minutes",
      "color",
      "notes",
      "is_active"
    ],
    defaultOrderBy: "name ASC"
  },
  staffing_requirements: {
    writableColumns: [
      "day_of_week",
      "shift_template_id",
      "role_id",
      "start_time",
      "end_time",
      "required_count",
      "minimum_experience_level",
      "experienced_required_count",
      "priority",
      "is_active",
      "notes"
    ],
    defaultOrderBy: "day_of_week ASC, start_time ASC"
  },
  special_days: {
    writableColumns: ["date", "name", "is_closed", "notes"],
    defaultOrderBy: "date ASC"
  },
  special_day_staffing_requirements: {
    writableColumns: [
      "special_day_id",
      "role_id",
      "start_time",
      "end_time",
      "required_count",
      "notes"
    ],
    defaultOrderBy: "start_time ASC"
  },
  employees: {
    writableColumns: [
      "first_name",
      "last_name",
      "email",
      "phone",
      "is_active",
      "notes"
    ],
    defaultOrderBy: "last_name ASC, first_name ASC"
  },
  employee_roles: {
    writableColumns: [
      "employee_id",
      "role_id",
      "is_primary",
      "experience_level",
      "skill_level",
      "can_lead_role",
      "is_preferred_role"
    ],
    defaultOrderBy: "created_at DESC"
  },
  employee_work_rules: {
    writableColumns: [
      "employee_id",
      "employment_type",
      "contract_days_per_week",
      "contract_hours_per_week",
      "preferred_hours_per_day",
      "min_days_per_week",
      "target_days_per_week",
      "min_hours_per_week",
      "target_hours_per_week",
      "max_consecutive_days",
      "can_work_weekends",
      "max_hours_per_week",
      "max_shifts_per_week",
      "max_days_per_week",
      "min_hours_between_shifts",
      "preferred_hours_per_week",
      "notes"
    ],
    defaultOrderBy: "created_at DESC"
  },
  employee_day_constraints: {
    writableColumns: ["employee_id", "day_of_week", "constraint_type", "notes"],
    defaultOrderBy: "day_of_week ASC"
  },
  employee_shift_availability: {
    writableColumns: [
      "employee_id",
      "day_of_week",
      "shift_template_id",
      "availability_type",
      "notes"
    ],
    defaultOrderBy: "employee_id ASC, day_of_week ASC"
  },
  employee_time_constraints: {
    writableColumns: [
      "employee_id",
      "date",
      "day_of_week",
      "start_time",
      "end_time",
      "constraint_type",
      "notes"
    ],
    defaultOrderBy: "date ASC, day_of_week ASC, start_time ASC"
  },
  time_off: {
    writableColumns: [
      "employee_id",
      "type",
      "start_date",
      "end_date",
      "reason",
      "status",
      "notes"
    ],
    defaultOrderBy: "start_date ASC"
  },
  schedule_runs: {
    writableColumns: [
      "name",
      "start_date",
      "end_date",
      "status",
      "parameters_json",
      "completed_at"
    ],
    defaultOrderBy: "created_at DESC"
  },
  schedule_slots: {
    writableColumns: [
      "schedule_run_id",
      "date",
      "role_id",
      "start_time",
      "end_time",
      "required_count",
      "status",
      "source_type",
      "source_id",
      "notes"
    ],
    defaultOrderBy: "date ASC, start_time ASC"
  },
  schedule_assignments: {
    writableColumns: [
      "schedule_run_id",
      "schedule_slot_id",
      "employee_id",
      "status",
      "is_manual_override",
      "notes"
    ],
    defaultOrderBy: "created_at DESC"
  },
  schedule_warnings: {
    writableColumns: [
      "schedule_run_id",
      "schedule_slot_id",
      "schedule_assignment_id",
      "severity",
      "warning_type",
      "message"
    ],
    defaultOrderBy: "created_at DESC"
  }
};

let database: SqliteDatabase | null = null;
let databasePath = "";

export class DatabaseOperationError extends Error {
  code: string;
  cause?: unknown;

  constructor(code: string, message: string, cause?: unknown) {
    super(message);
    this.name = "DatabaseOperationError";
    this.code = code;
    this.cause = cause;
  }
}

export function getDatabasePath(): string {
  if (!databasePath) {
    databasePath = path.join(app.getPath("userData"), "jprogrammer.sqlite");
  }

  return databasePath;
}

export function initializeDatabase(): DatabaseStatus {
  if (database) {
    return getDatabaseStatus();
  }

  try {
    const resolvedDatabasePath = getDatabasePath();
    fs.mkdirSync(path.dirname(resolvedDatabasePath), { recursive: true });

    database = new Database(resolvedDatabasePath);
    database.pragma("foreign_keys = ON");
    database.pragma("journal_mode = WAL");
    database.exec(initSql);
    applyCompatibilityMigrations(database);

    return getDatabaseStatus();
  } catch (error) {
    database = null;
    throw new DatabaseOperationError(
      "DATABASE_INIT_FAILED",
      `Failed to initialize local SQLite database at ${getDatabasePath()}.`,
      error
    );
  }
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = null;
  }
}

export function getDatabaseStatus(): DatabaseStatus {
  const db = getDatabase();
  const tableCounts = Object.fromEntries(
    databaseTableNames.map((tableName) => [
      tableName,
      db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as {
        count: number;
      }
    ])
  ) as Record<DatabaseTableName, { count: number }>;

  return {
    databasePath: getDatabasePath(),
    initialized: true,
    tableCounts: Object.fromEntries(
      databaseTableNames.map((tableName) => [
        tableName,
        tableCounts[tableName].count
      ])
    ) as Record<DatabaseTableName, number>
  };
}

export function listRecords<T extends CrudTableName>(
  tableName: T,
  options: ListRecordsOptions = {}
): DatabaseEntityMap[T][] {
  const metadata = getCrudTableMetadata(tableName);
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset);

  return getDatabase()
    .prepare(
      `SELECT * FROM ${tableName} ORDER BY ${metadata.defaultOrderBy} LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as DatabaseEntityMap[T][];
}

export function getRecord<T extends CrudTableName>(
  tableName: T,
  id: string
): DatabaseEntityMap[T] | null {
  validateId(id);
  getCrudTableMetadata(tableName);

  return getDatabase()
    .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
    .get(id) as DatabaseEntityMap[T] | null;
}

export function createRecord<T extends CrudTableName>(
  tableName: T,
  data: DatabaseRecordInput
): DatabaseEntityMap[T] {
  const metadata = getCrudTableMetadata(tableName);
  const sanitizedData = sanitizeRecordInput(tableName, metadata, data);
  const id = randomUUID();
  const columns = ["id", ...Object.keys(sanitizedData)];
  const placeholders = columns.map(() => "?").join(", ");
  const values = [id, ...Object.values(sanitizedData)];

  getDatabase()
    .prepare(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`
    )
    .run(...values);

  const created = getRecord(tableName, id);

  if (!created) {
    throw new DatabaseOperationError(
      "DATABASE_CREATE_FAILED",
      `Created row could not be read from ${tableName}.`
    );
  }

  return created;
}

export function updateRecord<T extends CrudTableName>(
  tableName: T,
  id: string,
  data: DatabaseRecordUpdate
): DatabaseEntityMap[T] | null {
  validateId(id);
  const metadata = getCrudTableMetadata(tableName);
  const sanitizedData = sanitizeRecordInput(tableName, metadata, data);
  const entries = Object.entries(sanitizedData);

  if (entries.length === 0) {
    return getRecord(tableName, id);
  }

  const assignments = entries.map(([column]) => `${column} = ?`);
  const result = getDatabase()
    .prepare(
      `UPDATE ${tableName} SET ${assignments.join(
        ", "
      )}, updated_at = datetime('now') WHERE id = ?`
    )
    .run(...entries.map(([, value]) => value), id);

  if (result.changes === 0) {
    return null;
  }

  return getRecord(tableName, id);
}

export function deleteRecord(tableName: CrudTableName, id: string): boolean {
  validateId(id);
  getCrudTableMetadata(tableName);

  const result = getDatabase()
    .prepare(`DELETE FROM ${tableName} WHERE id = ?`)
    .run(id);

  return result.changes > 0;
}

export function getSetting(key: string): SettingRecord | null {
  validateSettingKey(key);

  return getDatabase()
    .prepare("SELECT * FROM settings WHERE key = ?")
    .get(key) as SettingRecord | null;
}

export function setSetting(key: string, value: string): SettingRecord {
  validateSettingKey(key);

  getDatabase()
    .prepare(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT (key) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now')`
    )
    .run(key, value);

  const setting = getSetting(key);

  if (!setting) {
    throw new DatabaseOperationError(
      "DATABASE_SETTING_WRITE_FAILED",
      `Setting "${key}" could not be read after it was saved.`
    );
  }

  return setting;
}

function getDatabase(): SqliteDatabase {
  if (!database) {
    initializeDatabase();
  }

  if (!database) {
    throw new DatabaseOperationError(
      "DATABASE_NOT_INITIALIZED",
      "The local SQLite database is not initialized."
    );
  }

  return database;
}

function getCrudTableMetadata(tableName: CrudTableName): CrudTableMetadata {
  const metadata = crudTables[tableName];

  if (!metadata) {
    throw new DatabaseOperationError(
      "DATABASE_INVALID_TABLE",
      `Table "${tableName}" is not available through the CRUD API.`
    );
  }

  return metadata;
}

function sanitizeRecordInput(
  tableName: CrudTableName,
  metadata: CrudTableMetadata,
  data: DatabaseRecordInput | DatabaseRecordUpdate
): Record<string, DbStoredValue> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new DatabaseOperationError(
      "DATABASE_INVALID_INPUT",
      "Database record data must be an object."
    );
  }

  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([column, value]) => {
        if (!metadata.writableColumns.includes(column)) {
          throw new DatabaseOperationError(
            "DATABASE_INVALID_COLUMN",
            `Column "${column}" is not writable on table "${tableName}".`
          );
        }

        return [column, toSqlValue(value)];
      })
  );
}

function toSqlValue(value: DbValue | undefined): DbStoredValue {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  throw new DatabaseOperationError(
    "DATABASE_INVALID_VALUE",
    "Database values must be strings, numbers, booleans, null, or undefined."
  );
}

function validateId(id: string): void {
  if (!id || typeof id !== "string") {
    throw new DatabaseOperationError(
      "DATABASE_INVALID_ID",
      "A non-empty string id is required."
    );
  }
}

function validateSettingKey(key: string): void {
  if (!key || typeof key !== "string") {
    throw new DatabaseOperationError(
      "DATABASE_INVALID_SETTING_KEY",
      "A non-empty string setting key is required."
    );
  }
}

function normalizeLimit(limit = defaultListLimit): number {
  if (!Number.isInteger(limit) || limit < 1) {
    return defaultListLimit;
  }

  return Math.min(limit, maxListLimit);
}

function normalizeOffset(offset = 0): number {
  if (!Number.isInteger(offset) || offset < 0) {
    return 0;
  }

  return offset;
}

function applyCompatibilityMigrations(db: SqliteDatabase): void {
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
  addColumnIfMissing(db, "employee_work_rules", "min_days_per_week", "INTEGER");
  addColumnIfMissing(
    db,
    "employee_work_rules",
    "employment_type",
    "TEXT NOT NULL DEFAULT 'custom' CHECK (employment_type IN ('full_time', 'part_time', 'weekly_hours', 'custom'))"
  );
  addColumnIfMissing(
    db,
    "employee_work_rules",
    "contract_days_per_week",
    "INTEGER"
  );
  addColumnIfMissing(
    db,
    "employee_work_rules",
    "contract_hours_per_week",
    "REAL"
  );
  addColumnIfMissing(
    db,
    "employee_work_rules",
    "preferred_hours_per_day",
    "REAL"
  );
  addColumnIfMissing(db, "employee_work_rules", "target_days_per_week", "INTEGER");
  addColumnIfMissing(db, "employee_work_rules", "max_days_per_week", "INTEGER");
  addColumnIfMissing(db, "employee_work_rules", "min_hours_per_week", "REAL");
  addColumnIfMissing(db, "employee_work_rules", "target_hours_per_week", "REAL");
  addColumnIfMissing(db, "employee_work_rules", "max_hours_per_week", "REAL");
  addColumnIfMissing(db, "employee_work_rules", "max_consecutive_days", "INTEGER");
  addColumnIfMissing(
    db,
    "employee_work_rules",
    "can_work_weekends",
    "INTEGER NOT NULL DEFAULT 1 CHECK (can_work_weekends IN (0, 1))"
  );
  db.exec(`
    UPDATE employee_work_rules
    SET
      employment_type = COALESCE(NULLIF(employment_type, ''), 'custom'),
      contract_days_per_week = COALESCE(contract_days_per_week, target_days_per_week, max_days_per_week, 5),
      contract_hours_per_week = COALESCE(contract_hours_per_week, target_hours_per_week, preferred_hours_per_week, max_hours_per_week, 40),
      preferred_hours_per_day = COALESCE(
        preferred_hours_per_day,
        CASE
          WHEN COALESCE(contract_days_per_week, target_days_per_week, max_days_per_week, 5) > 0
          THEN COALESCE(contract_hours_per_week, target_hours_per_week, preferred_hours_per_week, max_hours_per_week, 40) /
               COALESCE(contract_days_per_week, target_days_per_week, max_days_per_week, 5)
          ELSE NULL
        END
      )
  `);
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
