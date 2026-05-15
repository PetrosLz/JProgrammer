import type {
  Employee,
  EmployeeRole,
  Role,
  ScheduleAssignment,
  ScheduleSlot,
  StaffingRequirement
} from "../../types";
import { getSlotShiftTemplateId } from "./constraints";

export const defaultSkillLevel = 3;
export const experiencedSkillLevel = 4;

export type RoleGroupQuality = {
  groupKey: string;
  roleName: string;
  requiredCount: number;
  assignedEmployeeIds: string[];
  skillLevels: number[];
  hasExperiencedEmployee: boolean;
  hasLeadEmployee: boolean;
  anyLeadConfiguredForRole: boolean;
  warnings: string[];
};

export function getEmployeeRoleAssignment(
  employeeId: string,
  roleId: string,
  employeeRoles: EmployeeRole[]
): EmployeeRole | null {
  return (
    employeeRoles.find(
      (employeeRole) =>
        employeeRole.employee_id === employeeId && employeeRole.role_id === roleId
    ) ?? null
  );
}

export function getEmployeeRoleSkillLevel(
  employeeId: string,
  roleId: string,
  employeeRoles: EmployeeRole[]
): number {
  const rawSkillLevel = getEmployeeRoleAssignment(employeeId, roleId, employeeRoles)
    ?.skill_level;

  if (typeof rawSkillLevel !== "number" || !Number.isFinite(rawSkillLevel)) {
    return defaultSkillLevel;
  }

  return Math.min(5, Math.max(1, Math.round(rawSkillLevel)));
}

export function employeeCanLeadRole(
  employeeId: string,
  roleId: string,
  employeeRoles: EmployeeRole[]
): boolean {
  return (
    getEmployeeRoleAssignment(employeeId, roleId, employeeRoles)?.can_lead_role ===
    1
  );
}

export function employeePrefersRole(
  employeeId: string,
  roleId: string,
  employeeRoles: EmployeeRole[]
): boolean {
  return (
    getEmployeeRoleAssignment(employeeId, roleId, employeeRoles)
      ?.is_preferred_role === 1
  );
}

export function getRoleGroupKey(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): string {
  const shiftTemplateId = getSlotShiftTemplateId(slot, staffingRequirements);
  const shiftKey = shiftTemplateId ?? `${slot.start_time}-${slot.end_time}`;

  return `${slot.date}|${shiftKey}|${slot.role_id}`;
}

export function isSameRoleGroup(
  left: ScheduleSlot,
  right: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): boolean {
  return (
    getRoleGroupKey(left, staffingRequirements) ===
    getRoleGroupKey(right, staffingRequirements)
  );
}

export function getRoleGroupSlots({
  slot,
  slots,
  staffingRequirements
}: {
  slot: ScheduleSlot;
  slots: ScheduleSlot[];
  staffingRequirements: StaffingRequirement[];
}): ScheduleSlot[] {
  const groupKey = getRoleGroupKey(slot, staffingRequirements);

  return slots.filter(
    (candidateSlot) =>
      getRoleGroupKey(candidateSlot, staffingRequirements) === groupKey
  );
}

export function assessRoleGroupQuality({
  slot,
  slots,
  assignments,
  employees,
  employeeRoles,
  roles,
  staffingRequirements
}: {
  slot: ScheduleSlot;
  slots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  roles: Role[];
  staffingRequirements: StaffingRequirement[];
}): RoleGroupQuality {
  const groupSlots = getRoleGroupSlots({ slot, slots, staffingRequirements });
  const groupSlotIds = new Set(groupSlots.map((groupSlot) => groupSlot.id));
  const assignedEmployeeIds = assignments
    .filter(
      (assignment) =>
        groupSlotIds.has(assignment.schedule_slot_id) &&
        assignment.status !== "cancelled" &&
        assignment.status !== "removed"
    )
    .map((assignment) => assignment.employee_id);
  const skillLevels = assignedEmployeeIds.map((employeeId) =>
    getEmployeeRoleSkillLevel(employeeId, slot.role_id, employeeRoles)
  );
  const hasExperiencedEmployee = skillLevels.some(
    (skillLevel) => skillLevel >= experiencedSkillLevel
  );
  const hasLeadEmployee = assignedEmployeeIds.some((employeeId) =>
    employeeCanLeadRole(employeeId, slot.role_id, employeeRoles)
  );
  const anyLeadConfiguredForRole = employees.some((employee) =>
    employeeCanLeadRole(employee.id, slot.role_id, employeeRoles)
  );
  const roleName =
    roles.find((role) => role.id === slot.role_id)?.name ?? "required role";
  const warnings: string[] = [];

  if (
    groupSlots.length >= 2 &&
    assignedEmployeeIds.length > 0 &&
    !hasExperiencedEmployee
  ) {
    warnings.push(`This shift has no experienced ${roleName}.`);
  }

  if (skillLevels.filter((skillLevel) => skillLevel <= 2).length >= 2) {
    warnings.push(`Two beginner ${roleName} employees are assigned together.`);
  }

  if (
    groupSlots.length >= 2 &&
    assignedEmployeeIds.length > 0 &&
    anyLeadConfiguredForRole &&
    !hasLeadEmployee
  ) {
    warnings.push(`No lead employee assigned for ${roleName}.`);
  }

  return {
    groupKey: getRoleGroupKey(slot, staffingRequirements),
    roleName,
    requiredCount: groupSlots.length,
    assignedEmployeeIds,
    skillLevels,
    hasExperiencedEmployee,
    hasLeadEmployee,
    anyLeadConfiguredForRole,
    warnings
  };
}
