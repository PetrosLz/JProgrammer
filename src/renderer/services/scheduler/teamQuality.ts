import type {
  Employee,
  EmployeeRole,
  ExperienceLevel,
  Role,
  ScheduleAssignment,
  ScheduleSlot,
  StaffingRequirement
} from "../../types";
import { experienceLevelRank, experienceLevelToLabel } from "../../types";
import {
  getEmployeeRoleExperienceLevel,
  getSlotExperiencedRequiredCount,
  getSlotMinimumExperienceLevel,
  getSlotShiftTemplateId
} from "./constraints";

export const experiencedExperienceLevel: ExperienceLevel = "some_experience";

export type RoleGroupQuality = {
  groupKey: string;
  roleName: string;
  requiredCount: number;
  minimumExperienceLevel: ExperienceLevel;
  experiencedRequiredCount: number;
  experiencedAssignedCount: number;
  assignedEmployeeIds: string[];
  experienceLevels: ExperienceLevel[];
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

export function getEmployeeRoleExperience(
  employeeId: string,
  roleId: string,
  employeeRoles: EmployeeRole[]
): ExperienceLevel {
  return getEmployeeRoleExperienceLevel(employeeId, roleId, employeeRoles);
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
  const experienceLevels = assignedEmployeeIds.map((employeeId) =>
    getEmployeeRoleExperience(employeeId, slot.role_id, employeeRoles)
  );
  const experiencedAssignedCount = experienceLevels.filter(
    (experienceLevel) => experienceLevelRank(experienceLevel) >= 2
  ).length;
  const hasExperiencedEmployee = experiencedAssignedCount > 0;
  const hasEmployeeWithExperience = experienceLevels.some(
    (experienceLevel) => experienceLevelRank(experienceLevel) >= 2
  );
  const minimumExperienceLevel = getSlotMinimumExperienceLevel(
    slot,
    staffingRequirements
  );
  const experiencedRequiredCount = getSlotExperiencedRequiredCount(
    slot,
    staffingRequirements
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

  const belowMinimumCount = experienceLevels.filter(
    (experienceLevel) =>
      experienceLevelRank(experienceLevel) <
      experienceLevelRank(minimumExperienceLevel)
  ).length;

  if (belowMinimumCount > 0) {
    warnings.push(
      `${belowMinimumCount} ${roleName} employee does not meet the required experience (${experienceLevelToLabel(
        minimumExperienceLevel,
        "en"
      )}).`
    );
  }

  if (
    experiencedRequiredCount > 0 &&
    assignedEmployeeIds.length > 0 &&
    experiencedAssignedCount < experiencedRequiredCount
  ) {
    warnings.push(
      `This shift needs ${experiencedRequiredCount} ${roleName} employee with prior experience, but assigned ${experiencedAssignedCount}.`
    );
  }

  if (
    groupSlots.length >= 2 &&
    assignedEmployeeIds.length > 0 &&
    !hasEmployeeWithExperience
  ) {
    warnings.push(`This shift has no ${roleName} employee with prior experience.`);
  }

  if (
    experienceLevels.filter((experienceLevel) => experienceLevel === "no_experience")
      .length >= 2 &&
    !hasEmployeeWithExperience
  ) {
    warnings.push(`Two no-experience ${roleName} employees are assigned together.`);
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
    minimumExperienceLevel,
    experiencedRequiredCount,
    experiencedAssignedCount,
    assignedEmployeeIds,
    experienceLevels,
    hasExperiencedEmployee,
    hasLeadEmployee,
    anyLeadConfiguredForRole,
    warnings
  };
}
