import type { DayOfWeek } from "../../../types";

export type AbsoluteShiftInterval = {
  startMs: number;
  endMs: number;
};

export type DailyMinuteContribution = {
  date: string;
  minutes: number;
};

const minutesPerDay = 24 * 60;
const msPerMinute = 60 * 1000;
const msPerDay = minutesPerDay * msPerMinute;

export function buildShiftInterval({
  date,
  startTime,
  endTime
}: {
  date: string;
  startTime: string;
  endTime: string;
  timezone?: string | null;
}): AbsoluteShiftInterval {
  const startDay = dateToDayNumber(date);
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const durationMinutes =
    endMinutes > startMinutes
      ? endMinutes - startMinutes
      : endMinutes + minutesPerDay - startMinutes;

  return {
    startMs: (startDay * minutesPerDay + startMinutes) * msPerMinute,
    endMs:
      (startDay * minutesPerDay + startMinutes + durationMinutes) *
      msPerMinute
  };
}

export function getShiftDurationMinutes({
  date,
  startTime,
  endTime,
  timezone
}: {
  date: string;
  startTime: string;
  endTime: string;
  timezone?: string | null;
}): number {
  const interval = buildShiftInterval({ date, startTime, endTime, timezone });
  return Math.round((interval.endMs - interval.startMs) / msPerMinute);
}

export function intervalsOverlap(
  first: AbsoluteShiftInterval,
  second: AbsoluteShiftInterval
): boolean {
  return first.startMs < second.endMs && second.startMs < first.endMs;
}

export function getOwningDateMinuteContribution({
  date,
  startTime,
  endTime,
  timezone
}: {
  date: string;
  startTime: string;
  endTime: string;
  timezone?: string | null;
}): DailyMinuteContribution {
  return {
    date,
    minutes: getShiftDurationMinutes({ date, startTime, endTime, timezone })
  };
}

export function getWeekKey({
  date,
  weekStartsOn
}: {
  date: string;
  weekStartsOn: DayOfWeek;
}): string {
  const dayNumber = dateToDayNumber(date);
  const dayOfWeek = getDayOfWeekFromDate(date);
  const daysSinceWeekStart = (dayOfWeek - weekStartsOn + 7) % 7;
  return dayNumberToDate(dayNumber - daysSinceWeekStart);
}

export function addDays(date: string, days: number): string {
  return dayNumberToDate(dateToDayNumber(date) + days);
}

export function getDayOfWeekFromDate(date: string): DayOfWeek {
  const [year, month, day] = parseDateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as DayOfWeek;
}

export function dateToDayNumber(date: string): number {
  const [year, month, day] = parseDateParts(date);
  return Math.floor(Date.UTC(year, month - 1, day) / msPerDay);
}

export function dayNumberToDate(dayNumber: number): string {
  const date = new Date(dayNumber * msPerDay);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function timeToMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

export function normalizeTime(value: string): string {
  const [hour = "00", minute = "00"] = value.split(":");
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

function parseDateParts(date: string): [number, number, number] {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid business date: ${date}`);
  }

  return [year, month, day];
}
