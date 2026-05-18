import type { Employee, Role, ScheduleSlot, StaffingRequirement } from "../../types";
import { experienceLevelRank } from "../../types";
import {
  type AssignedShift,
  type ManualOverrideMap,
  type SchedulerData,
  checkHardConstraints,
  employeeHasRole,
  getSlotExperiencedRequiredCount,
  getSlotMinimumExperienceLevel,
  getSlotShiftTemplateId,
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
  roleGroupAssignedCount: number;
  roleGroupRequiredCount: number;
  isHighPriority: boolean;
  reasons: string[];
};

export function buildSlotDifficultyMap({
  slots,
  employees,
  roles = [],
  data,
  assignedShifts,
  allSlots,
  staffingRequirements = [],
  manualOverrides = {}
}: {
  slots: ScheduleSlot[];
  employees: Employee[];
  roles?: Role[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  allSlots?: ScheduleSlot[];
  staffingRequirements?: StaffingRequirement[];
  manualOverrides?: ManualOverrideMap;
}): Map<string, SlotDifficulty> {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const coverageSlots = allSlots ?? slots;
  const dateDemand = countBy(coverageSlots, (slot) => slot.date);
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
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
    const groupSlots = coverageSlots.filter(
      (candidateSlot) =>
        roleGroupKey(candidateSlot, staffingRequirements) ===
        roleGroupKey(slot, staffingRequirements)
    );
    const groupSlotIds = new Set(groupSlots.map((groupSlot) => groupSlot.id));
    const roleGroupAssignedCount = assignedShifts.filter((assignedShift) =>
      groupSlotIds.has(assignedShift.slotId)
    ).length;
    const roleGroupRequiredCount = groupSlots.length;
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
      add("No hard-valid candidates", 400);
    } else if (candidateCount === 1) {
      add("One hard-valid candidate", 300);
    } else if (candidateCount === 2) {
      add("Two hard-valid candidates", 220);
    } else if (candidateCount === 3) {
      add("Three hard-valid candidates", 150);
    }

    if (activeRoleEmployeeCount === 1) {
      add("Rare role", 200);
    } else if (activeRoleEmployeeCount === 2) {
      add("Rare role", 150);
    } else if (activeRoleEmployeeCount === 3) {
      add("Rare role", 100);
    }

    if (isHighPriority) {
      add("High priority", 80);
    }

    if (roleGroupAssignedCount === 0) {
      add("Role group has no coverage", 500);

      if (roleGroupRequiredCount === 1) {
        add("Single-slot group has no coverage", 600);
      }
    }

    if (isCriticalRoleName(roleNameById.get(slot.role_id))) {
      add("Critical operational role", 80);
    }

    const minimumExperienceRank = experienceLevelRank(
      getSlotMinimumExperienceLevel(slot, staffingRequirements)
    );
    const experiencedRequiredCount = getSlotExperiencedRequiredCount(
      slot,
      staffingRequirements
    );

    if (minimumExperienceRank > 1) {
      add("Minimum experience requirement", (minimumExperienceRank - 1) * 40);
    }

    if (experiencedRequiredCount > 0) {
      add("Prior-experience coverage needed", experiencedRequiredCount * 60);
    }

    if (isNightOrDifficultShift(slot.start_time, slot.end_time)) {
      add("Late or overnight shift", 60);
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
      roleGroupAssignedCount,
      roleGroupRequiredCount,
      isHighPriority,
      reasons
    });
  }

  return result;
}

function isCriticalRoleName(roleName: string | undefined): boolean {
  if (!roleName) {
    return false;
  }

  const normalizedRoleName = roleName.trim().toLocaleLowerCase();

  return ["kitchen", "cashier", "manager"].some((keyword) =>
    normalizedRoleName.includes(keyword)
  );
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

function roleGroupKey(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): string {
  const shiftTemplateId = getSlotShiftTemplateId(slot, staffingRequirements);
  const shiftKey = shiftTemplateId ?? `${slot.start_time}-${slot.end_time}`;

  return `${slot.date}|${shiftKey}|${slot.role_id}`;
}
