import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import {
  applyVersionedMigrations,
  latestSchemaVersion
} from "../src/main/migrations";
import { persistValidatedScheduleBatchInTransaction } from "../src/main/schedulePersistence";
import type { PersistValidatedScheduleBatchRequest } from "../src/shared/types";

type SqliteDatabase = Database.Database;

const initSql = fs.readFileSync(
  path.join(process.cwd(), "src", "main", "migrations", "init.sql"),
  "utf8"
);

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [
  { name: "fresh database creates newest scheduler schema", run: testFreshDatabase },
  { name: "existing v1 database migrates to v2 safely", run: testV1Migration },
  { name: "existing v3 opening-hours schema migrates to explicit 24-hour mode", run: testV3OpeningHoursMigration },
  { name: "forced migration failure rolls back schema and data", run: testRollback },
  { name: "running migrations twice is idempotent", run: testIdempotence },
  { name: "schema version is not reset on startup", run: testSchemaVersionNotReset },
  { name: "validated schedule batch commits all rows atomically", run: testValidatedScheduleBatchSuccess },
  { name: "validated schedule batch rolls back on mid-transaction failure", run: testValidatedScheduleBatchRollback },
  { name: "validated schedule batch preserves manual assignments and rejects wrong-run slots", run: testValidatedScheduleBatchExistingData },
  { name: "validated schedule batch duplicate execution is idempotent", run: testValidatedScheduleBatchDuplicateExecution }
];

let passed = 0;

