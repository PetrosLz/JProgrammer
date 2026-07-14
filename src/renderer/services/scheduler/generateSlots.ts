import type {
  DayOfWeek,
  OpeningHours,
  SpecialDay,
  ShiftTemplate,
  StaffingRequirement
} from "../../types";
import {
  addDays as addBusinessDays,
  getDayOfWeekFromDate
} from "./model/workingTime";

export type SlotDraft = {
  date: string;
  dayOfWeek: DayOfWeek;
  roleId: string;
  startTime: string;
  endTime: string;
  sourceId: string;
  slotNumber: number;
  requiredCount: number;
};

export type GenerationWarningDraft = {
  severity: "info" | "warning";
  warningType: string;
  message: string;
};

export type GenerationPlan = {
  weekStartDate: string;
  weekEndDate: string;
  slots: SlotDraft[];
  warnings: GenerationWarningDraft[];
};

export type WeekRange = {
  selectedDate: string;
  weekStartDate: string;
  weekEndDate: string;
  weekStartsOn: DayOfWeek;
};

export function getWeekRangeForDate({
  selectedDate,
  weekStartsOn
}: {
  selectedDate: string;
  weekStartsOn: DayOfWeek;
}): WeekRange {
  const selectedDayOfWeek = getDayOfWeek(selectedDate);
  const daysSinceWeekStart = (selectedDayOfWeek - weekStartsOn + 7) % 7;
  const weekStartDate = addDays(selectedDate, -daysSinceWeekStart);

  return {
    selectedDate,
    weekStartDate,
    weekEndDate: addDays(weekStartDate, 6),
    weekStartsOn
  };
}

export function buildScheduleGenerationPlan({
  weekStartDate,
  openingHours,
  staffingRequirements,
  shiftTemplates,
  specialDays
}: {
  weekStartDate: string;
  openingHours: OpeningHours[];
  staffingRequirements: StaffingRequirement[];
  shiftTemplates: ShiftTemplate[];
  specialDays: SpecialDay[];
}): GenerationPlan {
  const activeRequirements = staffingRequirements.filter(
    (requirement) => requirement.is_active && requirement.required_count > 0
  );
  const warnings: GenerationWarningDraft[] = [];
  const slots: SlotDraft[] = [];
  const weekDates = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStartDate, index)
  );

  if (activeRequirements.length === 0) {
    warnings.push({
      severity: "warning",
      warningType: "no_staffing_requirements",
      message: "No active staffing requirements exist for this week."
    });
  }

  for (const date of weekDates) {
    const dayOfWeek = getDayOfWeek(date);
    const specialDay = specialDays.find((item) => item.date === date);

    if (specialDay?.is_closed) {
      continue;
    }

    const openingHour = openingHours.find(
      (item) => item.day_of_week === dayOfWeek
    );

    if (openingHour && !openingHour.is_open) {
      continue;
    }

    const dayRequirements = activeRequirements.filter(
      (requirement) => requirement.day_of_week === dayOfWeek
    );

    if (dayRequirements.length === 0) {
      warnings.push({
        severity: "info",
        warningType: "no_day_requirements",
        message: `${date} has no active staffing requirements.`
      });
      continue;
    }

    for (const requirement of dayRequirements) {
      const shiftSnapshot = getRequirementShiftSnapshot(
        requirement,
        shiftTemplates
      );

      for (let index = 1; index <= requirement.required_count; index += 1) {
        slots.push({
          date,
          dayOfWeek,
          roleId: requirement.role_id,
          startTime: shiftSnapshot.startTime,
          endTime: shiftSnapshot.endTime,
          sourceId: requirement.id,
          slotNumber: index,
          requiredCount: requirement.required_count
        });
      }
    }
  }

  if (slots.length === 0 && activeRequirements.length > 0) {
    warnings.push({
      severity: "warning",
      warningType: "no_slots_generated",
      message:
        "No slots were generated. The business may be closed for every day in the selected week."
    });
  }

  return {
    weekStartDate,
    weekEndDate: weekDates[6],
    slots,
    warnings
  };
}

function getRequirementShiftSnapshot(
  requirement: StaffingRequirement,
  shiftTemplates: ShiftTemplate[]
): { startTime: string; endTime: string } {
  const shiftTemplate = requirement.shift_template_id
    ? shiftTemplates.find((template) => template.id === requirement.shift_template_id)
    : null;

  return {
    startTime: shiftTemplate?.start_time ?? requirement.start_time,
    endTime: shiftTemplate?.end_time ?? requirement.end_time
  };
}

export function isDateInputValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDays(dateValue: string, amount: number): string {
  return addDaysFromWorkingTime(dateValue, amount);
}

export function getDayOfWeek(dateValue: string): DayOfWeek {
  return getDayOfWeekFromDate(dateValue);
}

const addDaysFromWorkingTime = addBusinessDays;
