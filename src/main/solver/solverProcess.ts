import { spawn } from "node:child_process";
import type { CpSatSolveRequest, CpSatSolveResult } from "../../shared/solverTypes";

export type PythonCommand = {
  executable: string;
  args: string[];
  label: string;
  env?: NodeJS.ProcessEnv;
  pythonVersion?: string;
  ortoolsVersion?: string;
};

const maxStdoutBytes = 1_000_000;
const maxStderrBytes = 200_000;

export async function runSolverProcess({
  python,
  scriptPath,
  request,
  timeoutMs
}: {
  python: PythonCommand;
  scriptPath: string;
  request: CpSatSolveRequest;
  timeoutMs: number;
}): Promise<CpSatSolveResult> {
  return await new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(python.executable, [...python.args, scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: python.env ? { ...process.env, ...python.env } : process.env
    });
    let stdout = "";
    let stderr = "";
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }

      finished = true;
      child.kill();
      resolve({
        ...buildUnknownResult(request, Date.now() - startedAt),
        message: `CP-SAT solver timed out after ${timeoutMs}ms.`
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < maxStdoutBytes) {
        stdout += chunk.toString("utf8");
        if (stdout.length > maxStdoutBytes) {
          stdout = stdout.slice(0, maxStdoutBytes);
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < maxStderrBytes) {
        stderr += chunk.toString("utf8");
        if (stderr.length > maxStderrBytes) {
          stderr = stderr.slice(0, maxStderrBytes);
        }
      }
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      resolve({
        ...buildUnknownResult(request, Date.now() - startedAt),
        message: `CP-SAT solver process failed: ${error.message}`
      });
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);

      const parsed = parseSolverStdout({
        stdout,
        requestId: request.requestId,
        totalSlots: request.slots.length,
        runtimeMs: Date.now() - startedAt
      });

      if (code !== 0) {
        resolve({
          ...parsed,
          status: parsed.status === "MODEL_INVALID" ? "MODEL_INVALID" : "UNKNOWN",
          message: [
            `CP-SAT solver exited with code ${code}.`,
            parsed.message,
            stderr.trim()
          ]
            .filter(Boolean)
            .join(" ")
        });
        return;
      }

      resolve({
        ...parsed,
        message: [parsed.message, stderr.trim()].filter(Boolean).join(" ") || null
      });
    });

    child.stdin.end(`${JSON.stringify(request)}\n`, "utf8");
  });
}

function parseSolverStdout({
  stdout,
  requestId,
  totalSlots,
  runtimeMs
}: {
  stdout: string;
  requestId: string;
  totalSlots: number;
  runtimeMs: number;
}): CpSatSolveResult {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const finalLine = lines[lines.length - 1];

  if (!finalLine) {
    return {
      ...buildUnknownResultFromIds({ requestId, totalSlots, runtimeMs }),
      runtimeMs,
      message: "CP-SAT solver produced no protocol output."
    };
  }

  try {
    const parsed = JSON.parse(finalLine) as CpSatSolveResult;

    if (!isCpSatSolveResult(parsed)) {
      throw new Error("Invalid CP-SAT result shape.");
    }

    if (parsed.requestId !== requestId) {
      return {
        ...buildUnknownResultFromIds({ requestId, totalSlots, runtimeMs }),
        runtimeMs,
        message: `CP-SAT solver returned mismatched request id ${parsed.requestId}; expected ${requestId}.`
      };
    }

    return {
      ...parsed,
      runtimeMs: Number.isFinite(parsed.runtimeMs) ? parsed.runtimeMs : runtimeMs
    };
  } catch (error) {
    return {
      ...buildUnknownResultFromIds({ requestId, totalSlots, runtimeMs }),
      runtimeMs,
      message: `CP-SAT solver returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}

function isCpSatSolveResult(value: CpSatSolveResult): value is CpSatSolveResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.requestId === "string" &&
    Array.isArray(value.assignments) &&
    typeof value.objectiveValues === "object" &&
    value.objectiveValues !== null &&
    typeof value.objectiveValues.coveredSlots === "number" &&
    typeof value.objectiveValues.totalSlots === "number" &&
    typeof value.objectiveValues.coverageRate === "number" &&
    typeof value.coverageProvenOptimal === "boolean" &&
    typeof value.fullLexicographicOptimality === "boolean" &&
    typeof value.objectiveStages === "object" &&
    value.objectiveStages !== null &&
    typeof value.hintDiagnostics === "object" &&
    value.hintDiagnostics !== null &&
    typeof value.runtimeMs === "number" &&
    typeof value.status === "string"
  );
}

function buildUnknownResult(
  request: CpSatSolveRequest,
  runtimeMs: number
): CpSatSolveResult {
  return buildUnknownResultFromIds({
    requestId: request.requestId,
    totalSlots: request.slots.length,
    runtimeMs
  });
}

function buildUnknownResultFromIds({
  requestId,
  totalSlots,
  runtimeMs
}: {
  requestId: string;
  totalSlots: number;
  runtimeMs: number;
}): CpSatSolveResult {
  return {
    requestId,
    assignments: [],
    status: "UNKNOWN",
    objectiveValues: {
      coveredSlots: 0,
      totalSlots,
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
    runtimeMs,
    message: null
  };
}
