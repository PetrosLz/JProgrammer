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
  getDayConstraint,
  getEmployeeShiftAvailability,
  getNightShiftCount,
  getWeekendShiftCount,
  hasAssignmentOnDate,
  hasOverlappingShift,
  hasTimeOffOnDate,
  isWeekendDate
} from "./constraints";
import { buildAssignmentExplanation } from "./explanations";
import {
  compareSlotsByDifficulty,
  buildSlotDifficultyMap,
  type SlotDifficulty
} from "./difficulty";
import { buildSchedulerDiagnostics } from "./diagnostics";
import { getDayOfWeek } from "./generateSlots";
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
  getEmployeeRoleSkillLevel,
  getRoleGroupKey,
  getRoleGroupSlots
} from "./teamQuality";
import {
  type SchedulerWarningDraft,
  createNoSlotsWarning,
  createUnfilledSlotWarning
} from "./warnings";

export type AssignmentResult = {
  runId: string;
  totalSlots: number;
  alreadyAssignedSlots: number;
  attemptedSlots: number;
  assignedSlots: number;
  unfilledSlots: number;
  warningsCreated: number;
  explanations: string[];
};

type AssignmentCandidate = {
  employee: Employee;
  score: CandidateScore;
};

type RepairResult = {
  repairedSlots: number;
  remainingUnfilledSlots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  explanations: string[];
};

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
  let assignedShifts: AssignedShift[] = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: activeRunAssignments
  });
  const activeEmployees = sortEmployees(employees).filter(
    (employee) => employee.is_active === 1
  );
  const explanations: string[] = [];
  let assignedSlots = 0;
  let warningsCreated = 0;

  if (slotsToAssign.length === 0) {
    await saveWarning(createNoSlotsWarning(run.id));
    await updateRunStatus(run, runSlots.length, assignedSlotIds.size);

    return {
      runId: run.id,
      totalSlots: runSlots.length,
      alreadyAssignedSlots: assignedSlotIds.size,
      attemptedSlots: 0,
      assignedSlots: 0,
      unfilledSlots: Math.max(0, runSlots.length - assignedSlotIds.size),
      warningsCreated: 1,
      explanations
    };
  }

  const diagnostics = buildSchedulerDiagnostics({
    slots: runSlots,
    employees,
    roles,
    data,
    assignedShifts,
    manualOverrides
  });

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

  const difficultyMap = buildSlotDifficultyMap({
    slots: slotsToAssign,
    employees,
    data,
    assignedShifts,
    staffingRequirements,
    manualOverrides
  });
  const orderedSlots = [...slotsToAssign].sort((left, right) =>
    compareSlotsByDifficulty(left, right, difficultyMap)
  );
  const initiallyUnfilledSlots: ScheduleSlot[] = [];

  for (const [slotIndex, slot] of orderedSlots.entries()) {
    const candidates = buildCandidates({
      slot,
      slotIndex,
      orderedSlots,
      runSlots,
      activeEmployees,
      data,
      assignedShifts,
      difficultyMap,
      manualOverrides
    });

    candidates.sort((left, right) => compareCandidates(left, right, assignedShifts));

    const bestCandidate = candidates[0];

    if (!bestCandidate) {
      initiallyUnfilledSlots.push(slot);
      continue;
    }

    const explanation = buildAssignmentExplanation({
      employee: bestCandidate.employee,
      slot,
      score: bestCandidate.score
    });
    const assignment = await databaseApi.createRecord("schedule_assignments", {
      schedule_run_id: run.id,
      schedule_slot_id: slot.id,
      employee_id: bestCandidate.employee.id,
      status: "assigned",
      is_manual_override: false,
      notes: explanation
    });

    await databaseApi.updateRecord("schedule_slots", slot.id, {
      status: "filled"
    });

    activeRunAssignments = [...activeRunAssignments, assignment];
    assignedSlotIds.add(slot.id);
    assignedShifts.push(buildAssignedShift(slot, bestCandidate.employee.id));
    explanations.push(explanation);
    assignedSlots += 1;
  }

  const repairResult = await repairUnfilledSlots({
    run,
    unfilledSlots: initiallyUnfilledSlots,
    runSlots,
    activeRunAssignments,
    assignedSlotIds,
    activeEmployees,
    data,
    assignedShifts,
    difficultyMap
  });

  activeRunAssignments = repairResult.assignments;
  assignedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: activeRunAssignments
  });
  assignedSlots += repairResult.repairedSlots;
  explanations.push(...repairResult.explanations);

  for (const slot of repairResult.remainingUnfilledSlots) {
    const message = buildDiagnosticUnfilledSlotMessage({
      slot,
      employees,
      data,
      assignedShifts,
      roles,
      shiftTemplates,
      staffingRequirements,
      manualOverrides
    });
    await saveWarning(
      createUnfilledSlotWarning({
        scheduleRunId: run.id,
        slot,
        message
      })
    );
    warningsCreated += 1;
  }

  const teamQualityWarnings = createTeamQualityWarnings({
    runId: run.id,
    runSlots,
    assignments: activeRunAssignments,
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
    activeRunAssignments.filter(
      (assignment) =>
        assignment.status !== "cancelled" && assignment.status !== "removed"
    ).length,
    diagnostics
  );

  return {
    runId: run.id,
    totalSlots: runSlots.length,
    alreadyAssignedSlots,
    attemptedSlots: slotsToAssign.length,
    assignedSlots,
    unfilledSlots: Math.max(0, runSlots.length - assignedSlotIds.size),
    warningsCreated,
    explanations
  };
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
  manualOverrides
}: {
  slot: ScheduleSlot;
  slotIndex: number;
  orderedSlots: ScheduleSlot[];
  runSlots: ScheduleSlot[];
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
  manualOverrides: ManualOverrideMap;
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

    candidates.push({
      employee,
      score: scoreCandidate({
        employee,
        slot,
        data,
        assignedShifts,
        context: buildScoringContext({
          employee,
          slot,
          slotIndex,
          orderedSlots,
          runSlots,
          activeEmployees,
          data,
          assignedShifts,
          difficultyMap,
          manualOverrides
        })
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

  const roleSkillLevel = getEmployeeRoleSkillLevel(
    employee.id,
    slot.role_id,
    data.employeeRoles
  );
  const groupSlots = getRoleGroupSlots({
    slot,
    slots: runSlots,
    staffingRequirements: data.staffingRequirements ?? []
  });
  const groupSlotIds = new Set(groupSlots.map((groupSlot) => groupSlot.id));
  const roleGroupAssignedEmployeeIds = assignedShifts
    .filter((assignedShift) => groupSlotIds.has(assignedShift.slotId))
    .map((assignedShift) => assignedShift.employeeId);
  const roleGroupAssignedSkillLevels = roleGroupAssignedEmployeeIds.map(
    (employeeId) =>
      getEmployeeRoleSkillLevel(employeeId, slot.role_id, data.employeeRoles)
  );
  const roleGroupHasLead = roleGroupAssignedEmployeeIds.some((employeeId) =>
    employeeCanLeadRole(employeeId, slot.role_id, data.employeeRoles)
  );

  return {
    averageAssignedHours: totalHours / divisor,
    averageAssignedDays: totalDays / divisor,
    averageWeekendAssignments: totalWeekendAssignments / divisor,
    averageDifficultAssignments: totalDifficultAssignments / divisor,
    roleSkillLevel,
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
    roleGroupRequiredCount: groupSlots.length,
    roleGroupAssignedSkillLevels,
    roleGroupHasLead,
    strongerCandidateAvailableForGroup: hasStrongerCandidateForRoleGroup({
      employee,
      slot,
      activeEmployees,
      data,
      assignedShifts,
      manualOverrides
    }),
    highSkillScarcityPenalty: getHighSkillScarcityPenalty({
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
      getEmployeeRoleSkillLevel(candidate.id, slot.role_id, data.employeeRoles) >=
        4 &&
      checkHardConstraints({
        employee: candidate,
        slot,
        data,
        assignedShifts,
        manualOverrides
      }).allowed
  );
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

function getHighSkillScarcityPenalty({
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
  const roleSkillLevel = getEmployeeRoleSkillLevel(
    employee.id,
    slot.role_id,
    data.employeeRoles
  );

  if (roleSkillLevel < 4 || currentDifficulty >= 250) {
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
        getEmployeeRoleSkillLevel(candidate.id, futureSlot.role_id, data.employeeRoles) >=
          4 &&
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

async function repairUnfilledSlots({
  run,
  unfilledSlots,
  runSlots,
  activeRunAssignments,
  assignedSlotIds,
  activeEmployees,
  data,
  assignedShifts,
  difficultyMap
}: {
  run: ScheduleRun;
  unfilledSlots: ScheduleSlot[];
  runSlots: ScheduleSlot[];
  activeRunAssignments: ScheduleAssignment[];
  assignedSlotIds: Set<string>;
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
}): Promise<RepairResult> {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const remainingUnfilledSlots: ScheduleSlot[] = [];
  const explanations: string[] = [];
  let repairedSlots = 0;
  let assignmentsState = activeRunAssignments;
  let shiftsState = assignedShifts;

  const orderedUnfilledSlots = [...unfilledSlots].sort((left, right) =>
    compareSlotsByDifficulty(left, right, difficultyMap)
  );

  for (const unfilledSlot of orderedUnfilledSlots) {
    const repair = findRepairMove({
      unfilledSlot,
      slotById,
      activeEmployees,
      data,
      assignments: assignmentsState,
      assignedShifts: shiftsState,
      difficultyMap
    });

    if (!repair) {
      remainingUnfilledSlots.push(unfilledSlot);
      continue;
    }

    const targetExplanation = `Repair assignment: moved ${repair.movedEmployee.first_name} ${repair.movedEmployee.last_name} to harder slot ${unfilledSlot.date} ${unfilledSlot.start_time}-${unfilledSlot.end_time}.`;
    const replacementExplanation = `Repair assignment: ${repair.replacementEmployee.first_name} ${repair.replacementEmployee.last_name} covered the easier slot freed for ${repair.movedEmployee.first_name} ${repair.movedEmployee.last_name}.`;

    const updatedOldAssignment = await databaseApi.updateRecord(
      "schedule_assignments",
      repair.oldAssignment.id,
      {
        employee_id: repair.replacementEmployee.id,
        status: "assigned",
        is_manual_override: false,
        notes: replacementExplanation
      }
    );
    const newAssignment = await databaseApi.createRecord("schedule_assignments", {
      schedule_run_id: run.id,
      schedule_slot_id: unfilledSlot.id,
      employee_id: repair.movedEmployee.id,
      status: "assigned",
      is_manual_override: false,
      notes: targetExplanation
    });

    await databaseApi.updateRecord("schedule_slots", unfilledSlot.id, {
      status: "filled"
    });

    assignmentsState = assignmentsState
      .map((assignment) =>
        assignment.id === repair.oldAssignment.id && updatedOldAssignment
          ? updatedOldAssignment
          : assignment
      )
      .concat(newAssignment);
    shiftsState = buildExistingAssignedShifts({
      slots: runSlots,
      assignments: assignmentsState
    });
    assignedSlotIds.add(unfilledSlot.id);
    explanations.push(targetExplanation, replacementExplanation);
    repairedSlots += 1;
  }

  return {
    repairedSlots,
    remainingUnfilledSlots,
    assignments: assignmentsState,
    explanations
  };
}

function findRepairMove({
  unfilledSlot,
  slotById,
  activeEmployees,
  data,
  assignments,
  assignedShifts,
  difficultyMap
}: {
  unfilledSlot: ScheduleSlot;
  slotById: Map<string, ScheduleSlot>;
  activeEmployees: Employee[];
  data: SchedulerData;
  assignments: ScheduleAssignment[];
  assignedShifts: AssignedShift[];
  difficultyMap: Map<string, SlotDifficulty>;
}):
  | {
      movedEmployee: Employee;
      replacementEmployee: Employee;
      oldAssignment: ScheduleAssignment;
    }
  | null {
  const targetDifficulty = difficultyMap.get(unfilledSlot.id)?.difficulty ?? 0;

  for (const movedEmployee of activeEmployees) {
    const employeeAssignments = assignments.filter(
      (assignment) =>
        assignment.employee_id === movedEmployee.id &&
        assignment.status === "assigned" &&
        assignment.is_manual_override !== 1
    );

    for (const oldAssignment of employeeAssignments) {
      const oldSlot = slotById.get(oldAssignment.schedule_slot_id);

      if (!oldSlot) {
        continue;
      }

      const oldDifficulty = difficultyMap.get(oldSlot.id)?.difficulty ?? 0;

      if (oldDifficulty >= targetDifficulty) {
        continue;
      }

      const assignmentsWithoutOld = assignments.filter(
        (assignment) => assignment.id !== oldAssignment.id
      );
      const shiftsWithoutOld = buildExistingAssignedShifts({
        slots: Array.from(slotById.values()),
        assignments: assignmentsWithoutOld
      });
      const movedEmployeeCanTakeTarget = checkHardConstraints({
        employee: movedEmployee,
        slot: unfilledSlot,
        data,
        assignedShifts: shiftsWithoutOld
      }).allowed;

      if (!movedEmployeeCanTakeTarget) {
        continue;
      }

      const shiftsWithTargetMove = [
        ...shiftsWithoutOld,
        buildAssignedShift(unfilledSlot, movedEmployee.id)
      ];
      const replacementCandidates = activeEmployees
        .filter((employee) => employee.id !== movedEmployee.id)
        .filter(
          (employee) =>
            checkHardConstraints({
              employee,
              slot: oldSlot,
              data,
              assignedShifts: shiftsWithTargetMove
            }).allowed
        )
        .map((employee) => ({
          employee,
          score: scoreCandidate({
            employee,
            slot: oldSlot,
            data,
            assignedShifts: shiftsWithTargetMove
          })
        }))
        .sort((left, right) =>
          compareCandidates(left, right, shiftsWithTargetMove)
        );

      const replacementCandidate = replacementCandidates[0];

      if (replacementCandidate) {
        return {
          movedEmployee,
          replacementEmployee: replacementCandidate.employee,
          oldAssignment
        };
      }
    }
  }

  return null;
}

function buildDiagnosticUnfilledSlotMessage({
  slot,
  employees,
  data,
  assignedShifts,
  roles,
  shiftTemplates,
  staffingRequirements,
  manualOverrides
}: {
  slot: ScheduleSlot;
  employees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
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
    maxHours: 0,
    maxDays: 0,
    sameDayAssignment: 0,
    overlap: 0,
    missingRole: 0
  };

  for (const employee of activeEmployees) {
    if (!employeeHasRole(employee.id, slot.role_id, data.employeeRoles)) {
      blocked.missingRole += 1;
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

  return [
    `No candidate could fill ${formatDayAndDate(slot.date)} ${formatShiftLabel({
      slot,
      shiftTemplates,
      staffingRequirements
    })} ${slot.start_time}-${slot.end_time} ${roleName}.`,
    `Employees with role: ${employeesWithRole.length}.`,
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
  assignedShifts: AssignedShift[]
): number {
  return (
    right.score.totalScore - left.score.totalScore ||
    getAssignedHours(left.employee.id, assignedShifts) -
      getAssignedHours(right.employee.id, assignedShifts) ||
    getAssignedDayCount(left.employee.id, assignedShifts) -
      getAssignedDayCount(right.employee.id, assignedShifts) ||
    left.employee.last_name.localeCompare(right.employee.last_name) ||
    left.employee.first_name.localeCompare(right.employee.first_name) ||
    left.employee.id.localeCompare(right.employee.id)
  );
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
  diagnostics?: ReturnType<typeof buildSchedulerDiagnostics>
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
    parameters_json: mergeRunParameters(run.parameters_json, diagnostics),
    completed_at: new Date().toISOString()
  });
}

function mergeRunParameters(
  parametersJson: string | null,
  diagnostics?: ReturnType<typeof buildSchedulerDiagnostics>
): string {
  const assignedAt = new Date().toISOString();
  const assignmentParameters = {
    stage: "employee_assignment",
    algorithm: "scarcity_aware_greedy_with_repair",
    assignedAt,
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
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];
