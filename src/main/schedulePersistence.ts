import type { Database as SqliteDatabase } from "better-sqlite3";
import type {
  PersistValidatedScheduleAssignmentInput,
  PersistValidatedScheduleBatchRequest,
  PersistValidatedScheduleBatchResult,
  ScheduleAssignmentSource,
  PersistValidatedScheduleWarningInput
} from "../shared/types";

type ScheduleRunRow = {
  id: string;
};

type ScheduleSlotRow = {
  id: string;
  schedule_run_id: string;
};

type EmployeeRow = {
  id: string;
};

type ScheduleAssignmentRow = {
  id: string;
  schedule_run_id: string;
  schedule_slot_id: string;
  employee_id: string;
  status: string;
  is_manual_override: number;
  is_locked: number;
  source: string;
  notes: string | null;
};

type ScheduleWarningRow = {
  id: string;
  schedule_run_id: string;
  schedule_slot_id: string | null;
  schedule_assignment_id: string | null;
  severity: string;
  warning_type: string;
  message: string;
};

export class SchedulePersistenceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SchedulePersistenceError";
    this.code = code;
  }
}

export function persistValidatedScheduleBatchInTransaction(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): PersistValidatedScheduleBatchResult {
  return db.transaction(() => {
    validateRequestShape(request);
    verifyRunExists(db, request.scheduleRunId);
    const slotIds = collectReferencedSlotIds(request);
    const assignmentIds = new Set(request.assignments.map((item) => item.id));

    verifySlotsBelongToRun(db, request.scheduleRunId, slotIds);
    verifyEmployeesExist(
      db,
      request.assignments.map((assignment) => assignment.employeeId)
    );
    verifyAssignmentsReferenceRunSlots(db, request);
    verifyWarningAssignmentReferences(db, request, assignmentIds);
    verifyNoDuplicateRequestAssignments(request.assignments);
    verifyNoDuplicateSlotUpdates(request);
    verifyNoDuplicateWarnings(request.warnings);
    verifyNoConflictingExistingAssignments(db, request);
    verifyNoConflictingExistingWarnings(db, request);

    const assignmentsInserted = insertNewAssignments(db, request);
    const slotsUpdated = updateSlots(db, request);
    const warningsInserted = insertNewWarnings(db, request);
    updateRun(db, request);

    return {
      assignmentsInserted,
      slotsUpdated,
      warningsInserted
    };
  })();
}

function validateRequestShape(request: PersistValidatedScheduleBatchRequest): void {
  requireNonEmptyString(request.scheduleRunId, "scheduleRunId");

  if (!Array.isArray(request.assignments)) {
    throwPersistenceError("SCHEDULE_BATCH_INVALID_REQUEST", "Assignments must be an array.");
  }

  if (!Array.isArray(request.slotUpdates)) {
    throwPersistenceError("SCHEDULE_BATCH_INVALID_REQUEST", "Slot updates must be an array.");
  }

  if (!Array.isArray(request.warnings)) {
    throwPersistenceError("SCHEDULE_BATCH_INVALID_REQUEST", "Warnings must be an array.");
  }

  if (!request.runUpdate || typeof request.runUpdate !== "object") {
    throwPersistenceError("SCHEDULE_BATCH_INVALID_REQUEST", "Run update is required.");
  }

  requireNonEmptyString(request.runUpdate.status, "runUpdate.status");
  requireNonEmptyString(request.runUpdate.completedAt, "runUpdate.completedAt");

  for (const assignment of request.assignments) {
    requireNonEmptyString(assignment.id, "assignment.id");
    requireNonEmptyString(assignment.scheduleSlotId, "assignment.scheduleSlotId");
    requireNonEmptyString(assignment.employeeId, "assignment.employeeId");
    requireNonEmptyString(assignment.status, "assignment.status");

    if (
      assignment.isManualOverride !== 0 &&
      assignment.isManualOverride !== 1
    ) {
      throwPersistenceError(
        "SCHEDULE_BATCH_INVALID_REQUEST",
        `Assignment ${assignment.id} has invalid manual override flag.`
      );
    }

    if (
      getAssignmentIsLocked(assignment) !== 0 &&
      getAssignmentIsLocked(assignment) !== 1
    ) {
      throwPersistenceError(
        "SCHEDULE_BATCH_INVALID_REQUEST",
        `Assignment ${assignment.id} has invalid lock flag.`
      );
    }

    if (!isValidAssignmentSource(getAssignmentSource(assignment))) {
      throwPersistenceError(
        "SCHEDULE_BATCH_INVALID_REQUEST",
        `Assignment ${assignment.id} has invalid source.`
      );
    }
  }

  for (const slotUpdate of request.slotUpdates) {
    requireNonEmptyString(slotUpdate.slotId, "slotUpdate.slotId");
    requireNonEmptyString(slotUpdate.status, "slotUpdate.status");
  }

  for (const warning of request.warnings) {
    requireNonEmptyString(warning.id, "warning.id");
    requireNonEmptyString(warning.severity, "warning.severity");
    requireNonEmptyString(warning.warningType, "warning.warningType");
    requireNonEmptyString(warning.message, "warning.message");
  }
}

