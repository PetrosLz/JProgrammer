import type {
  DayOfWeek,
  EmployeeDayConstraint,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  EmploymentType,
  ExperienceLevel,
  Role
} from "../../../types";
import type { UiLanguage } from "../../utils/localization";
import { roleLabel } from "../../utils/scheduleDisplay";
import type {
  DayConstraintValue,
  ShiftAvailabilityValue
} from "./employeeTypes";
import { normalizeEmploymentType } from "./employeeForms";

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
    { value: "no_experience", label: "Ξ§Ο‰ΟΞ―Ο‚ Ο€ΟΞΏΟ‹Ο€Ξ·ΟΞµΟƒΞ―Ξ±" },
    { value: "some_experience", label: "ΞΞµ Ο€ΟΞΏΟ‹Ο€Ξ·ΟΞµΟƒΞ―Ξ±" }
  ];
}

export function employmentTypeSelectOptions(language: UiLanguage): Array<{
  value: EmploymentType;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "full_time", label: "Full-time" },
      { value: "part_time", label: "Part-time" },
      { value: "weekly_hours", label: "Agreed weekly hours" },
      { value: "custom", label: "Custom" }
    ];
  }

  return [
    { value: "full_time", label: "Ξ Ξ»Ξ®ΟΞ·Ο‚ Ξ±Ο€Ξ±ΟƒΟ‡ΟΞ»Ξ·ΟƒΞ·" },
    { value: "part_time", label: "ΞΞµΟΞΉΞΊΞ® Ξ±Ο€Ξ±ΟƒΟ‡ΟΞ»Ξ·ΟƒΞ·" },
    { value: "weekly_hours", label: "Ξ£Ο…ΞΌΟ†Ο‰Ξ½Ξ·ΞΌΞ­Ξ½ΞµΟ‚ ΞµΞ²Ξ΄ΞΏΞΌΞ±Ξ΄ΞΉΞ±Ξ―ΞµΟ‚ ΟΟΞµΟ‚" },
    { value: "custom", label: "Ξ ΟΞΏΟƒΞ±ΟΞΌΞΏΟƒΞΌΞ­Ξ½ΞΏ" }
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
    { value: "neutral", label: "ΞΟ…Ξ΄Ξ­Ο„ΞµΟΞΏ" },
    { value: "cannot_work", label: "Ξ”ΞµΞ½ ΞΌΟ€ΞΏΟΞµΞ―" },
    { value: "prefers_not_to_work", label: "Ξ ΟΞΏΟ„ΞΉΞΌΞ¬ Ξ½Ξ± ΞΌΞ· Ξ΄ΞΏΟ…Ξ»Ξ­ΟΞµΞΉ" },
    { value: "prefers_to_work", label: "Ξ ΟΞΏΟ„ΞΉΞΌΞ¬ Ξ½Ξ± Ξ΄ΞΏΟ…Ξ»Ξ­ΟΞµΞΉ" }
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
    { value: "available", label: "Ξ”ΞΉΞ±ΞΈΞ­ΟƒΞΉΞΌΞΏΟ‚" },
    { value: "cannot_work", label: "Ξ”ΞµΞ½ ΞΌΟ€ΞΏΟΞµΞ―" },
    { value: "prefers_not_to_work", label: "Ξ ΟΞΏΟ„ΞΉΞΌΞ¬ Ξ½Ξ± ΞΌΞ· Ξ΄ΞΏΟ…Ξ»Ξ­ΟΞµΞΉ" },
    { value: "prefers_to_work", label: "Ξ ΟΞΏΟ„ΞΉΞΌΞ¬ Ξ½Ξ± Ξ΄ΞΏΟ…Ξ»Ξ­ΟΞµΞΉ" }
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
    { value: "day_off", label: "Ξ΅ΞµΟ€Ο" },
    { value: "vacation", label: "Ξ†Ξ΄ΞµΞΉΞ±" },
    { value: "sick_leave", label: "Ξ‘ΟƒΞΈΞ­Ξ½ΞµΞΉΞ±" },
    { value: "personal", label: "Ξ ΟΞΏΟƒΟ‰Ο€ΞΉΞΊΟ" },
    { value: "other", label: "Ξ†Ξ»Ξ»ΞΏ" }
  ];
}

