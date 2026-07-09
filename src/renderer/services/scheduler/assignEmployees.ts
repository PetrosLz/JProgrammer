import { databaseApi } from "../databaseApi";
import type {
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ShiftTemplate,
  StaffingRequirement,
  TimeOff
} from "../../types";
import {
  type AssignedShift,
  type ManualOverrideMap,
  type SchedulerData,
  buildAssignedShift,
  buildExistingAssignedShifts,
  checkHardConstraints,
  employeeHasRole,
  getAssignedDayCount,
  getAssignedHours,
  getContractDaysPerWeek,
  getContractHoursPerWeek,
  getDayConstraint,
  getEmployeeRoleExperienceLevel,
  getEmployeeShiftAvailability,
  getEmployeeWorkRules,
  getSlotDurationHours,
  getSlotExperiencedRequiredCount,
  getSlotMinimumExperienceLevel,
  getSlotShiftTemplateId,
  getNightShiftCount,
  getWeekendShiftCount,
  hasAssignmentOnDate,
  hasOverlappingShift,
  hasTimeOffOnDate,
  isNightOrDifficultShift,
  isWeekendDate
} from "./constraints";
import { buildAssignmentExplanation } from "./explanations";
import {
  compareSlotsByDifficulty,
  buildSlotDifficultyMap,
  type SlotDifficulty
} from "./difficulty";
import { buildSchedulerDiagnostics } from "./diagnostics";
import {
  buildScheduleFeasibilityAnalysis,
  type FeasibilityResult
} from "./feasibility";
import { getDayOfWeek } from "./generateSlots";
import {
  experienceLevelRank,
  experienceLevelToLabel,
  meetsMinimumExperience
} from "../../types";
import {
  scoreCandidate,
  scoreWeights,
  type CandidateScore,
  type CandidateScoringContext
} from "./scoring";
import {
  assessRoleGroupQuality,
  employeeCanLeadRole,
  employeePrefersRole,
  getEmployeeRoleExperience,
  getRoleGroupKey,
  getRoleGroupSlots
} from "./teamQuality";
import {
  type SchedulerWarningDraft,
  createNoSlotsWarning
} from "./warnings";
import {
  evaluateSchedule,
  type ScheduleEvaluationResult
} from "./evaluator";
import {
  defaultSchedulerOptimizationConfig,
  type OptimizationConfig
} from "./optimizationConfig";

export type AssignmentResult = {
  runId: string;
  totalSlots: number;
  alreadyAssignedSlots: number;
  attemptedSlots: number;
  assignedSlots: number;
  unfilledSlots: number;
  warningsCreated: number;
  explanations: string[];
  evaluation: ScheduleEvaluationResult;
};

export type InMemoryScheduleOptimizationResult = {
  runId: string;
  totalSlots: number;
  alreadyAssignedSlots: number;
  attemptedSlots: number;
  assignedSlots: number;
  unfilledSlots: number;
  assignments: ScheduleAssignment[];
  generatedAssignments: ScheduleAssignment[];
  warnings: SchedulerWarningDraft[];
  explanations: string[];
  evaluation: ScheduleEvaluationResult;
  selectedProfile: string | null;
  selectedScore: number;
  repairIterations: number;
};

type AssignmentCandidate = {
  employee: Employee;
  score: CandidateScore;
};

type AttemptProfileId =
  | "coverageFocused"
  | "rareRoleFocused"
  | "specialistFocused"
  | "experienceFocused"
  | "fairnessFocused"
  | "weekendFocused"
  | "baseline";

type AttemptProfile = {
  id: AttemptProfileId;
  label: string;
  candidateRankOffset: number;
  selectionWindow: number;
  coverageMultiplier: number;
  rareRoleMultiplier: number;
  specialistMultiplier: number;
  experienceMultiplier: number;
  fairnessMultiplier: number;
  weekendMultiplier: number;
};

type PlannedAssignment = {
  scheduleSlotId: string;
  employeeId: string;
  score: CandidateScore;
  explanation: string;
};

type CandidateSchedule = {
  profile: AttemptProfile;
  plannedAssignments: PlannedAssignment[];
  assignedShifts: AssignedShift[];
  unfilledSlots: ScheduleSlot[];
  score: number;
  scoreDetails: string[];
  explanations: string[];
  hardConstraintViolations: string[];
  repairIterations: number;
  evaluation: ScheduleEvaluationResult;
};

type FinalHardConstraintViolation = {
  assignmentId: string | null;
  slotId: string | null;
  message: string;
};

type SimulationState = {
  plannedAssignments: Map<string, PlannedAssignment>;
  assignedShifts: AssignedShift[];
  explanations: string[];
};

type RepairResult = {
  iterations: number;
  explanations: string[];
};

type RoleGroupCoverage = {
  groupKey: string;
  slots: ScheduleSlot[];
  assignedCount: number;
  requiredCount: number;
};

type EmployeeRotationHistory = {
  weekendAssignments: number;
  difficultAssignments: number;
  totalHours: number;
  dayKeys: Set<string>;
  assignmentKeys: Set<string>;
};

type RotationHistoryMap = Map<string, EmployeeRotationHistory>;

export async function assignEmployeesToRun({
  run,
  slots,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability = [],
  timeOff,
  assignments,
  roles = [],
  shiftTemplates = [],
  staffingRequirements = [],
  manualOverrides = {}
}: {
  run: ScheduleRun;
  slots: ScheduleSlot[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability?: EmployeeShiftAvailability[];
  timeOff: TimeOff[];
  assignments: ScheduleAssignment[];
  roles?: Role[];
  shiftTemplates?: ShiftTemplate[];
  staffingRequirements?: StaffingRequirement[];
  manualOverrides?: ManualOverrideMap;
}): Promise<AssignmentResult> {
  const runSlots = slots
    .filter((slot) => slot.schedule_run_id === run.id)
    .sort(compareSlots);
  let activeRunAssignments = assignments.filter(
    (assignment) =>
      assignment.schedule_run_id === run.id &&
      assignment.status !== "cancelled" &&
      assignment.status !== "removed"
  );
  const assignedSlotIds = new Set(
    activeRunAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const alreadyAssignedSlots = assignedSlotIds.size;
  const slotsToAssign = runSlots.filter(
    (slot) => slot.status !== "filled" && !assignedSlotIds.has(slot.id)
  );
  const data: SchedulerData = {
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    staffingRequirements,
    timeOff
  };
  const optimizationConfig = defaultSchedulerOptimizationConfig;
  const initialAssignedShifts: AssignedShift[] = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: activeRunAssignments
  });
  const activeEmployees = sortEmployees(employees).filter(
    (employee) => employee.is_active === 1
  );
  const rotationHistory = buildRotationHistory({
    run,
    slots,
    assignments,
    staffingRequirements
  });
  let warningsCreated = 0;

  if (slotsToAssign.length === 0) {
    await saveWarning(createNoSlotsWarning(run.id));
    const evaluation = evaluateSchedule({
      run,
      slots: runSlots,
      assignments: activeRunAssignments,
      employees,
      roles,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      timeOff,
      staffingRequirements,
      shiftTemplates,
      manualOverrides
    });
    await updateRunStatus(
      run,
      runSlots.length,
      assignedSlotIds.size,
      undefined,
      undefined,
      undefined,
      optimizationConfig,
      evaluation
    );

    return {
      runId: run.id,
      totalSlots: runSlots.length,
      alreadyAssignedSlots: assignedSlotIds.size,
      attemptedSlots: 0,
      assignedSlots: 0,
      unfilledSlots: Math.max(0, runSlots.length - assignedSlotIds.size),
      warningsCreated: 1,
      explanations: [],
      evaluation
    };
  }

  const diagnostics = buildSchedulerDiagnostics({
    slots: runSlots,
    employees,
    roles,
    data,
    assignedShifts: initialAssignedShifts,
    manualOverrides
  });
  const feasibility = buildScheduleFeasibilityAnalysis({
    slots: runSlots,
    employees,
    roles,
    shiftTemplates,
    data,
    assignedShifts: initialAssignedShifts,
    manualOverrides
  });

  for (const warning of createFeasibilityWarnings(run.id, feasibility)) {
    await saveWarning(warning);
    warningsCreated += 1;
  }

  for (const message of diagnostics.warnings) {
    await saveWarning({
      scheduleRunId: run.id,
      scheduleSlotId: null,
      scheduleAssignmentId: null,
      severity: "warning",
      warningType: "role_under_supplied",
      message
    });
    warningsCreated += 1;
  }

  const selectedSchedule = optimizeCandidateSchedules({
    run,
    runSlots,
    slotsToAssign,
    employees,
    roles,
    activeEmployees,
    data,
    initialAssignedShifts,
    fixedAssignments: activeRunAssignments,
    rotationHistory,
    manualOverrides,
    staffingRequirements,
    feasibility,
    optimizationConfig,
    shiftTemplates
  });
  const savedAssignments: ScheduleAssignment[] = [];

  for (const plannedAssignment of sortPlannedAssignments(
    selectedSchedule.plannedAssignments,
    runSlots
  )) {
    const slot = runSlots.find(
      (item) => item.id === plannedAssignment.scheduleSlotId
    );
    const employee = employees.find(
      (item) => item.id === plannedAssignment.employeeId
    );

    if (!slot || !employee) {
      continue;
    }

    const { assignment } = await saveAutomaticAssignment({
      run,
      slot,
      candidate: {
        employee,
        score: plannedAssignment.score
      },
      explanation: plannedAssignment.explanation
    });

    savedAssignments.push(assignment);
    assignedSlotIds.add(slot.id);
  }

  const finalAssignments = [...activeRunAssignments, ...savedAssignments];
  const finalAssignedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: finalAssignments
  });
  const finalHardConstraintViolations = validateFinalScheduleHardConstraints({
    runSlots,
    assignments: finalAssignments,
    employees,
    data,
    manualOverrides
  });
  const finalEvaluation = evaluateSchedule({
    run,
    slots: runSlots,
    assignments: finalAssignments,
    employees,
    roles,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    timeOff,
    staffingRequirements,
    shiftTemplates,
    manualOverrides
  });

  for (const violation of finalHardConstraintViolations) {
    await saveWarning({
      scheduleRunId: run.id,
      scheduleSlotId: violation.slotId,
      scheduleAssignmentId: violation.assignmentId,
      severity: "critical",
      warningType: "final_hard_constraint_violation",
      message: violation.message
    });
    warningsCreated += 1;
  }

  const coverageWarnings = createRoleGroupCoverageWarnings({
    runId: run.id,
    runSlots,
    assignedShifts: finalAssignedShifts,
    employees,
    data,
    roles,
    shiftTemplates,
    staffingRequirements,
    manualOverrides
  });

  for (const warning of coverageWarnings) {
    await saveWarning(warning);
    warningsCreated += 1;
  }

  const teamQualityWarnings = createTeamQualityWarnings({
    runId: run.id,
    runSlots,
    assignments: finalAssignments,
    employees,
    employeeRoles,
    roles,
    shiftTemplates,
    staffingRequirements
  });

  for (const warning of teamQualityWarnings) {
    await saveWarning(warning);
    warningsCreated += 1;
  }

  await updateRunStatus(
    run,
    runSlots.length,
    finalAssignments.filter(
      (assignment) =>
        assignment.status !== "cancelled" && assignment.status !== "removed"
    ).length,
    diagnostics,
    selectedSchedule,
    feasibility,
    optimizationConfig,
    finalEvaluation
  );

  if (finalHardConstraintViolations.length > 0) {
    await databaseApi.updateRecord("schedule_runs", run.id, {
      status: "needs_review"
    });
  }

  return {
    runId: run.id,
    totalSlots: runSlots.length,
    alreadyAssignedSlots,
    attemptedSlots: slotsToAssign.length,
    assignedSlots: savedAssignments.length,
    unfilledSlots: Math.max(0, runSlots.length - assignedSlotIds.size),
    warningsCreated,
    explanations: selectedSchedule.explanations,
    evaluation: finalEvaluation
  };
}

