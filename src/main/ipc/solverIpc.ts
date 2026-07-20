import { ipcMain } from "electron";
import type {
  CpSatSolveRequest,
  CpSatSolveResult,
  SolverAvailability
} from "../../shared/solverTypes";
import type { DatabaseApiErrorPayload, DatabaseResult } from "../../shared/types";
import { getCpSatAvailability, solveScheduleWithCpSat } from "../solver/cpSatClient";

const solverChannels = [
  "solver:getCpSatAvailability",
  "solver:solveScheduleWithCpSat"
] as const;

export function registerSolverIpc(): void {
  for (const channel of solverChannels) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle("solver:getCpSatAvailability", () =>
    handleSolverOperation(() => getCpSatAvailability())
  );

  ipcMain.handle(
    "solver:solveScheduleWithCpSat",
    (_event, request: CpSatSolveRequest) =>
      handleSolverOperation(() => solveScheduleWithCpSat(request))
  );
}

async function handleSolverOperation<T>(
  operation: () => Promise<T>
): Promise<DatabaseResult<T>> {
  try {
    return {
      ok: true,
      data: await operation()
    };
  } catch (error) {
    console.error("Solver IPC operation failed:", error);

    return {
      ok: false,
      error: serializeSolverError(error)
    };
  }
}

function serializeSolverError(error: unknown): DatabaseApiErrorPayload {
  return {
    code: "SOLVER_UNKNOWN_ERROR",
    message:
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "An unknown solver error occurred."
  };
}

export type SolverIpcApi = {
  getCpSatAvailability: () => Promise<DatabaseResult<SolverAvailability>>;
  solveScheduleWithCpSat: (
    request: CpSatSolveRequest
  ) => Promise<DatabaseResult<CpSatSolveResult>>;
};
