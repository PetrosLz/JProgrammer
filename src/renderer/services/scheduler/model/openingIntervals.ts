import type { DayOfWeek, OpeningHours, SpecialDay } from "../../../types";
import {
  addDays,
  buildShiftInterval,
  dateToDayNumber,
  dayNumberToDate,
  formatTimeRange,
  getDayOfWeekFromDate,
  isValidTimeString
} from "./workingTime";

export type OpeningIntervalReasonCode =
  | "ALLOWED"
  | "BUSINESS_CLOSED"
  | "SLOT_BEFORE_OPENING"
  | "SLOT_AFTER_CLOSING"
  | "SLOT_CROSSES_CLOSED_PERIOD"
  | "INVALID_OPENING_HOURS"
  | "INVALID_SLOT_INTERVAL";

export type ContinuousOpeningInterval = {
  startMs: number;
  endMs: number;
  businessDate: string;
  dayOfWeek: DayOfWeek;
  openingHoursId: string;
  label: string;
};

export type OpeningIntervalBuildResult =
  | {
      ok: true;
      interval: ContinuousOpeningInterval | null;
    }
  | {
      ok: false;
      reasonCode: "INVALID_OPENING_HOURS";
      businessDate: string;
      openingHoursId: string;
      message: string;
    };

export type OpeningContainmentResult = {
  allowed: boolean;
  slotInterval: { startMs: number; endMs: number } | null;
  relevantOpeningIntervals: ContinuousOpeningInterval[];
  mergedOpeningIntervals: ContinuousOpeningInterval[];
  reasonCode: OpeningIntervalReasonCode;
  message: string;
};

const minutesPerDay = 24 * 60;
const msPerMinute = 60 * 1000;

