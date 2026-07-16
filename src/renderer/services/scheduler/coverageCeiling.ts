import type {
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeTimeConstraint,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
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
  getEffectiveMaxShiftsPerWeek,
  getEmployeeWorkRules,
  getSlotDurationHours
} from "./constraints";
import { intervalsOverlap } from "./model/workingTime";

export type CoverageDiagnosis =
  | "fully_covered"
  | "understaffed"
  | "likely_scheduler_gap"
  | "invalid";

export type CoverageCeilingClassification =
  | "optimal_or_near_optimal"
  | "likely_scheduler_gap"
  | "understaffed"
  | "invalid";

export type CoverageCeilingBottleneck = {
  scope: "slot" | "role" | "date" | "date_role" | "employee";
  message: string;
  slotId?: string;
  roleId?: string;
  roleName?: string;
  date?: string;
  employeeId?: string;
  employeeName?: string;
  requiredSlots?: number;
  feasibleSlots?: number;
  candidateCount?: number;
};

export type CoverageCeilingCapacity = {
  key: string;
  label: string;
  requiredSlots: number;
  feasibleCandidateSlots: number;
  distinctCandidates: number;
};

export type CoverageCeilingAnalysis = {
  totalSlots: number;
  feasibleMaxAssignedSlots: number;
  feasibleCoverageRate: number;
  impossibleSlotCount: number;
  constrainedSlotCount: number;
  lockedAssignedSlots: number;
  isApproximate: boolean;
  bottlenecks: CoverageCeilingBottleneck[];
  perRoleCapacity: CoverageCeilingCapacity[];
  perDateCapacity: CoverageCeilingCapacity[];
  perDateRoleCapacity: CoverageCeilingCapacity[];
};

export type CoverageCeilingDiagnosis = {
  coverageGap: number;
  classification: CoverageCeilingClassification;
  diagnosis: CoverageDiagnosis;
};

type EmployeeState = {
  hoursUnits: number;
  shiftCount: number;
  assignedIntervals: Array<{ startMs: number; endMs: number }>;
  dailyMinutes: Map<string, number>;
  weeklyShiftCount: Map<string, number>;
};

type SlotCandidateSet = {
  slot: ScheduleSlot;
  candidateEmployeeIndexes: number[];
};

const hourUnit = 4;
const maxSearchStates = 1_000_000;

