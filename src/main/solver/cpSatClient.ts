import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { CpSatSolveRequest, CpSatSolveResult, SolverAvailability } from "../../shared/solverTypes";
import { type PythonCommand, runSolverProcess } from "./solverProcess";

const defaultSolverTimeoutMs = 15_000;

export async function getCpSatAvailability(): Promise<SolverAvailability> {
  const scriptPath = getSolverScriptPath();

  if (!existsSync(scriptPath)) {
    return {
      available: false,
      pythonExecutable: null,
      ortoolsAvailable: false,
      message: `CP-SAT solver script was not found at ${scriptPath}.`
    };
  }

  const python = discoverPythonCommand();

  if (!python) {
    return {
      available: false,
      pythonExecutable: null,
      ortoolsAvailable: false,
      message:
        "Python runtime was not found. Install Python and run: python -m pip install -r solver/requirements.txt"
    };
  }

  return {
    available: true,
    pythonExecutable: python.label,
    ortoolsAvailable: true,
    message: null
  };
}

export async function solveScheduleWithCpSat(
  request: CpSatSolveRequest
): Promise<CpSatSolveResult> {
  const scriptPath = getSolverScriptPath();
  const python = discoverPythonCommand();

  if (!existsSync(scriptPath)) {
    return buildUnknownResult(
      request,
      `CP-SAT solver script was not found at ${scriptPath}.`
    );
  }

  if (!python) {
    return buildUnknownResult(
      request,
      "Python or OR-Tools is unavailable. Install dependencies with: python -m pip install -r solver/requirements.txt"
    );
  }

  const timeoutMs = Math.max(
    1_000,
    Math.ceil(request.timeoutSeconds * 1_000) + 1_000
  );

  return await runSolverProcess({
    python,
    scriptPath,
    request,
    timeoutMs: Math.max(timeoutMs, defaultSolverTimeoutMs)
  });
}

function discoverPythonCommand(): PythonCommand | null {
  const configuredPython = process.env.JPROGRAMMER_PYTHON?.trim();
  const candidates: PythonCommand[] = [
    ...(configuredPython
      ? [
          {
            executable: configuredPython,
            args: [],
            label: configuredPython
          }
        ]
      : []),
    {
      executable: "python",
      args: [],
      label: "python"
    },
    {
      executable: "py",
      args: ["-3"],
      label: "py -3"
    },
    {
      executable: "python3",
      args: [],
      label: "python3"
    }
  ];

  return candidates.find(isPythonCommandReady) ?? null;
}

function isPythonCommandReady(command: PythonCommand): boolean {
  const result = spawnSync(
    command.executable,
    [
      ...command.args,
      "-c",
      "import ortools; from ortools.sat.python import cp_model; print('ok')"
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5_000
    }
  );

  return result.status === 0 && result.stdout.includes("ok");
}

function getSolverScriptPath(): string {
  const configuredSolverDir = process.env.JPROGRAMMER_SOLVER_DIR?.trim();
  const candidateDirs = [
    configuredSolverDir,
    path.join(process.cwd(), "solver"),
    path.resolve(__dirname, "../../..", "solver")
  ].filter((item): item is string => Boolean(item));

  for (const candidateDir of candidateDirs) {
    const scriptPath = path.join(candidateDir, "scheduler_solver.py");
    if (existsSync(scriptPath)) {
      return scriptPath;
    }
  }

  return path.join(candidateDirs[0] ?? process.cwd(), "scheduler_solver.py");
}

function buildUnknownResult(
  request: CpSatSolveRequest,
  message: string
): CpSatSolveResult {
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
    message
  };
}
