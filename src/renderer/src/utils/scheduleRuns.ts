import { databaseApi } from "../../services/databaseApi";
import type {
  ScheduleAssignment,
  ScheduleSlot,
  ScheduleWarning
} from "../../types";

export async function deleteGeneratedProgram({
  runId,
  scheduleSlots,
  scheduleAssignments,
  scheduleWarnings
}: {
  runId: string;
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  scheduleWarnings: ScheduleWarning[];
}): Promise<void> {
  for (const warning of scheduleWarnings.filter(
    (item) => item.schedule_run_id === runId
  )) {
    await databaseApi.deleteRecord("schedule_warnings", warning.id);
  }

  for (const assignment of scheduleAssignments.filter(
    (item) => item.schedule_run_id === runId
  )) {
    await databaseApi.deleteRecord("schedule_assignments", assignment.id);
  }

  for (const slot of scheduleSlots.filter(
    (item) => item.schedule_run_id === runId
  )) {
    await databaseApi.deleteRecord("schedule_slots", slot.id);
  }

  await databaseApi.deleteRecord("schedule_runs", runId);
}
