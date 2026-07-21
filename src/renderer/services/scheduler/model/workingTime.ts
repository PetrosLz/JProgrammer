import type { DayOfWeek } from "../../../types";

export type AbsoluteShiftInterval = {
  startMs: number;
  endMs: number;
};

export type TimeRangeInterpretation = {
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  endsNextDay: boolean;
  isEqualTime: boolean;
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
  const interpretation = interpretTimeRange({
    startTime,
    endTime,
    allowEqualAsFullDay: false
  });

  return {
    startMs:
      (startDay * minutesPerDay + interpretation.startMinutes) * msPerMinute,
    endMs:
      (startDay * minutesPerDay +
        interpretation.startMinutes +
        interpretation.durationMinutes) *
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

export function interpretTimeRange({
  startTime,
  endTime,
  allowEqualAsFullDay = false
}: {
  startTime: string;
  endTime: string;
  allowEqualAsFullDay?: boolean;
}): TimeRangeInterpretation {
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const isEqualTime = endMinutes === startMinutes;

  if (isEqualTime && !allowEqualAsFullDay) {
    throw new Error("Equal start and end times are not valid for an ordinary shift.");
  }

  const endsNextDay = endMinutes < startMinutes || (isEqualTime && allowEqualAsFullDay);
  const durationMinutes =
    endMinutes > startMinutes
      ? endMinutes - startMinutes
      : endMinutes + minutesPerDay - startMinutes;

  return {
    startMinutes,
    endMinutes,
    durationMinutes,
    endsNextDay,
    isEqualTime
  };
}

export function isNextDayTimeRange(startTime: string, endTime: string): boolean {
  return timeToMinutes(endTime) < timeToMinutes(startTime);
}

export function formatTimeRange({
  startTime,
  endTime,
  language = "en"
}: {
  startTime: string;
  endTime: string;
  language?: "en" | "el";
}): string {
  const suffix = isNextDayTimeRange(startTime, endTime)
    ? ` ${language === "en" ? "(+1 day)" : "(+1 ημέρα)"}`
    : "";

  return `${startTime}–${endTime}${suffix}`;
}

export function formatDurationMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (remainder === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
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