export function timeOffTypeLabelLocalized(value: string, language: UiLanguage): string {
  return timeOffTypeOptions(language).find((type) => type.value === value)?.label ?? value;
}

export function employeeRoleLabelsLocalized(
  roleIds: string[],
  roles: Role[],
  language: UiLanguage
): string {
  if (roleIds.length === 0) {
    return language === "en" ? "No roles" : "Ξ§Ο‰ΟΞ―Ο‚ ΟΟΞ»ΞΏΟ…Ο‚";
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
      : "Ξ”ΞµΞ½ Ξ­Ο‡ΞΏΟ…Ξ½ ΞΏΟΞΉΟƒΟ„ΞµΞ― ΞΊΞ±Ξ½ΟΞ½ΞµΟ‚ ΞµΟΞ³Ξ±ΟƒΞ―Ξ±Ο‚";
  }

  const employmentType =
    employmentTypeSelectOptions(language).find(
      (option) => option.value === normalizeEmploymentType(workRules.employment_type)
    )?.label ?? (language === "en" ? "Custom" : "Ξ ΟΞΏΟƒΞ±ΟΞΌΞΏΟƒΞΌΞ­Ξ½ΞΏ");
  const days =
    workRules.contract_days_per_week ??
    workRules.target_days_per_week ??
    workRules.max_days_per_week ??
    "-";
  const hours =
    workRules.contract_hours_per_week ??
    workRules.target_hours_per_week ??
    workRules.preferred_hours_per_week ??
    "-";
  const hoursPerDay = workRules.preferred_hours_per_day ?? "-";
  const weekends =
    workRules.can_work_weekends === 0
      ? language === "en"
        ? "no weekends"
        : "ΟΟ‡ΞΉ Ξ£Ξ±Ξ²Ξ²Ξ±Ο„ΞΏΞΊΟΟΞΉΞ±ΞΊΞ±"
      : language === "en"
        ? "weekends ok"
        : "Ξ£Ξ±Ξ²Ξ²Ξ±Ο„ΞΏΞΊΟΟΞΉΞ±ΞΊΞ± ok";

  if (language === "en") {
    return `${employmentType}: ${days} days, ${hoursPerDay} h/day, ${hours} h/week, ${weekends}`;
  }

  return `${employmentType}: ${days} Ξ·ΞΌΞ­ΟΞµΟ‚, ${hoursPerDay} ΟΟΞµΟ‚/Ξ·ΞΌΞ­ΟΞ±, ${hours} ΟΟΞµΟ‚/ΞµΞ²Ξ΄ΞΏΞΌΞ¬Ξ΄Ξ±, ${weekends}`;
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
    return language === "en" ? "No hard availability blocks" : "Ξ§Ο‰ΟΞ―Ο‚ ΟƒΞΊΞ»Ξ·ΟΞΏΟΟ‚ Ο€ΞµΟΞΉΞΏΟΞΉΟƒΞΌΞΏΟΟ‚";
  }

  return language === "en"
    ? `${totalBlocks} availability block${totalBlocks === 1 ? "" : "s"}`
    : `${totalBlocks} Ο€ΞµΟΞΉΞΏΟΞΉΟƒΞΌΞΏΞ― Ξ΄ΞΉΞ±ΞΈΞµΟƒΞΉΞΌΟΟ„Ξ·Ο„Ξ±Ο‚`;
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

export function shiftAvailabilityClassName(value: ShiftAvailabilityValue): string {
  if (value === "cannot_work") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  if (value === "prefers_not_to_work") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (value === "prefers_to_work") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  return "border-slate-200 bg-white text-slate-700";
}
