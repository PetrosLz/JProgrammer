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
import { experienceLevelRank } from "../../types";
import {
  type AssignedShift,
  type ManualOverrideMap,
  type SchedulerData,
  buildExistingAssignedShifts,
  checkHardConstraints,
  getAssignedDayCount,
  getAssignedHours,
  getContractDaysPerWeek,
  getContractHoursPerWeek,
  getDayConstraint,
  getEmployeeShiftAvailability,
  getEmployeeWorkRules,
  getSlotDurationHours,
  isNightOrDifficultShift,
  isWeekendDate
} from "./constraints";
import { getDayOfWeek } from "./generateSlots";
import { assessRoleGroupQuality, getRoleGroupKey } from "./teamQuality";

export type ScheduleEvaluationGrade =
  | "excellent"
  | "good"
  | "needs_review"
  | "bad"
  | "invalid";

export type ScheduleEvaluationHardViolation = {
  severity: "critical";
  type: string;
  message: string;
  slotId?: string;
  employeeId?: string;
};

export type ScheduleEvaluationSoftWarning = {
  severity: "info" | "warning";
  type: string;
  message: string;
  slotId?: string;
  employeeId?: string;
};

export type ScheduleEvaluationBreakdown = {
  coverage: number;
  hardConstraints: number;
  fairness: number;
  contractFit: number;
  preferences: number;
  experienceBalance: number;
  roleCoverage: number;
  weekendBalance: number;
  difficultShiftBalance: number;
  stability: number;
  penalties: number;
  total: number;
};

export type ScheduleEvaluationMetrics = {
  totalSlots: number;
  filledSlots: number;
  unfilledSlots: number;
  coverageRate: number;
  hardViolationCount: number;
  warningCount: number;
  averageHoursDeviation: number;
  weekendDistributionRange: number;
  difficultShiftDistributionRange: number;
};

export type ScheduleEvaluationResult = {
  isValid: boolean;
  reward: number;
  grade: ScheduleEvaluationGrade;
  hardViolations: ScheduleEvaluationHardViolation[];
  softWarnings: ScheduleEvaluationSoftWarning[];
  breakdown: ScheduleEvaluationBreakdown;
  metrics: ScheduleEvaluationMetrics;
  explanations: string[];
};

export function evaluateSchedule({
  run,
  slots,
  assignments,
  employees,
  roles,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability = [],
  timeOff,
  staffingRequirements,
  shiftTemplates,
  manualOverrides = {}
}: {
  run: ScheduleRun;
  slots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability?: EmployeeShiftAvailability[];
  timeOff: TimeOff[];
  staffingRequirements: StaffingRequirement[];
  shiftTemplates: ShiftTemplate[];
  manualOverrides?: ManualOverrideMap;
}): ScheduleEvaluationResult {
  const runSlots = slots.filter((slot) => slot.schedule_run_id === run.id);
  const runSlotIds = new Set(runSlots.map((slot) => slot.id));
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.schedule_run_id === run.id &&
      assignment.status !== "cancelled" &&
      assignment.status !== "removed"
  );
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const data: SchedulerData = {
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    staffingRequirements,
    timeOff
  };
  const hardViolations = validateEvaluationHardConstraints({
    runSlots,
    activeAssignments,
    employees,
    data,
    manualOverrides
  });
  const assignedSlotIds = new Set(
    activeAssignments
      .filter((assignment) => runSlotIds.has(assignment.schedule_slot_id))
      .map((assignment) => assignment.schedule_slot_id)
  );
  const filledSlots = assignedSlotIds.size;
  const unfilledSlots = Math.max(0, runSlots.length - filledSlots);
  const assignedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: activeAssignments
  });
  const breakdown = createEmptyBreakdown();
  const softWarnings: ScheduleEvaluationSoftWarning[] = [];

  breakdown.coverage += filledSlots * 1000;
  breakdown.coverage -= unfilledSlots * 1000;
  breakdown.hardConstraints -= hardViolations.length * 1_000_000;
  applyRoleCoverageEvaluation({
    runSlots,
    activeAssignments,
    roles,
    staffingRequirements,
    breakdown,
    softWarnings
  });
  applyExperienceEvaluation({
    runSlots,
    activeAssignments,
    employees,
    roles,
    employeeRoles,
    staffingRequirements,
    breakdown,
    softWarnings
  });
  applyContractAndFairnessEvaluation({
    employees,
    employeeWorkRules,
    assignedShifts,
    breakdown
  });
  applyPreferenceEvaluation({
    activeAssignments,
    slotById,
    employeeById,
    data,
    breakdown,
    softWarnings
  });
  applyShortageDistributionEvaluation({
    runSlots,
    assignedSlotIds,
    roles,
    staffingRequirements,
    shiftTemplates,
    breakdown,
    softWarnings
  });

  breakdown.total =
    breakdown.coverage +
    breakdown.hardConstraints +
    breakdown.fairness +
    breakdown.contractFit +
    breakdown.preferences +
    breakdown.experienceBalance +
    breakdown.roleCoverage +
    breakdown.weekendBalance +
    breakdown.difficultShiftBalance +
    breakdown.stability +
    breakdown.penalties;

  const metrics = buildEvaluationMetrics({
    runSlots,
    filledSlots,
    unfilledSlots,
    employees,
    employeeWorkRules,
    assignedShifts,
    hardViolations,
    softWarnings
  });
  const grade = gradeEvaluation({
    hardViolationCount: hardViolations.length,
    coverageRate: metrics.coverageRate,
    unfilledSlots,
    warningCount: softWarnings.length
  });
  const explanations = buildEvaluationExplanations({
    grade,
    metrics,
    hardViolations,
    softWarnings,
    breakdown
  });

  return {
    isValid: hardViolations.length === 0,
    reward: breakdown.total,
    grade,
    hardViolations,
    softWarnings,
    breakdown,
    metrics,
    explanations
  };
}

