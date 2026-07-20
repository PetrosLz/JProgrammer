import type {
  CpSatSolveRequest,
  CpSatSolveResult,
  SolverAvailability
} from "../../shared/solverTypes";
import type { DatabaseResult } from "../../shared/types";
import { DatabaseApiError } from "./databaseApi";

const unavailableSolver: SolverAvailability = {
  available: false,
  pythonExecutable: null,
  ortoolsAvailable: false,
  message: "CP-SAT solver IPC is unavailable in this runtime."
};

export const solverApi = {
  getCpSatAvailability: async (): Promise<SolverAvailability> => {
    const api = getApi();

    if (!api?.solver) {
      return unavailableSolver;
    }

    return unwrap(await api.solver.getCpSatAvailability());
  },

  solveScheduleWithCpSat: async (
    request: CpSatSolveRequest
  ): Promise<CpSatSolveResult> => {
    const api = getApi();

    if (!api?.solver) {
      return {
        requestId: request.requestId,
        assignments: [],
        status: "UNKNOWN",
        objectiveValues: {
          coveredSlots: 0,
          totalSlots: request.slots.length,
          coverageRate: 0
        },
        runtimeMs: 0,
        message: unavailableSolver.message
      };
    }

    return unwrap(await api.solver.solveScheduleWithCpSat(request));
  }
};

function getApi(): Window["jprogrammer"] | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.jprogrammer ?? null;
}

function unwrap<T>(result: DatabaseResult<T>): T {
  if (result.ok) {
    return result.data;
  }

  throw new DatabaseApiError(result.error.code, result.error.message);
}