export function optimizeScheduleInMemory({
  run,
  slots,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability = [],
  timeOff,
  assignments,
  roles = [],
  shiftTemplates = [],
  staffingRequirements = [],
  manualOverrides = {}
}: {
  run: ScheduleRun;
  slots: ScheduleSlot[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability?: EmployeeShiftAvailability[];
  timeOff: TimeOff[];
  assignments: ScheduleAssignment[];
  roles?: Role[];
  shiftTemplates?: ShiftTemplate[];
  staffingRequirements?: StaffingRequirement[];
  manualOverrides?: ManualOverrideMap;
}): InMemoryScheduleOptimizationResult {
  const runSlots = slots
    .filter((slot) => slot.schedule_run_id === run.id)
    .sort(compareSlots);
  const activeRunAssignments = assignments.filter(
    (assignment) =>
      assignment.schedule_run_id === run.id &&
      assignment.status !== "cancelled" &&
      assignment.status !== "removed"
  );
  const assignedSlotIds = new Set(
    activeRunAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const alreadyAssignedSlots = assignedSlotIds.size;
  const slotsToAssign = runSlots.filter(
    (slot) => slot.status !== "filled" && !assignedSlotIds.has(slot.id)
  );
  const data: SchedulerData = {
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    staffingRequirements,
    timeOff
  };
  const initialAssignedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: activeRunAssignments
  });
  const activeEmployees = sortEmployees(employees).filter(
    (employee) => employee.is_active === 1
  );
  const rotationHistory = buildRotationHistory({
    run,
    slots,
    assignments,
    staffingRequirements
  });
  const optimizationConfig = defaultSchedulerOptimizationConfig;
  const warnings: SchedulerWarningDraft[] = [];

  if (slotsToAssign.length === 0) {
    warnings.push(createNoSlotsWarning(run.id));
    const evaluation = evaluateSchedule({
      run,
      slots: runSlots,
      assignments: activeRunAssignments,
      employees,
      roles,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      timeOff,
      staffingRequirements,
      shiftTemplates,
      manualOverrides
    });

    return {
      runId: run.id,
      totalSlots: runSlots.length,
      alreadyAssignedSlots,
      attemptedSlots: 0,
      assignedSlots: 0,
      unfilledSlots: Math.max(0, runSlots.length - assignedSlotIds.size),
      assignments: activeRunAssignments,
      generatedAssignments: [],
      warnings,
      explanations: [],
      evaluation,
      selectedProfile: null,
      selectedScore: evaluation.reward,
      repairIterations: 0
    };
  }

  const diagnostics = buildSchedulerDiagnostics({
    slots: runSlots,
    employees,
    roles,
    data,
    assignedShifts: initialAssignedShifts,
    manualOverrides
  });
  const feasibility = buildScheduleFeasibilityAnalysis({
    slots: runSlots,
    employees,
    roles,
    shiftTemplates,
    data,
    assignedShifts: initialAssignedShifts,
    manualOverrides
  });

  warnings.push(...createFeasibilityWarnings(run.id, feasibility));
  warnings.push(
    ...diagnostics.warnings.map(
      (message): SchedulerWarningDraft => ({
        scheduleRunId: run.id,
        scheduleSlotId: null,
        scheduleAssignmentId: null,
        severity: "warning",
        warningType: "role_under_supplied",
        message
      })
    )
  );

  const selectedSchedule = optimizeCandidateSchedules({
    run,
    runSlots,
    slotsToAssign,
    employees,
    roles,
    activeEmployees,
    data,
    initialAssignedShifts,
    fixedAssignments: activeRunAssignments,
    rotationHistory,
    manualOverrides,
    staffingRequirements,
    feasibility,
    optimizationConfig,
    shiftTemplates
  });
  const generatedAssignments = buildSyntheticAssignments({
    run,
    fixedAssignments: [],
    plannedAssignments: sortPlannedAssignments(
      selectedSchedule.plannedAssignments,
      runSlots
    )
  }).map((assignment, index) => ({
    ...assignment,
    id: `benchmark-${run.id}-${index}-${assignment.schedule_slot_id}`,
    notes:
      selectedSchedule.plannedAssignments.find(
        (plannedAssignment) =>
          plannedAssignment.scheduleSlotId === assignment.schedule_slot_id
      )?.explanation ?? assignment.notes
  }));
  const finalAssignments = [...activeRunAssignments, ...generatedAssignments];
  const finalAssignedSlotIds = new Set([
    ...assignedSlotIds,
    ...generatedAssignments.map((assignment) => assignment.schedule_slot_id)
  ]);
  const finalAssignedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: finalAssignments
  });
  const finalHardConstraintViolations = validateFinalScheduleHardConstraints({
    runSlots,
    assignments: finalAssignments,
    employees,
    data,
    manualOverrides
  });

  warnings.push(
    ...finalHardConstraintViolations.map(
      (violation): SchedulerWarningDraft => ({
        scheduleRunId: run.id,
        scheduleSlotId: violation.slotId,
        scheduleAssignmentId: violation.assignmentId,
        severity: "critical",
        warningType: "final_hard_constraint_violation",
        message: violation.message
      })
    )
  );
  warnings.push(
    ...createRoleGroupCoverageWarnings({
      runId: run.id,
      runSlots,
      assignedShifts: finalAssignedShifts,
      employees,
      data,
      roles,
      shiftTemplates,
      staffingRequirements,
      manualOverrides
    })
  );
  warnings.push(
    ...createTeamQualityWarnings({
      runId: run.id,
      runSlots,
      assignments: finalAssignments,
      employees,
      employeeRoles,
      roles,
      shiftTemplates,
      staffingRequirements
    })
  );

  const evaluation = evaluateSchedule({
    run,
    slots: runSlots,
    assignments: finalAssignments,
    employees,
    roles,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    timeOff,
    staffingRequirements,
    shiftTemplates,
    manualOverrides
  });

  return {
    runId: run.id,
    totalSlots: runSlots.length,
    alreadyAssignedSlots,
    attemptedSlots: slotsToAssign.length,
    assignedSlots: generatedAssignments.length,
    unfilledSlots: Math.max(0, runSlots.length - finalAssignedSlotIds.size),
    assignments: finalAssignments,
    generatedAssignments,
    warnings,
    explanations: selectedSchedule.explanations,
    evaluation,
    selectedProfile: selectedSchedule.profile.id,
    selectedScore: selectedSchedule.score,
    repairIterations: selectedSchedule.repairIterations
  };
}

async function saveAutomaticAssignment({
  run,
  slot,
  candidate,
  explanation: providedExplanation
}: {
  run: ScheduleRun;
  slot: ScheduleSlot;
  candidate: AssignmentCandidate;
  explanation?: string;
}): Promise<{ assignment: ScheduleAssignment; explanation: string }> {
  const explanation =
    providedExplanation ??
    buildAssignmentExplanation({
      employee: candidate.employee,
      slot,
      score: candidate.score
    });
  const assignment = await databaseApi.createRecord("schedule_assignments", {
    schedule_run_id: run.id,
    schedule_slot_id: slot.id,
    employee_id: candidate.employee.id,
    status: "assigned",
    is_manual_override: false,
    notes: explanation
  });

  await databaseApi.updateRecord("schedule_slots", slot.id, {
    status: "filled"
  });

  return { assignment, explanation };
}

function optimizeCandidateSchedules({
  run,
  runSlots,
  slotsToAssign,
  employees,
  roles,
  activeEmployees,
  data,
  initialAssignedShifts,
  fixedAssignments,
  rotationHistory,
  manualOverrides,
  staffingRequirements,
  feasibility,
  optimizationConfig,
  shiftTemplates
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  slotsToAssign: ScheduleSlot[];
  employees: Employee[];
  roles: Role[];
  activeEmployees: Employee[];
  data: SchedulerData;
  initialAssignedShifts: AssignedShift[];
  fixedAssignments: ScheduleAssignment[];
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  staffingRequirements: StaffingRequirement[];
  feasibility: FeasibilityResult;
  optimizationConfig: OptimizationConfig;
  shiftTemplates: ShiftTemplate[];
}): CandidateSchedule {
  const startedAt = Date.now();
  const deadlineMs = startedAt + optimizationConfig.timeBudgetMs;
  const profiles = buildAttemptProfiles(optimizationConfig.attempts);
  let bestSchedule: CandidateSchedule | null = null;

  for (const profile of profiles) {
    if (
      bestSchedule &&
      Date.now() >= deadlineMs
    ) {
      break;
    }

    const candidateSchedule = buildCandidateSchedule({
      run,
      runSlots,
      slotsToAssign,
      employees,
      roles,
      activeEmployees,
      data,
      initialAssignedShifts,
      fixedAssignments,
      rotationHistory,
      manualOverrides,
      staffingRequirements,
      profile,
      deadlineMs,
      feasibility,
      optimizationConfig,
      shiftTemplates
    });

    if (!bestSchedule || candidateSchedule.score > bestSchedule.score) {
      bestSchedule = candidateSchedule;
    }
  }

  return (
    bestSchedule ??
    scoreCandidateSchedule({
      run,
      runSlots,
      employees,
      roles,
      data,
      fixedAssignments,
      state: {
        plannedAssignments: new Map(),
        assignedShifts: initialAssignedShifts,
        explanations: []
      },
      staffingRequirements,
      manualOverrides,
      profile: profiles[0] ?? buildAttemptProfiles(1)[0],
      repairIterations: 0,
      rotationHistory,
      feasibility,
      shiftTemplates
    })
  );
}

function buildCandidateSchedule({
  run,
  runSlots,
  slotsToAssign,
  employees,
  roles,
  activeEmployees,
  data,
  initialAssignedShifts,
  fixedAssignments,
  rotationHistory,
  manualOverrides,
  staffingRequirements,
  profile,
  deadlineMs,
  feasibility,
  optimizationConfig,
  shiftTemplates
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  slotsToAssign: ScheduleSlot[];
  employees: Employee[];
  roles: Role[];
  activeEmployees: Employee[];
  data: SchedulerData;
  initialAssignedShifts: AssignedShift[];
  fixedAssignments: ScheduleAssignment[];
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  staffingRequirements: StaffingRequirement[];
  profile: AttemptProfile;
  deadlineMs: number;
  feasibility: FeasibilityResult;
  optimizationConfig: OptimizationConfig;
  shiftTemplates: ShiftTemplate[];
}): CandidateSchedule {
  const state: SimulationState = {
    plannedAssignments: new Map(),
    assignedShifts: [...initialAssignedShifts],
    explanations: []
  };
  let difficultyMap = buildSlotDifficultyMap({
    slots: slotsToAssign,
    employees,
    roles,
    data,
    assignedShifts: state.assignedShifts,
    allSlots: runSlots,
    staffingRequirements,
    manualOverrides
  });
  const baseCoverageSlots = getBaseCoverageSlots({
    slotsToAssign,
    runSlots,
    assignedShifts: state.assignedShifts,
    staffingRequirements,
    difficultyMap
  });

  for (const [slotIndex, slot] of baseCoverageSlots.entries()) {
    if (
      state.plannedAssignments.has(slot.id) ||
      getRoleGroupAssignedCount({
        slot,
        runSlots,
        assignedShifts: state.assignedShifts,
        staffingRequirements
      }) > 0
    ) {
      continue;
    }

    assignSlotInMemory({
      slot,
      slotIndex,
      orderedSlots: baseCoverageSlots,
      runSlots,
      activeEmployees,
      data,
      state,
      difficultyMap,
      rotationHistory,
      manualOverrides,
      profile
    });
  }

  const slotsRemainingAfterCoverage = slotsToAssign.filter(
    (slot) => !state.plannedAssignments.has(slot.id)
  );
  difficultyMap = buildSlotDifficultyMap({
    slots: slotsRemainingAfterCoverage,
    employees,
    roles,
    data,
    assignedShifts: state.assignedShifts,
    allSlots: runSlots,
    staffingRequirements,
    manualOverrides
  });
  const orderedSlots = [...slotsRemainingAfterCoverage].sort((left, right) =>
    compareSlotsByDifficulty(left, right, difficultyMap)
  );

  for (const [slotIndex, slot] of orderedSlots.entries()) {
    if (state.plannedAssignments.has(slot.id)) {
      continue;
    }

    assignSlotInMemory({
      slot,
      slotIndex,
      orderedSlots,
      runSlots,
      activeEmployees,
      data,
      state,
      difficultyMap,
      rotationHistory,
      manualOverrides,
      profile
    });
  }

  const repairResult = repairCandidateSchedule({
    run,
    runSlots,
    slotsToAssign,
    employees,
    roles,
    activeEmployees,
    data,
    fixedAssignments,
    state,
    rotationHistory,
    manualOverrides,
    staffingRequirements,
    profile,
    deadlineMs,
    feasibility,
    optimizationConfig,
    shiftTemplates
  });

  state.explanations.push(...repairResult.explanations);

  return scoreCandidateSchedule({
    run,
    runSlots,
    employees,
    roles,
    data,
    fixedAssignments,
    state,
    staffingRequirements,
    manualOverrides,
    profile,
    repairIterations: repairResult.iterations,
    rotationHistory,
    feasibility,
    shiftTemplates
  });
}

function assignSlotInMemory({
  slot,
  slotIndex,
  orderedSlots,
  runSlots,
  activeEmployees,
  data,
  state,
  difficultyMap,
  rotationHistory,
  manualOverrides,
  profile
}: {
  slot: ScheduleSlot;
  slotIndex: number;
  orderedSlots: ScheduleSlot[];
  runSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  state: SimulationState;
  difficultyMap: Map<string, SlotDifficulty>;
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  profile: AttemptProfile;
}): boolean {
  const candidates = buildCandidates({
    slot,
    slotIndex,
    orderedSlots,
    runSlots,
    activeEmployees,
    data,
    assignedShifts: state.assignedShifts,
    difficultyMap,
    rotationHistory,
    manualOverrides,
    profile
  });
  const bestCandidate = selectCandidateForAttempt({
    candidates,
    assignedShifts: state.assignedShifts,
    data,
    profile
  });

  if (!bestCandidate) {
    return false;
  }

  const explanation = buildAssignmentExplanation({
    employee: bestCandidate.employee,
    slot,
    score: bestCandidate.score
  });

  state.plannedAssignments.set(slot.id, {
    scheduleSlotId: slot.id,
    employeeId: bestCandidate.employee.id,
    score: bestCandidate.score,
    explanation
  });
  state.assignedShifts.push(buildAssignedShift(slot, bestCandidate.employee.id));
  state.explanations.push(explanation);
  return true;
}

