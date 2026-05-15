import type { Employee, ScheduleSlot } from "../../types";
import { formatHours, getSlotDurationHours } from "./constraints";
import type { CandidateScore } from "./scoring";

export function buildAssignmentExplanation({
  employee,
  slot,
  score
}: {
  employee: Employee;
  slot: ScheduleSlot;
  score: CandidateScore;
}): string {
  const factors = score.details
    .filter((detail) => detail.label !== "Base score")
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 5)
    .map(
      (detail) =>
        `${detail.points > 0 ? "+" : ""}${formatScore(detail.points)} ${detail.label}`
    );

  const factorText =
    factors.length > 0 ? ` Main factors: ${factors.join("; ")}.` : "";

  return `Assigned ${employee.first_name} ${employee.last_name} to ${slot.date} ${slot.start_time}-${slot.end_time} (${formatHours(
    getSlotDurationHours(slot)
  )}h). Score ${formatScore(score.totalScore)}.${factorText}`;
}

export function buildUnfilledSlotMessage({
  slot,
  rejectionReasons
}: {
  slot: ScheduleSlot;
  rejectionReasons: string[];
}): string {
  const uniqueReasons = Array.from(new Set(rejectionReasons)).slice(0, 4);
  const reasonText =
    uniqueReasons.length > 0
      ? ` Hard constraints: ${uniqueReasons.join(" ")}`
      : " No employees were available for scoring.";

  return `No candidate could fill ${slot.date} ${slot.start_time}-${slot.end_time}.${reasonText}`;
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
