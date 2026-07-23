import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeTimeConstraint,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
  ScheduleAssignmentSource,
  ScheduleRun,
  ScheduleSlot,
  ScheduleWarning,
  ShiftTemplate,
  StaffingRequirement,
  TimeOff
} from "../../types";
import type {
  CpSatAttemptTelemetry,
  CpSatHintDiagnostics,
  CpSatSolveStatus,
  OptimizerEngine
} from "../../../shared/solverTypes";
import {
  formatTimeRange,
  getShiftDurationMinutes,
  interpretTimeRange
} from "./model/workingTime";
import {
  evaluateSchedule,
  type ScheduleEvaluationBreakdown,
  type ScheduleEvaluationResult
} from "./evaluator";
import {
  validateScheduleHardConstraints,
  type ScheduleValidationResult
} from "./evaluation/scheduleValidator";
import type { SchedulerData } from "./constraints";
import type { ManagerScheduleStatus } from "./managerDiagnostics";

export type ScheduleSnapshotDuplicateAssignment = {
  slotId: string;
  assignments: ScheduleAssignment[];
};

export type ScheduleSnapshotTimeIssue = {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  message: string;
};

export type ScheduleSnapshotSlotTime = {
  slotId: string;
  label: string;
  durationMinutes: number;
  endsNextDay: boolean;
  valid: boolean;
  message: string | null;
};

export type ScheduleSnapshotSolver = {
  engine: OptimizerEngine | "unknown";
  solverStatus: CpSatSolveStatus | "unknown";
  runtimeMs: number | null;
  coverageProvenOptimal: boolean | null;
  fullLexicographicOptimality: boolean | null;
  hintDiagnostics: CpSatHintDiagnostics;
  previousAssignmentHintCount: number;
  warmStartHintCount: number;
  ignoredPreviousAssignmentHintCount: number;
  cpSatAttempt: CpSatAttemptTelemetry | null;
  fallbackReason: string | null;
};

export type CanonicalScheduleSnapshot = {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  runWarnings: ScheduleWarning[];
  activeAssignments: ScheduleAssignment[];
  uniqueActiveAssignments: ScheduleAssignment[];
  assignmentsBySlotId: Map<string, ScheduleAssignment[]>;
  assignmentBySlotId: Map<string, ScheduleAssignment>;
  warningsBySlotId: Map<string, ScheduleWarning[]>;
  duplicateActiveAssignments: ScheduleSnapshotDuplicateAssignment[];
  malformedTimeIssues: ScheduleSnapshotTimeIssue[];
  slotTimeById: Map<string, ScheduleSnapshotSlotTime>;
  totalSlots: number;
  activeAssignmentCount: number;
  uniqueAssignedSlotCount: number;
  filledSlots: number;
  unfilledSlots: ScheduleSlot[];
  unfilledSlotCount: number;
  coverageRate: number;
  hardIssueCount: number;
  lockedAssignmentCount: number;
  manualAssignmentCount: number;
  assignmentSourceCounts: Record<ScheduleAssignmentSource, number>;
  employeeAssignedMinutes: Map<string, number>;
  employeeAssignedHours: Map<string, number>;
  employeeShiftCount: Map<string, number>;
  validation: ScheduleValidationResult;
  validationStatus: "passed" | "failed";
  managerStatus: ManagerScheduleStatus;
  solver: ScheduleSnapshotSolver;
  evaluation: ScheduleEvaluationResult;
  invalidReasons: string[];
};

const emptyHintDiagnostics: CpSatHintDiagnostics = {
  received: 0,
  accepted: 0,
  ignored: 0
};