function verifyRunExists(db: SqliteDatabase, scheduleRunId: string): void {
  const run = db
    .prepare("SELECT id FROM schedule_runs WHERE id = ?")
    .get(scheduleRunId) as ScheduleRunRow | undefined;

  if (!run) {
    throwPersistenceError(
      "SCHEDULE_BATCH_RUN_NOT_FOUND",
      `Schedule run ${scheduleRunId} does not exist.`
    );
  }
}

function collectReferencedSlotIds(
  request: PersistValidatedScheduleBatchRequest
): string[] {
  return uniqueStrings([
    ...request.slotUpdates.map((slotUpdate) => slotUpdate.slotId),
    ...request.assignments.map((assignment) => assignment.scheduleSlotId),
    ...request.warnings.flatMap((warning) =>
      warning.scheduleSlotId ? [warning.scheduleSlotId] : []
    )
  ]);
}

function verifySlotsBelongToRun(
  db: SqliteDatabase,
  scheduleRunId: string,
  slotIds: string[]
): void {
  const selectSlot = db.prepare("SELECT id, schedule_run_id FROM schedule_slots WHERE id = ?");

  for (const slotId of slotIds) {
    const slot = selectSlot.get(slotId) as ScheduleSlotRow | undefined;

    if (!slot) {
      throwPersistenceError(
        "SCHEDULE_BATCH_SLOT_NOT_FOUND",
        `Schedule slot ${slotId} does not exist.`
      );
    }

    if (slot.schedule_run_id !== scheduleRunId) {
      throwPersistenceError(
        "SCHEDULE_BATCH_SLOT_RUN_MISMATCH",
        `Schedule slot ${slotId} does not belong to run ${scheduleRunId}.`
      );
    }
  }
}

function verifyEmployeesExist(
  db: SqliteDatabase,
  employeeIds: string[]
): void {
  const selectEmployee = db.prepare("SELECT id FROM employees WHERE id = ?");

  for (const employeeId of uniqueStrings(employeeIds)) {
    const employee = selectEmployee.get(employeeId) as EmployeeRow | undefined;

    if (!employee) {
      throwPersistenceError(
        "SCHEDULE_BATCH_EMPLOYEE_NOT_FOUND",
        `Employee ${employeeId} does not exist.`
      );
    }
  }
}

function verifyAssignmentsReferenceRunSlots(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): void {
  const selectSlot = db.prepare("SELECT id, schedule_run_id FROM schedule_slots WHERE id = ?");

  for (const assignment of request.assignments) {
    const slot = selectSlot.get(assignment.scheduleSlotId) as
      | ScheduleSlotRow
      | undefined;

    if (!slot || slot.schedule_run_id !== request.scheduleRunId) {
      throwPersistenceError(
        "SCHEDULE_BATCH_ASSIGNMENT_SLOT_INVALID",
        `Assignment ${assignment.id} references a slot outside run ${request.scheduleRunId}.`
      );
    }
  }
}

