import type {
  Employee,
  EmployeeWorkRules,
  ScheduleSlot
} from "../../../types";
import {
  type AssignedShift,
  buildAssignedShift,
  getEmployeeWorkRules
} from "../constraints";
import {
  type AbsoluteShiftInterval,
  type DailyMinuteContribution,
  intervalsOverlap
} from "./workingTime";

export type EmployeeAssignmentState = {
  employeeId: string;
  assignedSlotIds: Set<string>;
  assignedIntervals: AbsoluteShiftInterval[];
  dailyAssignedMinutes: Map<string, number>;
  weeklyShiftCount: Map<string, number>;
  totalAssignedMinutes: number;
  assignedShifts: AssignedShift[];
};

export type AssignmentStateMap = Map<string, EmployeeAssignmentState>;

export type AssignmentStateValidationResult = {
  allowed: boolean;
  reasons: string[];
};

export function createAssignmentState({
  employees,
  assignedShifts
}: {
  employees: Employee[];
  assignedShifts: AssignedShift[];
}): AssignmentStateMap {
  const states: AssignmentStateMap = new Map(
    employees.map((employee) => [
      employee.id,
      createEmptyEmployeeAssignmentState(employee.id)
    ])
  );

  for (const assignedShift of assignedShifts) {
    const state =
      states.get(assignedShift.employeeId) ??
      createEmptyEmployeeAssignmentState(assignedShift.employeeId);
    applyAssignedShift(state, assignedShift);
    states.set(assignedShift.employeeId, state);
  }

  return states;
}

export function cloneAssignmentState(
  states: AssignmentStateMap
): AssignmentStateMap {
  return new Map(
    [...states.entries()].map(([employeeId, state]) => [
      employeeId,
      cloneEmployeeAssignmentState(state)
    ])
  );
}

export function canAddAssignment({
  employee,
  slot,
  employeeWorkRules,
  states,
  weekStartsOn = 1,
  timezone = null
}: {
  employee: Employee;
  slot: ScheduleSlot;
  employeeWorkRules: EmployeeWorkRules[];
  states: AssignmentStateMap;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  timezone?: string | null;
}): AssignmentStateValidationResult {
  const state =
    states.get(employee.id) ?? createEmptyEmployeeAssignmentState(employee.id);
  const candidate = buildAssignedShift(slot, employee.id, {
    weekStartsOn,
    timezone
  });
  return validateCandidateAgainstState({
    candidate,
    state,
    workRules: getEmployeeWorkRules(employee.id, employeeWorkRules)
  });
}

export function addAssignment({
  employee,
  slot,
  states,
  weekStartsOn = 1,
  timezone = null
}: {
  employee: Employee;
  slot: ScheduleSlot;
  states: AssignmentStateMap;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  timezone?: string | null;
}): AssignmentStateMap {
  const next = cloneAssignmentState(states);
  const state =
    next.get(employee.id) ?? createEmptyEmployeeAssignmentState(employee.id);
  applyAssignedShift(
    state,
    buildAssignedShift(slot, employee.id, { weekStartsOn, timezone })
  );
  next.set(employee.id, state);
  return next;
}

export function removeAssignment({
  employeeId,
  slotId,
  states
}: {
  employeeId: string;
  slotId: string;
  states: AssignmentStateMap;
}): AssignmentStateMap {
  const next = cloneAssignmentState(states);
  const state = next.get(employeeId);

  if (!state) {
    return next;
  }

  const remaining = state.assignedShifts.filter(
    (shift) => shift.slotId !== slotId
  );
  next.set(employeeId, rebuildEmployeeState(employeeId, remaining));
  return next;
}

export function replaceAssignment({
  previousEmployeeId,
  nextEmployee,
  slot,
  states,
  weekStartsOn = 1,
  timezone = null
}: {
  previousEmployeeId: string;
  nextEmployee: Employee;
  slot: ScheduleSlot;
  states: AssignmentStateMap;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  timezone?: string | null;
}): AssignmentStateMap {
  return addAssignment({
    employee: nextEmployee,
    slot,
    states: removeAssignment({
      employeeId: previousEmployeeId,
      slotId: slot.id,
      states
    }),
    weekStartsOn,
    timezone
  });
}

export function swapAssignments({
  leftEmployee,
  leftSlot,
  rightEmployee,
  rightSlot,
  states,
  weekStartsOn = 1,
  timezone = null
}: {
  leftEmployee: Employee;
  leftSlot: ScheduleSlot;
  rightEmployee: Employee;
  rightSlot: ScheduleSlot;
  states: AssignmentStateMap;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  timezone?: string | null;
}): AssignmentStateMap {
  const withoutLeft = removeAssignment({
    employeeId: leftEmployee.id,
    slotId: leftSlot.id,
    states
  });
  const withoutBoth = removeAssignment({
    employeeId: rightEmployee.id,
    slotId: rightSlot.id,
    states: withoutLeft
  });
  const withRightOnLeft = addAssignment({
    employee: rightEmployee,
    slot: leftSlot,
    states: withoutBoth,
    weekStartsOn,
    timezone
  });
  return addAssignment({
    employee: leftEmployee,
    slot: rightSlot,
    states: withRightOnLeft,
    weekStartsOn,
    timezone
  });
}

