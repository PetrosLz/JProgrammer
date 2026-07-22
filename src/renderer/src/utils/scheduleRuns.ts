import { databaseApi } from "../../services/databaseApi";

export async function deleteGeneratedProgram({
  runId
}: {
  runId: string;
}): Promise<void> {
  await databaseApi.deleteScheduleRunGraph({ scheduleRunId: runId });
}
