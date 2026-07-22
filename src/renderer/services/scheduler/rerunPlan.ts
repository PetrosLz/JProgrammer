import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeTimeConstraint,
  EmployeeWorkRules,
  OpeningHours,
  PersistCompleteGeneratedScheduleRequest,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ShiftTemplate,
  SpecialDay,
  SpecialDayStaffingRequirement,
  StaffingRequirement,
  TimeOff
} from "../../types";
import { validateScheduleHardConstraints } from "./evaluation/scheduleValidator";
import {
  buildAutomaticScheduleCandidate,
  type AutomaticScheduleCandidateResult
} from "./assignEmployees";
import { buildScheduleGenerationPlan } from "./generateSlots";

export type RerunSchedulePlanSuccess = {
  ok: true;
  run: ScheduleRun;
  slots: ScheduleSlot[];
  mappedLockedAssignments: ScheduleAssignment[];
  mappedPreviousAssignments: ScheduleAssignment[];
  unmappedPreviousAssignments: string[];
  candidate: AutomaticScheduleCandidateResult;
  persistenceRequest: PersistCompleteGeneratedScheduleRequest | null;
  metadata: RerunSchedulePlanMetadata;
};

export type RerunSchedulePlanFailure = {
  ok: false;
  reason: "unmappable_locked_assignment" | "invalid_locked_assignment";
  message: string;
  unmappedLockedAssignments: string[];
  lockViolations: string[];
};

export type RerunSchedulePlanResult =
  | RerunSchedulePlanSuccess
  | RerunSchedulePlanFailure;

export type RerunSchedulePlanMetadata = {
  rerunFromRunId: string;
  preservedLockedAssignmentCount: number;
  previousAssignmentHintCount: number;
  warmStartHintCount: number;
  ignoredPreviousAssignmentHintCount: number;
  unmappedPreviousAssignmentHintCount: number;
  engine: string;
  solverStatus: string;
  validationStatus: "valid" | "invalid";
  generatedAt: string;
};

