import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeTimeConstraint,
  EmployeeWorkRules,
  ExperienceLevel,
  ScheduleAssignment,
  ScheduleSlot,
  StaffingRequirement,
  TimeOff
} from "../../types";
import {
  meetsMinimumExperience,
  normalizeExperienceLevel,
  skillLevelToExperienceLevel
} from "../../types";
import {
  type AbsoluteShiftInterval,
  type DailyMinuteContribution,
  addDays,
  buildShiftInterval,
  dateToDayNumber,
  getDayOfWeekFromDate,
  getOwningDateMinuteContribution,
  getShiftDurationMinutes,
  getWeekKey,
  intervalsOverlap,
  timeToMinutes
} from "./model/workingTime";

export const hardConstraintViolationCodes = [
  "INACTIVE_EMPLOYEE",
  "MISSING_ROLE",
  "INSUFFICIENT_EXPERIENCE",
  "TIME_OFF",
  "DAY_UNAVAILABLE",
  "SHIFT_UNAVAILABLE",
  "TIME_WINDOW_UNAVAILABLE",
  "SHIFT_OVERLAP",
  "MAX_DAILY_HOURS",
  "MAX_WEEKLY_SHIFTS",
  "WEEKEND_NOT_ALLOWED",
  "INVALID_SHIFT_INTERVAL",
  "INSUFFICIENT_GROUP_EXPERIENCE"
] as const;

export type HardConstraintViolationCode =
  (typeof hardConstraintViolationCodes)[number];

