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
      pythonVersion: null,
      ortoolsAvailable: false,
      ortoolsVersion: null,
      message: `CP-SAT solver script was not found at ${scriptPath}.`
    };
  }

  const python = discoverPythonCommand();

  if (!python) {
    return {
      available: false,
      pythonExecutable: null,
      pythonVersion: null,
      ortoolsAvailable: false,
      ortoolsVersion: null,
      message:
        "Python runtime was not found. Install Python and run: python -m pip install -r solver/requirements.txt"
    };
  }

  return {
    available: true,
    pythonExecutable: python.label,
    pythonVersion: python.pythonVersion ?? null,
    ortoolsAvailable: true,
    ortoolsVersion: python.ortoolsVersion ?? null,
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
  const testPython = process.env.JPROGRAMMER_TEST_PYTHON?.trim();
  const testPythonPath = process.env.JPROGRAMMER_TEST_PYTHONPATH?.trim();
  const projectRoot = findProjectRoot();
  const localSitePackages = getLocalVenvSitePackages(projectRoot);
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
    ...(testPython
      ? [
          {
            executable: testPython,
            args: [],
            label: "test python",
            env:
              testPythonPath || localSitePackages
                ? {
                    PYTHONPATH: [testPythonPath, localSitePackages]
                      .filter(Boolean)
                      .join(path.delimiter)
                  }
                : undefined
          }
        ]
      : []),
    {
      executable: path.join(projectRoot, ".venv-solver", "Scripts", "python.exe"),
      args: [],
      label: ".venv-solver/Scripts/python.exe"
    },
    {
      executable: path.join(projectRoot, ".venv-solver", "bin", "python"),
      args: [],
      label: ".venv-solver/bin/python"
    },
    {
      executable: "py",
      args: ["-3.12"],
      label: "py -3.12"
    },
    {
      executable: "py",
      args: ["-3.11"],
      label: "py -3.11"
    },
    {
      executable: "python",
      args: [],
      label: "python"
    },
    {
      executable: "python3",
      args: [],
      label: "python3"
    }
  ];

  return candidates.map(hydratePythonCommand).find(Boolean) ?? null;
}

function hydratePythonCommand(command: PythonCommand): PythonCommand | null {
  if (!command.executable || (command.executable.includes(path.sep) && !existsSync(command.executable))) {
    return null;
  }

  const result = spawnSync(
    command.executable,
    [
      ...command.args,
      "-c",
      "import sys, ortools; from ortools.sat.python import cp_model; print(sys.version.split()[0]); print(ortools.__version__)"
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: command.env ? { ...process.env, ...command.env } : process.env,
      timeout: 5_000
    }
  );

  if (result.status !== 0) {
    return null;
  }

  const [pythonVersion, ortoolsVersion] = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!pythonVersion || !ortoolsVersion) {
    return null;
  }

  return {
    ...command,
    pythonVersion,
    ortoolsVersion
  };
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

function findProjectRoot(): string {
  let current = process.cwd();

  for (let index = 0; index < 8; index += 1) {
    if (existsSync(path.join(current, "package.json"))) {
      return current;
    }

    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }

  return process.cwd();
}

function getLocalVenvSitePackages(projectRoot: string): string | null {
  const windowsSitePackages = path.join(
    projectRoot,
    ".venv-solver",
    "Lib",
    "site-packages"
  );
  if (existsSync(windowsSitePackages)) {
    return windowsSitePackages;
  }

  const unixLibDir = path.join(projectRoot, ".venv-solver", "lib");
  if (!existsSync(unixLibDir)) {
    return null;
  }

  return null;
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
    coverageProvenOptimal: false,
    fullLexicographicOptimality: false,
    objectiveStages: {
      coverage: {
        value: 0,
        status: "UNKNOWN",
        provenOptimal: false
      }
    },
    hintDiagnostics: {
      received: 0,
      accepted: 0,
      ignored: 0
    },
    pythonVersion: null,
    ortoolsVersion: null,
    runtimeMs: 0,
    message
  };
}