function verifyWarningAssignmentReferences(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest,
  requestAssignmentIds: Set<string>
): void {
  const selectAssignment = db.prepare("SELECT id FROM schedule_assignments WHERE id = ?");

  for (const warning of request.warnings) {
    if (!warning.scheduleAssignmentId) {
      continue;
    }

    if (requestAssignmentIds.has(warning.scheduleAssignmentId)) {
      continue;
    }

    const assignment = selectAssignment.get(warning.scheduleAssignmentId) as
      | { id: string }
      | undefined;

    if (!assignment) {
      throwPersistenceError(
        "SCHEDULE_BATCH_WARNING_ASSIGNMENT_NOT_FOUND",
        `Warning ${warning.id} references missing assignment ${warning.scheduleAssignmentId}.`
      );
    }
  }
}

function verifyNoDuplicateRequestAssignments(
  assignments: PersistValidatedScheduleAssignmentInput[]
): void {
  const assignmentIds = new Set<string>();
  const activeSlotIds = new Set<string>();
  const activeEmployeeSlotPairs = new Set<string>();

  for (const assignment of assignments) {
    if (assignmentIds.has(assignment.id)) {
      throwPersistenceError(
        "SCHEDULE_BATCH_DUPLICATE_ASSIGNMENT_ID",
        `Duplicate assignment id ${assignment.id} in schedule batch.`
      );
    }

    assignmentIds.add(assignment.id);

    if (!isActiveStatus(assignment.status)) {
      continue;
    }

    if (activeSlotIds.has(assignment.scheduleSlotId)) {
      throwPersistenceError(
        "SCHEDULE_BATCH_DUPLICATE_SLOT_ASSIGNMENT",
        `Multiple active assignments were supplied for slot ${assignment.scheduleSlotId}.`
      );
    }

    activeSlotIds.add(assignment.scheduleSlotId);

    const pairKey = `${assignment.employeeId}|${assignment.scheduleSlotId}`;
    if (activeEmployeeSlotPairs.has(pairKey)) {
      throwPersistenceError(
        "SCHEDULE_BATCH_DUPLICATE_EMPLOYEE_SLOT",
        `Duplicate employee-slot pair ${pairKey} in schedule batch.`
      );
    }

    activeEmployeeSlotPairs.add(pairKey);
  }
}

function verifyNoDuplicateSlotUpdates(
  request: PersistValidatedScheduleBatchRequest
): void {
  const slotIds = new Set<string>();

  for (const slotUpdate of request.slotUpdates) {
    if (slotIds.has(slotUpdate.slotId)) {
      throwPersistenceError(
        "SCHEDULE_BATCH_DUPLICATE_SLOT_UPDATE",
        `Duplicate slot update for ${slotUpdate.slotId}.`
      );
    }

    slotIds.add(slotUpdate.slotId);
  }
}

function verifyNoDuplicateWarnings(
  warnings: PersistValidatedScheduleWarningInput[]
): void {
  const warningIds = new Set<string>();

  for (const warning of warnings) {
    if (warningIds.has(warning.id)) {
      throwPersistenceError(
        "SCHEDULE_BATCH_DUPLICATE_WARNING_ID",
        `Duplicate warning id ${warning.id} in schedule batch.`
      );
    }

    warningIds.add(warning.id);
  }
}

