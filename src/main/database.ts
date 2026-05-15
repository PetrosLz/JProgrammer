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

const crudTables: Record<CrudTableName, CrudTableMetadata> = {
  business_settings: {
    writableColumns: [
      "business_name",
      "timezone",
      "week_starts_on",
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
      "role_id",
      "start_time",
      "end_time",
      "required_count",
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
    writableColumns: ["employee_id", "role_id", "is_primary"],
    defaultOrderBy: "created_at DESC"
  },
  employee_work_rules: {
    writableColumns: [
      "employee_id",
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

function normalizeLimit(limit = 100): number {
  if (!Number.isInteger(limit) || limit < 1) {
    return 100;
  }

  return Math.min(limit, 500);
}

function normalizeOffset(offset = 0): number {
  if (!Number.isInteger(offset) || offset < 0) {
    return 0;
  }

  return offset;
}