function buildAttemptProfiles(attempts: number): AttemptProfile[] {
  const baseProfiles: AttemptProfile[] = [
    {
      id: "coverageFocused",
      label: "Coverage focused",
      candidateRankOffset: 0,
      selectionWindow: 70,
      coverageMultiplier: 1.45,
      rareRoleMultiplier: 1,
      specialistMultiplier: 1,
      experienceMultiplier: 1,
      fairnessMultiplier: 0.8,
      weekendMultiplier: 1
    },
    {
      id: "rareRoleFocused",
      label: "Rare role focused",
      candidateRankOffset: 0,
      selectionWindow: 80,
      coverageMultiplier: 1.15,
      rareRoleMultiplier: 1.55,
      specialistMultiplier: 1,
      experienceMultiplier: 1,
      fairnessMultiplier: 0.8,
      weekendMultiplier: 1.1
    },
    {
      id: "specialistFocused",
      label: "Specialist focused",
      candidateRankOffset: 0,
      selectionWindow: 80,
      coverageMultiplier: 1.1,
      rareRoleMultiplier: 1.15,
      specialistMultiplier: 1.6,
      experienceMultiplier: 1,
      fairnessMultiplier: 0.8,
      weekendMultiplier: 1
    },
    {
      id: "experienceFocused",
      label: "Experience focused",
      candidateRankOffset: 0,
      selectionWindow: 75,
      coverageMultiplier: 1.1,
      rareRoleMultiplier: 1,
      specialistMultiplier: 1,
      experienceMultiplier: 1.65,
      fairnessMultiplier: 0.75,
      weekendMultiplier: 1.1
    },
    {
      id: "fairnessFocused",
      label: "Fairness focused",
      candidateRankOffset: 0,
      selectionWindow: 65,
      coverageMultiplier: 1,
      rareRoleMultiplier: 0.9,
      specialistMultiplier: 0.9,
      experienceMultiplier: 0.9,
      fairnessMultiplier: 1.7,
      weekendMultiplier: 1
    },
    {
      id: "weekendFocused",
      label: "Weekend focused",
      candidateRankOffset: 0,
      selectionWindow: 80,
      coverageMultiplier: 1.25,
      rareRoleMultiplier: 1.15,
      specialistMultiplier: 1,
      experienceMultiplier: 1.2,
      fairnessMultiplier: 0.9,
      weekendMultiplier: 1.6
    },
    {
      id: "baseline",
      label: "Baseline",
      candidateRankOffset: 0,
      selectionWindow: 55,
      coverageMultiplier: 1,
      rareRoleMultiplier: 1,
      specialistMultiplier: 1,
      experienceMultiplier: 1,
      fairnessMultiplier: 1,
      weekendMultiplier: 1
    }
  ];
  const profiles: AttemptProfile[] = [];

  for (let index = 0; index < attempts; index += 1) {
    const profile = baseProfiles[index % baseProfiles.length];
    profiles.push({
      ...profile,
      candidateRankOffset: Math.floor(index / baseProfiles.length)
    });
  }

  return profiles;
}

function applyAttemptProfileToScore({
  score,
  context,
  slot,
  profile
}: {
  score: CandidateScore;
  context: CandidateScoringContext;
  slot: ScheduleSlot;
  profile: AttemptProfile;
}): CandidateScore {
  const details = [...score.details];
  let totalScore = score.totalScore;

  function add(label: string, points: number) {
    if (points === 0) {
      return;
    }

    totalScore += points;
    details.push({ label, points });
  }

  if (profile.coverageMultiplier !== 1 && context.roleGroupIsUncovered) {
    add(
      `${profile.label}: base coverage`,
      120 * (profile.coverageMultiplier - 1)
    );
  }

  if (profile.rareRoleMultiplier !== 1 && context.activeRoleEmployeeCount <= 3) {
    add(
      `${profile.label}: rare role`,
      90 * (profile.rareRoleMultiplier - 1)
    );
  }

  if (profile.specialistMultiplier !== 1) {
    if (context.candidateIsSpecialistForRole) {
      add(
        `${profile.label}: specialist`,
        80 * (profile.specialistMultiplier - 1)
      );
    } else if (context.specialistAvailableForRole) {
      add(
        `${profile.label}: preserve wildcard`,
        -70 * (profile.specialistMultiplier - 1)
      );
    }
  }

  if (profile.experienceMultiplier !== 1) {
    add(
      `${profile.label}: experience`,
      (context.roleExperienceRank - 1) * 45 * (profile.experienceMultiplier - 1)
    );

    if (
      context.roleGroupRequiredCount >= 2 &&
      context.roleGroupAssignedExperienceLevels.every(
        (level) => experienceLevelRank(level) < 2
      ) &&
      context.roleExperienceRank >= 2
    ) {
      add(
        `${profile.label}: group experience`,
        60 * (profile.experienceMultiplier - 1)
      );
    }
  }

  if (profile.fairnessMultiplier !== 1) {
    if (context.recentWeekendAssignments > context.averageRecentWeekendAssignments) {
      add(
        `${profile.label}: recent weekend fairness`,
        -35 * (profile.fairnessMultiplier - 1)
      );
    }

    if (
      context.recentDifficultAssignments >
      context.averageRecentDifficultAssignments
    ) {
      add(
        `${profile.label}: recent difficult fairness`,
        -25 * (profile.fairnessMultiplier - 1)
      );
    }
  }

  if (profile.weekendMultiplier !== 1 && isWeekendDate(slot.date)) {
    if (context.roleGroupIsUncovered) {
      add(
        `${profile.label}: weekend coverage`,
        120 * (profile.weekendMultiplier - 1)
      );
    }

    if (context.recentWeekendAssignments <= context.averageRecentWeekendAssignments) {
      add(
        `${profile.label}: weekend rotation`,
        35 * (profile.weekendMultiplier - 1)
      );
    }
  }

  return {
    ...score,
    totalScore,
    details
  };
}

function selectCandidateForAttempt({
  candidates,
  assignedShifts,
  data,
  profile
}: {
  candidates: AssignmentCandidate[];
  assignedShifts: AssignedShift[];
  data: SchedulerData;
  profile: AttemptProfile;
}): AssignmentCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const sortedCandidates = [...candidates].sort((left, right) =>
    compareCandidates(left, right, assignedShifts, data)
  );
  const bestScore = sortedCandidates[0].score.totalScore;
  const selectableCandidates = sortedCandidates.filter(
    (candidate) =>
      candidate.score.totalScore >= bestScore - profile.selectionWindow
  );
  const selectedIndex =
    profile.candidateRankOffset === 0
      ? 0
      : profile.candidateRankOffset % Math.max(1, selectableCandidates.length);

  return selectableCandidates[selectedIndex] ?? sortedCandidates[0];
}

function repairCandidateSchedule({
  run,
  runSlots,
  slotsToAssign,
  employees,
  roles,
  activeEmployees,
  data,
  fixedAssignments,
  state,
  rotationHistory,
  manualOverrides,
  staffingRequirements,
  profile,
  deadlineMs,
  feasibility,
  optimizationConfig,
  shiftTemplates
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  slotsToAssign: ScheduleSlot[];
  employees: Employee[];
  roles: Role[];
  activeEmployees: Employee[];
  data: SchedulerData;
  fixedAssignments: ScheduleAssignment[];
  state: SimulationState;
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  staffingRequirements: StaffingRequirement[];
  profile: AttemptProfile;
  deadlineMs: number;
  feasibility: FeasibilityResult;
  optimizationConfig: OptimizationConfig;
  shiftTemplates: ShiftTemplate[];
}): RepairResult {
  const explanations: string[] = [];
  let iterations = 0;

  while (
    iterations < optimizationConfig.maxRepairIterations &&
    Date.now() < deadlineMs
  ) {
    const currentScore = scoreCandidateSchedule({
      run,
      runSlots,
      employees,
      roles,
      data,
      fixedAssignments,
      state,
      rotationHistory,
      staffingRequirements,
      manualOverrides,
      profile,
      repairIterations: iterations,
      feasibility,
      shiftTemplates
    }).score;
    const moveRepair = findBestMoveRepair({
      run,
      runSlots,
      slotsToAssign,
      employees,
      roles,
      activeEmployees,
      data,
      fixedAssignments,
      state,
      rotationHistory,
      manualOverrides,
      staffingRequirements,
      profile,
      currentScore,
      feasibility,
      shiftTemplates
    });

    if (moveRepair) {
      applyRepairState(state, moveRepair.plannedAssignments, fixedAssignments, runSlots);
      explanations.push(moveRepair.explanation);
      iterations += 1;
      continue;
    }

    const replacementRepair = findBestReplacementRepair({
      run,
      runSlots,
      employees,
      roles,
      activeEmployees,
      data,
      fixedAssignments,
      state,
      rotationHistory,
      manualOverrides,
      staffingRequirements,
      profile,
      currentScore,
      feasibility,
      shiftTemplates
    });

    if (replacementRepair) {
      applyRepairState(
        state,
        replacementRepair.plannedAssignments,
        fixedAssignments,
        runSlots
      );
      explanations.push(replacementRepair.explanation);
      iterations += 1;
      continue;
    }

    const swapRepair = findBestSwapRepair({
      run,
      runSlots,
      employees,
      roles,
      data,
      fixedAssignments,
      state,
      rotationHistory,
      staffingRequirements,
      manualOverrides,
      profile,
      currentScore,
      feasibility,
      shiftTemplates
    });

    if (swapRepair) {
      applyRepairState(state, swapRepair.plannedAssignments, fixedAssignments, runSlots);
      explanations.push(swapRepair.explanation);
      iterations += 1;
      continue;
    }

    break;
  }

  return { iterations, explanations };
}

function findBestMoveRepair({
  run,
  runSlots,
  slotsToAssign,
  employees,
  roles,
  activeEmployees,
  data,
  fixedAssignments,
  state,
  rotationHistory,
  manualOverrides,
  staffingRequirements,
  profile,
  currentScore,
  feasibility,
  shiftTemplates
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  slotsToAssign: ScheduleSlot[];
  employees: Employee[];
  roles: Role[];
  activeEmployees: Employee[];
  data: SchedulerData;
  fixedAssignments: ScheduleAssignment[];
  state: SimulationState;
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  staffingRequirements: StaffingRequirement[];
  profile: AttemptProfile;
  currentScore: number;
  feasibility: FeasibilityResult;
  shiftTemplates: ShiftTemplate[];
}): { plannedAssignments: Map<string, PlannedAssignment>; score: number; explanation: string } | null {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const difficultyMap = buildSlotDifficultyMap({
    slots: runSlots,
    employees,
    roles,
    data,
    assignedShifts: state.assignedShifts,
    allSlots: runSlots,
    staffingRequirements,
    manualOverrides
  });
  const assignedSlotIds = new Set([
    ...fixedAssignments.map((assignment) => assignment.schedule_slot_id),
    ...state.plannedAssignments.keys()
  ]);
  const unfilledSlots = slotsToAssign
    .filter((slot) => !assignedSlotIds.has(slot.id))
    .sort((left, right) => compareSlotsByDifficulty(left, right, difficultyMap));
  let bestRepair: {
    plannedAssignments: Map<string, PlannedAssignment>;
    score: number;
    explanation: string;
  } | null = null;

  for (const targetSlot of unfilledSlots) {
    const targetDifficulty = difficultyMap.get(targetSlot.id)?.difficulty ?? 0;
    const movableAssignments = [...state.plannedAssignments.values()]
      .map((plannedAssignment) => ({
        plannedAssignment,
        slot: slotById.get(plannedAssignment.scheduleSlotId)
      }))
      .filter((item): item is { plannedAssignment: PlannedAssignment; slot: ScheduleSlot } =>
        Boolean(item.slot)
      )
      .sort(
        (left, right) =>
          (difficultyMap.get(left.slot.id)?.difficulty ?? 0) -
          (difficultyMap.get(right.slot.id)?.difficulty ?? 0)
      );

    for (const { plannedAssignment, slot: oldSlot } of movableAssignments) {
      const oldDifficulty = difficultyMap.get(oldSlot.id)?.difficulty ?? 0;

      if (oldDifficulty >= targetDifficulty) {
        continue;
      }

      const movedEmployee = employees.find(
        (employee) => employee.id === plannedAssignment.employeeId
      );

      if (!movedEmployee) {
        continue;
      }

      const withoutOld = clonePlannedAssignments(state.plannedAssignments);
      withoutOld.delete(oldSlot.id);
      const shiftsWithoutOld = buildAssignedShiftsForPlan({
        runSlots,
        fixedAssignments,
        plannedAssignments: withoutOld
      });

      if (
        !checkHardConstraints({
          employee: movedEmployee,
          slot: targetSlot,
          data,
          assignedShifts: shiftsWithoutOld,
          manualOverrides
        }).allowed
      ) {
        continue;
      }

      const movedScore = scoreCandidate({
        employee: movedEmployee,
        slot: targetSlot,
        data,
        assignedShifts: shiftsWithoutOld
      });
      const targetExplanation = `Repair: moved ${movedEmployee.first_name} ${movedEmployee.last_name} to harder uncovered slot ${targetSlot.date} ${targetSlot.start_time}-${targetSlot.end_time}.`;
      withoutOld.set(targetSlot.id, {
        scheduleSlotId: targetSlot.id,
        employeeId: movedEmployee.id,
        score: movedScore,
        explanation: targetExplanation
      });

      const stateWithMove: SimulationState = {
        plannedAssignments: withoutOld,
        assignedShifts: buildAssignedShiftsForPlan({
          runSlots,
          fixedAssignments,
          plannedAssignments: withoutOld
        }),
        explanations: state.explanations
      };
      const replacement = buildRepairReplacementAssignment({
        oldSlot,
        runSlots,
        activeEmployees,
        data,
        state: stateWithMove,
        difficultyMap,
        rotationHistory,
        manualOverrides,
        profile
      });
      const candidatePlans = [withoutOld];

      if (replacement) {
        const withReplacement = clonePlannedAssignments(withoutOld);
        withReplacement.set(oldSlot.id, replacement);
        candidatePlans.push(withReplacement);
      }

      for (const plannedAssignments of candidatePlans) {
        const candidateState: SimulationState = {
          plannedAssignments,
          assignedShifts: buildAssignedShiftsForPlan({
            runSlots,
            fixedAssignments,
            plannedAssignments
          }),
          explanations: state.explanations
        };
        const candidateScore = scoreCandidateSchedule({
          run,
          runSlots,
          employees,
          roles,
          data,
          fixedAssignments,
          state: candidateState,
          staffingRequirements,
          manualOverrides,
          profile,
          repairIterations: 0,
          rotationHistory,
          feasibility,
          shiftTemplates
        }).score;

        if (candidateScore <= currentScore || candidateScore <= (bestRepair?.score ?? -Infinity)) {
          continue;
        }

        bestRepair = {
          plannedAssignments,
          score: candidateScore,
          explanation: replacement
            ? `${targetExplanation} Refilled ${oldSlot.date} ${oldSlot.start_time}-${oldSlot.end_time}.`
            : `${targetExplanation} Left the lower-priority slot open because total coverage improved.`
        };
      }
    }
  }

  return bestRepair;
}