export function buildCoverageCeilingAnalysis({
  slots,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability = [],
  employeeTimeConstraints = [],
  timeOff,
  staffingRequirements,
  roles = [],
  existingAssignments = [],
  manualOverrides = {}
}: {
  slots: ScheduleSlot[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability?: EmployeeShiftAvailability[];
  employeeTimeConstraints?: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  staffingRequirements: StaffingRequirement[];
  shiftTemplates?: ShiftTemplate[];
  roles?: Role[];
  existingAssignments?: ScheduleAssignment[];
  manualOverrides?: ManualOverrideMap;
}): CoverageCeilingAnalysis {
  const activeEmployees = sortEmployees(employees).filter(
    (employee) => employee.is_active === 1
  );
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const activeExistingAssignments = existingAssignments.filter(
    (assignment) =>
      assignment.status !== "cancelled" &&
      assignment.status !== "removed" &&
      slotById.has(assignment.schedule_slot_id)
  );
  const data: SchedulerData = {
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    employeeTimeConstraints,
    staffingRequirements,
    timeOff
  };
  const existingAssignedShifts = buildExistingAssignedShifts({
    slots,
    assignments: activeExistingAssignments
  });
  const activeEmployeeIndexById = new Map(
    activeEmployees.map((employee, index) => [employee.id, index])
  );
  const lockedSlotIds = new Set(
    activeExistingAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const initialStates = buildInitialEmployeeStates({
    activeEmployees,
    activeEmployeeIndexById,
    existingAssignedShifts
  });
  const remainingSlots = slots.filter((slot) => !lockedSlotIds.has(slot.id));
  const slotCandidateSets = remainingSlots.map((slot) =>
    buildSlotCandidateSet({
      slot,
      activeEmployees,
      data,
      existingAssignedShifts,
      manualOverrides
    })
  );
  const orderedSlotCandidateSets = [...slotCandidateSets].sort(
    compareSlotCandidateSets
  );
  const searchResult = searchFeasibleAssignments({
    slotCandidateSets: orderedSlotCandidateSets,
    activeEmployees,
    employeeWorkRules,
    initialStates
  });
  const lockedAssignedSlots = activeExistingAssignments.length;
  const feasibleMaxAssignedSlots = Math.min(
    slots.length,
    lockedAssignedSlots + searchResult.assignedSlots
  );

  return {
    totalSlots: slots.length,
    feasibleMaxAssignedSlots,
    feasibleCoverageRate:
      slots.length === 0 ? 1 : feasibleMaxAssignedSlots / slots.length,
    impossibleSlotCount: slotCandidateSets.filter(
      (item) => item.candidateEmployeeIndexes.length === 0
    ).length,
    constrainedSlotCount: slotCandidateSets.filter(
      (item) => item.candidateEmployeeIndexes.length > 0 &&
        item.candidateEmployeeIndexes.length <= 1
    ).length,
    lockedAssignedSlots,
    isApproximate: searchResult.isApproximate,
    bottlenecks: buildCoverageBottlenecks({
      slotCandidateSets,
      activeEmployees,
      roleNameById
    }),
    perRoleCapacity: buildCapacitySummary({
      slotCandidateSets,
      getKey: (slot) => slot.role_id,
      getLabel: (slot) => roleNameById.get(slot.role_id) ?? slot.role_id
    }),
    perDateCapacity: buildCapacitySummary({
      slotCandidateSets,
      getKey: (slot) => slot.date,
      getLabel: (slot) => slot.date
    }),
    perDateRoleCapacity: buildCapacitySummary({
      slotCandidateSets,
      getKey: (slot) => `${slot.date}|${slot.role_id}`,
      getLabel: (slot) =>
        `${slot.date} ${roleNameById.get(slot.role_id) ?? slot.role_id}`
    })
  };
}

export function diagnoseCoverageCeiling({
  analysis,
  assignedSlots,
  hardViolationCount,
  gapTolerance = 1
}: {
  analysis: CoverageCeilingAnalysis;
  assignedSlots: number;
  hardViolationCount: number;
  gapTolerance?: number;
}): CoverageCeilingDiagnosis {
  const coverageGap = Math.max(
    0,
    analysis.feasibleMaxAssignedSlots - assignedSlots
  );

  if (hardViolationCount > 0) {
    return {
      coverageGap,
      classification: "invalid",
      diagnosis: "invalid"
    };
  }

  if (coverageGap > gapTolerance) {
    return {
      coverageGap,
      classification: "likely_scheduler_gap",
      diagnosis: "likely_scheduler_gap"
    };
  }

  if (assignedSlots >= analysis.totalSlots) {
    return {
      coverageGap,
      classification: "optimal_or_near_optimal",
      diagnosis: "fully_covered"
    };
  }

  if (analysis.feasibleMaxAssignedSlots < analysis.totalSlots) {
    return {
      coverageGap,
      classification: "understaffed",
      diagnosis: "understaffed"
    };
  }

  return {
    coverageGap,
    classification: "optimal_or_near_optimal",
    diagnosis: "understaffed"
  };
}

function buildSlotCandidateSet({
  slot,
  activeEmployees,
  data,
  existingAssignedShifts,
  manualOverrides
}: {
  slot: ScheduleSlot;
  activeEmployees: Employee[];
  data: SchedulerData;
  existingAssignedShifts: AssignedShift[];
  manualOverrides: ManualOverrideMap;
}): SlotCandidateSet {
  const candidateEmployeeIndexes: number[] = [];

  activeEmployees.forEach((employee, index) => {
    const result = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts: existingAssignedShifts,
      manualOverrides
    });

    if (result.allowed) {
      candidateEmployeeIndexes.push(index);
    }
  });

  return { slot, candidateEmployeeIndexes };
}

