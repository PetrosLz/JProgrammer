import type { Employee, ScheduleSlot, StaffingRequirement } from "../../types";
import {
  type AssignedShift,
  type ManualOverrideMap,
  type SchedulerData,
  checkHardConstraints,
  employeeHasRole,
  getSlotDurationHours,
  isNightOrDifficultShift,
  isWeekendDate
} from "./constraints";

export type SlotDifficulty = {
  slotId: string;
  difficulty: number;
  candidateCount: number;
  activeRoleEmployeeCount: number;
  dateDemand: number;
  isHighPriority: boolean;
  reasons: string[];
};

export function buildSlotDifficultyMap({
  slots,
  employees,
  data,
  assignedShifts,
  staffingRequirements = [],
  manualOverrides = {}
}: {
  slots: ScheduleSlot[];
  employees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  staffingRequirements?: StaffingRequirement[];
  manualOverrides?: ManualOverrideMap;
}): Map<string, SlotDifficulty> {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const dateDemand = countBy(slots, (slot) => slot.date);
  const requirementById = new Map(
    staffingRequirements.map((requirement) => [requirement.id, requirement])
  );
  const result = new Map<string, SlotDifficulty>();

  for (const slot of slots) {
    const candidateCount = activeEmployees.filter(
      (employee) =>
        checkHardConstraints({
          employee,
          slot,
          data,
          assignedShifts,
          manualOverrides
        }).allowed
    ).length;
    const activeRoleEmployeeCount = activeEmployees.filter((employee) =>
      employeeHasRole(employee.id, slot.role_id, data.employeeRoles)
    ).length;
    const sourceRequirement = slot.source_id
      ? requirementById.get(slot.source_id)
      : null;
    const isHighPriority = sourceRequirement?.priority === "high";
    const reasons: string[] = [];
    let difficulty = 0;

    function add(reason: string, points: number) {
      difficulty += points;
      reasons.push(`${reason} +${points}`);
    }

    if (isWeekendDate(slot.date)) {
      add("Weekend", 100);
    }

    if (candidateCount === 0) {
      add("No candidates", 300);
    } else if (candidateCount === 1) {
      add("One candidate", 200);
    } else if (candidateCount === 2) {
      add("Two candidates", 150);
    } else if (candidateCount === 3) {
      add("Three candidates", 100);
    }

    if (activeRoleEmployeeCount === 1) {
      add("Rare role", 150);
    } else if (activeRoleEmployeeCount === 2) {
      add("Rare role", 100);
    } else if (activeRoleEmployeeCount === 3) {
      add("Rare role", 60);
    }

    if (isHighPriority) {
      add("High priority", 80);
    }

    if (isNightOrDifficultShift(slot.start_time, slot.end_time)) {
      add("Late or overnight shift", 50);
    }

    if (getSlotDurationHours(slot) >= 8) {
      add("Long shift", 30);
    }

    const demand = dateDemand.get(slot.date) ?? 0;
    if (demand > 0) {
      add("Day demand", demand * 5);
    }

    result.set(slot.id, {
      slotId: slot.id,
      difficulty,
      candidateCount,
      activeRoleEmployeeCount,
      dateDemand: demand,
      isHighPriority,
      reasons
    });
  }

  return result;
}

export function compareSlotsByDifficulty(
  left: ScheduleSlot,
  right: ScheduleSlot,
  difficultyMap: Map<string, SlotDifficulty>
): number {
  const leftDifficulty = difficultyMap.get(left.id)?.difficulty ?? 0;
  const rightDifficulty = difficultyMap.get(right.id)?.difficulty ?? 0;

  return (
    rightDifficulty - leftDifficulty ||
    left.date.localeCompare(right.date) ||
    left.start_time.localeCompare(right.start_time) ||
    left.end_time.localeCompare(right.end_time) ||
    left.role_id.localeCompare(right.role_id) ||
    left.id.localeCompare(right.id)
  );
}

function countBy<T>(items: T[], getKey: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}