function buildRepairReplacementAssignment({
  oldSlot,
  runSlots,
  activeEmployees,
  data,
  state,
  difficultyMap,
  rotationHistory,
  manualOverrides,
  profile
}: {
  oldSlot: ScheduleSlot;
  runSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  state: SimulationState;
  difficultyMap: Map<string, SlotDifficulty>;
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  profile: AttemptProfile;
}): PlannedAssignment | null {
  const candidates = buildCandidates({
    slot: oldSlot,
    slotIndex: 0,
    orderedSlots: [oldSlot],
    runSlots,
    activeEmployees,
    data,
    assignedShifts: state.assignedShifts,
    difficultyMap,
    rotationHistory,
    manualOverrides,
    profile
  });
  const replacement = selectCandidateForAttempt({
    candidates,
    assignedShifts: state.assignedShifts,
    data,
    profile: { ...profile, candidateRankOffset: 0 }
  });

  if (!replacement) {
    return null;
  }

  return {
    scheduleSlotId: oldSlot.id,
    employeeId: replacement.employee.id,
    score: replacement.score,
    explanation: buildAssignmentExplanation({
      employee: replacement.employee,
      slot: oldSlot,
      score: replacement.score
    })
  };
}

function findBestReplacementRepair({
  run,
  runSlots,
  employees,
  roles,
  activeEmployees,
  data,
  fixedAssignments,
  state,
  rotationHistory,
  manualOverrides,
  staffingRequirements,
  profile,
  currentScore,
  feasibility,
  shiftTemplates
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  employees: Employee[];
  roles: Role[];
  activeEmployees: Employee[];
  data: SchedulerData;
  fixedAssignments: ScheduleAssignment[];
  state: SimulationState;
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  staffingRequirements: StaffingRequirement[];
  profile: AttemptProfile;
  currentScore: number;
  feasibility: FeasibilityResult;
  shiftTemplates: ShiftTemplate[];
}): { plannedAssignments: Map<string, PlannedAssignment>; score: number; explanation: string } | null {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const difficultyMap = buildSlotDifficultyMap({
    slots: runSlots,
    employees,
    roles,
    data,
    assignedShifts: state.assignedShifts,
    allSlots: runSlots,
    staffingRequirements,
    manualOverrides
  });
  let bestRepair: {
    plannedAssignments: Map<string, PlannedAssignment>;
    score: number;
    explanation: string;
  } | null = null;

  for (const plannedAssignment of state.plannedAssignments.values()) {
    const slot = slotById.get(plannedAssignment.scheduleSlotId);

    if (!slot) {
      continue;
    }

    const withoutCurrent = clonePlannedAssignments(state.plannedAssignments);
    withoutCurrent.delete(slot.id);
    const stateWithoutCurrent: SimulationState = {
      plannedAssignments: withoutCurrent,
      assignedShifts: buildAssignedShiftsForPlan({
        runSlots,
        fixedAssignments,
        plannedAssignments: withoutCurrent
      }),
      explanations: state.explanations
    };
    const candidates = buildCandidates({
      slot,
      slotIndex: 0,
      orderedSlots: [slot],
      runSlots,
      activeEmployees,
      data,
      assignedShifts: stateWithoutCurrent.assignedShifts,
      difficultyMap,
      rotationHistory,
      manualOverrides,
      profile
    }).filter((candidate) => candidate.employee.id !== plannedAssignment.employeeId);
    const replacement = selectCandidateForAttempt({
      candidates,
      assignedShifts: stateWithoutCurrent.assignedShifts,
      data,
      profile: { ...profile, candidateRankOffset: 0 }
    });

    if (!replacement) {
      continue;
    }

    const withReplacement = clonePlannedAssignments(withoutCurrent);
    withReplacement.set(slot.id, {
      scheduleSlotId: slot.id,
      employeeId: replacement.employee.id,
      score: replacement.score,
      explanation: buildAssignmentExplanation({
        employee: replacement.employee,
        slot,
        score: replacement.score
      })
    });
    const candidateState: SimulationState = {
      plannedAssignments: withReplacement,
      assignedShifts: buildAssignedShiftsForPlan({
        runSlots,
        fixedAssignments,
        plannedAssignments: withReplacement
      }),
      explanations: state.explanations
    };
    const candidateScore = scoreCandidateSchedule({
      run,
      runSlots,
      employees,
      roles,
      data,
      fixedAssignments,
      state: candidateState,
      staffingRequirements,
      manualOverrides,
      profile,
      repairIterations: 0,
      rotationHistory,
      feasibility,
      shiftTemplates
    }).score;

    if (candidateScore <= currentScore || candidateScore <= (bestRepair?.score ?? -Infinity)) {
      continue;
    }

    bestRepair = {
      plannedAssignments: withReplacement,
      score: candidateScore,
      explanation: `Repair: replaced assignment on ${slot.date} ${slot.start_time}-${slot.end_time} with ${replacement.employee.first_name} ${replacement.employee.last_name}.`
    };
  }

  return bestRepair;
}

function findBestSwapRepair({
  run,
  runSlots,
  employees,
  roles,
  data,
  fixedAssignments,
  state,
  rotationHistory,
  feasibility,
  staffingRequirements,
  manualOverrides,
  profile,
  currentScore,
  shiftTemplates
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  employees: Employee[];
  roles: Role[];
  data: SchedulerData;
  fixedAssignments: ScheduleAssignment[];
  state: SimulationState;
  rotationHistory: RotationHistoryMap;
  staffingRequirements: StaffingRequirement[];
  manualOverrides: ManualOverrideMap;
  profile: AttemptProfile;
  currentScore: number;
  feasibility: FeasibilityResult;
  shiftTemplates: ShiftTemplate[];
}): { plannedAssignments: Map<string, PlannedAssignment>; score: number; explanation: string } | null {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const plannedAssignments = [...state.plannedAssignments.values()];
  let bestRepair: {
    plannedAssignments: Map<string, PlannedAssignment>;
    score: number;
    explanation: string;
  } | null = null;

  for (let leftIndex = 0; leftIndex < plannedAssignments.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < plannedAssignments.length;
      rightIndex += 1
    ) {
      const left = plannedAssignments[leftIndex];
      const right = plannedAssignments[rightIndex];
      const leftSlot = slotById.get(left.scheduleSlotId);
      const rightSlot = slotById.get(right.scheduleSlotId);
      const leftEmployee = employees.find((employee) => employee.id === left.employeeId);
      const rightEmployee = employees.find((employee) => employee.id === right.employeeId);

      if (!leftSlot || !rightSlot || !leftEmployee || !rightEmployee) {
        continue;
      }

      const swappedPlans = clonePlannedAssignments(state.plannedAssignments);
      swappedPlans.delete(leftSlot.id);
      swappedPlans.delete(rightSlot.id);
      const shiftsWithoutBoth = buildAssignedShiftsForPlan({
        runSlots,
        fixedAssignments,
        plannedAssignments: swappedPlans
      });

      if (
        !checkHardConstraints({
          employee: leftEmployee,
          slot: rightSlot,
          data,
          assignedShifts: shiftsWithoutBoth,
          manualOverrides
        }).allowed
      ) {
        continue;
      }

      const withLeftMoved = [
        ...shiftsWithoutBoth,
        buildAssignedShift(rightSlot, leftEmployee.id)
      ];

      if (
        !checkHardConstraints({
          employee: rightEmployee,
          slot: leftSlot,
          data,
          assignedShifts: withLeftMoved,
          manualOverrides
        }).allowed
      ) {
        continue;
      }

      const leftScore = scoreCandidate({
        employee: rightEmployee,
        slot: leftSlot,
        data,
        assignedShifts: withLeftMoved
      });
      const rightScore = scoreCandidate({
        employee: leftEmployee,
        slot: rightSlot,
        data,
        assignedShifts: shiftsWithoutBoth
      });
      swappedPlans.set(leftSlot.id, {
        scheduleSlotId: leftSlot.id,
        employeeId: rightEmployee.id,
        score: leftScore,
        explanation: buildAssignmentExplanation({
          employee: rightEmployee,
          slot: leftSlot,
          score: leftScore
        })
      });
      swappedPlans.set(rightSlot.id, {
        scheduleSlotId: rightSlot.id,
        employeeId: leftEmployee.id,
        score: rightScore,
        explanation: buildAssignmentExplanation({
          employee: leftEmployee,
          slot: rightSlot,
          score: rightScore
        })
      });

      const candidateState: SimulationState = {
        plannedAssignments: swappedPlans,
        assignedShifts: buildAssignedShiftsForPlan({
          runSlots,
          fixedAssignments,
          plannedAssignments: swappedPlans
        }),
        explanations: state.explanations
      };
      const candidateScore = scoreCandidateSchedule({
        run,
        runSlots,
        employees,
        roles,
        data,
        fixedAssignments,
        state: candidateState,
        staffingRequirements,
        manualOverrides,
        profile,
        repairIterations: 0,
        rotationHistory,
        feasibility,
        shiftTemplates
      }).score;

      if (candidateScore <= currentScore || candidateScore <= (bestRepair?.score ?? -Infinity)) {
        continue;
      }

      bestRepair = {
        plannedAssignments: swappedPlans,
        score: candidateScore,
        explanation: `Repair: swapped ${leftEmployee.first_name} ${leftEmployee.last_name} and ${rightEmployee.first_name} ${rightEmployee.last_name} to improve the full schedule score.`
      };
    }
  }

  return bestRepair;
}

function scoreCandidateSchedule({
  run,
  runSlots,
  employees,
  roles,
  data,
  fixedAssignments,
  state,
  rotationHistory,
  feasibility,
  staffingRequirements,
  manualOverrides,
  profile,
  repairIterations,
  shiftTemplates
}: {
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  employees: Employee[];
  roles: Role[];
  data: SchedulerData;
  fixedAssignments: ScheduleAssignment[];
  state: SimulationState;
  rotationHistory?: RotationHistoryMap;
  feasibility?: FeasibilityResult;
  staffingRequirements: StaffingRequirement[];
  manualOverrides: ManualOverrideMap;
  profile: AttemptProfile;
  repairIterations: number;
  shiftTemplates: ShiftTemplate[];
}): CandidateSchedule {
  const plannedAssignments = [...state.plannedAssignments.values()];
  const syntheticAssignments = buildSyntheticAssignments({
    run,
    fixedAssignments,
    plannedAssignments
  });
  const runSlotIds = new Set(runSlots.map((slot) => slot.id));
  const filledSlotIds = new Set<string>(
    syntheticAssignments
      .filter(
        (assignment) =>
          runSlotIds.has(assignment.schedule_slot_id) &&
          assignment.status !== "cancelled" &&
          assignment.status !== "removed"
      )
      .map((assignment) => assignment.schedule_slot_id)
  );
  const unfilledSlots = runSlots.filter((slot) => !filledSlotIds.has(slot.id));
  const hardConstraintViolations = validateScheduleHardConstraints({
    runSlots,
    plannedAssignments,
    employees,
    data,
    fixedAssignments,
    manualOverrides
  });
  const evaluation = evaluateSchedule({
    run,
    slots: runSlots,
    assignments: syntheticAssignments,
    employees,
    roles,
    employeeRoles: data.employeeRoles,
    employeeWorkRules: data.employeeWorkRules,
    employeeDayConstraints: data.employeeDayConstraints,
    employeeShiftAvailability: data.employeeShiftAvailability ?? [],
    timeOff: data.timeOff,
    staffingRequirements,
    shiftTemplates,
    manualOverrides
  });
  const evaluationHardConstraintViolations = evaluation.hardViolations.map(
    (violation) => violation.message
  );
  const combinedHardConstraintViolations = [
    ...new Set([...hardConstraintViolations, ...evaluationHardConstraintViolations])
  ];

  return {
    profile,
    plannedAssignments,
    assignedShifts: state.assignedShifts,
    unfilledSlots,
    score: evaluation.reward,
    scoreDetails: formatEvaluationScoreDetails(evaluation),
    explanations: state.explanations,
    hardConstraintViolations: combinedHardConstraintViolations,
    repairIterations,
    evaluation
  };
}

