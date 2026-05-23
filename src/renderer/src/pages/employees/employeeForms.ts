import { normalizeExperienceLevel, skillLevelToExperienceLevel } from "../../../types";
import type { Employee, EmployeeRole, EmployeeWorkRules, EmploymentType } from "../../../types";
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
    employmentType: "full_time",
    contractDaysPerWeek: "5",
    preferredHoursPerDay: "8",
    contractHoursPerWeek: "40",
    maxConsecutiveDays: "5",
    canWorkWeekends: true
  };
}

export function applyEmploymentTypeDefaults(
  current: EmployeeWorkRulesForm,
  employmentType: EmploymentType
): EmployeeWorkRulesForm {
  if (employmentType === "full_time") {
    return {
      ...current,
      employmentType,
      contractDaysPerWeek: "5",
      preferredHoursPerDay: "8",
      contractHoursPerWeek: "40",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  if (employmentType === "part_time") {
    return {
      ...current,
      employmentType,
      contractDaysPerWeek: "5",
      preferredHoursPerDay: "6",
      contractHoursPerWeek: "30",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  if (employmentType === "weekly_hours") {
    return {
      ...current,
      employmentType,
      contractDaysPerWeek: current.contractDaysPerWeek || "5",
      preferredHoursPerDay: current.preferredHoursPerDay || "",
      contractHoursPerWeek: current.contractHoursPerWeek || "32",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  return {
    ...current,
    employmentType
  };
}

export function applyEmploymentPatternPreset(
  current: EmployeeWorkRulesForm,
  presetId: EmploymentPatternPresetId
): EmployeeWorkRulesForm {
  if (presetId === "full_time_8h") {
    return applyEmploymentTypeDefaults(current, "full_time");
  }

  if (presetId === "part_time_4h") {
    return {
      ...current,
      employmentType: "part_time",
      contractDaysPerWeek: "5",
      preferredHoursPerDay: "4",
      contractHoursPerWeek: "20",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  return applyEmploymentTypeDefaults(current, "part_time");
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

  const contractDays =
    workRules.contract_days_per_week ??
    workRules.target_days_per_week ??
    workRules.max_days_per_week ??
    5;
  const contractHours =
    workRules.contract_hours_per_week ??
    workRules.target_hours_per_week ??
    workRules.preferred_hours_per_week ??
    workRules.max_hours_per_week ??
    40;
  const preferredHoursPerDay =
    workRules.preferred_hours_per_day ??
    (contractDays > 0 ? contractHours / contractDays : null);

  return {
    employmentType: normalizeEmploymentType(workRules.employment_type),
    contractDaysPerWeek: optionalNumberToString(contractDays),
    preferredHoursPerDay: optionalNumberToString(preferredHoursPerDay),
    contractHoursPerWeek: optionalNumberToString(contractHours),
    maxConsecutiveDays: optionalNumberToString(
      workRules.max_consecutive_days ?? Math.min(5, contractDays)
    ),
    canWorkWeekends: workRules.can_work_weekends !== 0
  };
}

export function normalizeEmploymentType(value: unknown): EmploymentType {
  return value === "full_time" ||
    value === "part_time" ||
    value === "weekly_hours" ||
    value === "custom"
    ? value
    : "custom";
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