function validateEvaluationHardConstraints({
  runSlots,
  activeAssignments,
  employees,
  data,
  manualOverrides
}: {
  runSlots: ScheduleSlot[];
  activeAssignments: ScheduleAssignment[];
  employees: Employee[];
  data: SchedulerData;
  manualOverrides: ManualOverrideMap;
}): ScheduleEvaluationHardViolation[] {
  const hardViolations: ScheduleEvaluationHardViolation[] = [];
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const assignmentsBySlotId = new Map<string, ScheduleAssignment[]>();

  for (const assignment of activeAssignments) {
    const slotAssignments = assignmentsBySlotId.get(assignment.schedule_slot_id) ?? [];
    assignmentsBySlotId.set(assignment.schedule_slot_id, [
      ...slotAssignments,
      assignment
    ]);
  }

  for (const [slotId, slotAssignments] of assignmentsBySlotId.entries()) {
    if (slotAssignments.length > 1) {
      hardViolations.push({
        severity: "critical",
        type: "duplicate_slot_assignment",
        slotId,
        message: `Slot ${slotId} has ${slotAssignments.length} active assignments.`
      });
    }
  }

  for (const assignment of activeAssignments) {
    const slot = slotById.get(assignment.schedule_slot_id);
    const employee = employeeById.get(assignment.employee_id);

    if (!slot) {
      hardViolations.push({
        severity: "critical",
        type: "missing_slot",
        slotId: assignment.schedule_slot_id,
        employeeId: assignment.employee_id,
        message: `Assignment ${assignment.id} references a missing schedule slot.`
      });
      continue;
    }

    if (!employee) {
      hardViolations.push({
        severity: "critical",
        type: "missing_employee",
        slotId: slot.id,
        employeeId: assignment.employee_id,
        message: `Assignment ${assignment.id} references a missing employee.`
      });
      continue;
    }

    const otherAssignments = activeAssignments.filter(
      (candidate) => candidate.id !== assignment.id
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
      for (const reason of hardConstraintResult.reasons) {
        hardViolations.push({
          severity: "critical",
          type: hardConstraintReasonToType(reason),
          slotId: slot.id,
          employeeId: employee.id,
          message: `${employee.first_name} ${employee.last_name} cannot work ${slot.date} ${slot.start_time}-${slot.end_time}: ${reason}`
        });
      }
    }
  }

  return hardViolations;
}

