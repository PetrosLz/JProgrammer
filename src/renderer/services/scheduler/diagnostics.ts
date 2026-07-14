import type { Employee, Role, ScheduleSlot, StaffingRequirement } from "../../types";
import {
  type AssignedShift,
  type ManualOverrideMap,
  type SchedulerData,
  checkHardConstraints,
  employeeHasRole,
  formatHours,
  getApproximateTargetHoursPerWeek,
  getEmployeeWorkRules,
  getSlotDurationHours,
  isWeekendDate
} from "./constraints";

export type RoleSupplyDiagnostic = {
  roleId: string;
  roleName: string;
  requiredSlots: number;
  requiredHours: number;
  activeEmployees: number;
  maxAvailableHours: number;
  isUnderSupplied: boolean;
};

export type SchedulerDiagnostics = {
  totalRequiredSlots: number;
  totalRequiredHours: number;
  requiredSlotsByRole: Record<string, number>;
  requiredHoursByRole: Record<string, number>;
  activeEmployeesByRole: Record<string, number>;
  totalMaxAvailableHoursByRole: Record<string, number>;
  requiredSlotsByDate: Record<string, number>;
  weekendRequiredSlots: number;
  candidateCountBySlotId: Record<string, number>;
  roles: RoleSupplyDiagnostic[];
  warnings: string[];
};

export function buildSchedulerDiagnostics({
  slots,
  employees,
  roles = [],
  data,
  assignedShifts,
  manualOverrides = {}
}: {
  slots: ScheduleSlot[];
  employees: Employee[];
  roles?: Role[];
  staffingRequirements?: StaffingRequirement[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  manualOverrides?: ManualOverrideMap;
}): SchedulerDiagnostics {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const requiredSlotsByRole = new Map<string, number>();
  const requiredHoursByRole = new Map<string, number>();
  const requiredSlotsByDate = new Map<string, number>();
  const activeEmployeesByRole = new Map<string, number>();
  const totalMaxAvailableHoursByRole = new Map<string, number>();
  const candidateCountBySlotId = new Map<string, number>();
  let totalRequiredHours = 0;
  let weekendRequiredSlots = 0;

  for (const slot of slots) {
    const slotHours = getSlotDurationHours(slot);
    totalRequiredHours += slotHours;
    requiredSlotsByRole.set(slot.role_id, (requiredSlotsByRole.get(slot.role_id) ?? 0) + 1);
    requiredHoursByRole.set(
      slot.role_id,
      (requiredHoursByRole.get(slot.role_id) ?? 0) + slotHours
    );
    requiredSlotsByDate.set(slot.date, (requiredSlotsByDate.get(slot.date) ?? 0) + 1);

    if (isWeekendDate(slot.date)) {
      weekendRequiredSlots += 1;
    }

    candidateCountBySlotId.set(
      slot.id,
      activeEmployees.filter(
        (employee) =>
          checkHardConstraints({
            employee,
            slot,
            data,
            assignedShifts,
            manualOverrides
          }).allowed
      ).length
    );
  }

  const roleIds = new Set([
    ...Array.from(requiredSlotsByRole.keys()),
    ...data.employeeRoles.map((employeeRole) => employeeRole.role_id)
  ]);

  for (const roleId of roleIds) {
    const employeesWithRole = activeEmployees.filter((employee) =>
      employeeHasRole(employee.id, roleId, data.employeeRoles)
    );
    activeEmployeesByRole.set(roleId, employeesWithRole.length);
    totalMaxAvailableHoursByRole.set(
      roleId,
      employeesWithRole.reduce((total, employee) => {
        const workRules = getEmployeeWorkRules(employee.id, data.employeeWorkRules);
        return total + (getApproximateTargetHoursPerWeek(workRules) ?? 40);
      }, 0)
    );
  }

  const roleDiagnostics = Array.from(requiredSlotsByRole.keys())
    .map((roleId) => {
      const requiredHours = requiredHoursByRole.get(roleId) ?? 0;
      const maxAvailableHours = totalMaxAvailableHoursByRole.get(roleId) ?? 0;

      return {
        roleId,
        roleName: roleNameById.get(roleId) ?? `Role ${roleId}`,
        requiredSlots: requiredSlotsByRole.get(roleId) ?? 0,
        requiredHours,
        activeEmployees: activeEmployeesByRole.get(roleId) ?? 0,
        maxAvailableHours,
        isUnderSupplied: requiredHours > maxAvailableHours
      };
    })
    .sort((left, right) => left.roleName.localeCompare(right.roleName));

  const warnings = roleDiagnostics
    .filter((role) => role.isUnderSupplied)
    .map(
      (role) =>
        `Role ${role.roleName} requires ${formatHours(role.requiredHours)} hours but available max capacity is ${formatHours(
          role.maxAvailableHours
        )} hours.`
    );

  return {
    totalRequiredSlots: slots.length,
    totalRequiredHours,
    requiredSlotsByRole: toRecord(requiredSlotsByRole),
    requiredHoursByRole: toRecord(requiredHoursByRole),
    activeEmployeesByRole: toRecord(activeEmployeesByRole),
    totalMaxAvailableHoursByRole: toRecord(totalMaxAvailableHoursByRole),
    requiredSlotsByDate: toRecord(requiredSlotsByDate),
    weekendRequiredSlots,
    candidateCountBySlotId: toRecord(candidateCountBySlotId),
    roles: roleDiagnostics,
    warnings
  };
}

function toRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    Array.from(map.entries()).map(([key, value]) => [
      key,
      Number.isInteger(value) ? value : Number(value.toFixed(2))
    ])
  );
}