export type HardConstraintViolation = {
  code: HardConstraintViolationCode;
  message: string;
  employeeId: string;
  slotId: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ManualOverride = {
  slotId: string;
  employeeId: string;
  allowedViolationCodes: HardConstraintViolationCode[];
  reason: string;
};

export type ManualOverrideMap = Record<string, Array<string | ManualOverride>>;

export type AssignedShift = {
  employeeId: string;
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  durationMinutes: number;
  interval: AbsoluteShiftInterval;
  dailyContributions: DailyMinuteContribution[];
  weekKey: string;
};

export type SchedulerData = {
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability?: EmployeeShiftAvailability[];
  employeeTimeConstraints?: EmployeeTimeConstraint[];
  staffingRequirements?: StaffingRequirement[];
  timeOff: TimeOff[];
  weekStartsOn?: DayOfWeek;
  timezone?: string | null;
};

export type HardConstraintResult = {
  allowed: boolean;
  violations: HardConstraintViolation[];
  reasons: string[];
};

export function buildAssignedShift(
  slot: ScheduleSlot,
  employeeId: string,
  data?: Pick<SchedulerData, "weekStartsOn" | "timezone">
): AssignedShift {
  const interval = buildShiftInterval({
    date: slot.date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    timezone: data?.timezone
  });
  const durationMinutes = getShiftDurationMinutes({
    date: slot.date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    timezone: data?.timezone
  });

  return {
    employeeId,
    slotId: slot.id,
    date: slot.date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    durationHours: durationMinutes / 60,
    durationMinutes,
    interval,
    dailyContributions: [
      getOwningDateMinuteContribution({
        date: slot.date,
        startTime: slot.start_time,
        endTime: slot.end_time,
        timezone: data?.timezone
      })
    ],
    weekKey: getWeekKey({
      date: slot.date,
      weekStartsOn: data?.weekStartsOn ?? 1
    })
  };
}

export function buildExistingAssignedShifts({
  slots,
  assignments,
  data
}: {
  slots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  data?: Pick<SchedulerData, "weekStartsOn" | "timezone">;
}): AssignedShift[] {
  const slotById = new Map(slots.map((slot) => [slot.id, slot]));

  return assignments
    .filter(
      (assignment) =>
        assignment.status !== "cancelled" && assignment.status !== "removed"
    )
    .flatMap((assignment) => {
      const slot = slotById.get(assignment.schedule_slot_id);

      if (!slot) {
        return [];
      }

      return [buildAssignedShift(slot, assignment.employee_id, data)];
    });
}

export function checkHardConstraints({
  employee,
  slot,
  data,
  assignedShifts,
  manualOverrides = {}
}: {
  employee: Employee;
  slot: ScheduleSlot;
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  manualOverrides?: ManualOverrideMap;
}): HardConstraintResult {
  const violations: HardConstraintViolation[] = [];
  const weekStartsOn = data.weekStartsOn ?? 1;
  const timezone = data.timezone;
  let candidateShift: AssignedShift | null = null;

  function addViolation(
    code: HardConstraintViolationCode,
    message: string,
    metadata?: Record<string, string | number | boolean | null>
  ) {
    if (isViolationOverridden({ manualOverrides, slot, employee, code })) {
      return;
    }

    violations.push({
      code,
      message,
      employeeId: employee.id,
      slotId: slot.id,
      metadata
    });
  }

  try {
    candidateShift = buildAssignedShift(slot, employee.id, {
      weekStartsOn,
      timezone
    });
  } catch (error) {
    addViolation("INVALID_SHIFT_INTERVAL", getErrorMessage(error));
  }

  if (employee.is_active !== 1) {
    addViolation("INACTIVE_EMPLOYEE", "Employee is inactive.");
  }

  if (!employeeHasRole(employee.id, slot.role_id, data.employeeRoles)) {
    addViolation("MISSING_ROLE", "Employee does not have the required role.");
  } else {
    const employeeExperienceLevel = getEmployeeRoleExperienceLevel(
      employee.id,
      slot.role_id,
      data.employeeRoles
    );
    const requiredExperienceLevel = getSlotMinimumExperienceLevel(
      slot,
      data.staffingRequirements ?? []
    );

    if (
      !meetsMinimumExperience(employeeExperienceLevel, requiredExperienceLevel)
    ) {
      addViolation(
        "INSUFFICIENT_EXPERIENCE",
        "Employee does not meet the required experience level for this role."
      );
    }
  }

  const touchedDates = candidateShift?.dailyContributions.map((item) => item.date) ?? [
    slot.date
  ];

  for (const touchedDate of touchedDates) {
    if (hasTimeOffOnDate(employee.id, touchedDate, data.timeOff)) {
      addViolation("TIME_OFF", "Employee has time off on this date.", {
        date: touchedDate
      });
    }

    const dayConstraint = getDayConstraint(
      employee.id,
      getDayOfWeek(touchedDate),
      data.employeeDayConstraints
    );

    if (dayConstraint?.constraint_type === "cannot_work") {
      addViolation("DAY_UNAVAILABLE", "Employee cannot work on this day.", {
        date: touchedDate,
        dayOfWeek: getDayOfWeek(touchedDate)
      });
    }
  }

  const shiftAvailability = getEmployeeShiftAvailability({
    employeeId: employee.id,
    slot,
    data
  });

  if (shiftAvailability?.availability_type === "cannot_work") {
    addViolation("SHIFT_UNAVAILABLE", "Employee is not available for this shift.");
  }

  if (candidateShift) {
    const overlappingShift = getOverlappingShift(
      employee.id,
      candidateShift.interval,
      assignedShifts
    );

    if (overlappingShift) {
      addViolation("SHIFT_OVERLAP", "Employee already has an overlapping shift.", {
        conflictingSlotId: overlappingShift.slotId,
        conflictingStart: overlappingShift.startTime,
        conflictingEnd: overlappingShift.endTime
      });
    }

    for (const constraint of getOverlappingCannotWorkTimeConstraints({
      employeeId: employee.id,
      candidateShift,
      constraints: data.employeeTimeConstraints ?? [],
      timezone
    })) {
      addViolation(
        "TIME_WINDOW_UNAVAILABLE",
        "Employee cannot work during this time window.",
        {
          constraintId: constraint.id,
          date: constraint.date,
          dayOfWeek: constraint.day_of_week,
          startTime: constraint.start_time,
          endTime: constraint.end_time
        }
      );
    }
  }

  const workRules = getEmployeeWorkRules(employee.id, data.employeeWorkRules);
  const maxShiftsPerWeek = getEffectiveMaxShiftsPerWeek(workRules);

  if (
    workRules?.can_work_weekends === 0 &&
    touchedDates.some((date) => isWeekendDate(date))
  ) {
    addViolation("WEEKEND_NOT_ALLOWED", "Employee cannot work weekends.", {
      dates: touchedDates.join(",")
    });
  }

  if (candidateShift && workRules && workRules.max_hours_per_day !== null) {
    const maximumMinutes = Math.round(workRules.max_hours_per_day * 60);

    for (const contribution of candidateShift.dailyContributions) {
      const existingMinutes = getAssignedMinutesOnDate(
        employee.id,
        contribution.date,
        assignedShifts
      );
      const projectedMinutes = existingMinutes + contribution.minutes;

      if (projectedMinutes > maximumMinutes) {
        addViolation(
          "MAX_DAILY_HOURS",
          `Employee would exceed max daily hours (${formatMinutesAsHours(projectedMinutes)}/${formatMinutesAsHours(maximumMinutes)}).`,
          {
            date: contribution.date,
            existingMinutes,
            candidateMinutes: contribution.minutes,
            projectedMinutes,
            maximumMinutes
          }
        );
      }
    }
  }

  if (candidateShift && maxShiftsPerWeek !== null) {
    const existingShiftCount = getAssignedShiftCountForWeek(
      employee.id,
      candidateShift.weekKey,
      assignedShifts
    );
    const projectedShiftCount = existingShiftCount + 1;

    if (projectedShiftCount > maxShiftsPerWeek) {
      addViolation(
        "MAX_WEEKLY_SHIFTS",
        `Employee would exceed max weekly shifts (${projectedShiftCount}/${maxShiftsPerWeek}).`,
        {
          weekKey: candidateShift.weekKey,
          existingShiftCount,
          projectedShiftCount,
          maximumShiftCount: maxShiftsPerWeek
        }
      );
    }
  }

  const reasons = violations.map((violation) => violation.message);

  return {
    allowed: violations.length === 0,
    violations,
    reasons
  };
}

export function employeeHasRole(
  employeeId: string,
  roleId: string,
  employeeRoles: EmployeeRole[]
): boolean {
  return employeeRoles.some(
    (employeeRole) =>
      employeeRole.employee_id === employeeId && employeeRole.role_id === roleId
  );
}

export function getEmployeeRoleExperienceLevel(
  employeeId: string,
  roleId: string,
  employeeRoles: EmployeeRole[]
): ExperienceLevel {
  const employeeRole = employeeRoles.find(
    (item) => item.employee_id === employeeId && item.role_id === roleId
  );

  if (!employeeRole) {
    return "some_experience";
  }

  return normalizeExperienceLevel(
    employeeRole.experience_level ??
      skillLevelToExperienceLevel(employeeRole.skill_level)
  );
}

export function getEmployeeWorkRules(
  employeeId: string,
  workRules: EmployeeWorkRules[]
): EmployeeWorkRules | null {
  return workRules.find((item) => item.employee_id === employeeId) ?? null;
}

export function getApproximateTargetHoursPerWeek(
  workRules: EmployeeWorkRules | null
): number | null {
  if (!workRules || workRules.target_hours_per_day === null) {
    return null;
  }

  return workRules.target_hours_per_day * workRules.max_shifts_per_week;
}

export function getTargetShiftCountPerWeek(
  workRules: EmployeeWorkRules | null
): number | null {
  return workRules?.max_shifts_per_week ?? null;
}

export function getEffectiveMaxShiftsPerWeek(
  workRules: EmployeeWorkRules | null
): number | null {
  return workRules?.max_shifts_per_week ?? null;
}

export function getDayConstraint(
  employeeId: string,
  dayOfWeek: DayOfWeek,
  constraints: EmployeeDayConstraint[]
): EmployeeDayConstraint | null {
  return (
    constraints.find(
      (constraint) =>
        constraint.employee_id === employeeId &&
        constraint.day_of_week === dayOfWeek
    ) ?? null
  );
}

export function getEmployeeShiftAvailability({
  employeeId,
  slot,
  data
}: {
  employeeId: string;
  slot: ScheduleSlot;
  data: SchedulerData;
}): EmployeeShiftAvailability | null {
  const shiftTemplateId = getSlotShiftTemplateId(slot, data.staffingRequirements ?? []);

  if (!shiftTemplateId) {
    return null;
  }

  return (
    (data.employeeShiftAvailability ?? []).find(
      (item) =>
        item.employee_id === employeeId &&
        item.day_of_week === getDayOfWeek(slot.date) &&
        item.shift_template_id === shiftTemplateId
    ) ?? null
  );
}

export function getSlotShiftTemplateId(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): string | null {
  return getSlotStaffingRequirement(slot, staffingRequirements)?.shift_template_id ?? null;
}

export function getSlotStaffingRequirement(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): StaffingRequirement | null {
  if (!slot.source_id) {
    return null;
  }

  return (
    staffingRequirements.find((requirement) => requirement.id === slot.source_id) ??
    null
  );
}

export function getSlotMinimumExperienceLevel(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): ExperienceLevel {
  return normalizeExperienceLevel(
    slot.minimum_experience_level ??
      getSlotStaffingRequirement(slot, staffingRequirements)
        ?.minimum_experience_level ??
      "no_experience"
  );
}

export function getSlotExperiencedRequiredCount(
  slot: ScheduleSlot,
  staffingRequirements: StaffingRequirement[]
): number {
  return Math.max(
    0,
    slot.experienced_required_count ??
      getSlotStaffingRequirement(slot, staffingRequirements)
        ?.experienced_required_count ??
      0
  );
}

export function hasTimeOffOnDate(
  employeeId: string,
  date: string,
  timeOff: TimeOff[]
): boolean {
  return timeOff.some(
    (entry) =>
      entry.employee_id === employeeId &&
      entry.status !== "cancelled" &&
      entry.status !== "rejected" &&
      entry.start_date <= date &&
      entry.end_date >= date
  );
}

export function hasOverlappingShift(
  employeeId: string,
  slot: ScheduleSlot,
  assignedShifts: AssignedShift[]
): boolean {
  const slotInterval = buildShiftInterval({
    date: slot.date,
    startTime: slot.start_time,
    endTime: slot.end_time
  });

  return getOverlappingShift(employeeId, slotInterval, assignedShifts) !== null;
}

export function getSlotDurationHours(slot: ScheduleSlot): number {
  return (
    getShiftDurationMinutes({
      date: slot.date,
      startTime: slot.start_time,
      endTime: slot.end_time
    }) / 60
  );
}

export function getAssignedHours(
  employeeId: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts
    .filter((shift) => shift.employeeId === employeeId)
    .reduce((total, shift) => total + shift.durationMinutes / 60, 0);
}

export function getAssignedShiftCount(
  employeeId: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts.filter((shift) => shift.employeeId === employeeId).length;
}

export function getAssignedShiftCountForWeek(
  employeeId: string,
  weekKey: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts.filter(
    (shift) => shift.employeeId === employeeId && shift.weekKey === weekKey
  ).length;
}

export function getAssignedMinutesOnDate(
  employeeId: string,
  date: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts
    .filter((shift) => shift.employeeId === employeeId)
    .flatMap((shift) => shift.dailyContributions)
    .filter((contribution) => contribution.date === date)
    .reduce((total, contribution) => total + contribution.minutes, 0);
}

export function getWeekendShiftCount(
  employeeId: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts.filter(
    (shift) =>
      shift.employeeId === employeeId &&
      shift.dailyContributions.some((item) => isWeekendDate(item.date))
  ).length;
}

export function getNightShiftCount(
  employeeId: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts.filter(
    (shift) =>
      shift.employeeId === employeeId &&
      isNightOrDifficultShift(shift.startTime, shift.endTime)
  ).length;
}

export function getConsecutiveDayCountIfAssigned(
  employeeId: string,
  assignedShifts: AssignedShift[],
  date: string
): number {
  const dayNumbers = new Set(
    assignedShifts
      .filter((shift) => shift.employeeId === employeeId)
      .map((shift) => dateToDayNumber(shift.date))
  );
  const targetDay = dateToDayNumber(date);

  dayNumbers.add(targetDay);

  let firstDay = targetDay;
  let lastDay = targetDay;

  while (dayNumbers.has(firstDay - 1)) {
    firstDay -= 1;
  }

  while (dayNumbers.has(lastDay + 1)) {
    lastDay += 1;
  }

  return lastDay - firstDay + 1;
}

export function isWeekendDate(date: string): boolean {
  const dayOfWeek = getDayOfWeek(date);
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export function getDayOfWeek(date: string): DayOfWeek {
  return getDayOfWeekFromDate(date);
}

export function isNightOrDifficultShift(
  startTime: string,
  endTime: string
): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  return end <= start || start < 6 * 60 || end > 22 * 60;
}

export function getOverlappingShift(
  employeeId: string,
  interval: AbsoluteShiftInterval,
  assignedShifts: AssignedShift[]
): AssignedShift | null {
  return (
    assignedShifts.find(
      (assignedShift) =>
        assignedShift.employeeId === employeeId &&
        intervalsOverlap(interval, assignedShift.interval)
    ) ?? null
  );
}

export function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getOverlappingCannotWorkTimeConstraints({
  employeeId,
  candidateShift,
  constraints,
  timezone
}: {
  employeeId: string;
  candidateShift: AssignedShift;
  constraints: EmployeeTimeConstraint[];
  timezone?: string | null;
}): EmployeeTimeConstraint[] {
  const intervalDates = getCandidateIntervalDates(candidateShift);

  return constraints.filter((constraint) => {
    if (
      constraint.employee_id !== employeeId ||
      constraint.constraint_type !== "cannot_work"
    ) {
      return false;
    }

    const applicableDates = intervalDates.filter((date) => {
      if (constraint.date !== null) {
        return constraint.date === date;
      }

      if (constraint.day_of_week !== null) {
        return constraint.day_of_week === getDayOfWeek(date);
      }

      return false;
    });

    return applicableDates.some((date) => {
      const constraintInterval = buildShiftInterval({
        date,
        startTime: constraint.start_time,
        endTime: constraint.end_time,
        timezone
      });

      return intervalsOverlap(candidateShift.interval, constraintInterval);
    });
  });
}

function getCandidateIntervalDates(candidateShift: AssignedShift): string[] {
  const dates = [candidateShift.date];

  if (timeToMinutes(candidateShift.endTime) <= timeToMinutes(candidateShift.startTime)) {
    dates.push(addDays(candidateShift.date, 1));
  }

  return dates;
}

function isViolationOverridden({
  manualOverrides,
  slot,
  employee,
  code
}: {
  manualOverrides: ManualOverrideMap;
  slot: ScheduleSlot;
  employee: Employee;
  code: HardConstraintViolationCode;
}): boolean {
  const overrides = manualOverrides[slot.id] ?? [];

  return overrides.some((override) => {
    if (typeof override === "string") {
      return override === employee.id && code === "MAX_WEEKLY_SHIFTS";
    }

    return (
      override.slotId === slot.id &&
      override.employeeId === employee.id &&
      override.allowedViolationCodes.includes(code)
    );
  });
}

function formatMinutesAsHours(minutes: number): string {
  return formatHours(minutes / 60);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