export function buildCanonicalScheduleSnapshot({
  run,
  scheduleSlots,
  scheduleAssignments,
  scheduleWarnings,
  employees,
  roles,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability = [],
  employeeTimeConstraints = [],
  timeOff,
  shiftTemplates,
  staffingRequirements,
  weekStartsOn = 1
}: {
  run: ScheduleRun;
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  scheduleWarnings: ScheduleWarning[];
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability?: EmployeeShiftAvailability[];
  employeeTimeConstraints?: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  weekStartsOn?: DayOfWeek;
}): CanonicalScheduleSnapshot {
  const runSlots = scheduleSlots
    .filter((slot) => slot.schedule_run_id === run.id)
    .sort(compareSlots);
  const runSlotIds = new Set(runSlots.map((slot) => slot.id));
  const runWarnings = scheduleWarnings.filter(
    (warning) => warning.schedule_run_id === run.id
  );
  const activeAssignments = scheduleAssignments
    .filter(
      (assignment) =>
        assignment.schedule_run_id === run.id &&
        assignment.status !== "cancelled" &&
        assignment.status !== "removed"
    )
    .sort(compareAssignments);
  const assignmentsBySlotId = groupAssignmentsBySlot(activeAssignments);
  const duplicateActiveAssignments = [...assignmentsBySlotId.entries()]
    .filter(([, assignments]) => assignments.length > 1)
    .map(([slotId, assignments]) => ({ slotId, assignments }));
  const duplicateSlotIds = new Set(
    duplicateActiveAssignments.map((duplicate) => duplicate.slotId)
  );
  const assignmentBySlotId = new Map<string, ScheduleAssignment>();

  for (const [slotId, assignments] of assignmentsBySlotId.entries()) {
    if (assignments.length === 1 && assignments[0]) {
      assignmentBySlotId.set(slotId, assignments[0]);
    }
  }

  const uniqueActiveAssignments = activeAssignments.filter(
    (assignment) =>
      runSlotIds.has(assignment.schedule_slot_id) &&
      !duplicateSlotIds.has(assignment.schedule_slot_id)
  );
  const uniqueAssignedSlotIds = new Set(
    uniqueActiveAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const slotTimeById = new Map<string, ScheduleSnapshotSlotTime>();
  const malformedTimeIssues: ScheduleSnapshotTimeIssue[] = [];

  for (const slot of runSlots) {
    const slotTime = buildSnapshotSlotTime(slot);
    slotTimeById.set(slot.id, slotTime);

    if (!slotTime.valid) {
      malformedTimeIssues.push({
        slotId: slot.id,
        date: slot.date,
        startTime: slot.start_time,
        endTime: slot.end_time,
        message: slotTime.message ?? "Invalid schedule slot time."
      });
    }
  }

  const data: SchedulerData = {
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    employeeTimeConstraints,
    staffingRequirements,
    timeOff,
    weekStartsOn
  };
  const validation = safeValidateSchedule({
    runSlots,
    activeAssignments,
    employees,
    data,
    malformedTimeIssues
  });
  const evaluation = safeEvaluateSchedule({
    run,
    runSlots,
    uniqueActiveAssignments,
    employees,
    roles,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    employeeTimeConstraints,
    timeOff,
    shiftTemplates,
    staffingRequirements,
    weekStartsOn,
    validation,
    malformedTimeIssues
  });
  const unfilledSlots = runSlots.filter(
    (slot) => !uniqueAssignedSlotIds.has(slot.id)
  );
  const employeeAssignedMinutes = new Map<string, number>();
  const employeeShiftCount = new Map<string, number>();

  for (const assignment of uniqueActiveAssignments) {
    const slotTime = slotTimeById.get(assignment.schedule_slot_id);
    if (!slotTime?.valid) {
      continue;
    }

    employeeAssignedMinutes.set(
      assignment.employee_id,
      (employeeAssignedMinutes.get(assignment.employee_id) ?? 0) +
        slotTime.durationMinutes
    );
    employeeShiftCount.set(
      assignment.employee_id,
      (employeeShiftCount.get(assignment.employee_id) ?? 0) + 1
    );
  }

  const employeeAssignedHours = new Map(
    [...employeeAssignedMinutes.entries()].map(([employeeId, minutes]) => [
      employeeId,
      minutes / 60
    ])
  );
  const invalidReasons = [
    ...duplicateActiveAssignments.map(
      (duplicate) =>
        `Slot ${duplicate.slotId} has ${duplicate.assignments.length} active assignments.`
    ),
    ...malformedTimeIssues.map((issue) => issue.message),
    ...(malformedTimeIssues.length > 0
      ? []
      : validation.violations.map((violation) => violation.message))
  ];
  const managerStatus = getSnapshotManagerStatus({
    validation,
    malformedTimeIssues,
    duplicateActiveAssignments,
    unfilledSlotCount: unfilledSlots.length
  });

  return {
    run,
    runSlots,
    runWarnings,
    activeAssignments,
    uniqueActiveAssignments,
    assignmentsBySlotId,
    assignmentBySlotId,
    warningsBySlotId: groupWarningsBySlot(runWarnings),
    duplicateActiveAssignments,
    malformedTimeIssues,
    slotTimeById,
    totalSlots: runSlots.length,
    activeAssignmentCount: activeAssignments.length,
    uniqueAssignedSlotCount: uniqueAssignedSlotIds.size,
    filledSlots: uniqueAssignedSlotIds.size,
    unfilledSlots,
    unfilledSlotCount: unfilledSlots.length,
    coverageRate:
      runSlots.length === 0 ? 1 : uniqueAssignedSlotIds.size / runSlots.length,
    hardIssueCount: invalidReasons.length,
    lockedAssignmentCount: activeAssignments.filter(
      (assignment) => assignment.is_locked === 1
    ).length,
    manualAssignmentCount: activeAssignments.filter(
      (assignment) =>
        assignment.is_manual_override === 1 || assignment.source === "manual"
    ).length,
    assignmentSourceCounts: countAssignmentSources(activeAssignments),
    employeeAssignedMinutes,
    employeeAssignedHours,
    employeeShiftCount,
    validation,
    validationStatus: invalidReasons.length === 0 ? "passed" : "failed",
    managerStatus,
    solver: parseSnapshotSolver(run.parameters_json),
    evaluation:
      invalidReasons.length > 0
        ? {
            ...evaluation,
            isValid: false,
            grade: "invalid",
            metrics: {
              ...evaluation.metrics,
              hardViolationCount: invalidReasons.length
            },
            hardViolations: invalidReasons.map((message) => ({
              severity: "critical",
              type: "snapshot_invalid",
              message
            }))
          }
        : evaluation,
    invalidReasons
  };
}

function buildSnapshotSlotTime(slot: ScheduleSlot): ScheduleSnapshotSlotTime {
  try {
    const interpretation = interpretTimeRange({
      startTime: slot.start_time,
      endTime: slot.end_time,
      allowEqualAsFullDay: false
    });

    return {
      slotId: slot.id,
      label: formatTimeRange({
        startTime: slot.start_time,
        endTime: slot.end_time,
        language: "en"
      }),
      durationMinutes: interpretation.durationMinutes,
      endsNextDay: interpretation.endsNextDay,
      valid: true,
      message: null
    };
  } catch (error) {
    return {
      slotId: slot.id,
      label: `${slot.start_time}-${slot.end_time}`,
      durationMinutes: 0,
      endsNextDay: false,
      valid: false,
      message: getErrorMessage(error)
    };
  }
}

function safeValidateSchedule({
  runSlots,
  activeAssignments,
  employees,
  data,
  malformedTimeIssues
}: {
  runSlots: ScheduleSlot[];
  activeAssignments: ScheduleAssignment[];
  employees: Employee[];
  data: SchedulerData;
  malformedTimeIssues: ScheduleSnapshotTimeIssue[];
}): ScheduleValidationResult {
  if (malformedTimeIssues.length > 0) {
    return {
      valid: false,
      violations: malformedTimeIssues.map((issue) => ({
        code: "INVALID_SHIFT_INTERVAL",
        message: issue.message,
        employeeId: "schedule",
        slotId: issue.slotId,
        metadata: {
          issue: "invalid_schedule_slot_time",
          date: issue.date,
          startTime: issue.startTime,
          endTime: issue.endTime
        }
      }))
    };
  }

  try {
    return validateScheduleHardConstraints({
      runSlots,
      assignments: activeAssignments,
      employees,
      data
    });
  } catch (error) {
    return {
      valid: false,
      violations: [
        {
          code: "INVALID_SHIFT_INTERVAL",
          message: getErrorMessage(error),
          employeeId: "schedule",
          slotId: runSlots[0]?.id ?? "run",
          metadata: {
            issue: "schedule_validation_failed"
          }
        }
      ]
    };
  }
}

function safeEvaluateSchedule({
  run,
  runSlots,
  uniqueActiveAssignments,
  employees,
  roles,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  employeeTimeConstraints,
  timeOff,
  shiftTemplates,
  staffingRequirements,
  weekStartsOn,
  validation,
  malformedTimeIssues
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  uniqueActiveAssignments: ScheduleAssignment[];
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  employeeTimeConstraints: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  weekStartsOn: DayOfWeek;
  validation: ScheduleValidationResult;
  malformedTimeIssues: ScheduleSnapshotTimeIssue[];
}): ScheduleEvaluationResult {
  if (malformedTimeIssues.length > 0) {
    return createInvalidEvaluation({
      totalSlots: runSlots.length,
      filledSlots: uniqueActiveAssignments.length,
      hardIssueCount: malformedTimeIssues.length,
      explanations: malformedTimeIssues.map((issue) => issue.message)
    });
  }

  try {
    return evaluateSchedule({
      run,
      slots: runSlots,
      assignments: uniqueActiveAssignments,
      employees,
      roles,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      employeeTimeConstraints,
      timeOff,
      staffingRequirements,
      shiftTemplates,
      weekStartsOn
    });
  } catch (error) {
    return createInvalidEvaluation({
      totalSlots: runSlots.length,
      filledSlots: uniqueActiveAssignments.length,
      hardIssueCount: Math.max(1, validation.violations.length),
      explanations: [getErrorMessage(error)]
    });
  }
}

function createInvalidEvaluation({
  totalSlots,
  filledSlots,
  hardIssueCount,
  explanations
}: {
  totalSlots: number;
  filledSlots: number;
  hardIssueCount: number;
  explanations: string[];
}): ScheduleEvaluationResult {
  const unfilledSlots = Math.max(0, totalSlots - filledSlots);
  const breakdown: ScheduleEvaluationBreakdown = {
    coverage: filledSlots * 1000 - unfilledSlots * 1000,
    hardConstraints: -hardIssueCount * 1_000_000,
    fairness: 0,
    contractFit: 0,
    preferences: 0,
    experienceBalance: 0,
    roleCoverage: 0,
    weekendBalance: 0,
    difficultShiftBalance: 0,
    stability: 0,
    penalties: 0,
    total: filledSlots * 1000 - unfilledSlots * 1000 - hardIssueCount * 1_000_000
  };

  return {
    isValid: false,
    reward: breakdown.total,
    grade: "invalid",
    hardViolations: explanations.map((message) => ({
      severity: "critical",
      type: "snapshot_invalid",
      message
    })),
    softWarnings: [],
    breakdown,
    metrics: {
      totalSlots,
      filledSlots,
      unfilledSlots,
      coverageRate: totalSlots === 0 ? 1 : filledSlots / totalSlots,
      hardViolationCount: hardIssueCount,
      warningCount: 0,
      averageHoursDeviation: 0,
      weekendDistributionRange: 0,
      difficultShiftDistributionRange: 0
    },
    explanations
  };
}

function getSnapshotManagerStatus({
  validation,
  malformedTimeIssues,
  duplicateActiveAssignments,
  unfilledSlotCount
}: {
  validation: ScheduleValidationResult;
  malformedTimeIssues: ScheduleSnapshotTimeIssue[];
  duplicateActiveAssignments: ScheduleSnapshotDuplicateAssignment[];
  unfilledSlotCount: number;
}): ManagerScheduleStatus {
  if (
    !validation.valid ||
    malformedTimeIssues.length > 0 ||
    duplicateActiveAssignments.length > 0
  ) {
    return "Invalid";
  }

  return unfilledSlotCount > 0 ? "Understaffed" : "Excellent";
}

function countAssignmentSources(
  assignments: ScheduleAssignment[]
): Record<ScheduleAssignmentSource, number> {
  const counts: Record<ScheduleAssignmentSource, number> = {
    automatic_cp_sat: 0,
    automatic_heuristic: 0,
    manual: 0,
    imported: 0,
    locked_manual: 0
  };

  for (const assignment of assignments) {
    counts[assignment.source] += 1;
  }

  return counts;
}

function groupAssignmentsBySlot(
  assignments: ScheduleAssignment[]
): Map<string, ScheduleAssignment[]> {
  const grouped = new Map<string, ScheduleAssignment[]>();

  for (const assignment of assignments) {
    grouped.set(assignment.schedule_slot_id, [
      ...(grouped.get(assignment.schedule_slot_id) ?? []),
      assignment
    ]);
  }

  return grouped;
}

function groupWarningsBySlot(
  warnings: ScheduleWarning[]
): Map<string, ScheduleWarning[]> {
  const grouped = new Map<string, ScheduleWarning[]>();

  for (const warning of warnings) {
    if (!warning.schedule_slot_id) {
      continue;
    }

    grouped.set(warning.schedule_slot_id, [
      ...(grouped.get(warning.schedule_slot_id) ?? []),
      warning
    ]);
  }

  return grouped;
}

function parseSnapshotSolver(parametersJson: string | null): ScheduleSnapshotSolver {
  const parameters = parseJsonObject(parametersJson);
  const solver = parseJsonObjectValue(parameters.solver);

  return {
    engine: getOptimizerEngine(solver.engine ?? parameters.optimizerEngine),
    solverStatus: getSolverStatus(solver.status),
    runtimeMs: getNullableNumber(solver.runtimeMs),
    coverageProvenOptimal: getNullableBoolean(solver.coverageProvenOptimal),
    fullLexicographicOptimality: getNullableBoolean(
      solver.fullLexicographicOptimality
    ),
    hintDiagnostics: getHintDiagnostics(solver.hintDiagnostics),
    previousAssignmentHintCount: getNumber(
      solver.previousAssignmentHintCount
    ),
    warmStartHintCount: getNumber(solver.warmStartHintCount),
    ignoredPreviousAssignmentHintCount: getNumber(
      solver.ignoredPreviousAssignmentHintCount
    ),
    cpSatAttempt: getCpSatAttemptTelemetry(solver.cpSatAttempt),
    fallbackReason: getNullableString(solver.fallbackReason)
  };
}

function getCpSatAttemptTelemetry(value: unknown): CpSatAttemptTelemetry | null {
  const attempt = parseJsonObjectValue(value);
  if (Object.keys(attempt).length === 0) {
    return null;
  }

  return {
    attempted: attempt.attempted === true,
    status: getSolverStatusOrNull(attempt.status),
    runtimeMs: getNullableNumber(attempt.runtimeMs),
    hintDiagnostics: getHintDiagnostics(attempt.hintDiagnostics),
    pythonVersion: getNullableString(attempt.pythonVersion),
    ortoolsVersion: getNullableString(attempt.ortoolsVersion),
    failureOrFallbackReason: getNullableString(attempt.failureOrFallbackReason)
  };
}

function getOptimizerEngine(value: unknown): ScheduleSnapshotSolver["engine"] {
  return value === "cp_sat" || value === "heuristic_fallback" ? value : "unknown";
}

function getSolverStatus(value: unknown): ScheduleSnapshotSolver["solverStatus"] {
  return getSolverStatusOrNull(value) ?? "unknown";
}

function getSolverStatusOrNull(value: unknown): CpSatSolveStatus | null {
  const statuses: CpSatSolveStatus[] = [
    "OPTIMAL",
    "FEASIBLE",
    "INFEASIBLE",
    "MODEL_INVALID",
    "UNKNOWN",
    "HEURISTIC_FALLBACK"
  ];

  return statuses.includes(value as CpSatSolveStatus)
    ? (value as CpSatSolveStatus)
    : null;
}

function getHintDiagnostics(value: unknown): CpSatHintDiagnostics {
  const diagnostics = parseJsonObjectValue(value);

  return {
    received: getNumber(diagnostics.received),
    accepted: getNumber(diagnostics.accepted),
    ignored: getNumber(diagnostics.ignored)
  };
}

function getNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getNullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) {
    return {};
  }

  try {
    return parseJsonObjectValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseJsonObjectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compareSlots(left: ScheduleSlot, right: ScheduleSlot): number {
  return (
    left.date.localeCompare(right.date) ||
    left.start_time.localeCompare(right.start_time) ||
    left.end_time.localeCompare(right.end_time) ||
    left.role_id.localeCompare(right.role_id) ||
    (left.slot_number ?? 0) - (right.slot_number ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function compareAssignments(
  left: ScheduleAssignment,
  right: ScheduleAssignment
): number {
  return (
    left.schedule_slot_id.localeCompare(right.schedule_slot_id) ||
    left.employee_id.localeCompare(right.employee_id) ||
    left.id.localeCompare(right.id)
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
