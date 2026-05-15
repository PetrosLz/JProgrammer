import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  ScheduleAssignment,
  ScheduleSlot,
  StaffingRequirement,
  TimeOff
} from "../../types";
import { getDayOfWeek } from "./generateSlots";

const dayInMs = 24 * 60 * 60 * 1000;

export type ManualOverrideMap = Record<string, string[]>;

export type AssignedShift = {
  employeeId: string;
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
};

export type SchedulerData = {
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability?: EmployeeShiftAvailability[];
  staffingRequirements?: StaffingRequirement[];
  timeOff: TimeOff[];
};

export type HardConstraintResult = {
  allowed: boolean;
  reasons: string[];
};

export function buildAssignedShift(
  slot: ScheduleSlot,
  employeeId: string
): AssignedShift {
  return {
    employeeId,
    slotId: slot.id,
    date: slot.date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    durationHours: getSlotDurationHours(slot)
  };
}

export function buildExistingAssignedShifts({
  slots,
  assignments
}: {
  slots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
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

      return [buildAssignedShift(slot, assignment.employee_id)];
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
  const reasons: string[] = [];

  if (employee.is_active !== 1) {
    reasons.push("Employee is inactive.");
  }

  if (!employeeHasRole(employee.id, slot.role_id, data.employeeRoles)) {
    reasons.push("Employee does not have the required role.");
  }

  if (hasTimeOffOnDate(employee.id, slot.date, data.timeOff)) {
    reasons.push("Employee has time off on this date.");
  }

  const dayConstraint = getDayConstraint(
    employee.id,
    getDayOfWeek(slot.date),
    data.employeeDayConstraints
  );

  if (dayConstraint?.constraint_type === "cannot_work") {
    reasons.push("Employee cannot work on this day.");
  }

  const shiftAvailability = getEmployeeShiftAvailability({
    employeeId: employee.id,
    slot,
    data
  });

  if (shiftAvailability?.availability_type === "cannot_work") {
    reasons.push("Employee is not available for this shift.");
  }

  if (hasAssignmentOnDate(employee.id, slot.date, assignedShifts)) {
    reasons.push("Employee already has a shift on this date.");
  }

  if (hasOverlappingShift(employee.id, slot, assignedShifts)) {
    reasons.push("Employee already has an overlapping shift.");
  }

  const workRules = getEmployeeWorkRules(employee.id, data.employeeWorkRules);
  const hasMaxHoursOverride = manualOverrides[slot.id]?.includes(employee.id);
  const hasMaxDaysOverride = manualOverrides[slot.id]?.includes(employee.id);

  if (
    workRules?.max_hours_per_week !== null &&
    workRules?.max_hours_per_week !== undefined &&
    !hasMaxHoursOverride
  ) {
    const projectedHours =
      getAssignedHours(employee.id, assignedShifts) + getSlotDurationHours(slot);

    if (projectedHours > workRules.max_hours_per_week) {
      reasons.push(
        `Employee would exceed max weekly hours (${formatHours(projectedHours)}/${formatHours(
          workRules.max_hours_per_week
        )}).`
      );
    }
  }

  if (
    workRules?.max_days_per_week !== null &&
    workRules?.max_days_per_week !== undefined &&
    !hasMaxDaysOverride
  ) {
    const projectedDays = getAssignedDayCount(employee.id, assignedShifts, slot.date);

    if (projectedDays > workRules.max_days_per_week) {
      reasons.push(
        `Employee would exceed max weekly days (${projectedDays}/${workRules.max_days_per_week}).`
      );
    }
  }

  return {
    allowed: reasons.length === 0,
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

export function getEmployeeWorkRules(
  employeeId: string,
  workRules: EmployeeWorkRules[]
): EmployeeWorkRules | null {
  return workRules.find((item) => item.employee_id === employeeId) ?? null;
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
  if (!slot.source_id) {
    return null;
  }

  return (
    staffingRequirements.find((requirement) => requirement.id === slot.source_id)
      ?.shift_template_id ?? null
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
  const slotInterval = getShiftInterval(slot.date, slot.start_time, slot.end_time);

  return assignedShifts.some((assignedShift) => {
    if (assignedShift.employeeId !== employeeId) {
      return false;
    }

    const assignedInterval = getShiftInterval(
      assignedShift.date,
      assignedShift.startTime,
      assignedShift.endTime
    );

    return (
      slotInterval.start < assignedInterval.end &&
      slotInterval.end > assignedInterval.start
    );
  });
}

export function hasAssignmentOnDate(
  employeeId: string,
  date: string,
  assignedShifts: AssignedShift[]
): boolean {
  // TODO: Some businesses may allow split shifts later; maxShiftsPerDay is 1 for the MVP.
  return assignedShifts.some(
    (assignedShift) =>
      assignedShift.employeeId === employeeId && assignedShift.date === date
  );
}

export function getSlotDurationHours(slot: ScheduleSlot): number {
  const start = timeToMinutes(slot.start_time);
  let end = timeToMinutes(slot.end_time);

  if (end <= start) {
    end += 24 * 60;
  }

  return (end - start) / 60;
}

export function getAssignedHours(
  employeeId: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts
    .filter((shift) => shift.employeeId === employeeId)
    .reduce((total, shift) => total + shift.durationHours, 0);
}

export function getAssignedShiftCount(
  employeeId: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts.filter((shift) => shift.employeeId === employeeId).length;
}

export function getAssignedDayCount(
  employeeId: string,
  assignedShifts: AssignedShift[],
  extraDate?: string
): number {
  const dates = new Set(
    assignedShifts
      .filter((shift) => shift.employeeId === employeeId)
      .map((shift) => shift.date)
  );

  if (extraDate) {
    dates.add(extraDate);
  }

  return dates.size;
}

export function getWeekendShiftCount(
  employeeId: string,
  assignedShifts: AssignedShift[]
): number {
  return assignedShifts.filter(
    (shift) => shift.employeeId === employeeId && isWeekendDate(shift.date)
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

export function isNightOrDifficultShift(
  startTime: string,
  endTime: string
): boolean {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);

  return end <= start || start < 6 * 60 || end > 22 * 60;
}

export function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getShiftInterval(
  date: string,
  startTime: string,
  endTime: string
): { start: number; end: number } {
  const start = new Date(`${date}T${normalizeTime(startTime)}:00`).getTime();
  let end = new Date(`${date}T${normalizeTime(endTime)}:00`).getTime();

  if (end <= start) {
    end += dayInMs;
  }

  return { start, end };
}

function timeToMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function normalizeTime(value: string): string {
  const [hour = "00", minute = "00"] = value.split(":");
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function dateToDayNumber(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00`).getTime() / dayInMs);
}