function validateScheduleHardConstraints({
  runSlots,
  plannedAssignments,
  employees,
  data,
  fixedAssignments,
  manualOverrides
}: {
  runSlots: ScheduleSlot[];
  plannedAssignments: PlannedAssignment[];
  employees: Employee[];
  data: SchedulerData;
  fixedAssignments: ScheduleAssignment[];
  manualOverrides: ManualOverrideMap;
}): string[] {
  const violations: string[] = [];
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const fixedSlotIds = new Set(
    fixedAssignments
      .filter(
        (assignment) =>
          assignment.status !== "cancelled" && assignment.status !== "removed"
      )
      .map((assignment) => assignment.schedule_slot_id)
  );
  const plannedBySlotId = new Set<string>();

  for (const plannedAssignment of plannedAssignments) {
    if (plannedBySlotId.has(plannedAssignment.scheduleSlotId)) {
      violations.push(
        `Multiple automatic assignments planned for slot ${plannedAssignment.scheduleSlotId}.`
      );
    }

    plannedBySlotId.add(plannedAssignment.scheduleSlotId);

    if (fixedSlotIds.has(plannedAssignment.scheduleSlotId)) {
      violations.push(
        `Automatic assignment attempted to overwrite existing slot ${plannedAssignment.scheduleSlotId}.`
      );
    }
  }

  for (const plannedAssignment of plannedAssignments) {
    const slot = slotById.get(plannedAssignment.scheduleSlotId);
    const employee = employees.find(
      (item) => item.id === plannedAssignment.employeeId
    );

    if (!slot || !employee) {
      violations.push(
        `Automatic assignment references missing slot or employee (${plannedAssignment.scheduleSlotId}).`
      );
      continue;
    }

    const otherPlans = plannedAssignments.filter(
      (item) => item.scheduleSlotId !== plannedAssignment.scheduleSlotId
    );
    const assignedShiftsWithoutCurrent = buildAssignedShiftsForPlan({
      runSlots,
      fixedAssignments,
      plannedAssignments: new Map(
        otherPlans.map((item) => [item.scheduleSlotId, item])
      )
    });
    const hardConstraintResult = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts: assignedShiftsWithoutCurrent,
      manualOverrides
    });

    if (!hardConstraintResult.allowed) {
      violations.push(
        `${employee.first_name} ${employee.last_name} cannot be assigned to ${slot.date} ${slot.start_time}-${slot.end_time}: ${hardConstraintResult.reasons.join(" ")}`
      );
    }
  }

  return violations;
}

function validateFinalScheduleHardConstraints({
  runSlots,
  assignments,
  employees,
  data,
  manualOverrides
}: {
  runSlots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  employees: Employee[];
  data: SchedulerData;
  manualOverrides: ManualOverrideMap;
}): FinalHardConstraintViolation[] {
  const violations: FinalHardConstraintViolation[] = [];
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.status !== "cancelled" && assignment.status !== "removed"
  );
  const assignmentsBySlotId = new Map<string, ScheduleAssignment[]>();

  for (const assignment of activeAssignments) {
    const existing = assignmentsBySlotId.get(assignment.schedule_slot_id) ?? [];
    assignmentsBySlotId.set(assignment.schedule_slot_id, [...existing, assignment]);
  }

  for (const [slotId, slotAssignments] of assignmentsBySlotId.entries()) {
    if (slotAssignments.length > 1) {
      violations.push({
        assignmentId: null,
        slotId,
        message: `Critical validation issue: slot ${slotId} has ${slotAssignments.length} active assignments.`
      });
    }
  }

  for (const assignment of activeAssignments) {
    const slot = slotById.get(assignment.schedule_slot_id);
    const employee = employees.find(
      (item) => item.id === assignment.employee_id
    );

    if (!slot || !employee) {
      violations.push({
        assignmentId: assignment.id,
        slotId: assignment.schedule_slot_id,
        message: `Critical validation issue: assignment ${assignment.id} references a missing slot or employee.`
      });
      continue;
    }

    const otherAssignments = activeAssignments.filter(
      (item) => item.id !== assignment.id
    );
    const assignedShiftsWithoutCurrent = buildExistingAssignedShifts({
      slots: runSlots,
      assignments: otherAssignments
    });
    const hardConstraintResult = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts: assignedShiftsWithoutCurrent,
      manualOverrides
    });

    if (!hardConstraintResult.allowed) {
      violations.push({
        assignmentId: assignment.id,
        slotId: slot.id,
        message: `Σοβαρό θέμα ελέγχου: ${employee.first_name} ${
          employee.last_name
        } έχει ανατεθεί στις ${formatDayAndDate(slot.date)} ${
          slot.start_time
        }-${slot.end_time}, αλλά παραβιάζει κανόνες εργασίας: ${hardConstraintResult.reasons.join(
          " "
        )}`
      });
    }
  }

  return violations;
}

function buildSyntheticAssignments({
  run,
  fixedAssignments,
  plannedAssignments
}: {
  run: ScheduleRun;
  fixedAssignments: ScheduleAssignment[];
  plannedAssignments: PlannedAssignment[];
}): ScheduleAssignment[] {
  return [
    ...fixedAssignments,
    ...plannedAssignments.map(
      (plannedAssignment, index): ScheduleAssignment => ({
        id: `planned-${index}-${plannedAssignment.scheduleSlotId}`,
        schedule_run_id: run.id,
        schedule_slot_id: plannedAssignment.scheduleSlotId,
        employee_id: plannedAssignment.employeeId,
        status: "assigned",
        is_manual_override: 0,
        notes: plannedAssignment.explanation,
        created_at: "",
        updated_at: ""
      })
    )
  ];
}

function buildAssignedShiftsForPlan({
  runSlots,
  fixedAssignments,
  plannedAssignments
}: {
  runSlots: ScheduleSlot[];
  fixedAssignments: ScheduleAssignment[];
  plannedAssignments: Map<string, PlannedAssignment>;
}): AssignedShift[] {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const fixedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: fixedAssignments
  });
  const plannedShifts = [...plannedAssignments.values()].flatMap(
    (plannedAssignment) => {
      const slot = slotById.get(plannedAssignment.scheduleSlotId);

      return slot ? [buildAssignedShift(slot, plannedAssignment.employeeId)] : [];
    }
  );

  return [...fixedShifts, ...plannedShifts];
}

function applyRepairState(
  state: SimulationState,
  plannedAssignments: Map<string, PlannedAssignment>,
  fixedAssignments: ScheduleAssignment[],
  runSlots: ScheduleSlot[]
) {
  state.plannedAssignments = plannedAssignments;
  state.assignedShifts = buildAssignedShiftsForPlan({
    runSlots,
    fixedAssignments,
    plannedAssignments
  });
}

function clonePlannedAssignments(
  plannedAssignments: Map<string, PlannedAssignment>
): Map<string, PlannedAssignment> {
  return new Map(
    [...plannedAssignments.entries()].map(([slotId, plannedAssignment]) => [
      slotId,
      { ...plannedAssignment }
    ])
  );
}

function sortPlannedAssignments(
  plannedAssignments: PlannedAssignment[],
  runSlots: ScheduleSlot[]
): PlannedAssignment[] {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));

  return [...plannedAssignments].sort((left, right) => {
    const leftSlot = slotById.get(left.scheduleSlotId);
    const rightSlot = slotById.get(right.scheduleSlotId);

    if (!leftSlot || !rightSlot) {
      return left.scheduleSlotId.localeCompare(right.scheduleSlotId);
    }

    return compareSlots(leftSlot, rightSlot);
  });
}

function getRange(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.max(...values) - Math.min(...values);
}

function formatSignedScore(value: number): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatEvaluationScoreDetails(
  evaluation: ScheduleEvaluationResult
): string[] {
  return Object.entries(evaluation.breakdown)
    .filter(([key, value]) => key !== "total" && value !== 0)
    .map(([key, value]) => `${key}: ${formatSignedScore(value)}`);
}



function getBaseCoverageSlots({
  slotsToAssign,
  runSlots,
  assignedShifts,
  staffingRequirements,
  difficultyMap
}: {
  slotsToAssign: ScheduleSlot[];
  runSlots: ScheduleSlot[];
  assignedShifts: AssignedShift[];
  staffingRequirements: StaffingRequirement[];
  difficultyMap: Map<string, SlotDifficulty>;
}): ScheduleSlot[] {
  const unassignedSlotsByGroup = groupSlotsByRoleGroup(
    slotsToAssign,
    staffingRequirements
  );
  const coverageGroups = buildRoleGroupCoverage({
    slots: runSlots,
    assignedShifts,
    staffingRequirements
  });

  return coverageGroups
    .filter((group) => group.requiredCount > 0 && group.assignedCount === 0)
    .flatMap((group) => {
      const unassignedGroupSlots = unassignedSlotsByGroup.get(group.groupKey) ?? [];

      if (unassignedGroupSlots.length === 0) {
        return [];
      }

      return [
        [...unassignedGroupSlots].sort((left, right) =>
          compareSlotsByDifficulty(left, right, difficultyMap)
        )[0]
      ];
    })
    .sort((left, right) => {
      const leftGroup = coverageGroups.find(
        (group) => group.groupKey === getRoleGroupKey(left, staffingRequirements)
      );
      const rightGroup = coverageGroups.find(
        (group) => group.groupKey === getRoleGroupKey(right, staffingRequirements)
      );

      return (
        compareSlotsByDifficulty(left, right, difficultyMap) ||
        (rightGroup?.requiredCount ?? 0) - (leftGroup?.requiredCount ?? 0) ||
        left.date.localeCompare(right.date) ||
        left.start_time.localeCompare(right.start_time) ||
        left.role_id.localeCompare(right.role_id)
      );
    });
}

function buildRoleGroupCoverage({
  slots,
  assignedShifts,
  staffingRequirements
}: {
  slots: ScheduleSlot[];
  assignedShifts: AssignedShift[];
  staffingRequirements: StaffingRequirement[];
}): RoleGroupCoverage[] {
  const slotsByGroup = groupSlotsByRoleGroup(slots, staffingRequirements);

  return [...slotsByGroup.entries()].map(([groupKey, groupSlots]) => {
    const groupSlotIds = new Set(groupSlots.map((slot) => slot.id));
    const assignedCount = assignedShifts.filter((assignedShift) =>
      groupSlotIds.has(assignedShift.slotId)
    ).length;

    return {
      groupKey,
      slots: groupSlots,
      assignedCount,
      requiredCount: groupSlots.length
    };
  });
}

function groupSlotsByRoleGroup(
  slots: ScheduleSlot[],
  staffingRequirements: StaffingRequirement[]
): Map<string, ScheduleSlot[]> {
  const groups = new Map<string, ScheduleSlot[]>();

  for (const slot of slots) {
    const groupKey = getRoleGroupKey(slot, staffingRequirements);
    const existingSlots = groups.get(groupKey) ?? [];
    groups.set(groupKey, [...existingSlots, slot]);
  }

  return groups;
}

function getRoleGroupAssignedCount({
  slot,
  runSlots,
  assignedShifts,
  staffingRequirements
}: {
  slot: ScheduleSlot;
  runSlots: ScheduleSlot[];
  assignedShifts: AssignedShift[];
  staffingRequirements: StaffingRequirement[];
}): number {
  const groupSlots = getRoleGroupSlots({ slot, slots: runSlots, staffingRequirements });
  const groupSlotIds = new Set(groupSlots.map((groupSlot) => groupSlot.id));

  return assignedShifts.filter((assignedShift) =>
    groupSlotIds.has(assignedShift.slotId)
  ).length;
}

function buildCandidates({
  slot,
  slotIndex,
  orderedSlots,
  runSlots,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap,
  rotationHistory,
  manualOverrides,
  profile
}: {
  slot: ScheduleSlot;
  slotIndex: number;
  orderedSlots: ScheduleSlot[];
  runSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
  profile: AttemptProfile;
}): AssignmentCandidate[] {
  const candidates: AssignmentCandidate[] = [];

  for (const employee of activeEmployees) {
    const hardConstraintResult = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts,
      manualOverrides
    });

    if (!hardConstraintResult.allowed) {
      continue;
    }

    const context = buildScoringContext({
      employee,
      slot,
      slotIndex,
      orderedSlots,
      runSlots,
      activeEmployees,
      data,
      assignedShifts,
      difficultyMap,
      rotationHistory,
      manualOverrides
    });
    const baseScore = scoreCandidate({
      employee,
      slot,
      data,
      assignedShifts,
      context
    });

    candidates.push({
      employee,
      score: applyAttemptProfileToScore({
        score: baseScore,
        context,
        slot,
        profile
      })
    });
  }

  return candidates;
}