function verifyNoConflictingExistingAssignments(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): void {
  const selectAssignmentById = db.prepare(
    `SELECT id, schedule_run_id, schedule_slot_id, employee_id, status, is_manual_override, is_locked, source, notes
     FROM schedule_assignments
     WHERE id = ?`
  );
  const selectActiveAssignmentsBySlot = db.prepare(
    `SELECT id, schedule_run_id, schedule_slot_id, employee_id, status, is_manual_override, is_locked, source, notes
     FROM schedule_assignments
     WHERE schedule_slot_id = ?
       AND status NOT IN ('cancelled', 'removed')`
  );

  for (const assignment of request.assignments) {
    const existingById = selectAssignmentById.get(
      assignment.id
    ) as ScheduleAssignmentRow | undefined;

    if (
      existingById &&
      !existingAssignmentMatchesRequest(existingById, request.scheduleRunId, assignment)
    ) {
      throwPersistenceError(
        "SCHEDULE_BATCH_DUPLICATE_ASSIGNMENT_ID",
        `Assignment id ${assignment.id} already exists with different data.`
      );
    }

    if (!isActiveStatus(assignment.status)) {
      continue;
    }

    const activeAssignments = selectActiveAssignmentsBySlot.all(
      assignment.scheduleSlotId
    ) as ScheduleAssignmentRow[];

    for (const activeAssignment of activeAssignments) {
      if (
        activeAssignment.id === assignment.id &&
        existingAssignmentMatchesRequest(
          activeAssignment,
          request.scheduleRunId,
          assignment
        )
      ) {
        continue;
      }

      throwPersistenceError(
        "SCHEDULE_BATCH_SLOT_ALREADY_ASSIGNED",
        `Slot ${assignment.scheduleSlotId} already has an active assignment.`
      );
    }
  }
}

function verifyNoConflictingExistingWarnings(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): void {
  const selectWarningById = db.prepare(
    `SELECT id, schedule_run_id, schedule_slot_id, schedule_assignment_id, severity, warning_type, message
     FROM schedule_warnings
     WHERE id = ?`
  );

  for (const warning of request.warnings) {
    const existingWarning = selectWarningById.get(warning.id) as
      | ScheduleWarningRow
      | undefined;

    if (
      existingWarning &&
      !existingWarningMatchesRequest(existingWarning, request.scheduleRunId, warning)
    ) {
      throwPersistenceError(
        "SCHEDULE_BATCH_DUPLICATE_WARNING_ID",
        `Warning id ${warning.id} already exists with different data.`
      );
    }
  }
}