function searchFeasibleAssignments({
  slotCandidateSets,
  activeEmployees,
  employeeWorkRules,
  initialStates
}: {
  slotCandidateSets: SlotCandidateSet[];
  activeEmployees: Employee[];
  employeeWorkRules: EmployeeWorkRules[];
  initialStates: EmployeeState[];
}): { assignedSlots: number; isApproximate: boolean } {
  const memo = new Map<string, number>();
  const states = initialStates.map(cloneEmployeeState);
  let visitedStates = 0;
  let exceededStateBudget = false;

  function search(slotIndex: number): number {
    if (slotIndex >= slotCandidateSets.length) {
      return 0;
    }

    visitedStates += 1;
    if (visitedStates > maxSearchStates) {
      exceededStateBudget = true;
      return greedyFeasibleAssignments({
        slotCandidateSets: slotCandidateSets.slice(slotIndex),
        activeEmployees,
        employeeWorkRules,
        states
      });
    }

    const remainingSlots = slotCandidateSets.length - slotIndex;
    const key = `${slotIndex}|${stateSignature(states)}`;
    const cached = memo.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const slotCandidateSet = slotCandidateSets[slotIndex];
    let best = search(slotIndex + 1);

    for (const employeeIndex of slotCandidateSet.candidateEmployeeIndexes) {
      if (
        !canAssignEmployeeToSlot({
          employee: activeEmployees[employeeIndex],
          employeeWorkRules,
          state: states[employeeIndex],
          slot: slotCandidateSet.slot
        })
      ) {
        continue;
      }

      const previousState = cloneEmployeeState(states[employeeIndex]);
      applySlotToEmployeeState({
        state: states[employeeIndex],
        employeeId: activeEmployees[employeeIndex].id,
        slot: slotCandidateSet.slot
      });
      best = Math.max(best, 1 + search(slotIndex + 1));
      states[employeeIndex] = previousState;

      if (best >= remainingSlots) {
        break;
      }
    }

    memo.set(key, best);
    return best;
  }

  return {
    assignedSlots: search(0),
    isApproximate: exceededStateBudget
  };
}

function greedyFeasibleAssignments({
  slotCandidateSets,
  activeEmployees,
  employeeWorkRules,
  states
}: {
  slotCandidateSets: SlotCandidateSet[];
  activeEmployees: Employee[];
  employeeWorkRules: EmployeeWorkRules[];
  states: EmployeeState[];
}): number {
  const workingStates = states.map(cloneEmployeeState);
  let assignedSlots = 0;

  for (const slotCandidateSet of slotCandidateSets) {
    const employeeIndex = [...slotCandidateSet.candidateEmployeeIndexes]
      .filter((candidateIndex) =>
        canAssignEmployeeToSlot({
          employee: activeEmployees[candidateIndex],
          employeeWorkRules,
          state: workingStates[candidateIndex],
          slot: slotCandidateSet.slot
        })
      )
      .sort((left, right) => {
        const leftState = workingStates[left];
        const rightState = workingStates[right];
        return (
          leftState.hoursUnits - rightState.hoursUnits ||
          leftState.shiftCount - rightState.shiftCount ||
          employeeLabel(activeEmployees[left]).localeCompare(
            employeeLabel(activeEmployees[right])
          ) ||
          activeEmployees[left].id.localeCompare(activeEmployees[right].id)
        );
      })[0];

    if (employeeIndex === undefined) {
      continue;
    }

    applySlotToEmployeeState({
      state: workingStates[employeeIndex],
      employeeId: activeEmployees[employeeIndex].id,
      slot: slotCandidateSet.slot
    });
    assignedSlots += 1;
  }

  return assignedSlots;
}

