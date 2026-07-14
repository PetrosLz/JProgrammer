import type {
  DayOfWeek,
  EmployeeDayConstraint,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  ExperienceLevel,
  Role
} from "../../../types";
import type { UiLanguage } from "../../utils/localization";
import { roleLabel } from "../../utils/scheduleDisplay";
import type {
  DayConstraintValue,
  ShiftAvailabilityValue
} from "./employeeTypes";

export function experienceOptions(language: UiLanguage): Array<{
  value: ExperienceLevel;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "no_experience", label: "No experience" },
      { value: "some_experience", label: "Experienced" }
    ];
  }

  return [
    { value: "no_experience", label: "Χωρίς προϋπηρεσία" },
    { value: "some_experience", label: "Με προϋπηρεσία" }
  ];
}

export function dayConstraintSelectOptions(language: UiLanguage): Array<{
  value: DayConstraintValue;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "neutral", label: "Neutral" },
      { value: "cannot_work", label: "Cannot work" },
      { value: "prefers_not_to_work", label: "Prefers not to work" },
      { value: "prefers_to_work", label: "Prefers to work" }
    ];
  }

  return [
    { value: "neutral", label: "Ουδέτερο" },
    { value: "cannot_work", label: "Δεν μπορεί" },
    { value: "prefers_not_to_work", label: "Προτιμά να μη δουλέψει" },
    { value: "prefers_to_work", label: "Προτιμά να δουλέψει" }
  ];
}

export function shiftAvailabilitySelectOptions(language: UiLanguage): Array<{
  value: ShiftAvailabilityValue;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "available", label: "Available" },
      { value: "cannot_work", label: "Cannot work" },
      { value: "prefers_not_to_work", label: "Prefers not to work" },
      { value: "prefers_to_work", label: "Prefers to work" }
    ];
  }

  return [
    { value: "available", label: "Διαθέσιμος" },
    { value: "cannot_work", label: "Δεν μπορεί" },
    { value: "prefers_not_to_work", label: "Προτιμά να μη δουλέψει" },
    { value: "prefers_to_work", label: "Προτιμά να δουλέψει" }
  ];
}

export function timeOffTypeOptions(language: UiLanguage): Array<{
  value: string;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "day_off", label: "Day off" },
      { value: "vacation", label: "Vacation" },
      { value: "sick_leave", label: "Sick leave" },
      { value: "personal", label: "Personal" },
      { value: "other", label: "Other" }
    ];
  }

  return [
    { value: "day_off", label: "Ρεπό" },
    { value: "vacation", label: "Άδεια" },
    { value: "sick_leave", label: "Ασθένεια" },
    { value: "personal", label: "Προσωπικό" },
    { value: "other", label: "Άλλο" }
  ];
}

export function timeOffTypeLabelLocalized(
  value: string,
  language: UiLanguage
): string {
  return (
    timeOffTypeOptions(language).find((type) => type.value === value)?.label ??
    value
  );
}

export function employeeRoleLabelsLocalized(
  roleIds: string[],
  roles: Role[],
  language: UiLanguage
): string {
  if (roleIds.length === 0) {
    return language === "en" ? "No roles" : "Χωρίς ρόλους";
  }

  return roleIds.map((roleId) => roleLabel(roleId, roles)).join(", ");
}

export function workRulesSummaryLocalized(
  workRules: EmployeeWorkRules | null,
  language: UiLanguage
): string {
  if (!workRules) {
    return language === "en"
      ? "No work rules configured"
      : "Δεν έχουν οριστεί κανόνες εργασίας";
  }

  const maxShifts = workRules.max_shifts_per_week;
  const maxHoursPerDay = workRules.max_hours_per_day;
  const targetHoursPerDay = workRules.target_hours_per_day ?? "-";
  const weekends =
    workRules.can_work_weekends === 0
      ? language === "en"
        ? "no weekends"
        : "Όχι Σαββατοκύριακα"
      : language === "en"
        ? "weekends ok"
        : "Σαββατοκύριακα ok";

  if (language === "en") {
    return `Max ${maxShifts} shifts/week, max ${maxHoursPerDay} h/day, target ${targetHoursPerDay} h/day, ${weekends}`;
  }

  return `Μέγιστο ${maxShifts} βάρδιες/εβδομάδα, έως ${maxHoursPerDay} ώρες/ημέρα, στόχος ${targetHoursPerDay} ώρες/ημέρα, ${weekends}`;
}

export function employeeAvailabilitySummary(
  employeeId: string,
  dayConstraints: EmployeeDayConstraint[],
  shiftAvailability: EmployeeShiftAvailability[],
  language: UiLanguage
): string {
  const blockedDays = dayConstraints.filter(
    (constraint) =>
      constraint.employee_id === employeeId &&
      constraint.constraint_type === "cannot_work"
  ).length;
  const blockedShifts = shiftAvailability.filter(
    (availability) =>
      availability.employee_id === employeeId &&
      availability.availability_type === "cannot_work"
  ).length;
  const totalBlocks = blockedDays + blockedShifts;

  if (totalBlocks === 0) {
    return language === "en"
      ? "No hard availability blocks"
      : "Χωρίς σκληρούς περιορισμούς";
  }

  return language === "en"
    ? `${totalBlocks} availability block${totalBlocks === 1 ? "" : "s"}`
    : `${totalBlocks} περιορισμοί διαθεσιμότητας`;
}

export function dayConstraintValue(
  employeeId: string,
  dayOfWeek: DayOfWeek,
  constraints: EmployeeDayConstraint[]
): DayConstraintValue {
  const constraint = constraints.find(
    (item) => item.employee_id === employeeId && item.day_of_week === dayOfWeek
  );

  if (
    constraint?.constraint_type === "cannot_work" ||
    constraint?.constraint_type === "prefers_not_to_work" ||
    constraint?.constraint_type === "prefers_to_work"
  ) {
    return constraint.constraint_type;
  }

  return "neutral";
}

export function shiftAvailabilityValue(
  employeeId: string,
  dayOfWeek: DayOfWeek,
  shiftTemplateId: string,
  shiftAvailability: EmployeeShiftAvailability[]
): ShiftAvailabilityValue {
  const row = shiftAvailability.find(
    (item) =>
      item.employee_id === employeeId &&
      item.day_of_week === dayOfWeek &&
      item.shift_template_id === shiftTemplateId
  );

  if (
    row?.availability_type === "cannot_work" ||
    row?.availability_type === "prefers_not_to_work" ||
    row?.availability_type === "prefers_to_work"
  ) {
    return row.availability_type;
  }

  return "available";
}

export function shiftAvailabilityClassName(
  value: ShiftAvailabilityValue
): string {
  if (value === "cannot_work") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  if (value === "prefers_not_to_work") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (value === "prefers_to_work") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  return "";
}