export async function buildRerunSchedulePlan({
  sourceRun,
  sourceRunSlots,
  sourceRunAssignments,
  allScheduleSlots,
  allScheduleAssignments,
  openingHours,
  staffingRequirements,
  specialDays,
  specialDayStaffingRequirements,
  shiftTemplates,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  employeeTimeConstraints,
  timeOff,
  roles,
  weekStartsOn,
  generatedAt = new Date().toISOString(),
  idFactory = defaultIdFactory
}: {
  sourceRun: ScheduleRun;
  sourceRunSlots: ScheduleSlot[];
  sourceRunAssignments: ScheduleAssignment[];
  allScheduleSlots: ScheduleSlot[];
  allScheduleAssignments: ScheduleAssignment[];
  openingHours: OpeningHours[];
  staffingRequirements: StaffingRequirement[];
  specialDays: SpecialDay[];
  specialDayStaffingRequirements: SpecialDayStaffingRequirement[];
  shiftTemplates: ShiftTemplate[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  employeeTimeConstraints: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  roles: Role[];
  weekStartsOn: DayOfWeek;
  generatedAt?: string;
  idFactory?: (prefix: string) => string;
}): Promise<RerunSchedulePlanResult> {
  const generationPlan = buildScheduleGenerationPlan({
    weekStartDate: sourceRun.start_date,
    openingHours,
    staffingRequirements,
    specialDayStaffingRequirements,
    shiftTemplates,
    specialDays
  });
  const rerun: ScheduleRun = {
    id: idFactory("schedule-run"),
    name: `${sourceRun.name} rerun`,
    start_date: generationPlan.weekStartDate,
    end_date: generationPlan.weekEndDate,
    status: "generating",
    parameters_json: JSON.stringify({
      stage: "rerun_candidate",
      type: "weekly",
      rerunFromRunId: sourceRun.id,
      weekStartsOn,
      weekStartDate: generationPlan.weekStartDate,
      weekEndDate: generationPlan.weekEndDate,
      generatedAt
    }),
    completed_at: null,
    created_at: generatedAt,
    updated_at: generatedAt
  };
  const regeneratedSlots: ScheduleSlot[] = generationPlan.slots.map((slot) => ({
    id: idFactory("schedule-slot"),
    schedule_run_id: rerun.id,
    date: slot.date,
    role_id: slot.roleId,
    start_time: slot.startTime,
    end_time: slot.endTime,
    required_count: 1,
    requirement_group_id: slot.requirementGroupId,
    minimum_experience_level: slot.minimumExperienceLevel,
    experienced_required_count: slot.experiencedRequiredCount,
    status: "unfilled",
    source_type: slot.sourceType,
    source_id: slot.sourceId,
    slot_number: slot.slotNumber,
    notes: `Slot ${slot.slotNumber} of ${slot.requiredCount}`,
    created_at: generatedAt,
    updated_at: generatedAt
  }));
  const lockedAssignments = sourceRunAssignments.filter(
    (assignment) => assignment.is_locked === 1
  );
  const unlockedAssignments = sourceRunAssignments.filter(
    (assignment) => assignment.is_locked !== 1
  );
  const mappedLockedAssignments = mapAssignmentsToRegeneratedSlots({
    assignments: lockedAssignments,
    sourceSlots: sourceRunSlots,
    targetSlots: regeneratedSlots,
    newRunId: rerun.id,
    generatedAt,
    locked: true,
    idFactory,
    idPrefix: "locked-assignment"
  });
  const mappedPreviousAssignments = mapAssignmentsToRegeneratedSlots({
    assignments: unlockedAssignments,
    sourceSlots: sourceRunSlots,
    targetSlots: regeneratedSlots,
    newRunId: rerun.id,
    generatedAt,
    locked: false,
    idFactory,
    idPrefix: "previous-assignment"
  });

  if (mappedLockedAssignments.unmapped.length > 0) {
    return {
      ok: false,
      reason: "unmappable_locked_assignment",
      message: `Locked assignment cannot be preserved because its slot no longer exists in the current staffing rules: ${mappedLockedAssignments.unmapped
        .slice(0, 3)
        .join("; ")}`,
      unmappedLockedAssignments: mappedLockedAssignments.unmapped,
      lockViolations: []
    };
  }

  const lockValidation = validateScheduleHardConstraints({
    runSlots: regeneratedSlots,
    assignments: mappedLockedAssignments.assignments,
    employees,
    data: {
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      employeeTimeConstraints,
      timeOff,
      staffingRequirements,
      weekStartsOn
    }
  });

  if (!lockValidation.valid) {
    return {
      ok: false,
      reason: "invalid_locked_assignment",
      message: `Locked assignments are no longer valid: ${lockValidation.violations
        .map((violation) => violation.message)
        .slice(0, 3)
        .join(" ")}`,
      unmappedLockedAssignments: [],
      lockViolations: lockValidation.violations.map(
        (violation) => violation.message
      )
    };
  }

  const candidate = await buildAutomaticScheduleCandidate({
    run: rerun,
    slots: [...allScheduleSlots, ...regeneratedSlots],
    employees,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    employeeTimeConstraints,
    timeOff,
    roles,
    shiftTemplates,
    staffingRequirements,
    weekStartsOn,
    assignments: [
      ...allScheduleAssignments,
      ...mappedLockedAssignments.assignments,
      ...mappedPreviousAssignments.assignments
    ]
  });
  const metadata: RerunSchedulePlanMetadata = {
    rerunFromRunId: sourceRun.id,
    preservedLockedAssignmentCount: mappedLockedAssignments.assignments.length,
    previousAssignmentHintCount: candidate.previousAssignmentHintCount,
    warmStartHintCount: candidate.warmStartHintCount,
    ignoredPreviousAssignmentHintCount:
      candidate.ignoredPreviousAssignmentHintCount,
    unmappedPreviousAssignmentHintCount: mappedPreviousAssignments.unmapped.length,
    engine: candidate.optimizerTelemetry.engine,
    solverStatus: candidate.optimizerTelemetry.solverStatus,
    validationStatus: candidate.validation.valid ? "valid" : "invalid",
    generatedAt
  };
  const persistenceRequest = candidate.validation.valid
    ? buildPersistenceRequest({
        rerun,
        regeneratedSlots,
        generationWarnings: generationPlan.warnings,
        candidate,
        metadata,
        idFactory
      })
    : null;

  return {
    ok: true,
    run: rerun,
    slots: regeneratedSlots,
    mappedLockedAssignments: mappedLockedAssignments.assignments,
    mappedPreviousAssignments: mappedPreviousAssignments.assignments,
    unmappedPreviousAssignments: mappedPreviousAssignments.unmapped,
    candidate,
    persistenceRequest,
    metadata
  };
}

function buildPersistenceRequest({
  rerun,
  regeneratedSlots,
  generationWarnings,
  candidate,
  metadata,
  idFactory
}: {
  rerun: ScheduleRun;
  regeneratedSlots: ScheduleSlot[];
  generationWarnings: Array<{
    severity: "info" | "warning";
    warningType: string;
    message: string;
  }>;
  candidate: AutomaticScheduleCandidateResult;
  metadata: RerunSchedulePlanMetadata;
  idFactory: (prefix: string) => string;
}): PersistCompleteGeneratedScheduleRequest {
  const slotStatusById = new Map(
    candidate.slotUpdates.map((update) => [update.slotId, update.status])
  );

  return {
    run: {
      id: rerun.id,
      name: rerun.name,
      startDate: rerun.start_date,
      endDate: rerun.end_date,
      status: rerun.status,
      parametersJson: rerun.parameters_json,
      completedAt: rerun.completed_at
    },
    slots: regeneratedSlots.map((slot) => ({
      id: slot.id,
      date: slot.date,
      roleId: slot.role_id,
      startTime: slot.start_time,
      endTime: slot.end_time,
      requiredCount: slot.required_count,
      requirementGroupId: slot.requirement_group_id,
      minimumExperienceLevel: slot.minimum_experience_level,
      experiencedRequiredCount: slot.experienced_required_count,
      status: slotStatusById.get(slot.id) ?? slot.status,
      sourceType: slot.source_type,
      sourceId: slot.source_id,
      slotNumber: slot.slot_number,
      notes: slot.notes
    })),
    assignments: candidate.finalAssignmentInputs,
    warnings: [
      ...generationWarnings.map((warning) => ({
        id: idFactory("schedule-warning"),
        scheduleSlotId: null,
        scheduleAssignmentId: null,
        severity: warning.severity,
        warningType: warning.warningType,
        message: warning.message
      })),
      ...candidate.warningInputs
    ],
    runUpdate: {
      ...candidate.runUpdate,
      parametersJson: mergeRerunCandidateParameters(
        candidate.runUpdate.parametersJson,
        metadata
      )
    }
  };
}

function mapAssignmentsToRegeneratedSlots({
  assignments,
  sourceSlots,
  targetSlots,
  newRunId,
  generatedAt,
  locked,
  idFactory,
  idPrefix
}: {
  assignments: ScheduleAssignment[];
  sourceSlots: ScheduleSlot[];
  targetSlots: ScheduleSlot[];
  newRunId: string;
  generatedAt: string;
  locked: boolean;
  idFactory: (prefix: string) => string;
  idPrefix: string;
}): { assignments: ScheduleAssignment[]; unmapped: string[] } {
  const sourceSlotById = new Map(sourceSlots.map((slot) => [slot.id, slot]));
  const targetSlotByKey = new Map(
    targetSlots.map((slot) => [slotSemanticKey(slot), slot])
  );
  const mappedAssignments: ScheduleAssignment[] = [];
  const unmapped: string[] = [];

  for (const assignment of assignments) {
    const sourceSlot = sourceSlotById.get(assignment.schedule_slot_id);
    const targetSlot = sourceSlot
      ? targetSlotByKey.get(slotSemanticKey(sourceSlot))
      : null;

    if (!sourceSlot || !targetSlot) {
      unmapped.push(formatUnmappedSlotLabel(sourceSlot, assignment));
      continue;
    }

    mappedAssignments.push({
      ...assignment,
      id: idFactory(idPrefix),
      schedule_run_id: newRunId,
      schedule_slot_id: targetSlot.id,
      is_locked: locked ? 1 : 0,
      source: assignment.source === "locked_manual" ? "manual" : assignment.source,
      created_at: generatedAt,
      updated_at: generatedAt
    });
  }

  return {
    assignments: mappedAssignments,
    unmapped
  };
}

function slotSemanticKey(slot: ScheduleSlot): string {
  return [
    slot.date,
    slot.source_type ?? "",
    slot.source_id ?? "",
    slot.requirement_group_id ?? "",
    slot.role_id,
    slot.start_time,
    slot.end_time,
    slot.slot_number ?? ""
  ].join("|");
}

function formatUnmappedSlotLabel(
  sourceSlot: ScheduleSlot | undefined,
  assignment: ScheduleAssignment
): string {
  return sourceSlot
    ? `${sourceSlot.date} ${sourceSlot.start_time}-${sourceSlot.end_time} role ${sourceSlot.role_id}`
    : assignment.schedule_slot_id;
}

function mergeRerunCandidateParameters(
  parametersJson: string | null,
  metadata: RerunSchedulePlanMetadata
): string {
  return JSON.stringify({
    ...parseJsonObject(parametersJson),
    ...metadata
  });
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function defaultIdFactory(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