function canAssignEmployeeToSlot({
  employee,
  employeeWorkRules,
  state,
  slot
}: {
  employee: Employee;
  employeeWorkRules: EmployeeWorkRules[];
  state: EmployeeState;
  slot: ScheduleSlot;
}): boolean {
  const candidate = buildAssignedShift(slot, employee.id);

  if (
    state.assignedIntervals.some((interval) =>
      intervalsOverlap(candidate.interval, interval)
    )
  ) {
    return false;
  }

  const workRules = getEmployeeWorkRules(employee.id, employeeWorkRules);
  const maxShifts = getEffectiveMaxShiftsPerWeek(workRules);
  const projectedShifts =
    (state.weeklyShiftCount.get(candidate.weekKey) ?? 0) + 1;

  if (maxShifts !== null && projectedShifts > maxShifts) {
    return false;
  }

  if (workRules && workRules.max_hours_per_day !== null) {
    const maxDailyMinutes = Math.round(workRules.max_hours_per_day * 60);

    for (const contribution of candidate.dailyContributions) {
      const projectedMinutes =
        (state.dailyMinutes.get(contribution.date) ?? 0) + contribution.minutes;

      if (projectedMinutes > maxDailyMinutes) {
        return false;
      }
    }
  }

  return true;
}

function applySlotToEmployeeState({
  state,
  employeeId,
  slot
}: {
  state: EmployeeState;
  employeeId: string;
  slot: ScheduleSlot;
}) {
  applyAssignedShiftToEmployeeState(state, buildAssignedShift(slot, employeeId));
}

function applyAssignedShiftToEmployeeState(
  state: EmployeeState,
  assignedShift: AssignedShift
) {
  state.assignedIntervals.push(assignedShift.interval);
  state.weeklyShiftCount.set(
    assignedShift.weekKey,
    (state.weeklyShiftCount.get(assignedShift.weekKey) ?? 0) + 1
  );
  for (const contribution of assignedShift.dailyContributions) {
    state.dailyMinutes.set(
      contribution.date,
      (state.dailyMinutes.get(contribution.date) ?? 0) + contribution.minutes
    );
  }
  state.hoursUnits += toHourUnits(assignedShift.durationMinutes / 60);
  state.shiftCount += 1;
}

function buildInitialEmployeeStates({
  activeEmployees,
  activeEmployeeIndexById,
  existingAssignedShifts
}: {
  activeEmployees: Employee[];
  activeEmployeeIndexById: Map<string, number>;
  existingAssignedShifts: AssignedShift[];
}): EmployeeState[] {
  const states = activeEmployees.map(() => ({
    hoursUnits: 0,
    shiftCount: 0,
    assignedIntervals: [],
    dailyMinutes: new Map<string, number>(),
    weeklyShiftCount: new Map<string, number>()
  }));

  for (const assignedShift of existingAssignedShifts) {
    const employeeIndex = activeEmployeeIndexById.get(assignedShift.employeeId);

    if (employeeIndex === undefined) {
      continue;
    }

    applyAssignedShiftToEmployeeState(states[employeeIndex], assignedShift);
  }

  return states;
}

function buildCoverageBottlenecks({
  slotCandidateSets,
  activeEmployees,
  roleNameById
}: {
  slotCandidateSets: SlotCandidateSet[];
  activeEmployees: Employee[];
  roleNameById: Map<string, string>;
}): CoverageCeilingBottleneck[] {
  const bottlenecks: CoverageCeilingBottleneck[] = [];
  const onlyCandidateSlotIdsByEmployee = new Map<string, ScheduleSlot[]>();

  for (const slotCandidateSet of slotCandidateSets) {
    const roleName =
      roleNameById.get(slotCandidateSet.slot.role_id) ??
      slotCandidateSet.slot.role_id;

    if (slotCandidateSet.candidateEmployeeIndexes.length === 0) {
      bottlenecks.push({
        scope: "slot",
        slotId: slotCandidateSet.slot.id,
        roleId: slotCandidateSet.slot.role_id,
        roleName,
        date: slotCandidateSet.slot.date,
        candidateCount: 0,
        message: `${slotCandidateSet.slot.date} ${roleName} has no hard-valid candidate.`
      });
      continue;
    }

    if (slotCandidateSet.candidateEmployeeIndexes.length === 1) {
      const employee = activeEmployees[slotCandidateSet.candidateEmployeeIndexes[0]];
      onlyCandidateSlotIdsByEmployee.set(employee.id, [
        ...(onlyCandidateSlotIdsByEmployee.get(employee.id) ?? []),
        slotCandidateSet.slot
      ]);
    }
  }

  for (const [employeeId, employeeSlots] of onlyCandidateSlotIdsByEmployee.entries()) {
    if (employeeSlots.length <= 1) {
      continue;
    }

    const employee = activeEmployees.find((item) => item.id === employeeId);
    bottlenecks.push({
      scope: "employee",
      employeeId,
      employeeName: employee ? employeeLabel(employee) : employeeId,
      requiredSlots: employeeSlots.length,
      message: `${employee ? employeeLabel(employee) : employeeId} is the only hard-valid candidate for ${employeeSlots.length} slots.`
    });
  }

  return bottlenecks.slice(0, 12);
}

