import type { Database as SqliteDatabase } from "better-sqlite3";
import type {
  DeleteScheduleRunGraphRequest,
  DeleteScheduleRunGraphResult,
  PersistCompleteGeneratedScheduleRequest,
  PersistCompleteGeneratedScheduleResult,
  PersistCompleteGeneratedScheduleSlotInput,
  PersistManualAssignmentChangeRequest,
  PersistManualAssignmentChangeResult,
  PersistValidatedScheduleAssignmentInput,
  PersistValidatedScheduleBatchRequest,
  PersistValidatedScheduleBatchResult,
  ScheduleAssignmentOrigin,
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

export function persistCompleteGeneratedScheduleInTransaction(
  db: SqliteDatabase,
  request: PersistCompleteGeneratedScheduleRequest
): PersistCompleteGeneratedScheduleResult {
  return db.transaction(() => {
    validateCompleteGeneratedScheduleRequest(request);
    verifyRunDoesNotExist(db, request.run.id);

    const runInserted = insertGeneratedRun(db, request);
    const slotsInserted = insertGeneratedSlots(db, request);
    const batchRequest: PersistValidatedScheduleBatchRequest = {
      scheduleRunId: request.run.id,
      assignments: request.assignments,
      slotUpdates: [],
      runUpdate: request.runUpdate,
      warnings: request.warnings
    };
    const assignmentIds = new Set(request.assignments.map((item) => item.id));

    verifySlotsBelongToRun(
      db,
      request.run.id,
      collectReferencedSlotIds(batchRequest)
    );
    verifyEmployeesExist(
      db,
      request.assignments.map((assignment) => assignment.employeeId)
    );
    verifyAssignmentsReferenceRunSlots(db, batchRequest);
    verifyWarningAssignmentReferences(db, batchRequest, assignmentIds);
    verifyNoDuplicateRequestAssignments(request.assignments);
    verifyNoDuplicateWarnings(request.warnings);
    verifyNoConflictingExistingAssignments(db, batchRequest);
    verifyNoConflictingExistingWarnings(db, batchRequest);

    const assignmentsInserted = insertNewAssignments(db, batchRequest);
    const warningsInserted = insertNewWarnings(db, batchRequest);
    updateRun(db, batchRequest);

    return {
      runInserted,
      slotsInserted,
      assignmentsInserted,
      warningsInserted
    };
  })();
}

export function persistManualAssignmentChangeInTransaction(
  db: SqliteDatabase,
  request: PersistManualAssignmentChangeRequest
): PersistManualAssignmentChangeResult {
  return db.transaction(() => {
    validateManualAssignmentChangeRequest(request);
    verifyRunExists(db, request.scheduleRunId);
    verifySlotsBelongToRun(db, request.scheduleRunId, [request.scheduleSlotId]);

    if (request.nextEmployeeId) {
      verifyEmployeesExist(db, [request.nextEmployeeId]);
    }

    const currentAssignment = request.currentAssignmentId
      ? getAssignmentForManualChange(
          db,
          request.currentAssignmentId,
          request.scheduleRunId,
          request.scheduleSlotId
        )
      : null;
    const reusableAssignment =
      request.nextEmployeeId === null
        ? null
        : findReusableManualAssignment({
            db,
            request,
            currentAssignmentId: currentAssignment?.id ?? null
          });
    let assignmentInserted = false;
    let assignmentUpdated = false;
    let assignmentRemoved = false;
    let slotStatus = "unfilled";

    deleteManualAssignmentWarningsForSlot(db, request);

    if (request.nextEmployeeId === null) {
      if (currentAssignment) {
        markAssignmentRemoved(db, currentAssignment.id);
        assignmentRemoved = true;
      }
      updateSingleSlotStatus(db, request.scheduleRunId, request.scheduleSlotId, "unfilled");
    } else {
      const notes = request.assignmentNotes;

      if (currentAssignment && reusableAssignment) {
        markAssignmentRemoved(db, currentAssignment.id);
        activateManualAssignment(db, reusableAssignment.id, request.nextEmployeeId, notes);
        assignmentRemoved = true;
        assignmentUpdated = true;
      } else if (currentAssignment) {
        updateManualAssignmentEmployee({
          db,
          assignmentId: currentAssignment.id,
          employeeId: request.nextEmployeeId,
          notes
        });
        assignmentUpdated = true;
      } else if (reusableAssignment) {
        activateManualAssignment(db, reusableAssignment.id, request.nextEmployeeId, notes);
        assignmentUpdated = true;
      } else {
        if (!request.nextAssignmentId) {
          throwPersistenceError(
            "MANUAL_ASSIGNMENT_INVALID_REQUEST",
            "nextAssignmentId is required when creating a manual assignment."
          );
        }
        insertManualAssignment(db, request, notes);
        assignmentInserted = true;
      }

      updateSingleSlotStatus(db, request.scheduleRunId, request.scheduleSlotId, "filled");
      slotStatus = "filled";
    }

    const warningsInserted = insertManualAssignmentWarnings(db, request);

    return {
      assignmentInserted,
      assignmentUpdated,
      assignmentRemoved,
      slotStatus,
      warningsInserted
    };
  })();
}

export function deleteScheduleRunGraphInTransaction(
  db: SqliteDatabase,
  request: DeleteScheduleRunGraphRequest
): DeleteScheduleRunGraphResult {
  return db.transaction(() => {
    requireNonEmptyString(request.scheduleRunId, "scheduleRunId");
    verifyRunExists(db, request.scheduleRunId);
    const rerunDescendants = findRerunDescendants(db, request.scheduleRunId);

    if (rerunDescendants.length > 0) {
      throwPersistenceError(
        "SCHEDULE_DELETE_HAS_RERUN_DESCENDANTS",
        `Schedule run ${request.scheduleRunId} has rerun descendants and cannot be deleted before ${rerunDescendants
          .slice(0, 3)
          .join(", ")}.`
      );
    }

    const slotsDeleted = countRunRows(db, "schedule_slots", request.scheduleRunId);
    const assignmentsDeleted = countRunRows(
      db,
      "schedule_assignments",
      request.scheduleRunId
    );
    const warningsDeleted = countRunRows(db, "schedule_warnings", request.scheduleRunId);
    const result = db
      .prepare("DELETE FROM schedule_runs WHERE id = ?")
      .run(request.scheduleRunId);

    if (result.changes !== 1) {
      throwPersistenceError(
        "SCHEDULE_DELETE_FAILED",
        `Schedule run ${request.scheduleRunId} could not be deleted.`
      );
    }

    return {
      runDeleted: true,
      slotsDeleted,
      assignmentsDeleted,
      warningsDeleted
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

function validateCompleteGeneratedScheduleRequest(
  request: PersistCompleteGeneratedScheduleRequest
): void {
  if (!request || typeof request !== "object") {
    throwPersistenceError(
      "COMPLETE_SCHEDULE_INVALID_REQUEST",
      "Complete schedule request is required."
    );
  }

  requireNonEmptyString(request.run?.id, "run.id");
  requireNonEmptyString(request.run?.name, "run.name");
  requireNonEmptyString(request.run?.startDate, "run.startDate");
  requireNonEmptyString(request.run?.endDate, "run.endDate");
  requireNonEmptyString(request.run?.status, "run.status");

  if (!Array.isArray(request.slots)) {
    throwPersistenceError(
      "COMPLETE_SCHEDULE_INVALID_REQUEST",
      "Slots must be an array."
    );
  }

  const slotIds = new Set<string>();
  for (const slot of request.slots) {
    validateCompleteGeneratedScheduleSlot(slot);
    if (slotIds.has(slot.id)) {
      throwPersistenceError(
        "COMPLETE_SCHEDULE_DUPLICATE_SLOT_ID",
        `Duplicate slot id ${slot.id} in complete schedule request.`
      );
    }
    slotIds.add(slot.id);
  }

  validateRequestShape({
    scheduleRunId: request.run.id,
    assignments: request.assignments,
    slotUpdates: [],
    runUpdate: request.runUpdate,
    warnings: request.warnings
  });
}

function validateCompleteGeneratedScheduleSlot(
  slot: PersistCompleteGeneratedScheduleSlotInput
): void {
  requireNonEmptyString(slot.id, "slot.id");
  requireNonEmptyString(slot.date, "slot.date");
  requireNonEmptyString(slot.roleId, "slot.roleId");
  requireNonEmptyString(slot.startTime, "slot.startTime");
  requireNonEmptyString(slot.endTime, "slot.endTime");
  requireNonEmptyString(slot.status, "slot.status");

  if (!Number.isInteger(slot.requiredCount) || slot.requiredCount < 0) {
    throwPersistenceError(
      "COMPLETE_SCHEDULE_INVALID_REQUEST",
      `Slot ${slot.id} has invalid required count.`
    );
  }

  if (
    !Number.isInteger(slot.experiencedRequiredCount) ||
    slot.experiencedRequiredCount < 0
  ) {
    throwPersistenceError(
      "COMPLETE_SCHEDULE_INVALID_REQUEST",
      `Slot ${slot.id} has invalid experienced required count.`
    );
  }

  if (slot.slotNumber !== null && !Number.isInteger(slot.slotNumber)) {
    throwPersistenceError(
      "COMPLETE_SCHEDULE_INVALID_REQUEST",
      `Slot ${slot.id} has invalid slot number.`
    );
  }
}

function validateManualAssignmentChangeRequest(
  request: PersistManualAssignmentChangeRequest
): void {
  requireNonEmptyString(request.scheduleRunId, "scheduleRunId");
  requireNonEmptyString(request.scheduleSlotId, "scheduleSlotId");

  if (request.currentAssignmentId !== null) {
    requireNonEmptyString(request.currentAssignmentId, "currentAssignmentId");
  }

  if (request.nextEmployeeId !== null) {
    requireNonEmptyString(request.nextEmployeeId, "nextEmployeeId");
    requireNonEmptyString(request.nextAssignmentId, "nextAssignmentId");
  }

  if (!Array.isArray(request.softWarnings) || !Array.isArray(request.hardWarnings)) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_INVALID_REQUEST",
      "Manual assignment warnings must be arrays."
    );
  }

  if (request.hardWarnings.length > 0 && request.allowHardOverride !== true) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_HARD_RULE_VIOLATION",
      "Hard-rule manual assignment warnings require an explicit override."
    );
  }

  verifyNoDuplicateWarnings([...request.softWarnings, ...request.hardWarnings]);
}

function verifyRunDoesNotExist(db: SqliteDatabase, scheduleRunId: string): void {
  const run = db
    .prepare("SELECT id FROM schedule_runs WHERE id = ?")
    .get(scheduleRunId) as ScheduleRunRow | undefined;

  if (run) {
    throwPersistenceError(
      "COMPLETE_SCHEDULE_RUN_ALREADY_EXISTS",
      `Schedule run ${scheduleRunId} already exists.`
    );
  }
}

function insertGeneratedRun(
  db: SqliteDatabase,
  request: PersistCompleteGeneratedScheduleRequest
): number {
  const result = db
    .prepare(
      `INSERT INTO schedule_runs (
        id,
        name,
        start_date,
        end_date,
        status,
        parameters_json,
        completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      request.run.id,
      request.run.name,
      request.run.startDate,
      request.run.endDate,
      request.run.status,
      request.run.parametersJson,
      request.run.completedAt
    );

  if (result.changes !== 1) {
    throwPersistenceError(
      "COMPLETE_SCHEDULE_RUN_INSERT_FAILED",
      `Schedule run ${request.run.id} could not be inserted.`
    );
  }

  return result.changes;
}

function insertGeneratedSlots(
  db: SqliteDatabase,
  request: PersistCompleteGeneratedScheduleRequest
): number {
  const insertSlot = db.prepare(
    `INSERT INTO schedule_slots (
      id,
      schedule_run_id,
      date,
      role_id,
      start_time,
      end_time,
      required_count,
      requirement_group_id,
      minimum_experience_level,
      experienced_required_count,
      status,
      source_type,
      source_id,
      slot_number,
      notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let inserted = 0;

  for (const slot of request.slots) {
    insertSlot.run(
      slot.id,
      request.run.id,
      slot.date,
      slot.roleId,
      slot.startTime,
      slot.endTime,
      slot.requiredCount,
      slot.requirementGroupId,
      slot.minimumExperienceLevel,
      slot.experiencedRequiredCount,
      slot.status,
      slot.sourceType,
      slot.sourceId,
      slot.slotNumber,
      slot.notes
    );
    inserted += 1;
  }

  return inserted;
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
  const selectAssignment = db.prepare(
    "SELECT id, schedule_run_id FROM schedule_assignments WHERE id = ?"
  );

  for (const warning of request.warnings) {
    if (!warning.scheduleAssignmentId) {
      continue;
    }

    if (requestAssignmentIds.has(warning.scheduleAssignmentId)) {
      continue;
    }

    const assignment = selectAssignment.get(warning.scheduleAssignmentId) as
      | { id: string; schedule_run_id: string }
      | undefined;

    if (!assignment) {
      throwPersistenceError(
        "SCHEDULE_BATCH_WARNING_ASSIGNMENT_NOT_FOUND",
        `Warning ${warning.id} references missing assignment ${warning.scheduleAssignmentId}.`
      );
    }

    if (assignment.schedule_run_id !== request.scheduleRunId) {
      throwPersistenceError(
        "SCHEDULE_BATCH_WARNING_ASSIGNMENT_RUN_MISMATCH",
        `Warning ${warning.id} references assignment ${warning.scheduleAssignmentId} outside run ${request.scheduleRunId}.`
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

function getAssignmentForManualChange(
  db: SqliteDatabase,
  assignmentId: string,
  scheduleRunId: string,
  scheduleSlotId: string
): ScheduleAssignmentRow {
  const assignment = db
    .prepare(
      `SELECT id, schedule_run_id, schedule_slot_id, employee_id, status, is_manual_override, is_locked, source, notes
       FROM schedule_assignments
       WHERE id = ?`
    )
    .get(assignmentId) as ScheduleAssignmentRow | undefined;

  if (!assignment) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_NOT_FOUND",
      `Assignment ${assignmentId} could not be found.`
    );
  }

  if (
    assignment.schedule_run_id !== scheduleRunId ||
    assignment.schedule_slot_id !== scheduleSlotId
  ) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_RUN_SLOT_MISMATCH",
      `Assignment ${assignmentId} does not belong to the requested slot.`
    );
  }

  return assignment;
}

function findReusableManualAssignment({
  db,
  request,
  currentAssignmentId
}: {
  db: SqliteDatabase;
  request: PersistManualAssignmentChangeRequest;
  currentAssignmentId: string | null;
}): ScheduleAssignmentRow | null {
  const assignment = db
    .prepare(
      `SELECT id, schedule_run_id, schedule_slot_id, employee_id, status, is_manual_override, is_locked, source, notes
       FROM schedule_assignments
       WHERE schedule_run_id = ?
         AND schedule_slot_id = ?
         AND employee_id = ?
         AND (? IS NULL OR id <> ?)
       ORDER BY created_at DESC
       LIMIT 1`
    )
    .get(
      request.scheduleRunId,
      request.scheduleSlotId,
      request.nextEmployeeId,
      currentAssignmentId,
      currentAssignmentId
    ) as ScheduleAssignmentRow | undefined;

  return assignment ?? null;
}

function markAssignmentRemoved(
  db: SqliteDatabase,
  assignmentId: string
): void {
  const result = db
    .prepare(
      `UPDATE schedule_assignments
       SET status = 'removed',
           is_manual_override = 1,
           is_locked = 0,
           source = 'manual',
           notes = 'Manual override: assignment removed by manager.',
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(assignmentId);

  if (result.changes !== 1) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_REMOVE_FAILED",
      `Assignment ${assignmentId} could not be removed.`
    );
  }
}

function activateManualAssignment(
  db: SqliteDatabase,
  assignmentId: string,
  employeeId: string,
  notes: string | null
): void {
  const result = db
    .prepare(
      `UPDATE schedule_assignments
       SET employee_id = ?,
           status = 'assigned',
           is_manual_override = 1,
           is_locked = 0,
           source = 'manual',
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(employeeId, notes, assignmentId);

  if (result.changes !== 1) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_UPDATE_FAILED",
      `Assignment ${assignmentId} could not be activated.`
    );
  }
}

function updateManualAssignmentEmployee({
  db,
  assignmentId,
  employeeId,
  notes
}: {
  db: SqliteDatabase;
  assignmentId: string;
  employeeId: string;
  notes: string | null;
}): void {
  const result = db
    .prepare(
      `UPDATE schedule_assignments
       SET employee_id = ?,
           status = 'assigned',
           is_manual_override = 1,
           is_locked = 0,
           source = 'manual',
           notes = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(employeeId, notes, assignmentId);

  if (result.changes !== 1) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_UPDATE_FAILED",
      `Assignment ${assignmentId} could not be updated.`
    );
  }
}

function insertManualAssignment(
  db: SqliteDatabase,
  request: PersistManualAssignmentChangeRequest,
  notes: string | null
): void {
  const result = db
    .prepare(
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
      ) VALUES (?, ?, ?, ?, 'assigned', 1, 0, 'manual', ?)`
    )
    .run(
      request.nextAssignmentId,
      request.scheduleRunId,
      request.scheduleSlotId,
      request.nextEmployeeId,
      notes
    );

  if (result.changes !== 1) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_INSERT_FAILED",
      `Manual assignment ${request.nextAssignmentId} could not be inserted.`
    );
  }
}

