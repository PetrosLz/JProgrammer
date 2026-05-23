import type { EmploymentType, ExperienceLevel } from "../../../types";

export type EmployeeWorkRulesForm = {
  employmentType: EmploymentType;
  contractDaysPerWeek: string;
  preferredHoursPerDay: string;
  contractHoursPerWeek: string;
  maxConsecutiveDays: string;
  canWorkWeekends: boolean;
};

export type EmployeeForm = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  isActive: boolean;
  notes: string;
  roleIds: string[];
  roleDetails: Record<
    string,
    {
      experienceLevel: ExperienceLevel;
      canLeadRole: boolean;
      isPreferredRole: boolean;
    }
  >;
  workRules: EmployeeWorkRulesForm;
};

export type DayConstraintValue =
  | "neutral"
  | "cannot_work"
  | "prefers_not_to_work"
  | "prefers_to_work";

export type ShiftAvailabilityValue =
  | "available"
  | "cannot_work"
  | "prefers_not_to_work"
  | "prefers_to_work";

export type TimeOffForm = {
  employeeId: string;
  dateFrom: string;
  dateTo: string;
  type: string;
  reason: string;
};

export type EmploymentPatternPresetId = "full_time_8h" | "part_time_6h" | "part_time_4h";

export const employmentPatternPresets: Array<{
  id: EmploymentPatternPresetId;
  label: string;
}> = [
  { id: "full_time_8h", label: "5x8" },
  { id: "part_time_6h", label: "5x6" },
  { id: "part_time_4h", label: "5x4" }
];