function buildScoringContext({
  employee,
  slot,
  slotIndex,
  orderedSlots,
  runSlots,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap,
  rotationHistory,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  slotIndex: number;
  orderedSlots: ScheduleSlot[];
  runSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  rotationHistory: RotationHistoryMap;
  manualOverrides: ManualOverrideMap;
}): CandidateScoringContext {
  const divisor = Math.max(1, activeEmployees.length);
  const totalHours = activeEmployees.reduce(
    (sum, item) => sum + getAssignedHours(item.id, assignedShifts),
    0
  );
  const totalDays = activeEmployees.reduce(
    (sum, item) => sum + getAssignedDayCount(item.id, assignedShifts),
    0
  );
  const totalWeekendAssignments = activeEmployees.reduce(
    (sum, item) => sum + getWeekendShiftCount(item.id, assignedShifts),
    0
  );
  const totalDifficultAssignments = activeEmployees.reduce(
    (sum, item) => sum + getNightShiftCount(item.id, assignedShifts),
    0
  );
  const totalRecentWeekendAssignments = activeEmployees.reduce(
    (sum, item) =>
      sum + getRotationHistoryForEmployee(item.id, rotationHistory).weekendAssignments,
    0
  );
  const totalRecentDifficultAssignments = activeEmployees.reduce(
    (sum, item) =>
      sum + getRotationHistoryForEmployee(item.id, rotationHistory).difficultAssignments,
    0
  );

  const slotDifficulty = difficultyMap.get(slot.id);
  const roleExperienceLevel = getEmployeeRoleExperience(
    employee.id,
    slot.role_id,
    data.employeeRoles
  );
  const roleFlexibility = getEmployeeRoleFlexibility(
    employee.id,
    data.employeeRoles
  );
  const employeeRotationHistory = getRotationHistoryForEmployee(
    employee.id,
    rotationHistory
  );
  const activeRoleEmployeeCount =
    slotDifficulty?.activeRoleEmployeeCount ??
    getActiveEmployeeCountForRole(slot.role_id, activeEmployees, data.employeeRoles);
  const slotHardCandidateCount =
    slotDifficulty?.candidateCount ??
    activeEmployees.filter((candidate) =>
      checkHardConstraints({
        employee: candidate,
        slot,
        data,
        assignedShifts,
        manualOverrides
      }).allowed
    ).length;
  const groupSlots = getRoleGroupSlots({
    slot,
    slots: runSlots,
    staffingRequirements: data.staffingRequirements ?? []
  });
  const groupSlotIds = new Set(groupSlots.map((groupSlot) => groupSlot.id));
  const roleGroupAssignedEmployeeIds = assignedShifts
    .filter((assignedShift) => groupSlotIds.has(assignedShift.slotId))
    .map((assignedShift) => assignedShift.employeeId);
  const roleGroupAssignedCount = roleGroupAssignedEmployeeIds.length;
  const roleGroupAssignedExperienceLevels = roleGroupAssignedEmployeeIds.map(
    (employeeId) =>
      getEmployeeRoleExperience(employeeId, slot.role_id, data.employeeRoles)
  );
  const roleGroupHasLead = roleGroupAssignedEmployeeIds.some((employeeId) =>
    employeeCanLeadRole(employeeId, slot.role_id, data.employeeRoles)
  );

  return {
    averageAssignedHours: totalHours / divisor,
    averageAssignedDays: totalDays / divisor,
    averageWeekendAssignments: totalWeekendAssignments / divisor,
    averageDifficultAssignments: totalDifficultAssignments / divisor,
    averageRecentWeekendAssignments: totalRecentWeekendAssignments / divisor,
    averageRecentDifficultAssignments: totalRecentDifficultAssignments / divisor,
    roleExperienceLevel,
    roleExperienceRank: experienceLevelRank(roleExperienceLevel),
    candidateCanLeadRole: employeeCanLeadRole(
      employee.id,
      slot.role_id,
      data.employeeRoles
    ),
    candidatePrefersRole: employeePrefersRole(
      employee.id,
      slot.role_id,
      data.employeeRoles
    ),
    roleFlexibility,
    candidateIsSpecialistForRole: roleFlexibility === 1,
    specialistAvailableForRole: hasSpecialistCandidateForRole({
      employee,
      slot,
      activeEmployees,
      data,
      assignedShifts,
      manualOverrides
    }),
    activeRoleEmployeeCount,
    slotHardCandidateCount,
    roleGroupRequiredCount: groupSlots.length,
    roleGroupAssignedCount,
    roleGroupIsUncovered: roleGroupAssignedCount === 0,
    sameDaySameRoleUncoveredGroupCount: getSameDaySameRoleUncoveredGroupCount({
      slot,
      runSlots,
      assignedShifts,
      staffingRequirements: data.staffingRequirements ?? []
    }),
    roleGroupAssignedExperienceLevels,
    experiencedRequiredCount: getSlotExperiencedRequiredCount(
      slot,
      data.staffingRequirements ?? []
    ),
    roleGroupHasLead,
    strongerCandidateAvailableForGroup: hasStrongerCandidateForRoleGroup({
      employee,
      slot,
      activeEmployees,
      data,
      assignedShifts,
      manualOverrides
    }),
    highExperienceScarcityPenalty: getHighExperienceScarcityPenalty({
      employee,
      slot,
      futureSlots: orderedSlots.slice(slotIndex + 1),
      activeEmployees,
      data,
      assignedShifts,
      difficultyMap,
      runSlots,
      manualOverrides
    }),
    coverageScarcityPenalty: getCoverageScarcityPenalty({
      employee,
      slot,
      activeEmployees,
      data,
      assignedShifts,
      runSlots,
      manualOverrides
    }),
    rareRoleCapacityPenalty: getRareRoleCapacityPenalty({
      employee,
      slot,
      futureSlots: orderedSlots.slice(slotIndex + 1),
      activeEmployees,
      data,
      assignedShifts,
      difficultyMap,
      manualOverrides
    }),
    wildcardPreservationPenalty: getWildcardPreservationPenalty({
      employee,
      slot,
      futureSlots: orderedSlots.slice(slotIndex + 1),
      activeEmployees,
      data,
      assignedShifts,
      difficultyMap,
      manualOverrides
    }),
    recentWeekendAssignments: employeeRotationHistory.weekendAssignments,
    recentDifficultAssignments: employeeRotationHistory.difficultAssignments,
    recentSameAssignment: employeeRotationHistory.assignmentKeys.has(
      buildRotationAssignmentKey(slot, data.staffingRequirements ?? [])
    ),
    scarcityPenalty: getFutureScarcityPenalty({
      employee,
      slot,
      futureSlots: orderedSlots.slice(slotIndex + 1),
      activeEmployees,
      data,
      assignedShifts,
      difficultyMap,
      manualOverrides
    })
  };
}

function hasStrongerCandidateForRoleGroup({
  employee,
  slot,
  activeEmployees,
  data,
  assignedShifts,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  manualOverrides: ManualOverrideMap;
}): boolean {
  return activeEmployees.some(
    (candidate) =>
      candidate.id !== employee.id &&
      experienceLevelRank(
        getEmployeeRoleExperience(candidate.id, slot.role_id, data.employeeRoles)
      ) >
        experienceLevelRank(
          getEmployeeRoleExperience(employee.id, slot.role_id, data.employeeRoles)
        ) &&
      checkHardConstraints({
        employee: candidate,
        slot,
        data,
        assignedShifts,
        manualOverrides
      }).allowed
  );
}

function getEmployeeRoleIds(
  employeeId: string,
  employeeRoles: EmployeeRole[]
): string[] {
  return [
    ...new Set(
      employeeRoles
        .filter((employeeRole) => employeeRole.employee_id === employeeId)
        .map((employeeRole) => employeeRole.role_id)
    )
  ];
}

function getEmployeeRoleFlexibility(
  employeeId: string,
  employeeRoles: EmployeeRole[]
): number {
  return getEmployeeRoleIds(employeeId, employeeRoles).length;
}

function getActiveEmployeeCountForRole(
  roleId: string,
  activeEmployees: Employee[],
  employeeRoles: EmployeeRole[]
): number {
  return activeEmployees.filter((employee) =>
    employeeHasRole(employee.id, roleId, employeeRoles)
  ).length;
}

function hasSpecialistCandidateForRole({
  employee,
  slot,
  activeEmployees,
  data,
  assignedShifts,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  manualOverrides: ManualOverrideMap;
}): boolean {
  return activeEmployees.some(
    (candidate) =>
      candidate.id !== employee.id &&
      getEmployeeRoleFlexibility(candidate.id, data.employeeRoles) === 1 &&
      employeeHasRole(candidate.id, slot.role_id, data.employeeRoles) &&
      checkHardConstraints({
        employee: candidate,
        slot,
        data,
        assignedShifts,
        manualOverrides
      }).allowed
  );
}

function getRareRoleCapacityPenalty({
  employee,
  slot,
  futureSlots,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  futureSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  manualOverrides: ManualOverrideMap;
}): number {
  const roleFlexibility = getEmployeeRoleFlexibility(employee.id, data.employeeRoles);

  if (roleFlexibility <= 1) {
    return 0;
  }

  const currentRoleEmployeeCount = getActiveEmployeeCountForRole(
    slot.role_id,
    activeEmployees,
    data.employeeRoles
  );
  const currentDifficulty = difficultyMap.get(slot.id)?.difficulty ?? 0;

  if (currentRoleEmployeeCount <= 3 || currentDifficulty >= 500) {
    return 0;
  }

  const futureCriticalSlots = countFutureCriticalSlotsCandidateCanCover({
    employee,
    slot,
    futureSlots: futureSlots.filter(
      (futureSlot) => futureSlot.role_id !== slot.role_id
    ),
    activeEmployees,
    data,
    assignedShifts,
    difficultyMap,
    manualOverrides
  });

  if (futureCriticalSlots === 0) {
    return 0;
  }

  return futureCriticalSlots > 1
    ? scoreWeights.preserveRareRoleCapacity * 1.5
    : scoreWeights.preserveRareRoleCapacity;
}

function getWildcardPreservationPenalty({
  employee,
  slot,
  futureSlots,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  futureSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  manualOverrides: ManualOverrideMap;
}): number {
  const roleFlexibility = getEmployeeRoleFlexibility(employee.id, data.employeeRoles);
  const currentDifficulty = difficultyMap.get(slot.id)?.difficulty ?? 0;

  if (roleFlexibility < 3 || currentDifficulty >= 500) {
    return 0;
  }

  const futureCriticalSlots = countFutureCriticalSlotsCandidateCanCover({
    employee,
    slot,
    futureSlots,
    activeEmployees,
    data,
    assignedShifts,
    difficultyMap,
    manualOverrides
  });

  return futureCriticalSlots > 0 ? scoreWeights.preserveFlexibleWildcard : 0;
}

function countFutureCriticalSlotsCandidateCanCover({
  employee,
  slot,
  futureSlots,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  futureSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  manualOverrides: ManualOverrideMap;
}): number {
  const projectedShifts = [...assignedShifts, buildAssignedShift(slot, employee.id)];

  return futureSlots.filter((futureSlot) => {
    const futureDifficulty = difficultyMap.get(futureSlot.id);
    const activeRoleEmployeeCount =
      futureDifficulty?.activeRoleEmployeeCount ??
      getActiveEmployeeCountForRole(
        futureSlot.role_id,
        activeEmployees,
        data.employeeRoles
      );
    const candidateCount = futureDifficulty?.candidateCount ?? activeEmployees.length;
    const isCriticalFutureSlot =
      (futureDifficulty?.difficulty ?? 0) >= 250 ||
      candidateCount <= 2 ||
      activeRoleEmployeeCount <= 3 ||
      isWeekendDate(futureSlot.date);

    if (!isCriticalFutureSlot) {
      return false;
    }

    return checkHardConstraints({
      employee,
      slot: futureSlot,
      data,
      assignedShifts: projectedShifts,
      manualOverrides
    }).allowed;
  }).length;
}

function getSameDaySameRoleUncoveredGroupCount({
  slot,
  runSlots,
  assignedShifts,
  staffingRequirements
}: {
  slot: ScheduleSlot;
  runSlots: ScheduleSlot[];
  assignedShifts: AssignedShift[];
  staffingRequirements: StaffingRequirement[];
}): number {
  const currentGroupKey = getRoleGroupKey(slot, staffingRequirements);
  const groups = buildRoleGroupCoverage({
    slots: runSlots.filter(
      (candidateSlot) =>
        candidateSlot.date === slot.date && candidateSlot.role_id === slot.role_id
    ),
    assignedShifts,
    staffingRequirements
  });

  return groups.filter(
    (group) => group.groupKey !== currentGroupKey && group.assignedCount === 0
  ).length;
}

function getCoverageScarcityPenalty({
  employee,
  slot,
  activeEmployees,
  data,
  assignedShifts,
  runSlots,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  runSlots: ScheduleSlot[];
  manualOverrides: ManualOverrideMap;
}): number {
  const staffingRequirements = data.staffingRequirements ?? [];
  const currentGroupKey = getRoleGroupKey(slot, staffingRequirements);
  const currentGroupAssignedCount = getRoleGroupAssignedCount({
    slot,
    runSlots,
    assignedShifts,
    staffingRequirements
  });

  if (currentGroupAssignedCount === 0) {
    return 0;
  }

  const sameDaySameRoleGroups = buildRoleGroupCoverage({
    slots: runSlots.filter(
      (candidateSlot) =>
        candidateSlot.date === slot.date && candidateSlot.role_id === slot.role_id
    ),
    assignedShifts,
    staffingRequirements
  }).filter(
    (group) => group.groupKey !== currentGroupKey && group.assignedCount === 0
  );

  for (const group of sameDaySameRoleGroups) {
    const representativeSlot = group.slots[0];

    if (!representativeSlot) {
      continue;
    }

    const employeeCanCoverUncoveredGroup = checkHardConstraints({
      employee,
      slot: representativeSlot,
      data,
      assignedShifts,
      manualOverrides
    }).allowed;

    if (!employeeCanCoverUncoveredGroup) {
      continue;
    }

    const candidateCount = activeEmployees.filter((candidate) =>
      checkHardConstraints({
        employee: candidate,
        slot: representativeSlot,
        data,
        assignedShifts,
        manualOverrides
      }).allowed
    ).length;

    if (candidateCount <= 1) {
      return scoreWeights.protectUncoveredGroupCandidate;
    }
  }

  return 0;
}