export function validateAssignmentState({
  states,
  employeeWorkRules
}: {
  states: AssignmentStateMap;
  employeeWorkRules: EmployeeWorkRules[];
}): AssignmentStateValidationResult {
  const reasons: string[] = [];

  for (const state of states.values()) {
    const workRules = getEmployeeWorkRules(state.employeeId, employeeWorkRules);

    for (let left = 0; left < state.assignedIntervals.length; left += 1) {
      for (let right = left + 1; right < state.assignedIntervals.length; right += 1) {
        if (
          intervalsOverlap(
            state.assignedIntervals[left],
            state.assignedIntervals[right]
          )
        ) {
          reasons.push(`${state.employeeId} has overlapping assignments.`);
        }
      }
    }

    if (workRules && workRules.max_hours_per_day !== null) {
      const maxMinutes = Math.round(workRules.max_hours_per_day * 60);
      for (const [date, minutes] of state.dailyAssignedMinutes.entries()) {
        if (minutes > maxMinutes) {
          reasons.push(
            `${state.employeeId} exceeds max daily hours on ${date}.`
          );
        }
      }
    }

    if (workRules && workRules.max_shifts_per_week !== null) {
      for (const [weekKey, shiftCount] of state.weeklyShiftCount.entries()) {
        if (shiftCount > workRules.max_shifts_per_week) {
          reasons.push(
            `${state.employeeId} exceeds max weekly shifts in ${weekKey}.`
          );
        }
      }
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

function createEmptyEmployeeAssignmentState(
  employeeId: string
): EmployeeAssignmentState {
  return {
    employeeId,
    assignedSlotIds: new Set(),
    assignedIntervals: [],
    dailyAssignedMinutes: new Map(),
    weeklyShiftCount: new Map(),
    totalAssignedMinutes: 0,
    assignedShifts: []
  };
}

function cloneEmployeeAssignmentState(
  state: EmployeeAssignmentState
): EmployeeAssignmentState {
  return {
    employeeId: state.employeeId,
    assignedSlotIds: new Set(state.assignedSlotIds),
    assignedIntervals: [...state.assignedIntervals],
    dailyAssignedMinutes: new Map(state.dailyAssignedMinutes),
    weeklyShiftCount: new Map(state.weeklyShiftCount),
    totalAssignedMinutes: state.totalAssignedMinutes,
    assignedShifts: [...state.assignedShifts]
  };
}

function applyAssignedShift(
  state: EmployeeAssignmentState,
  assignedShift: AssignedShift
) {
  state.assignedSlotIds.add(assignedShift.slotId);
  state.assignedIntervals.push(assignedShift.interval);
  state.assignedShifts.push(assignedShift);
  state.weeklyShiftCount.set(
    assignedShift.weekKey,
    (state.weeklyShiftCount.get(assignedShift.weekKey) ?? 0) + 1
  );
  state.totalAssignedMinutes += assignedShift.durationMinutes;

  for (const contribution of assignedShift.dailyContributions) {
    incrementDailyMinutes(state.dailyAssignedMinutes, contribution);
  }
}

function rebuildEmployeeState(
  employeeId: string,
  assignedShifts: AssignedShift[]
): EmployeeAssignmentState {
  const state = createEmptyEmployeeAssignmentState(employeeId);

  for (const assignedShift of assignedShifts) {
    applyAssignedShift(state, assignedShift);
  }

  return state;
}

function validateCandidateAgainstState({
  candidate,
  state,
  workRules
}: {
  candidate: AssignedShift;
  state: EmployeeAssignmentState;
  workRules: EmployeeWorkRules | null;
}): AssignmentStateValidationResult {
  const reasons: string[] = [];

  if (
    state.assignedIntervals.some((interval) =>
      intervalsOverlap(candidate.interval, interval)
    )
  ) {
    reasons.push("overlap");
  }

  if (workRules && workRules.max_hours_per_day !== null) {
    const maxMinutes = Math.round(workRules.max_hours_per_day * 60);

    for (const contribution of candidate.dailyContributions) {
      const projected =
        (state.dailyAssignedMinutes.get(contribution.date) ?? 0) +
        contribution.minutes;

      if (projected > maxMinutes) {
        reasons.push("max_daily_hours");
      }
    }
  }

  if (workRules && workRules.max_shifts_per_week !== null) {
    const projected =
      (state.weeklyShiftCount.get(candidate.weekKey) ?? 0) + 1;

    if (projected > workRules.max_shifts_per_week) {
      reasons.push("max_weekly_shifts");
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

function incrementDailyMinutes(
  dailyAssignedMinutes: Map<string, number>,
  contribution: DailyMinuteContribution
) {
  dailyAssignedMinutes.set(
    contribution.date,
    (dailyAssignedMinutes.get(contribution.date) ?? 0) + contribution.minutes
  );
}