export function buildOpeningIntervalForBusinessDate({
  businessDate,
  openingHours,
  specialDays = []
}: {
  businessDate: string;
  openingHours: OpeningHours[];
  specialDays?: SpecialDay[];
}): OpeningIntervalBuildResult {
  const specialDay = specialDays.find((item) => item.date === businessDate);
  if (specialDay?.is_closed) {
    return { ok: true, interval: null };
  }

  const dayOfWeek = getDayOfWeekFromDate(businessDate);
  const openingHour = openingHours.find((item) => item.day_of_week === dayOfWeek);

  if (!openingHour || !openingHour.is_open) {
    return { ok: true, interval: null };
  }

  if (openingHour.is_24_hours) {
    const startMs = dateToDayNumber(businessDate) * minutesPerDay * msPerMinute;
    return {
      ok: true,
      interval: {
        startMs,
        endMs: startMs + minutesPerDay * msPerMinute,
        businessDate,
        dayOfWeek,
        openingHoursId: openingHour.id,
        label: `${businessDate} 00:00-00:00 (+1 day)`
      }
    };
  }

  if (!openingHour.open_time || !openingHour.close_time) {
    return {
      ok: false,
      reasonCode: "INVALID_OPENING_HOURS",
      businessDate,
      openingHoursId: openingHour.id,
      message: `${businessDate} has custom opening hours without both opening and closing time.`
    };
  }

  try {
    const interval = buildShiftInterval({
      date: businessDate,
      startTime: openingHour.open_time,
      endTime: openingHour.close_time
    });
    return {
      ok: true,
      interval: {
        ...interval,
        businessDate,
        dayOfWeek,
        openingHoursId: openingHour.id,
        label: `${businessDate} ${formatTimeRange({
          startTime: openingHour.open_time,
          endTime: openingHour.close_time
        })}`
      }
    };
  } catch (error) {
    return {
      ok: false,
      reasonCode: "INVALID_OPENING_HOURS",
      businessDate,
      openingHoursId: openingHour.id,
      message: `${businessDate} opening interval ${formatSafeTimeRange({
        startTime: openingHour.open_time,
        endTime: openingHour.close_time
      })} is invalid: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export function buildContinuousOpeningIntervals({
  anchorDate,
  openingHours,
  specialDays = []
}: {
  anchorDate: string;
  openingHours: OpeningHours[];
  specialDays?: SpecialDay[];
}): {
  intervals: ContinuousOpeningInterval[];
  invalidOpeningHours: Extract<OpeningIntervalBuildResult, { ok: false }>[];
} {
  const intervals: ContinuousOpeningInterval[] = [];
  const invalidOpeningHours: Extract<OpeningIntervalBuildResult, { ok: false }>[] = [];

  for (const businessDate of [
    addDays(anchorDate, -1),
    anchorDate,
    addDays(anchorDate, 1)
  ]) {
    const result = buildOpeningIntervalForBusinessDate({
      businessDate,
      openingHours,
      specialDays
    });

    if (!result.ok) {
      invalidOpeningHours.push(result);
      continue;
    }

    if (result.interval) {
      intervals.push(result.interval);
    }
  }

  return {
    intervals,
    invalidOpeningHours
  };
}

export function mergeAdjacentIntervals(
  intervals: ContinuousOpeningInterval[]
): ContinuousOpeningInterval[] {
  const sorted = [...intervals].sort((first, second) => first.startMs - second.startMs);
  const merged: ContinuousOpeningInterval[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];

    if (!previous || interval.startMs > previous.endMs) {
      merged.push({ ...interval });
      continue;
    }

    previous.endMs = Math.max(previous.endMs, interval.endMs);
    previous.label = `${formatAbsoluteInterval(previous)}`;
  }

  return merged;
}

export function isShiftContainedWithinOpeningIntervals({
  date,
  startTime,
  endTime,
  openingHours,
  specialDays = []
}: {
  date: string;
  startTime: string;
  endTime: string;
  openingHours: OpeningHours[];
  specialDays?: SpecialDay[];
}): OpeningContainmentResult {
  let slotInterval: { startMs: number; endMs: number };

  try {
    slotInterval = buildShiftInterval({ date, startTime, endTime });
  } catch (error) {
    return {
      allowed: false,
      slotInterval: null,
      relevantOpeningIntervals: [],
      mergedOpeningIntervals: [],
      reasonCode: "INVALID_SLOT_INTERVAL",
      message: `${date} ${formatSafeTimeRange({ startTime, endTime })} was not generated because the time range is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }

  if (openingHours.length === 0) {
    return {
      allowed: true,
      slotInterval,
      relevantOpeningIntervals: [],
      mergedOpeningIntervals: [],
      reasonCode: "ALLOWED",
      message: "No opening-hours rules are configured."
    };
  }

  const { intervals, invalidOpeningHours } = buildContinuousOpeningIntervals({
    anchorDate: date,
    openingHours,
    specialDays
  });
  const mergedOpeningIntervals = mergeAdjacentIntervals(intervals);
  const containingInterval = mergedOpeningIntervals.find(
    (interval) =>
      slotInterval.startMs >= interval.startMs && slotInterval.endMs <= interval.endMs
  );

  if (containingInterval) {
    return {
      allowed: true,
      slotInterval,
      relevantOpeningIntervals: intervals,
      mergedOpeningIntervals,
      reasonCode: "ALLOWED",
      message: `Slot is inside continuous opening interval ${formatAbsoluteInterval(containingInterval)}.`
    };
  }

  if (invalidOpeningHours.length > 0 && mergedOpeningIntervals.length === 0) {
    return {
      allowed: false,
      slotInterval,
      relevantOpeningIntervals: intervals,
      mergedOpeningIntervals,
      reasonCode: "INVALID_OPENING_HOURS",
      message: invalidOpeningHours.map((item) => item.message).join(" ")
    };
  }

  const reasonCode = classifyOutsideOpening(slotInterval, mergedOpeningIntervals);
  return {
    allowed: false,
    slotInterval,
    relevantOpeningIntervals: intervals,
    mergedOpeningIntervals,
    reasonCode,
    message: buildContainmentFailureMessage({
      date,
      startTime,
      endTime,
      reasonCode,
      mergedOpeningIntervals
    })
  };
}

export function formatOpeningHoursSummary({
  isOpen,
  is24Hours,
  openTime,
  closeTime,
  language
}: {
  isOpen: boolean;
  is24Hours: boolean;
  openTime: string | null;
  closeTime: string | null;
  language: "en" | "el";
}): string {
  if (!isOpen) {
    return language === "en" ? "Closed" : "Κλειστά";
  }

  if (is24Hours) {
    return language === "en" ? "Open 24 hours" : "24 Ώρες";
  }

  if (
    !isValidTimeString(openTime) ||
    !isValidTimeString(closeTime) ||
    openTime === closeTime
  ) {
    return language === "en" ? "Invalid time range" : "Μη έγκυρο";
  }

  return formatTimeRange({
    startTime: openTime,
    endTime: closeTime,
    language
  });
}

export function formatAbsoluteInterval(interval: {
  startMs: number;
  endMs: number;
}): string {
  return `${formatAbsoluteEndpoint(interval.startMs)}-${formatAbsoluteEndpoint(interval.endMs)}`;
}

function classifyOutsideOpening(
  slotInterval: { startMs: number; endMs: number },
  intervals: ContinuousOpeningInterval[]
): OpeningIntervalReasonCode {
  if (intervals.length === 0) {
    return "BUSINESS_CLOSED";
  }

  if (slotInterval.endMs <= intervals[0].startMs) {
    return "SLOT_BEFORE_OPENING";
  }

  if (slotInterval.startMs >= intervals[intervals.length - 1].endMs) {
    return "SLOT_AFTER_CLOSING";
  }

  return "SLOT_CROSSES_CLOSED_PERIOD";
}

function buildContainmentFailureMessage({
  date,
  startTime,
  endTime,
  reasonCode,
  mergedOpeningIntervals
}: {
  date: string;
  startTime: string;
  endTime: string;
  reasonCode: OpeningIntervalReasonCode;
  mergedOpeningIntervals: ContinuousOpeningInterval[];
}): string {
  const slotLabel = `${date} ${formatSafeTimeRange({ startTime, endTime })}`;

  if (mergedOpeningIntervals.length === 0) {
    return `${slotLabel} was not generated because the business is closed.`;
  }

  const openingLabels = mergedOpeningIntervals.map(formatAbsoluteInterval).join(", ");
  const reason =
    reasonCode === "SLOT_BEFORE_OPENING"
      ? "before opening"
      : reasonCode === "SLOT_AFTER_CLOSING"
        ? "after closing"
        : "across a closed period";

  return `${slotLabel} was not generated because it falls ${reason}. Continuous opening interval: ${openingLabels}.`;
}

function formatSafeTimeRange({
  startTime,
  endTime
}: {
  startTime: string;
  endTime: string;
}): string {
  try {
    return formatTimeRange({ startTime, endTime });
  } catch {
    return `${startTime}-${endTime}`;
  }
}

function formatAbsoluteEndpoint(ms: number): string {
  const totalMinutes = Math.round(ms / msPerMinute);
  const dayNumber = Math.floor(totalMinutes / minutesPerDay);
  const minuteOfDay = ((totalMinutes % minutesPerDay) + minutesPerDay) % minutesPerDay;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${dayNumberToDate(dayNumber)} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