for (const test of tests) {
  try {
    test.run();
    passed += 1;
    console.log(`ok ${passed} - ${test.name}`);
  } catch (error) {
    console.error(`not ok - ${test.name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode !== 1) {
  console.log(`\n${passed}/${tests.length} migration tests passed.`);
}

process.exit(process.exitCode ?? 0);

function testFreshDatabase(): void {
  const db = createMemoryDatabase();
  db.exec(initSql);
  applyVersionedMigrations(db);

  assertEqual(readUserVersion(db), latestSchemaVersion, "fresh user_version");
  assert(!hasColumn(db, "shift_templates", "break_minutes"), "fresh schema removed break_minutes");
  assertV2WorkRuleSchema(db);
  assertSchedulerRuleCleanupSchema(db);
  assertOpeningHours24HourSchema(db);
  db.close();
}

function testV1Migration(): void {
  const db = createLegacyV1Database();
  applyVersionedMigrations(db);

  assertEqual(readUserVersion(db), latestSchemaVersion, "migrated user_version");
  assert(!hasColumn(db, "shift_templates", "break_minutes"), "break_minutes no longer exists");
  assertV2WorkRuleSchema(db);
  assertSchedulerRuleCleanupSchema(db);
  assertOpeningHours24HourSchema(db);

  assertEqual(countRows(db, "employees"), 2, "employees preserved");
  assertEqual(countRows(db, "opening_hours"), 2, "opening hours preserved");
  assertEqual(countRows(db, "employee_roles"), 1, "employee roles preserved");
  assertEqual(countRows(db, "employee_day_constraints"), 1, "day constraints preserved");
  assertEqual(countRows(db, "employee_shift_availability"), 1, "shift availability preserved");
  assertEqual(countRows(db, "time_off"), 1, "time off preserved");
  assertEqual(countRows(db, "schedule_slots"), 1, "schedule slots preserved");
  assertEqual(countRows(db, "schedule_assignments"), 1, "schedule assignments preserved");

  const validRule = getRow<{
    id: string;
    employee_id: string;
    max_shifts_per_week: number;
    max_hours_per_day: number;
    target_hours_per_day: number;
    can_work_weekends: number;
  }>(db, "SELECT * FROM employee_work_rules WHERE id = 'wr-valid'");
  assertEqual(validRule.id, "wr-valid", "work-rule id preserved");
  assertEqual(validRule.employee_id, "emp-1", "work-rule employee id preserved");
  assertEqual(validRule.max_shifts_per_week, 7, "valid max shifts preserved");
  assertEqual(validRule.target_hours_per_day, 6, "preferred daily target preserved");
  assertEqual(validRule.max_hours_per_day, 8, "overnight longest shift applied");
  assertEqual(validRule.can_work_weekends, 0, "weekend flag preserved");

  const fallbackRule = getRow<{
    max_shifts_per_week: number;
    max_hours_per_day: number;
    target_hours_per_day: number;
    can_work_weekends: number;
  }>(db, "SELECT * FROM employee_work_rules WHERE id = 'wr-fallback'");
  assertEqual(fallbackRule.max_shifts_per_week, 5, "fallback max shifts applied");
  assertEqual(fallbackRule.target_hours_per_day, 8, "fallback target hours applied");
  assertEqual(fallbackRule.max_hours_per_day, 8, "fallback max daily hours applied");
  assertEqual(fallbackRule.can_work_weekends, 1, "invalid weekend flag normalized");

  assert(!hasColumn(db, "staffing_requirements", "priority"), "priority column removed");
  const slotSnapshot = getRow<{
    requirement_group_id: string;
    minimum_experience_level: string;
    experienced_required_count: number;
    slot_number: number;
  }>(db, "SELECT requirement_group_id, minimum_experience_level, experienced_required_count, slot_number FROM schedule_slots WHERE id = 'slot-1'");
  assertEqual(
    slotSnapshot.requirement_group_id,
    "2026-05-18|staffing_requirement|req-invalid-priority",
    "legacy slot requirement group backfilled"
  );
  assertEqual(slotSnapshot.minimum_experience_level, "no_experience", "slot minimum experience backfilled");
  assertEqual(slotSnapshot.experienced_required_count, 0, "slot experienced required backfilled");
  assertEqual(slotSnapshot.slot_number, 1, "slot number backfilled");
  const saturdayHours = getRow<{
    is_24_hours: number;
    is_overnight: number;
  }>(db, "SELECT is_24_hours, is_overnight FROM opening_hours WHERE id = 'hours-saturday'");
  assertEqual(saturdayHours.is_24_hours, 0, "legacy opening hour defaults to non-24-hour");
  assertEqual(saturdayHours.is_overnight, 1, "legacy opening overnight flag derived from times");
  assertEqual(
    getValue<string>(
      db,
      "SELECT value FROM settings WHERE key = 'scheduler_v2_work_rules_need_review'"
    ),
    "true",
    "migration review setting created"
  );

  db.close();
}

function testV3OpeningHoursMigration(): void {
  const db = createV3OpeningHoursDatabase();
  applyVersionedMigrations(db);

  assertEqual(readUserVersion(db), latestSchemaVersion, "migrated v3 user_version");
  assertOpeningHours24HourSchema(db);
  assertEqual(countRows(db, "opening_hours"), 4, "v3 opening-hour rows preserved");
  assertEqual(countRows(db, "shift_templates"), 3, "v3 shift-template rows preserved");

  const sameDay = getRow<{
    is_24_hours: number;
    is_overnight: number;
  }>(db, "SELECT is_24_hours, is_overnight FROM opening_hours WHERE id = 'hours-same-day'");
  assertEqual(sameDay.is_24_hours, 0, "same-day opening is not 24-hour");
  assertEqual(sameDay.is_overnight, 0, "same-day opening overnight flag normalized off");

  const overnight = getRow<{
    is_24_hours: number;
    is_overnight: number;
  }>(db, "SELECT is_24_hours, is_overnight FROM opening_hours WHERE id = 'hours-cross-midnight'");
  assertEqual(overnight.is_24_hours, 0, "cross-midnight opening remains non-24-hour");
  assertEqual(overnight.is_overnight, 1, "cross-midnight opening overnight flag normalized on");

  const equalTimes = getRow<{
    is_24_hours: number;
    is_overnight: number;
  }>(db, "SELECT is_24_hours, is_overnight FROM opening_hours WHERE id = 'hours-equal'");
  assertEqual(equalTimes.is_24_hours, 0, "equal opening times are not inferred as 24-hour");
  assertEqual(equalTimes.is_overnight, 0, "equal opening times are not overnight");

  const closedDay = getRow<{
    is_24_hours: number;
    is_overnight: number;
  }>(db, "SELECT is_24_hours, is_overnight FROM opening_hours WHERE id = 'hours-closed'");
  assertEqual(closedDay.is_24_hours, 0, "closed day remains non-24-hour");
  assertEqual(closedDay.is_overnight, 0, "closed day overnight flag normalized off");

  const sameDayShift = getRow<{ is_overnight: number; is_active: number }>(
    db,
    "SELECT is_overnight, is_active FROM shift_templates WHERE id = 'shift-same-day'"
  );
  assertEqual(sameDayShift.is_overnight, 0, "same-day shift overnight flag normalized off");
  assertEqual(sameDayShift.is_active, 1, "same-day shift remains active");
  const nightShift = getRow<{ is_overnight: number; is_active: number }>(
    db,
    "SELECT is_overnight, is_active FROM shift_templates WHERE id = 'shift-night'"
  );
  assertEqual(nightShift.is_overnight, 1, "cross-midnight shift overnight flag normalized on");
  assertEqual(nightShift.is_active, 1, "cross-midnight shift remains active");
  const equalShift = getRow<{ is_overnight: number; is_active: number }>(
    db,
    "SELECT is_overnight, is_active FROM shift_templates WHERE id = 'shift-equal'"
  );
  assertEqual(equalShift.is_overnight, 0, "equal shift times are not overnight");
  assertEqual(equalShift.is_active, 0, "equal shift is deactivated for review");
  assertEqual(
    getValue<string>(
      db,
      "SELECT value FROM settings WHERE key = 'scheduler_v4_invalid_equal_time_shifts_need_review'"
    ),
    "true",
    "equal-time shift review setting created"
  );

  db.close();
}

function testRollback(): void {
  const db = createRollbackDatabase();

  assertThrows(() => applyVersionedMigrations(db), "forced migration should fail");
  assertEqual(readUserVersion(db), 1, "failed migration leaves user_version unchanged");
  assert(hasColumn(db, "shift_templates", "break_minutes"), "rollback restored old shift schema");
  assert(hasColumn(db, "employee_work_rules", "employment_type"), "rollback restored old work-rule schema");
  assertEqual(countRows(db, "employee_work_rules"), 1, "rollback preserved old work-rule row");
  assertEqual(
    getValue<string | null>(
      db,
      "SELECT value FROM settings WHERE key = 'scheduler_v2_work_rules_need_review'"
    ),
    null,
    "failed migration did not create review setting"
  );

  db.close();
}

function testIdempotence(): void {
  const db = createLegacyV1Database();
  applyVersionedMigrations(db);
  const afterFirstRun = dumpSchema(db);
  applyVersionedMigrations(db);

  assertEqual(dumpSchema(db), afterFirstRun, "second migration run leaves schema unchanged");
  assertEqual(countRows(db, "employee_work_rules"), 2, "second migration run leaves rows unchanged");
  db.close();
}

function testSchemaVersionNotReset(): void {
  const db = createMemoryDatabase();
  db.exec(initSql);
  applyVersionedMigrations(db);
  db.exec(initSql);
  applyVersionedMigrations(db);

  assertEqual(readUserVersion(db), latestSchemaVersion, "startup init did not reset user_version");
  assertEqual(
    getValue<string>(db, "SELECT value FROM settings WHERE key = 'schema_version'"),
    String(latestSchemaVersion),
    "schema_version setting remains newest"
  );
  db.close();
}

function testValidatedScheduleBatchSuccess(): void {
  const db = createScheduleBatchDatabase();
  const request = createScheduleBatchRequest();
  const result = persistValidatedScheduleBatchInTransaction(db, request);

  assertEqual(result.assignmentsInserted, 3, "assignments inserted");
  assertEqual(result.slotsUpdated, 3, "slots updated");
  assertEqual(result.warningsInserted, 2, "warnings inserted");
  assertEqual(countRows(db, "schedule_assignments"), 3, "assignment row count");
  assertEqual(
    getValue<number>(
      db,
      "SELECT COUNT(*) FROM schedule_slots WHERE schedule_run_id = 'run-batch' AND status = 'filled'"
    ),
    3,
    "all batch slots filled"
  );
  assertEqual(
    getValue<string>(
      db,
      "SELECT status FROM schedule_runs WHERE id = 'run-batch'"
    ),
    "assigned",
    "run status committed"
  );
  assertEqual(
    getValue<string>(
      db,
      "SELECT completed_at FROM schedule_runs WHERE id = 'run-batch'"
    ),
    request.runUpdate.completedAt,
    "run completion timestamp committed"
  );
  assertEqual(countRows(db, "schedule_warnings"), 2, "warning row count");

  db.close();
}

function testValidatedScheduleBatchRollback(): void {
  const db = createScheduleBatchDatabase();
  db.exec(
    `CREATE TRIGGER fail_second_batch_assignment
     BEFORE INSERT ON schedule_assignments
     WHEN NEW.id = 'as-batch-2'
     BEGIN
       SELECT RAISE(ABORT, 'forced assignment insert failure');
     END`
  );

  assertThrows(
    () => persistValidatedScheduleBatchInTransaction(db, createScheduleBatchRequest()),
    "forced assignment insert failure should roll back the transaction"
  );
  assertEqual(countRows(db, "schedule_assignments"), 0, "rollback removed inserted assignments");
  assertEqual(
    getValue<number>(
      db,
      "SELECT COUNT(*) FROM schedule_slots WHERE schedule_run_id = 'run-batch' AND status = 'filled'"
    ),
    0,
    "rollback left slot statuses unchanged"
  );
  assertEqual(
    getValue<string>(
      db,
      "SELECT status FROM schedule_runs WHERE id = 'run-batch'"
    ),
    "generated",
    "rollback left run status unchanged"
  );
  assertEqual(
    getValue<string | null>(
      db,
      "SELECT completed_at FROM schedule_runs WHERE id = 'run-batch'"
    ),
    null,
    "rollback left run completion empty"
  );
  assertEqual(countRows(db, "schedule_warnings"), 0, "rollback removed warning batch");

  db.close();
}

function testValidatedScheduleBatchExistingData(): void {
  const manualDb = createScheduleBatchDatabase();
  manualDb
    .prepare(
      `INSERT INTO schedule_assignments (
        id,
        schedule_run_id,
        schedule_slot_id,
        employee_id,
        status,
        is_manual_override,
        notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run("as-manual", "run-batch", "slot-batch-1", "emp-batch-1", "assigned", 1, "manual");

  assertThrows(
    () => persistValidatedScheduleBatchInTransaction(manualDb, createScheduleBatchRequest()),
    "batch should reject a slot with an existing manual assignment"
  );
  assertEqual(countRows(manualDb, "schedule_assignments"), 1, "manual assignment preserved");
  assertEqual(
    getValue<number>(
      manualDb,
      "SELECT is_manual_override FROM schedule_assignments WHERE id = 'as-manual'"
    ),
    1,
    "manual flag preserved"
  );
  manualDb.close();

  const wrongRunDb = createScheduleBatchDatabase();
  const wrongRunRequest = createScheduleBatchRequest();
  wrongRunRequest.assignments[0] = {
    ...wrongRunRequest.assignments[0],
    scheduleSlotId: "slot-other-run"
  };
  wrongRunRequest.slotUpdates[0] = {
    ...wrongRunRequest.slotUpdates[0],
    slotId: "slot-other-run"
  };

  assertThrows(
    () => persistValidatedScheduleBatchInTransaction(wrongRunDb, wrongRunRequest),
    "batch should reject a slot belonging to another run"
  );
  assertEqual(countRows(wrongRunDb, "schedule_assignments"), 0, "wrong-run rejection inserted no assignments");
  wrongRunDb.close();
}

function testValidatedScheduleBatchDuplicateExecution(): void {
  const db = createScheduleBatchDatabase();
  const request = createScheduleBatchRequest();
  const firstResult = persistValidatedScheduleBatchInTransaction(db, request);
  const secondResult = persistValidatedScheduleBatchInTransaction(db, request);

  assertEqual(firstResult.assignmentsInserted, 3, "first batch inserted assignments");
  assertEqual(secondResult.assignmentsInserted, 0, "second batch inserted no duplicate assignments");
  assertEqual(secondResult.warningsInserted, 0, "second batch inserted no duplicate warnings");
  assertEqual(countRows(db, "schedule_assignments"), 3, "duplicate execution assignment count");
  assertEqual(countRows(db, "schedule_warnings"), 2, "duplicate execution warning count");

  db.close();
}

function createMemoryDatabase(): SqliteDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

function createScheduleBatchDatabase(): SqliteDatabase {
  const db = createMemoryDatabase();
  db.exec(initSql);
  applyVersionedMigrations(db);
  db.exec(`
    INSERT INTO roles (id, name, color, description, is_active)
    VALUES ('role-service', 'Service', '#2563eb', NULL, 1);

    INSERT INTO employees (id, first_name, last_name, email, phone, is_active, notes)
    VALUES
      ('emp-batch-1', 'Batch', 'One', NULL, NULL, 1, NULL),
      ('emp-batch-2', 'Batch', 'Two', NULL, NULL, 1, NULL),
      ('emp-batch-3', 'Batch', 'Three', NULL, NULL, 1, NULL);

    INSERT INTO schedule_runs (id, name, start_date, end_date, status, parameters_json, completed_at)
    VALUES
      ('run-batch', 'Batch run', '2026-05-18', '2026-05-24', 'generated', NULL, NULL),
      ('run-other', 'Other run', '2026-05-18', '2026-05-24', 'generated', NULL, NULL);

    INSERT INTO schedule_slots (
      id,
      schedule_run_id,
      date,
      role_id,
      start_time,
      end_time,
      required_count,
      status
    )
    VALUES
      ('slot-batch-1', 'run-batch', '2026-05-18', 'role-service', '08:00', '12:00', 1, 'unfilled'),
      ('slot-batch-2', 'run-batch', '2026-05-18', 'role-service', '12:00', '16:00', 1, 'unfilled'),
      ('slot-batch-3', 'run-batch', '2026-05-18', 'role-service', '16:00', '20:00', 1, 'unfilled'),
      ('slot-other-run', 'run-other', '2026-05-18', 'role-service', '08:00', '12:00', 1, 'unfilled');
  `);
  return db;
}

function createScheduleBatchRequest(): PersistValidatedScheduleBatchRequest {
  return {
    scheduleRunId: "run-batch",
    assignments: [
      {
        id: "as-batch-1",
        scheduleSlotId: "slot-batch-1",
        employeeId: "emp-batch-1",
        status: "assigned",
        isManualOverride: 0,
        notes: "auto one"
      },
      {
        id: "as-batch-2",
        scheduleSlotId: "slot-batch-2",
        employeeId: "emp-batch-2",
        status: "assigned",
        isManualOverride: 0,
        notes: "auto two"
      },
      {
        id: "as-batch-3",
        scheduleSlotId: "slot-batch-3",
        employeeId: "emp-batch-3",
        status: "assigned",
        isManualOverride: 0,
        notes: "auto three"
      }
    ],
    slotUpdates: [
      { slotId: "slot-batch-1", status: "filled" },
      { slotId: "slot-batch-2", status: "filled" },
      { slotId: "slot-batch-3", status: "filled" }
    ],
    runUpdate: {
      status: "assigned",
      parametersJson: "{\"stage\":\"test\"}",
      completedAt: "2026-05-18T12:00:00.000Z"
    },
    warnings: [
      {
        id: "warn-batch-1",
        scheduleSlotId: null,
        scheduleAssignmentId: null,
        severity: "info",
        warningType: "test_info",
        message: "test warning one"
      },
      {
        id: "warn-batch-2",
        scheduleSlotId: "slot-batch-3",
        scheduleAssignmentId: "as-batch-3",
        severity: "warning",
        warningType: "test_warning",
        message: "test warning two"
      }
    ]
  };
}

function createLegacyV1Database(): SqliteDatabase {
  const db = createMemoryDatabase();
  createLegacySchema(db);
  seedLegacyData(db);
  db.pragma("user_version = 1");
  db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES ('schema_version', '1', datetime('now'))"
  ).run();
  return db;
}

function createRollbackDatabase(): SqliteDatabase {
  const db = createMemoryDatabase();
  createLegacySchema(db);
  db.pragma("foreign_keys = OFF");
  db.prepare(
    "INSERT INTO employee_work_rules (id, employee_id, employment_type, max_shifts_per_week, notes) VALUES ('wr-bad', 'missing-employee', 'full_time', 5, 'bad')"
  ).run();
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 1");
  return db;
}

function createV3OpeningHoursDatabase(): SqliteDatabase {
  const db = createMemoryDatabase();
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE opening_hours (
      id TEXT PRIMARY KEY,
      day_of_week INTEGER NOT NULL,
      is_open INTEGER NOT NULL DEFAULT 1,
      open_time TEXT,
      close_time TEXT,
      is_overnight INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE shift_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_overnight INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO opening_hours (id, day_of_week, is_open, open_time, close_time, is_overnight)
      VALUES
        ('hours-same-day', 1, 1, '08:00', '20:00', 1),
        ('hours-cross-midnight', 2, 1, '18:00', '02:00', 0),
        ('hours-equal', 3, 1, '00:00', '00:00', 1),
        ('hours-closed', 4, 0, '08:00', '20:00', 1);

    INSERT INTO shift_templates (id, name, start_time, end_time, is_overnight)
      VALUES
        ('shift-same-day', 'Same day', '09:00', '17:00', 1),
        ('shift-night', 'Night', '22:00', '06:00', 0),
        ('shift-equal', 'Equal', '00:00', '00:00', 1);

    INSERT INTO settings (key, value, updated_at)
      VALUES ('schema_version', '3', datetime('now'));
  `);
  db.pragma("user_version = 3");
  return db;
}

function createLegacySchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE opening_hours (
      id TEXT PRIMARY KEY,
      day_of_week INTEGER NOT NULL,
      is_open INTEGER NOT NULL DEFAULT 1,
      open_time TEXT,
      close_time TEXT,
      is_overnight INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE shift_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role_id TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      is_overnight INTEGER NOT NULL DEFAULT 0,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE SET NULL
    );

    CREATE TABLE employees (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE employee_roles (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      experience_level TEXT NOT NULL DEFAULT 'some_experience',
      skill_level INTEGER,
      can_lead_role INTEGER NOT NULL DEFAULT 0,
      is_preferred_role INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
    );

    CREATE TABLE employee_work_rules (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      employment_type TEXT,
      contract_days_per_week INTEGER,
      contract_hours_per_week REAL,
      preferred_hours_per_day REAL,
      min_days_per_week INTEGER,
      max_days_per_week INTEGER,
      target_days_per_week INTEGER,
      min_hours_per_week REAL,
      max_hours_per_week REAL,
      target_hours_per_week REAL,
      max_consecutive_days INTEGER,
      can_work_weekends INTEGER,
      max_shifts_per_week INTEGER,
      min_hours_between_shifts REAL,
      preferred_hours_per_week REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
      UNIQUE (employee_id)
    );

    CREATE TABLE staffing_requirements (
      id TEXT PRIMARY KEY,
      day_of_week INTEGER NOT NULL,
      shift_template_id TEXT,
      role_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      required_count INTEGER NOT NULL,
      minimum_experience_level TEXT NOT NULL DEFAULT 'no_experience',
      experienced_required_count INTEGER NOT NULL DEFAULT 0,
      priority TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shift_template_id) REFERENCES shift_templates (id) ON DELETE SET NULL,
      FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
    );

    CREATE TABLE employee_day_constraints (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      constraint_type TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    );

    CREATE TABLE employee_shift_availability (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      shift_template_id TEXT NOT NULL,
      availability_type TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE,
      FOREIGN KEY (shift_template_id) REFERENCES shift_templates (id) ON DELETE CASCADE
    );

    CREATE TABLE employee_time_constraints (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      date TEXT,
      day_of_week INTEGER,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      constraint_type TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    );

    CREATE TABLE time_off (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'day_off',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'approved',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    );

    CREATE TABLE special_days (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      name TEXT NOT NULL,
      is_closed INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE schedule_runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL,
      parameters_json TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE schedule_slots (
      id TEXT PRIMARY KEY,
      schedule_run_id TEXT NOT NULL,
      date TEXT NOT NULL,
      role_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      required_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'unfilled',
      source_type TEXT NOT NULL,
      source_id TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (schedule_run_id) REFERENCES schedule_runs (id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles (id) ON DELETE CASCADE
    );

    CREATE TABLE schedule_assignments (
      id TEXT PRIMARY KEY,
      schedule_run_id TEXT NOT NULL,
      schedule_slot_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'assigned',
      is_manual_override INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (schedule_run_id) REFERENCES schedule_runs (id) ON DELETE CASCADE,
      FOREIGN KEY (schedule_slot_id) REFERENCES schedule_slots (id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    );

    CREATE TABLE schedule_warnings (
      id TEXT PRIMARY KEY,
      schedule_run_id TEXT NOT NULL,
      schedule_slot_id TEXT,
      schedule_assignment_id TEXT,
      severity TEXT NOT NULL,
      warning_type TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (schedule_run_id) REFERENCES schedule_runs (id) ON DELETE CASCADE
    );
  `);
}

function seedLegacyData(db: SqliteDatabase): void {
  db.exec(`
    INSERT INTO roles (id, name) VALUES ('role-service', 'Service');
    INSERT INTO opening_hours (id, day_of_week, is_open, open_time, close_time, is_overnight)
      VALUES
        ('hours-monday', 1, 1, '08:00', '22:00', 0),
        ('hours-saturday', 6, 1, '08:00', '00:00', 0);
    INSERT INTO shift_templates (id, name, start_time, end_time, is_overnight, break_minutes)
      VALUES ('shift-night', 'Night', '20:00', '04:00', 1, 30);
    INSERT INTO employees (id, first_name, last_name) VALUES
      ('emp-1', 'Maria', 'Demo'),
      ('emp-2', 'Nikos', 'Demo');
    INSERT INTO employee_roles (id, employee_id, role_id)
      VALUES ('er-1', 'emp-1', 'role-service');
    INSERT INTO employee_work_rules (
      id,
      employee_id,
      employment_type,
      contract_days_per_week,
      contract_hours_per_week,
      preferred_hours_per_day,
      max_days_per_week,
      target_days_per_week,
      target_hours_per_week,
      can_work_weekends,
      max_shifts_per_week,
      notes
    ) VALUES
      ('wr-valid', 'emp-1', 'full_time', 5, 40, 6, 5, 5, 35, 0, 7, 'valid'),
      ('wr-fallback', 'emp-2', 'custom', NULL, NULL, -2, NULL, 0, 20, 9, NULL, 'fallback');
    INSERT INTO staffing_requirements (
      id,
      day_of_week,
      shift_template_id,
      role_id,
      start_time,
      end_time,
      required_count,
      priority
    ) VALUES
      ('req-invalid-priority', 1, 'shift-night', 'role-service', '20:00', '04:00', 1, 'urgent');
    INSERT INTO employee_day_constraints (id, employee_id, day_of_week, constraint_type)
      VALUES ('dc-1', 'emp-1', 1, 'prefers_to_work');
    INSERT INTO employee_shift_availability (id, employee_id, day_of_week, shift_template_id, availability_type)
      VALUES ('sa-1', 'emp-1', 1, 'shift-night', 'available');
    INSERT INTO time_off (id, employee_id, start_date, end_date)
      VALUES ('to-1', 'emp-1', '2026-05-18', '2026-05-18');
    INSERT INTO schedule_runs (id, name, start_date, end_date, status)
      VALUES ('run-1', 'Legacy run', '2026-05-18', '2026-05-24', 'generated');
    INSERT INTO schedule_slots (id, schedule_run_id, date, role_id, start_time, end_time, required_count, source_type, source_id)
      VALUES ('slot-1', 'run-1', '2026-05-18', 'role-service', '20:00', '04:00', 1, 'staffing_requirement', 'req-invalid-priority');
    INSERT INTO schedule_assignments (id, schedule_run_id, schedule_slot_id, employee_id)
      VALUES ('assignment-1', 'run-1', 'slot-1', 'emp-1');
  `);
}

function assertV2WorkRuleSchema(db: SqliteDatabase): void {
  const columns = getColumns(db, "employee_work_rules");
  for (const column of [
    "max_shifts_per_week",
    "max_hours_per_day",
    "target_hours_per_day",
    "can_work_weekends"
  ]) {
    assert(columns.includes(column), `new work-rule column exists: ${column}`);
  }

  for (const column of [
    "employment_type",
    "contract_days_per_week",
    "contract_hours_per_week",
    "preferred_hours_per_day",
    "min_days_per_week",
    "max_days_per_week",
    "target_days_per_week",
    "min_hours_per_week",
    "max_hours_per_week",
    "target_hours_per_week",
    "preferred_hours_per_week",
    "max_consecutive_days",
    "min_hours_between_shifts"
  ]) {
    assert(!columns.includes(column), `deprecated work-rule column removed: ${column}`);
  }
}

function assertSchedulerRuleCleanupSchema(db: SqliteDatabase): void {
  assert(!hasColumn(db, "staffing_requirements", "priority"), "priority column removed");

  for (const column of [
    "minimum_experience_level",
    "experienced_required_count"
  ]) {
    assert(
      hasColumn(db, "special_day_staffing_requirements", column),
      `special-day requirement column exists: ${column}`
    );
  }

  for (const column of [
    "requirement_group_id",
    "minimum_experience_level",
    "experienced_required_count",
    "slot_number"
  ]) {
    assert(hasColumn(db, "schedule_slots", column), `slot snapshot column exists: ${column}`);
  }
}

function assertOpeningHours24HourSchema(db: SqliteDatabase): void {
  assert(
    hasColumn(db, "opening_hours", "is_24_hours"),
    "opening_hours supports explicit 24-hour mode"
  );
}

function hasColumn(
  db: SqliteDatabase,
  tableName: string,
  columnName: string
): boolean {
  return getColumns(db, tableName).includes(columnName);
}

function getColumns(db: SqliteDatabase, tableName: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
  ).map((column) => column.name);
}

function readUserVersion(db: SqliteDatabase): number {
  return Number(db.pragma("user_version", { simple: true }));
}

function countRows(db: SqliteDatabase, tableName: string): number {
  return getValue<number>(db, `SELECT COUNT(*) FROM ${tableName}`);
}

function getRow<T>(db: SqliteDatabase, sql: string): T {
  const row = db.prepare(sql).get() as T | undefined;
  assert(row !== undefined, `expected row for query: ${sql}`);
  return row;
}

function getValue<T>(db: SqliteDatabase, sql: string): T {
  const row = db.prepare(sql).get() as Record<string, T> | undefined;
  if (!row) {
    return null as T;
  }

  return Object.values(row)[0] as T;
}

function dumpSchema(db: SqliteDatabase): string {
  return JSON.stringify(
    db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
      )
      .all()
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertThrows(action: () => void, message: string): void {
  try {
    action();
  } catch {
    return;
  }

  throw new Error(message);
}
