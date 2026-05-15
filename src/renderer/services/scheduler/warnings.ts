import type { ScheduleSlot } from "../../types";
import type { CandidateScoreWarning } from "./scoring";

export type SchedulerWarningDraft = {
  scheduleRunId: string;
  scheduleSlotId: string | null;
  scheduleAssignmentId: string | null;
  severity: "info" | "warning";
  warningType: string;
  message: string;
};

export function createNoSlotsWarning(scheduleRunId: string): SchedulerWarningDraft {
  return {
    scheduleRunId,
    scheduleSlotId: null,
    scheduleAssignmentId: null,
    severity: "warning",
    warningType: "no_slots_to_assign",
    message: "This schedule run has no unfilled slots to assign."
  };
}

export function createUnfilledSlotWarning({
  scheduleRunId,
  slot,
  message
}: {
  scheduleRunId: string;
  slot: ScheduleSlot;
  message: string;
}): SchedulerWarningDraft {
  return {
    scheduleRunId,
    scheduleSlotId: slot.id,
    scheduleAssignmentId: null,
    severity: "warning",
    warningType: "slot_unfilled",
    message
  };
}

export function createSoftScoreWarnings({
  scheduleRunId,
  slot,
  assignmentId,
  warnings
}: {
  scheduleRunId: string;
  slot: ScheduleSlot;
  assignmentId: string;
  warnings: CandidateScoreWarning[];
}): SchedulerWarningDraft[] {
  return warnings.map((warning) => ({
    scheduleRunId,
    scheduleSlotId: slot.id,
    scheduleAssignmentId: assignmentId,
    severity: warning.severity,
    warningType: warning.warningType,
    message: warning.message
  }));
}