function updateSingleSlotStatus(
  db: SqliteDatabase,
  scheduleRunId: string,
  scheduleSlotId: string,
  status: string
): void {
  const result = db
    .prepare(
      `UPDATE schedule_slots
       SET status = ?,
           updated_at = datetime('now')
       WHERE id = ? AND schedule_run_id = ?`
    )
    .run(status, scheduleSlotId, scheduleRunId);

  if (result.changes !== 1) {
    throwPersistenceError(
      "MANUAL_ASSIGNMENT_SLOT_UPDATE_FAILED",
      `Schedule slot ${scheduleSlotId} could not be updated.`
    );
  }
}

function deleteManualAssignmentWarningsForSlot(
  db: SqliteDatabase,
  request: PersistManualAssignmentChangeRequest
): void {
  db.prepare(
    `DELETE FROM schedule_warnings
     WHERE schedule_run_id = ?
       AND schedule_slot_id = ?
       AND warning_type IN (
         'manual_override_warning',
         'manual_hard_override_violation'
       )`
  ).run(request.scheduleRunId, request.scheduleSlotId);
}

function insertManualAssignmentWarnings(
  db: SqliteDatabase,
  request: PersistManualAssignmentChangeRequest
): number {
  const warnings = [...request.softWarnings, ...request.hardWarnings];
  const selectAssignment = db.prepare(
    "SELECT id, schedule_run_id FROM schedule_assignments WHERE id = ?"
  );
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

  for (const warning of warnings) {
    if (warning.scheduleSlotId && warning.scheduleSlotId !== request.scheduleSlotId) {
      throwPersistenceError(
        "MANUAL_ASSIGNMENT_WARNING_SLOT_MISMATCH",
        `Warning ${warning.id} does not belong to slot ${request.scheduleSlotId}.`
      );
    }

    if (warning.scheduleAssignmentId) {
      const assignment = selectAssignment.get(warning.scheduleAssignmentId) as
        | { id: string; schedule_run_id: string }
        | undefined;

      if (!assignment || assignment.schedule_run_id !== request.scheduleRunId) {
        throwPersistenceError(
          "MANUAL_ASSIGNMENT_WARNING_ASSIGNMENT_MISMATCH",
          `Warning ${warning.id} references assignment ${warning.scheduleAssignmentId} outside run ${request.scheduleRunId}.`
        );
      }
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

function countRunRows(
  db: SqliteDatabase,
  tableName: "schedule_slots" | "schedule_assignments" | "schedule_warnings",
  scheduleRunId: string
): number {
  return Number(
    (
      db
        .prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE schedule_run_id = ?`)
        .get(scheduleRunId) as { count: number }
    ).count
  );
}

function findRerunDescendants(
  db: SqliteDatabase,
  scheduleRunId: string
): string[] {
  const rows = db
    .prepare("SELECT id, parameters_json FROM schedule_runs WHERE id <> ?")
    .all(scheduleRunId) as Array<{ id: string; parameters_json: string | null }>;

  return rows
    .filter((row) => getRerunFromRunId(row.parameters_json) === scheduleRunId)
    .map((row) => row.id)
    .sort();
}

function getRerunFromRunId(parametersJson: string | null): string | null {
  if (!parametersJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(parametersJson) as unknown;

    if (
      parsed &&
      typeof parsed === "object" &&
      "rerunFromRunId" in parsed &&
      typeof (parsed as { rerunFromRunId?: unknown }).rerunFromRunId === "string"
    ) {
      return (parsed as { rerunFromRunId: string }).rerunFromRunId;
    }
  } catch {
    return null;
  }

  return null;
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
): ScheduleAssignmentOrigin {
  return normalizeAssignmentSource(assignment.source ?? "automatic_heuristic");
}

function normalizeAssignmentSource(source: string): ScheduleAssignmentOrigin {
  if (source === "locked_manual") {
    return "manual";
  }

  return isValidAssignmentSource(source) ? source : "automatic_heuristic";
}

function isValidAssignmentSource(
  source: string
): source is ScheduleAssignmentOrigin {
  return (
    source === "automatic_cp_sat" ||
    source === "automatic_heuristic" ||
    source === "manual" ||
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