function applyRoleCoverageEvaluation({
  runSlots,
  activeAssignments,
  roles,
  staffingRequirements,
  breakdown,
  softWarnings
}: {
  runSlots: ScheduleSlot[];
  activeAssignments: ScheduleAssignment[];
  roles: Role[];
  staffingRequirements: StaffingRequirement[];
  breakdown: ScheduleEvaluationBreakdown;
  softWarnings: ScheduleEvaluationSoftWarning[];
}) {
  const assignedSlotIds = new Set(
    activeAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const groupMap = new Map<
    string,
    {
      representativeSlot: ScheduleSlot;
      slots: ScheduleSlot[];
      assignedCount: number;
      requiredCount: number;
    }
  >();

  for (const slot of runSlots) {
    const groupKey = getRoleGroupKey(slot, staffingRequirements);
    const group = groupMap.get(groupKey) ?? {
      representativeSlot: slot,
      slots: [],
      assignedCount: 0,
      requiredCount: 0
    };
    group.slots.push(slot);
    group.requiredCount += 1;

    if (assignedSlotIds.has(slot.id)) {
      group.assignedCount += 1;
    }

    groupMap.set(groupKey, group);
  }

  for (const group of groupMap.values()) {
    const roleName = roleNameForSlot(group.representativeSlot, roles);
    const missingCount = Math.max(0, group.requiredCount - group.assignedCount);
    const critical = isCriticalRoleName(roleName);

    if (group.assignedCount === 0) {
      breakdown.roleCoverage += critical ? -5000 : -3000;
      softWarnings.push({
        severity: "warning",
        type: critical ? "critical_zero_coverage" : "zero_coverage",
        slotId: group.representativeSlot.id,
        message: `${group.representativeSlot.date} ${roleName} has zero coverage.`
      });
      continue;
    }

    breakdown.roleCoverage += 2500;

    if (critical) {
      breakdown.roleCoverage += 1500;
    }

    if (missingCount > 0) {
      breakdown.roleCoverage -= missingCount * 500;
      softWarnings.push({
        severity: "warning",
        type: "partial_coverage",
        slotId: group.representativeSlot.id,
        message: `${group.representativeSlot.date} ${roleName} has ${group.assignedCount}/${group.requiredCount} coverage.`
      });
    }
  }
}

function applyExperienceEvaluation({
  runSlots,
  activeAssignments,
  employees,
  roles,
  employeeRoles,
  staffingRequirements,
  breakdown,
  softWarnings
}: {
  runSlots: ScheduleSlot[];
  activeAssignments: ScheduleAssignment[];
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  staffingRequirements: StaffingRequirement[];
  breakdown: ScheduleEvaluationBreakdown;
  softWarnings: ScheduleEvaluationSoftWarning[];
}) {
  const seenGroupKeys = new Set<string>();

  for (const slot of runSlots) {
    const groupKey = getRoleGroupKey(slot, staffingRequirements);

    if (seenGroupKeys.has(groupKey)) {
      continue;
    }

    seenGroupKeys.add(groupKey);

    const quality = assessRoleGroupQuality({
      slot,
      slots: runSlots,
      assignments: activeAssignments,
      employees,
      employeeRoles,
      roles,
      staffingRequirements
    });

    if (quality.warnings.length > 0) {
      const penalty = quality.warnings.length * 500;
      breakdown.experienceBalance -= penalty;

      for (const message of quality.warnings) {
        softWarnings.push({
          severity: "warning",
          type: "experience_balance",
          slotId: slot.id,
          message
        });
      }
    }

    if (
      quality.requiredCount >= 2 &&
      quality.assignedEmployeeIds.length > 0 &&
      quality.experienceLevels.some((level) => experienceLevelRank(level) >= 2)
    ) {
      breakdown.experienceBalance += 250;
    }

    if (
      quality.experiencedRequiredCount > 0 &&
      quality.experiencedAssignedCount >= quality.experiencedRequiredCount
    ) {
      breakdown.experienceBalance += 350;
    }
  }
}

function applyContractAndFairnessEvaluation({
  employees,
  employeeWorkRules,
  assignedShifts,
  breakdown
}: {
  employees: Employee[];
  employeeWorkRules: EmployeeWorkRules[];
  assignedShifts: AssignedShift[];
  breakdown: ScheduleEvaluationBreakdown;
}) {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const weekendCounts = activeEmployees.map((employee) =>
    countAssignedShifts(employee.id, assignedShifts, isWeekendShift)
  );
  const difficultCounts = activeEmployees.map((employee) =>
    countAssignedShifts(employee.id, assignedShifts, isDifficultShift)
  );

  breakdown.weekendBalance -= 300 * getRange(weekendCounts);
  breakdown.difficultShiftBalance -= 220 * getRange(difficultCounts);

  for (const employee of activeEmployees) {
    const workRules = getEmployeeWorkRules(employee.id, employeeWorkRules);
    const contractHours = getContractHoursPerWeek(workRules);
    const contractDays = getContractDaysPerWeek(workRules);
    const assignedHours = getAssignedHours(employee.id, assignedShifts);
    const assignedDays = getAssignedDayCount(employee.id, assignedShifts);

    if (contractHours !== null) {
      const hourDifference = Math.abs(contractHours - assignedHours);
      breakdown.contractFit += Math.max(-500, 160 - hourDifference * 18);

      if (assignedHours > contractHours + 4) {
        breakdown.penalties -= 500;
      }
    }

    if (contractDays !== null) {
      const dayDifference = Math.abs(contractDays - assignedDays);
      breakdown.fairness += Math.max(-250, 100 - dayDifference * 45);

      if (assignedDays > contractDays + 1) {
        breakdown.penalties -= 250;
      }
    }
  }
}

function applyPreferenceEvaluation({
  activeAssignments,
  slotById,
  employeeById,
  data,
  breakdown,
  softWarnings
}: {
  activeAssignments: ScheduleAssignment[];
  slotById: Map<string, ScheduleSlot>;
  employeeById: Map<string, Employee>;
  data: SchedulerData;
  breakdown: ScheduleEvaluationBreakdown;
  softWarnings: ScheduleEvaluationSoftWarning[];
}) {
  for (const assignment of activeAssignments) {
    const slot = slotById.get(assignment.schedule_slot_id);
    const employee = employeeById.get(assignment.employee_id);

    if (!slot || !employee) {
      continue;
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
    const preference =
      shiftAvailability?.availability_type ?? dayConstraint?.constraint_type;

    if (preference === "prefers_to_work") {
      breakdown.preferences += 30;
    }

    if (preference === "prefers_not_to_work") {
      breakdown.preferences -= 30;
      softWarnings.push({
        severity: "info",
        type: "preference_mismatch",
        slotId: slot.id,
        employeeId: employee.id,
        message: `${employee.first_name} ${employee.last_name} prefers not to work ${slot.date}.`
      });
    }
  }
}

function applyShortageDistributionEvaluation({
  runSlots,
  assignedSlotIds,
  roles,
  staffingRequirements,
  shiftTemplates,
  breakdown,
  softWarnings
}: {
  runSlots: ScheduleSlot[];
  assignedSlotIds: Set<string>;
  roles: Role[];
  staffingRequirements: StaffingRequirement[];
  shiftTemplates: ShiftTemplate[];
  breakdown: ScheduleEvaluationBreakdown;
  softWarnings: ScheduleEvaluationSoftWarning[];
}) {
  const unfilledSlots = runSlots.filter((slot) => !assignedSlotIds.has(slot.id));

  if (unfilledSlots.length === 0) {
    return;
  }

  const unfilledByDate = countSlotsBy(unfilledSlots, (slot) => slot.date);
  const unfilledByDateRole = countSlotsBy(
    unfilledSlots,
    (slot) => `${slot.date}|${slot.role_id}`
  );
  const unfilledCriticalByShift = countSlotsBy(
    unfilledSlots.filter((slot) => isCriticalRoleName(roleNameForSlot(slot, roles))),
    (slot) =>
      `${slot.date}|${
        getShiftTemplateIdForSlot(slot, staffingRequirements, shiftTemplates) ??
        `${slot.start_time}-${slot.end_time}`
      }`
  );
  const requiredByDate = countSlotsBy(runSlots, (slot) => slot.date);

  for (const [date, count] of unfilledByDate.entries()) {
    if (count > 1) {
      breakdown.penalties -= 300 * (count - 1);
    }

    const requiredSlots = requiredByDate.get(date) ?? count;

    if (count / Math.max(1, requiredSlots) >= 0.4) {
      breakdown.penalties -= 1200;
      softWarnings.push({
        severity: "warning",
        type: "day_understaffed",
        message: `${date} has a concentrated shortage.`
      });
    }
  }

  for (const count of unfilledByDateRole.values()) {
    if (count > 1) {
      breakdown.penalties -= 500 * (count - 1);
    }
  }

  for (const count of unfilledCriticalByShift.values()) {
    if (count > 1) {
      breakdown.penalties -= 700 * (count - 1);
    }
  }
}

function buildEvaluationMetrics({
  runSlots,
  filledSlots,
  unfilledSlots,
  employees,
  employeeWorkRules,
  assignedShifts,
  hardViolations,
  softWarnings
}: {
  runSlots: ScheduleSlot[];
  filledSlots: number;
  unfilledSlots: number;
  employees: Employee[];
  employeeWorkRules: EmployeeWorkRules[];
  assignedShifts: AssignedShift[];
  hardViolations: ScheduleEvaluationHardViolation[];
  softWarnings: ScheduleEvaluationSoftWarning[];
}): ScheduleEvaluationMetrics {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const hourDeviations = activeEmployees.flatMap((employee) => {
    const contractHours = getContractHoursPerWeek(
      getEmployeeWorkRules(employee.id, employeeWorkRules)
    );

    if (contractHours === null) {
      return [];
    }

    return [Math.abs(contractHours - getAssignedHours(employee.id, assignedShifts))];
  });
  const weekendCounts = activeEmployees.map((employee) =>
    countAssignedShifts(employee.id, assignedShifts, isWeekendShift)
  );
  const difficultCounts = activeEmployees.map((employee) =>
    countAssignedShifts(employee.id, assignedShifts, isDifficultShift)
  );

  return {
    totalSlots: runSlots.length,
    filledSlots,
    unfilledSlots,
    coverageRate: runSlots.length === 0 ? 1 : filledSlots / runSlots.length,
    hardViolationCount: hardViolations.length,
    warningCount: softWarnings.length,
    averageHoursDeviation: average(hourDeviations),
    weekendDistributionRange: getRange(weekendCounts),
    difficultShiftDistributionRange: getRange(difficultCounts)
  };
}

function gradeEvaluation({
  hardViolationCount,
  coverageRate,
  unfilledSlots,
  warningCount
}: {
  hardViolationCount: number;
  coverageRate: number;
  unfilledSlots: number;
  warningCount: number;
}): ScheduleEvaluationGrade {
  if (hardViolationCount > 0) {
    return "invalid";
  }

  if (coverageRate === 1 && warningCount === 0) {
    return "excellent";
  }

  if (coverageRate >= 0.95 && unfilledSlots <= 1) {
    return "good";
  }

  if (coverageRate >= 0.8) {
    return "needs_review";
  }

  return "bad";
}

function buildEvaluationExplanations({
  grade,
  metrics,
  hardViolations,
  softWarnings,
  breakdown
}: {
  grade: ScheduleEvaluationGrade;
  metrics: ScheduleEvaluationMetrics;
  hardViolations: ScheduleEvaluationHardViolation[];
  softWarnings: ScheduleEvaluationSoftWarning[];
  breakdown: ScheduleEvaluationBreakdown;
}): string[] {
  const explanations: string[] = [];

  if (grade === "excellent") {
    explanations.push(
      "Excellent: all slots are covered, no hard violations were found, and the schedule is clean."
    );
  } else if (grade === "invalid") {
    explanations.push(
      `Invalid: ${hardViolations.length} hard constraint issue${
        hardViolations.length === 1 ? "" : "s"
      } must be reviewed.`
    );
  } else if (metrics.unfilledSlots > 0) {
    explanations.push(
      `Needs review: ${metrics.unfilledSlots} slot${
        metrics.unfilledSlots === 1 ? "" : "s"
      } remained unfilled.`
    );
  } else {
    explanations.push(
      `Good: ${Math.round(metrics.coverageRate * 100)}% coverage with ${softWarnings.length} warning${
        softWarnings.length === 1 ? "" : "s"
      }.`
    );
  }

  explanations.push(
    `Reward ${Math.round(breakdown.total)} combines coverage, hard constraints, role coverage, contracts, preferences and fairness.`
  );

  if (metrics.weekendDistributionRange > 1) {
    explanations.push(
      `Weekend balance can improve: distribution range is ${metrics.weekendDistributionRange}.`
    );
  }

  if (metrics.difficultShiftDistributionRange > 1) {
    explanations.push(
      `Difficult shift balance can improve: distribution range is ${metrics.difficultShiftDistributionRange}.`
    );
  }

  return explanations;
}

function createEmptyBreakdown(): ScheduleEvaluationBreakdown {
  return {
    coverage: 0,
    hardConstraints: 0,
    fairness: 0,
    contractFit: 0,
    preferences: 0,
    experienceBalance: 0,
    roleCoverage: 0,
    weekendBalance: 0,
    difficultShiftBalance: 0,
    stability: 0,
    penalties: 0,
    total: 0
  };
}

function roleNameForSlot(slot: ScheduleSlot, roles: Role[]): string {
  return roles.find((role) => role.id === slot.role_id)?.name ?? "required role";
}

function isCriticalRoleName(roleName: string): boolean {
  const normalizedRoleName = roleName.trim().toLocaleLowerCase();

  return ["kitchen", "cashier", "manager"].some((keyword) =>
    normalizedRoleName.includes(keyword)
  );
}

function getShiftTemplateIdForSlot(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[],
  shiftTemplates: ShiftTemplate[]
): string | null {
  const requirement = staffingRequirements.find(
    (item) =>
      item.role_id === slot.role_id &&
      item.start_time === slot.start_time &&
      item.end_time === slot.end_time
  );

  if (requirement?.shift_template_id) {
    return requirement.shift_template_id;
  }

  return (
    shiftTemplates.find(
      (template) =>
        template.start_time === slot.start_time &&
        template.end_time === slot.end_time
    )?.id ?? null
  );
}

function hardConstraintReasonToType(reason: string): string {
  const normalizedReason = reason.toLocaleLowerCase();

  if (normalizedReason.includes("inactive")) {
    return "inactive_employee";
  }

  if (normalizedReason.includes("role")) {
    return "missing_role_or_experience";
  }

  if (normalizedReason.includes("time off")) {
    return "time_off";
  }

  if (normalizedReason.includes("cannot work")) {
    return "cannot_work";
  }

  if (normalizedReason.includes("same date")) {
    return "same_day_assignment";
  }

  if (normalizedReason.includes("overlapping")) {
    return "overlap";
  }

  if (normalizedReason.includes("weekend")) {
    return "weekend_not_allowed";
  }

  if (normalizedReason.includes("hours")) {
    return "max_hours";
  }

  if (normalizedReason.includes("days")) {
    return "max_days";
  }

  return "hard_constraint";
}

function countAssignedShifts(
  employeeId: string,
  assignedShifts: AssignedShift[],
  predicate: (shift: AssignedShift) => boolean
): number {
  return assignedShifts.filter(
    (shift) => shift.employeeId === employeeId && predicate(shift)
  ).length;
}

function isWeekendShift(shift: AssignedShift): boolean {
  return isWeekendDate(shift.date);
}

function isDifficultShift(shift: AssignedShift): boolean {
  return isNightOrDifficultShift(shift.startTime, shift.endTime);
}

function countSlotsBy(
  slots: ScheduleSlot[],
  getKey: (slot: ScheduleSlot) => string
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const slot of slots) {
    const key = getKey(slot);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function getRange(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.max(...values) - Math.min(...values);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
