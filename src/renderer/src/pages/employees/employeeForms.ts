import { normalizeExperienceLevel, skillLevelToExperienceLevel } from "../../../types";
import type { Employee, EmployeeRole, EmployeeWorkRules } from "../../../types";
import type { EmployeeForm, EmployeeWorkRulesForm, EmploymentPatternPresetId, TimeOffForm } from "./employeeTypes";

export function createTimeOffForm(employees: Employee[]): TimeOffForm {
  const todayIso = new Date().toISOString().slice(0, 10);

  return {
    employeeId: employees[0]?.id ?? "",
    dateFrom: todayIso,
    dateTo: todayIso,
    type: "day_off",
    reason: ""
  };
}

export function createEmployeeForm(): EmployeeForm {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    isActive: true,
    notes: "",
    roleIds: [],
    roleDetails: {},
    workRules: createDefaultWorkRulesForm()
  };
}

export function createDefaultWorkRulesForm(): EmployeeWorkRulesForm {
  return {
    maxShiftsPerWeek: "5",
    maxHoursPerDay: "8",
    targetHoursPerDay: "8",
    canWorkWeekends: true
  };
}

export function applyEmploymentPatternPreset(
  current: EmployeeWorkRulesForm,
  presetId: EmploymentPatternPresetId
): EmployeeWorkRulesForm {
  if (presetId === "full_time_8h") {
    return {
      ...current,
      maxShiftsPerWeek: "5",
      maxHoursPerDay: "8",
      targetHoursPerDay: "8"
    };
  }

  if (presetId === "part_time_4h") {
    return {
      ...current,
      maxShiftsPerWeek: "5",
      maxHoursPerDay: "4",
      targetHoursPerDay: "4"
    };
  }

  return {
    ...current,
    maxShiftsPerWeek: "5",
    maxHoursPerDay: "6",
    targetHoursPerDay: "6"
  };
}

export function employeeToForm(
  employee: Employee,
  assignedRoles: EmployeeRole[],
  workRules: EmployeeWorkRules | null
): EmployeeForm {
  const roleDetails = Object.fromEntries(
    assignedRoles.map((employeeRole) => [
      employeeRole.role_id,
      {
        experienceLevel: normalizeExperienceLevel(
          employeeRole.experience_level ??
            skillLevelToExperienceLevel(employeeRole.skill_level)
        ),
        canLeadRole: employeeRole.can_lead_role === 1,
        isPreferredRole: employeeRole.is_preferred_role === 1
      }
    ])
  );

  return {
    firstName: employee.first_name,
    lastName: employee.last_name,
    phone: employee.phone ?? "",
    email: employee.email ?? "",
    isActive: Boolean(employee.is_active),
    notes: employee.notes ?? "",
    roleIds: assignedRoles.map((employeeRole) => employeeRole.role_id),
    roleDetails,
    workRules: workRulesToForm(workRules)
  };
}

export function workRulesToForm(
  workRules: EmployeeWorkRules | null
): EmployeeWorkRulesForm {
  const defaultForm = createDefaultWorkRulesForm();

  if (!workRules) {
    return defaultForm;
  }

  return {
    maxShiftsPerWeek: optionalNumberToString(workRules.max_shifts_per_week),
    maxHoursPerDay: optionalNumberToString(workRules.max_hours_per_day),
    targetHoursPerDay: optionalNumberToString(workRules.target_hours_per_day),
    canWorkWeekends: workRules.can_work_weekends !== 0
  };
}

export function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function optionalNumberToString(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}