function getFutureScarcityPenalty({
  employee,
  slot,
  futureSlots,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  futureSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  manualOverrides: ManualOverrideMap;
}): number {
  const currentDifficulty = difficultyMap.get(slot.id)?.difficulty ?? 0;

  if (currentDifficulty >= 250) {
    return 0;
  }

  let protectedFutureSlots = 0;

  for (const futureSlot of futureSlots) {
    const futureDifficulty = difficultyMap.get(futureSlot.id)?.difficulty ?? 0;

    if (futureDifficulty < 250 && !isWeekendDate(futureSlot.date)) {
      continue;
    }

    const employeeCanFillFutureSlot = checkHardConstraints({
      employee,
      slot: futureSlot,
      data,
      assignedShifts,
      manualOverrides
    }).allowed;

    if (!employeeCanFillFutureSlot) {
      continue;
    }

    const candidateCount = activeEmployees.filter(
      (candidate) =>
        checkHardConstraints({
          employee: candidate,
          slot: futureSlot,
          data,
          assignedShifts,
          manualOverrides
        }).allowed
    ).length;

    if (candidateCount > 0 && candidateCount <= 2) {
      protectedFutureSlots += 1;
    }
  }

  if (protectedFutureSlots === 0) {
    return 0;
  }

  return protectedFutureSlots > 1
    ? scoreWeights.futureDifficultSlotProtection * 1.5
    : scoreWeights.futureDifficultSlotProtection;
}

function getHighExperienceScarcityPenalty({
  employee,
  slot,
  futureSlots,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap,
  runSlots,
  manualOverrides
}: {
  employee: Employee;
  slot: ScheduleSlot;
  futureSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  runSlots: ScheduleSlot[];
  manualOverrides: ManualOverrideMap;
}): number {
  const currentDifficulty = difficultyMap.get(slot.id)?.difficulty ?? 0;
  const roleExperienceLevel = getEmployeeRoleExperience(
    employee.id,
    slot.role_id,
    data.employeeRoles
  );

  if (experienceLevelRank(roleExperienceLevel) < 2 || currentDifficulty >= 250) {
    return 0;
  }

  let futureHighSkillNeeds = 0;

  for (const futureSlot of futureSlots) {
    if (futureSlot.role_id !== slot.role_id) {
      continue;
    }

    const futureDifficulty = difficultyMap.get(futureSlot.id)?.difficulty ?? 0;
    const futureGroupSize = getRoleGroupSlots({
      slot: futureSlot,
      slots: runSlots,
      staffingRequirements: data.staffingRequirements ?? []
    }).length;

    if (
      futureDifficulty < 250 &&
      !isWeekendDate(futureSlot.date) &&
      futureGroupSize < 2
    ) {
      continue;
    }

    const employeeCanFillFutureSlot = checkHardConstraints({
      employee,
      slot: futureSlot,
      data,
      assignedShifts,
      manualOverrides
    }).allowed;

    if (!employeeCanFillFutureSlot) {
      continue;
    }

    const strongCandidateCount = activeEmployees.filter(
      (candidate) =>
        experienceLevelRank(
          getEmployeeRoleExperience(
            candidate.id,
            futureSlot.role_id,
            data.employeeRoles
          )
        ) >= 2 &&
        checkHardConstraints({
          employee: candidate,
          slot: futureSlot,
          data,
          assignedShifts,
          manualOverrides
        }).allowed
    ).length;

    if (strongCandidateCount > 0 && strongCandidateCount <= 2) {
      futureHighSkillNeeds += 1;
    }
  }

  if (futureHighSkillNeeds === 0) {
    return 0;
  }

  return futureHighSkillNeeds > 1 ? -70 : -40;
}

function buildDiagnosticUnfilledSlotMessage({
  slot,
  employees,
  data,
  assignedShifts,
  runSlots,
  roles,
  shiftTemplates,
  staffingRequirements,
  manualOverrides
}: {
  slot: ScheduleSlot;
  employees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  runSlots: ScheduleSlot[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  manualOverrides: ManualOverrideMap;
}): string {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const roleName = roles.find((role) => role.id === slot.role_id)?.name ?? "required role";
  const employeesWithRole = activeEmployees.filter((employee) =>
    employeeHasRole(employee.id, slot.role_id, data.employeeRoles)
  );
  const blocked = {
    timeOff: 0,
    cannotWork: 0,
    shiftUnavailable: 0,
    insufficientExperience: 0,
    maxHours: 0,
    maxDays: 0,
    sameDayAssignment: 0,
    overlap: 0,
    missingRole: 0
  };

  for (const employee of activeEmployees) {
    if (!employeeHasRole(employee.id, slot.role_id, data.employeeRoles)) {
      blocked.missingRole += 1;
    } else {
      const employeeExperienceLevel = getEmployeeRoleExperienceLevel(
        employee.id,
        slot.role_id,
        data.employeeRoles
      );
      const minimumExperienceLevel = getSlotMinimumExperienceLevel(
        slot,
        staffingRequirements
      );

      if (!meetsMinimumExperience(employeeExperienceLevel, minimumExperienceLevel)) {
        blocked.insufficientExperience += 1;
      }
    }

    if (hasTimeOffOnDate(employee.id, slot.date, data.timeOff)) {
      blocked.timeOff += 1;
    }

    const dayConstraint = getDayConstraint(
      employee.id,
      getDayOfWeek(slot.date),
      data.employeeDayConstraints
    );
    if (dayConstraint?.constraint_type === "cannot_work") {
      blocked.cannotWork += 1;
    }

    const shiftAvailability = getEmployeeShiftAvailability({
      employeeId: employee.id,
      slot,
      data
    });

    if (shiftAvailability?.availability_type === "cannot_work") {
      blocked.shiftUnavailable += 1;
    }

    if (hasAssignmentOnDate(employee.id, slot.date, assignedShifts)) {
      blocked.sameDayAssignment += 1;
    }

    if (hasOverlappingShift(employee.id, slot, assignedShifts)) {
      blocked.overlap += 1;
    }

    const hardConstraintResult = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts,
      manualOverrides
    });
    const reasons = hardConstraintResult.reasons.join(" ");

    if (reasons.includes("max weekly hours")) {
      blocked.maxHours += 1;
    }

    if (reasons.includes("max weekly days")) {
      blocked.maxDays += 1;
    }
  }
  const groupSlots = getRoleGroupSlots({ slot, slots: runSlots, staffingRequirements });
  const groupSlotIds = new Set(groupSlots.map((groupSlot) => groupSlot.id));
  const assignedEmployeeIds = assignedShifts
    .filter((assignedShift) => groupSlotIds.has(assignedShift.slotId))
    .map((assignedShift) => assignedShift.employeeId);
  const minimumExperienceLevel = getSlotMinimumExperienceLevel(
    slot,
    staffingRequirements
  );
  const experiencedRequiredCount = getSlotExperiencedRequiredCount(
    slot,
    staffingRequirements
  );
  const experiencedAssignedCount = assignedEmployeeIds.filter(
    (employeeId) =>
      experienceLevelRank(
        getEmployeeRoleExperience(employeeId, slot.role_id, data.employeeRoles)
      ) >= 2
  ).length;
  const missingExperienceLabel =
    minimumExperienceLevel === "no_experience"
      ? "χωρίς συγκεκριμένη απαίτηση προϋπηρεσίας"
      : `με τουλάχιστον ${experienceLevelToLabel(minimumExperienceLevel)}`;

  return [
    `No candidate could fill ${formatDayAndDate(slot.date)} ${formatShiftLabel({
      slot,
      shiftTemplates,
      staffingRequirements
    })} ${slot.start_time}-${slot.end_time} ${roleName}.`,
    `Missing: 1 employee for ${roleName} ${missingExperienceLabel}.`,
    `Required total: ${groupSlots.length}. Assigned: ${assignedEmployeeIds.length}.`,
    `Required prior-experience employees: ${experiencedRequiredCount}. Assigned prior-experience employees: ${experiencedAssignedCount}.`,
    `Employees with role: ${employeesWithRole.length}.`,
    `Blocked by insufficient experience: ${blocked.insufficientExperience}.`,
    `Blocked by time off: ${blocked.timeOff}.`,
    `Blocked by cannot_work: ${blocked.cannotWork}.`,
    `Blocked by shift availability: ${blocked.shiftUnavailable}.`,
    `Blocked by same-day assignment: ${blocked.sameDayAssignment}.`,
    `Blocked by max hours: ${blocked.maxHours}.`,
    `Blocked by max days: ${blocked.maxDays}.`,
    `Blocked by overlap: ${blocked.overlap}.`,
    `Missing role: ${blocked.missingRole}.`
  ].join(" ");
}

function createTeamQualityWarnings({
  runId,
  runSlots,
  assignments,
  employees,
  employeeRoles,
  roles,
  shiftTemplates,
  staffingRequirements
}: {
  runId: string;
  runSlots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
}): SchedulerWarningDraft[] {
  const seenGroupKeys = new Set<string>();
  const warnings: SchedulerWarningDraft[] = [];

  for (const slot of runSlots) {
    const groupKey = getRoleGroupKey(slot, staffingRequirements);

    if (seenGroupKeys.has(groupKey)) {
      continue;
    }

    seenGroupKeys.add(groupKey);

    const quality = assessRoleGroupQuality({
      slot,
      slots: runSlots,
      assignments,
      employees,
      employeeRoles,
      roles,
      staffingRequirements
    });

    if (quality.warnings.length === 0) {
      continue;
    }

    warnings.push({
      scheduleRunId: runId,
      scheduleSlotId: slot.id,
      scheduleAssignmentId: null,
      severity: "warning",
      warningType: "weak_team_composition",
      message: `${formatDayAndDate(slot.date)} ${formatShiftLabel({
        slot,
        shiftTemplates,
        staffingRequirements
      })} ${quality.roleName}: ${quality.warnings.join(" ")}`
    });
  }

  return warnings;
}

function createRoleGroupCoverageWarnings({
  runId,
  runSlots,
  assignedShifts,
  employees,
  data,
  roles,
  shiftTemplates,
  staffingRequirements,
  manualOverrides
}: {
  runId: string;
  runSlots: ScheduleSlot[];
  assignedShifts: AssignedShift[];
  employees: Employee[];
  data: SchedulerData;
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  manualOverrides: ManualOverrideMap;
}): SchedulerWarningDraft[] {
  return buildRoleGroupCoverage({
    slots: runSlots,
    assignedShifts,
    staffingRequirements
  }).flatMap((group) => {
    const representativeSlot = group.slots[0];

    if (!representativeSlot || group.assignedCount >= group.requiredCount) {
      return [];
    }

    const roleName =
      roles.find((role) => role.id === representativeSlot.role_id)?.name ??
      "required role";
    const shiftLabel = formatShiftLabel({
      slot: representativeSlot,
      shiftTemplates,
      staffingRequirements
    });
    const coverageLabel = `${formatDayAndDate(
      representativeSlot.date
    )} ${shiftLabel} ${roleName}`;
    const diagnosticMessage = buildCoverageGroupShortageMessage({
      slot: representativeSlot,
      group,
      coverageLabel,
      employees,
      data,
      assignedShifts,
      manualOverrides
    });

    if (group.assignedCount === 0) {
      return [
        {
          scheduleRunId: runId,
          scheduleSlotId: representativeSlot.id,
          scheduleAssignmentId: null,
          severity: "warning",
          warningType: "critical_coverage_gap",
          message: diagnosticMessage
        }
      ];
    }

    return [
      {
        scheduleRunId: runId,
        scheduleSlotId: representativeSlot.id,
        scheduleAssignmentId: null,
        severity: "warning",
        warningType: "role_group_understaffed",
        message: diagnosticMessage
      }
    ];
  });
}