function buildCapacitySummary({
  slotCandidateSets,
  getKey,
  getLabel
}: {
  slotCandidateSets: SlotCandidateSet[];
  getKey: (slot: ScheduleSlot) => string;
  getLabel: (slot: ScheduleSlot) => string;
}): CoverageCeilingCapacity[] {
  const groups = new Map<
    string,
    {
      label: string;
      requiredSlots: number;
      feasibleCandidateSlots: number;
      distinctCandidates: Set<number>;
    }
  >();

  for (const slotCandidateSet of slotCandidateSets) {
    const key = getKey(slotCandidateSet.slot);
    const existing = groups.get(key) ?? {
      label: getLabel(slotCandidateSet.slot),
      requiredSlots: 0,
      feasibleCandidateSlots: 0,
      distinctCandidates: new Set<number>()
    };

    existing.requiredSlots += 1;
    if (slotCandidateSet.candidateEmployeeIndexes.length > 0) {
      existing.feasibleCandidateSlots += 1;
    }
    for (const employeeIndex of slotCandidateSet.candidateEmployeeIndexes) {
      existing.distinctCandidates.add(employeeIndex);
    }

    groups.set(key, existing);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      requiredSlots: group.requiredSlots,
      feasibleCandidateSlots: group.feasibleCandidateSlots,
      distinctCandidates: group.distinctCandidates.size
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function compareSlotCandidateSets(left: SlotCandidateSet, right: SlotCandidateSet) {
  return (
    left.candidateEmployeeIndexes.length - right.candidateEmployeeIndexes.length ||
    left.slot.date.localeCompare(right.slot.date) ||
    left.slot.start_time.localeCompare(right.slot.start_time) ||
    left.slot.role_id.localeCompare(right.slot.role_id) ||
    left.slot.id.localeCompare(right.slot.id)
  );
}

function sortEmployees(employees: Employee[]): Employee[] {
  return [...employees].sort(
    (left, right) =>
      employeeLabel(left).localeCompare(employeeLabel(right)) ||
      left.id.localeCompare(right.id)
  );
}

function employeeLabel(employee: Employee): string {
  return `${employee.first_name} ${employee.last_name}`.trim();
}

function stateSignature(states: EmployeeState[]): string {
  return states
    .map((state) => {
      const intervals = state.assignedIntervals
        .map((interval) => `${interval.startMs}-${interval.endMs}`)
        .sort()
        .join(".");
      const daily = [...state.dailyMinutes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([date, minutes]) => `${date}:${minutes}`)
        .join(".");
      const weekly = [...state.weeklyShiftCount.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([weekKey, count]) => `${weekKey}:${count}`)
        .join(".");
      return `${state.hoursUnits}:${state.shiftCount}:${intervals}:${daily}:${weekly}`;
    })
    .join(",");
}

function toHourUnits(hours: number): number {
  return Math.ceil(hours * hourUnit);
}

function cloneEmployeeState(state: EmployeeState): EmployeeState {
  return {
    hoursUnits: state.hoursUnits,
    shiftCount: state.shiftCount,
    assignedIntervals: [...state.assignedIntervals],
    dailyMinutes: new Map(state.dailyMinutes),
    weeklyShiftCount: new Map(state.weeklyShiftCount)
  };
}