function insertNewAssignments(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): number {
  const selectAssignmentById = db.prepare("SELECT id FROM schedule_assignments WHERE id = ?");
  const insertAssignment = db.prepare(
    `INSERT INTO schedule_assignments (
      id,
      schedule_run_id,
      schedule_slot_id,
      employee_id,
      status,
      is_manual_override,
      is_locked,
      source,
      notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let inserted = 0;

  for (const assignment of request.assignments) {
    const existing = selectAssignmentById.get(assignment.id) as
      | { id: string }
      | undefined;

    if (existing) {
      continue;
    }

    insertAssignment.run(
      assignment.id,
      request.scheduleRunId,
      assignment.scheduleSlotId,
      assignment.employeeId,
      assignment.status,
      assignment.isManualOverride,
      getAssignmentIsLocked(assignment),
      getAssignmentSource(assignment),
      assignment.notes
    );
    inserted += 1;
  }

  return inserted;
}

function updateSlots(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): number {
  const updateSlot = db.prepare(
    `UPDATE schedule_slots
     SET status = ?, updated_at = datetime('now')
     WHERE id = ? AND schedule_run_id = ?`
  );
  let updated = 0;

  for (const slotUpdate of request.slotUpdates) {
    const result = updateSlot.run(
      slotUpdate.status,
      slotUpdate.slotId,
      request.scheduleRunId
    );

    if (result.changes !== 1) {
      throwPersistenceError(
        "SCHEDULE_BATCH_SLOT_UPDATE_FAILED",
        `Slot ${slotUpdate.slotId} could not be updated.`
      );
    }

    updated += 1;
  }

  return updated;
}

function insertNewWarnings(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): number {
  const selectWarningById = db.prepare("SELECT id FROM schedule_warnings WHERE id = ?");
  const insertWarning = db.prepare(
    `INSERT INTO schedule_warnings (
      id,
      schedule_run_id,
      schedule_slot_id,
      schedule_assignment_id,
      severity,
      warning_type,
      message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  let inserted = 0;

  for (const warning of request.warnings) {
    const existing = selectWarningById.get(warning.id) as
      | { id: string }
      | undefined;

    if (existing) {
      continue;
    }

    insertWarning.run(
      warning.id,
      request.scheduleRunId,
      warning.scheduleSlotId,
      warning.scheduleAssignmentId,
      warning.severity,
      warning.warningType,
      warning.message
    );
    inserted += 1;
  }

  return inserted;
}

function updateRun(
  db: SqliteDatabase,
  request: PersistValidatedScheduleBatchRequest
): void {
  const result = db
    .prepare(
      `UPDATE schedule_runs
       SET status = ?,
           parameters_json = ?,
           completed_at = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      request.runUpdate.status,
      request.runUpdate.parametersJson,
      request.runUpdate.completedAt,
      request.scheduleRunId
    );

  if (result.changes !== 1) {
    throwPersistenceError(
      "SCHEDULE_BATCH_RUN_UPDATE_FAILED",
      `Schedule run ${request.scheduleRunId} could not be updated.`
    );
  }
}

function existingAssignmentMatchesRequest(
  existing: ScheduleAssignmentRow,
  scheduleRunId: string,
  assignment: PersistValidatedScheduleAssignmentInput
): boolean {
  return (
    existing.schedule_run_id === scheduleRunId &&
    existing.schedule_slot_id === assignment.scheduleSlotId &&
    existing.employee_id === assignment.employeeId &&
    existing.status === assignment.status &&
    Number(existing.is_manual_override) === assignment.isManualOverride &&
    Number(existing.is_locked) === getAssignmentIsLocked(assignment) &&
    normalizeAssignmentSource(existing.source) === getAssignmentSource(assignment) &&
    normalizeNullableText(existing.notes) === normalizeNullableText(assignment.notes)
  );
}

function getAssignmentIsLocked(
  assignment: PersistValidatedScheduleAssignmentInput
): 0 | 1 {
  return assignment.isLocked ?? 0;
}

function getAssignmentSource(
  assignment: PersistValidatedScheduleAssignmentInput
): ScheduleAssignmentSource {
  return assignment.source ?? "automatic_heuristic";
}

function normalizeAssignmentSource(source: string): ScheduleAssignmentSource {
  return isValidAssignmentSource(source) ? source : "automatic_heuristic";
}

function isValidAssignmentSource(
  source: string
): source is ScheduleAssignmentSource {
  return (
    source === "automatic_cp_sat" ||
    source === "automatic_heuristic" ||
    source === "manual" ||
    source === "locked_manual" ||
    source === "imported"
  );
}

function existingWarningMatchesRequest(
  existing: ScheduleWarningRow,
  scheduleRunId: string,
  warning: PersistValidatedScheduleWarningInput
): boolean {
  return (
    existing.schedule_run_id === scheduleRunId &&
    normalizeNullableText(existing.schedule_slot_id) ===
      normalizeNullableText(warning.scheduleSlotId) &&
    normalizeNullableText(existing.schedule_assignment_id) ===
      normalizeNullableText(warning.scheduleAssignmentId) &&
    existing.severity === warning.severity &&
    existing.warning_type === warning.warningType &&
    existing.message === warning.message
  );
}

function isActiveStatus(status: string): boolean {
  return status !== "cancelled" && status !== "removed";
}

function requireNonEmptyString(value: unknown, fieldName: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throwPersistenceError(
      "SCHEDULE_BATCH_INVALID_REQUEST",
      `${fieldName} must be a non-empty string.`
    );
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeNullableText(value: string | null): string | null {
  return value ?? null;
}

function throwPersistenceError(code: string, message: string): never {
  throw new SchedulePersistenceError(code, message);
}