function buildCoverageGroupShortageMessage({
  slot,
  group,
  coverageLabel,
  employees,
  data,
  assignedShifts,
  manualOverrides
}: {
  slot: ScheduleSlot;
  group: RoleGroupCoverage;
  coverageLabel: string;
  employees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  manualOverrides: ManualOverrideMap;
}): string {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const diagnostics = {
    activeEmployeesWithRole: 0,
    availableAfterHardConstraints: 0,
    blockedByTimeOff: 0,
    blockedByCannotWork: 0,
    blockedBySameDayAssignment: 0,
    blockedByMaxHours: 0,
    blockedByMaxDays: 0,
    blockedByMissingRole: 0
  };

  for (const employee of activeEmployees) {
    if (employeeHasRole(employee.id, slot.role_id, data.employeeRoles)) {
      diagnostics.activeEmployeesWithRole += 1;
    } else {
      diagnostics.blockedByMissingRole += 1;
    }

    if (hasTimeOffOnDate(employee.id, slot.date, data.timeOff)) {
      diagnostics.blockedByTimeOff += 1;
    }

    const dayConstraint = getDayConstraint(
      employee.id,
      getDayOfWeek(slot.date),
      data.employeeDayConstraints
    );
    const shiftAvailability = getEmployeeShiftAvailability({
      employeeId: employee.id,
      slot,
      data
    });

    if (
      dayConstraint?.constraint_type === "cannot_work" ||
      shiftAvailability?.availability_type === "cannot_work"
    ) {
      diagnostics.blockedByCannotWork += 1;
    }

    if (hasAssignmentOnDate(employee.id, slot.date, assignedShifts)) {
      diagnostics.blockedBySameDayAssignment += 1;
    }

    const hardConstraintResult = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts,
      manualOverrides
    });

    if (hardConstraintResult.allowed) {
      diagnostics.availableAfterHardConstraints += 1;
    }

    const reasons = hardConstraintResult.reasons.join(" ");

    if (reasons.includes("max weekly hours")) {
      diagnostics.blockedByMaxHours += 1;
    }

    if (reasons.includes("max weekly days")) {
      diagnostics.blockedByMaxDays += 1;
    }
  }

  const header =
    group.assignedCount === 0
      ? `Κρίσιμη έλλειψη: ${coverageLabel} έχει 0/${group.requiredCount} εργαζομένους.`
      : `Μερική κάλυψη: ${coverageLabel} έχει ${group.assignedCount}/${group.requiredCount} εργαζομένους.`;

  return [
    header,
    `Ενεργοί με αυτόν τον ρόλο: ${diagnostics.activeEmployeesWithRole}.`,
    `Διαθέσιμοι μετά τους βασικούς περιορισμούς: ${diagnostics.availableAfterHardConstraints}.`,
    `Μπλοκαρισμένοι από άδεια: ${diagnostics.blockedByTimeOff}.`,
    `Μπλοκαρισμένοι από cannot_work/διαθεσιμότητα βάρδιας: ${diagnostics.blockedByCannotWork}.`,
    `Μπλοκαρισμένοι επειδή έχουν ήδη βάρδια την ίδια ημέρα: ${diagnostics.blockedBySameDayAssignment}.`,
    `Μπλοκαρισμένοι από μέγιστες ώρες: ${diagnostics.blockedByMaxHours}.`,
    `Μπλοκαρισμένοι από μέγιστες ημέρες: ${diagnostics.blockedByMaxDays}.`,
    `Δεν έχουν τον ρόλο: ${diagnostics.blockedByMissingRole}.`
  ].join(" ");
}

function formatShiftLabel({
  slot,
  shiftTemplates,
  staffingRequirements
}: {
  slot: ScheduleSlot;
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
}): string {
  const requirement = slot.source_id
    ? staffingRequirements.find((item) => item.id === slot.source_id)
    : null;
  const shiftTemplate = requirement?.shift_template_id
    ? shiftTemplates.find((item) => item.id === requirement.shift_template_id)
    : shiftTemplates.find(
        (item) =>
          item.start_time === slot.start_time && item.end_time === slot.end_time
      );

  return shiftTemplate?.name ?? "Shift";
}

function buildRotationHistory({
  run,
  slots,
  assignments,
  staffingRequirements
}: {
  run: ScheduleRun;
  slots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  staffingRequirements: StaffingRequirement[];
}): RotationHistoryMap {
  const lookbackDays = 28;
  const runStartTime = new Date(`${run.start_date}T00:00:00`).getTime();
  const lookbackStartTime = runStartTime - lookbackDays * 24 * 60 * 60 * 1000;
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const history: RotationHistoryMap = new Map();

  for (const assignment of assignments) {
    if (assignment.status === "cancelled" || assignment.status === "removed") {
      continue;
    }

    const slot = slotById.get(assignment.schedule_slot_id);

    if (!slot || slot.schedule_run_id === run.id) {
      continue;
    }

    const slotTime = new Date(`${slot.date}T00:00:00`).getTime();

    if (slotTime >= runStartTime || slotTime < lookbackStartTime) {
      continue;
    }

    const employeeHistory = getRotationHistoryForEmployee(
      assignment.employee_id,
      history
    );

    if (!history.has(assignment.employee_id)) {
      history.set(assignment.employee_id, employeeHistory);
    }

    employeeHistory.totalHours += getSlotDurationHours(slot);
    employeeHistory.dayKeys.add(slot.date);
    employeeHistory.assignmentKeys.add(
      buildRotationAssignmentKey(slot, staffingRequirements)
    );

    if (isWeekendDate(slot.date)) {
      employeeHistory.weekendAssignments += 1;
    }

    if (isNightOrDifficultShift(slot.start_time, slot.end_time)) {
      employeeHistory.difficultAssignments += 1;
    }
  }

  return history;
}

function getRotationHistoryForEmployee(
  employeeId: string,
  rotationHistory: RotationHistoryMap
): EmployeeRotationHistory {
  return rotationHistory.get(employeeId) ?? createEmptyRotationHistory();
}

function createEmptyRotationHistory(): EmployeeRotationHistory {
  return {
    weekendAssignments: 0,
    difficultAssignments: 0,
    totalHours: 0,
    dayKeys: new Set<string>(),
    assignmentKeys: new Set<string>()
  };
}

function buildRotationAssignmentKey(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): string {
  const shiftTemplateId =
    getSlotShiftTemplateId(slot, staffingRequirements) ??
    `${slot.start_time}-${slot.end_time}`;

  return `${getDayOfWeek(slot.date)}|${shiftTemplateId}|${slot.role_id}`;
}

function compareSlots(left: ScheduleSlot, right: ScheduleSlot): number {
  return (
    left.date.localeCompare(right.date) ||
    left.start_time.localeCompare(right.start_time) ||
    left.end_time.localeCompare(right.end_time) ||
    left.role_id.localeCompare(right.role_id) ||
    left.id.localeCompare(right.id)
  );
}

function sortEmployees(employees: Employee[]): Employee[] {
  return [...employees].sort(
    (left, right) =>
      left.last_name.localeCompare(right.last_name) ||
      left.first_name.localeCompare(right.first_name) ||
      left.id.localeCompare(right.id)
  );
}

function compareCandidates(
  left: AssignmentCandidate,
  right: AssignmentCandidate,
  assignedShifts: AssignedShift[],
  data: SchedulerData
): number {
  return (
    right.score.totalScore - left.score.totalScore ||
    getAssignedHours(left.employee.id, assignedShifts) -
      getAssignedHours(right.employee.id, assignedShifts) ||
    getAssignedDayCount(left.employee.id, assignedShifts) -
      getAssignedDayCount(right.employee.id, assignedShifts) ||
    getWeekendShiftCount(left.employee.id, assignedShifts) -
      getWeekendShiftCount(right.employee.id, assignedShifts) ||
    getNightShiftCount(left.employee.id, assignedShifts) -
      getNightShiftCount(right.employee.id, assignedShifts) ||
    getEmployeeRoleFlexibility(left.employee.id, data.employeeRoles) -
      getEmployeeRoleFlexibility(right.employee.id, data.employeeRoles) ||
    left.employee.last_name.localeCompare(right.employee.last_name) ||
    left.employee.first_name.localeCompare(right.employee.first_name) ||
    left.employee.id.localeCompare(right.employee.id)
  );
}

function createFeasibilityWarnings(
  runId: string,
  feasibility: FeasibilityResult
): SchedulerWarningDraft[] {
  if (feasibility.status === "feasible") {
    return [];
  }

  const warnings: SchedulerWarningDraft[] = [];
  const summary =
    feasibility.status === "infeasible"
      ? "Το πρόγραμμα δημιουργήθηκε, αλλά δεν καλύπτεται πλήρως με τα τωρινά δεδομένα."
      : "Το πρόγραμμα δημιουργήθηκε, αλλά είναι οριακό και έχει μικρό περιθώριο για αλλαγές.";

  warnings.push({
    scheduleRunId: runId,
    scheduleSlotId: null,
    scheduleAssignmentId: null,
    severity: "warning",
    warningType: `feasibility_${feasibility.status}`,
    message: summary
  });

  for (const message of feasibility.warnings.slice(1, 7)) {
    warnings.push({
      scheduleRunId: runId,
      scheduleSlotId: null,
      scheduleAssignmentId: null,
      severity: "warning",
      warningType: "feasibility_shortage",
      message
    });
  }

  if (feasibility.recommendations.length > 0) {
    warnings.push({
      scheduleRunId: runId,
      scheduleSlotId: null,
      scheduleAssignmentId: null,
      severity: "info",
      warningType: "feasibility_recommendation",
      message: `Προτάσεις: ${feasibility.recommendations.slice(0, 4).join(" ")}`
    });
  }

  return warnings;
}

async function saveWarning(warning: SchedulerWarningDraft): Promise<void> {
  await databaseApi.createRecord("schedule_warnings", {
    schedule_run_id: warning.scheduleRunId,
    schedule_slot_id: warning.scheduleSlotId,
    schedule_assignment_id: warning.scheduleAssignmentId,
    severity: warning.severity,
    warning_type: warning.warningType,
    message: warning.message
  });
}

async function updateRunStatus(
  run: ScheduleRun,
  totalSlots: number,
  assignedSlots: number,
  diagnostics?: ReturnType<typeof buildSchedulerDiagnostics>,
  selectedSchedule?: CandidateSchedule,
  feasibility?: FeasibilityResult,
  optimizationConfig: OptimizationConfig = defaultSchedulerOptimizationConfig,
  evaluation?: ScheduleEvaluationResult
): Promise<void> {
  const status =
    totalSlots === 0
      ? "generated"
      : assignedSlots === totalSlots
        ? "assigned"
        : assignedSlots > 0
          ? "partially_assigned"
          : "unfilled";

  await databaseApi.updateRecord("schedule_runs", run.id, {
    status,
    parameters_json: mergeRunParameters(
      run.parameters_json,
      diagnostics,
      selectedSchedule,
      feasibility,
      optimizationConfig,
      evaluation
    ),
    completed_at: new Date().toISOString()
  });
}

function mergeRunParameters(
  parametersJson: string | null,
  diagnostics?: ReturnType<typeof buildSchedulerDiagnostics>,
  selectedSchedule?: CandidateSchedule,
  feasibility?: FeasibilityResult,
  optimizationConfig: OptimizationConfig = defaultSchedulerOptimizationConfig,
  evaluation?: ScheduleEvaluationResult
): string {
  const assignedAt = new Date().toISOString();
  const assignmentParameters = {
    stage: "employee_assignment",
    algorithm: "multi_start_coverage_first_manager_policy",
    assignedAt,
    optimization: selectedSchedule
      ? {
          attempts: optimizationConfig.attempts,
          maxRepairIterations: optimizationConfig.maxRepairIterations,
          timeBudgetMs: optimizationConfig.timeBudgetMs,
          selectedProfile: selectedSchedule.profile.id,
          selectedScore: selectedSchedule.score,
          selectedGrade: evaluation?.grade ?? selectedSchedule.evaluation.grade,
          selectedCoverageRate:
            evaluation?.metrics.coverageRate ??
            selectedSchedule.evaluation.metrics.coverageRate,
          repairIterations: selectedSchedule.repairIterations,
          unfilledSlots: selectedSchedule.unfilledSlots.length,
          hardConstraintViolations:
            selectedSchedule.hardConstraintViolations.length,
          scoreDetails: selectedSchedule.scoreDetails.slice(0, 30),
          scoreBreakdown: evaluation?.breakdown ?? selectedSchedule.evaluation.breakdown
        }
      : evaluation
        ? {
            attempts: optimizationConfig.attempts,
            maxRepairIterations: optimizationConfig.maxRepairIterations,
            timeBudgetMs: optimizationConfig.timeBudgetMs,
            selectedProfile: null,
            selectedScore: evaluation.reward,
            selectedGrade: evaluation.grade,
            selectedCoverageRate: evaluation.metrics.coverageRate,
            repairIterations: 0,
            unfilledSlots: evaluation.metrics.unfilledSlots,
            hardConstraintViolations: evaluation.metrics.hardViolationCount,
            scoreDetails: formatEvaluationScoreDetails(evaluation).slice(0, 30),
            scoreBreakdown: evaluation.breakdown
          }
        : null,
    evaluation: evaluation
      ? {
          grade: evaluation.grade,
          reward: evaluation.reward,
          metrics: evaluation.metrics,
          breakdown: evaluation.breakdown,
          explanations: evaluation.explanations.slice(0, 8),
          hardViolations: evaluation.hardViolations.slice(0, 8),
          softWarnings: evaluation.softWarnings.slice(0, 8)
        }
      : null,
    feasibility,
    diagnostics
  };

  if (!parametersJson) {
    return JSON.stringify(assignmentParameters);
  }

  try {
    const parsed = JSON.parse(parametersJson) as Record<string, unknown>;
    return JSON.stringify({
      ...parsed,
      ...assignmentParameters
    });
  } catch {
    return JSON.stringify(assignmentParameters);
  }
}

function formatDayAndDate(date: string): string {
  const dayLabel = dayLabels[getDayOfWeek(date)];
  const [year, month, day] = date.split("-");
  return `${dayLabel} ${day}/${month}/${year}`;
}

const dayLabels = [
  "Κυριακή",
  "Δευτέρα",
  "Τρίτη",
  "Τετάρτη",
  "Πέμπτη",
  "Παρασκευή",
  "Σάββατο"
];
