import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

import { runSolverProcess, type PythonCommand } from "../src/main/solver/solverProcess";
import type {
  CpSatAssignment,
  CpSatSolveRequest,
  CpSatSolveResult
} from "../src/shared/solverTypes";
import {
  buildCpSatSolveRequest,
  buildScheduleGenerationPlan,
  evaluateSchedule,
  optimizeScheduleInMemory,
  validateScheduleHardConstraints,
  type SchedulerData
} from "../src/renderer/services/scheduler";
import type {
  Employee,
  EmployeeRole,
  EmployeeWorkRules,
  OpeningHours,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ShiftTemplate,
  StaffingRequirement
} from "../src/renderer/types";
import { createAssignment, createSlot } from "./scheduler-fixtures";
import type { SchedulerBenchmarkScenario } from "./scheduler-fixtures";

export type GeneratedScenarioRun = {
  scenario: SchedulerBenchmarkScenario;
  slots: ScheduleSlot[];
  planWarnings: ReturnType<typeof buildScheduleGenerationPlan>["warnings"];
};

export type CpSatValidatedRun = {
  request: CpSatSolveRequest;
  result: CpSatSolveResult;
  assignments: ScheduleAssignment[];
  hardViolationCount: number;
  coverage: number;
  validated: boolean;
};

export type HeuristicValidatedRun = {
  assignments: ScheduleAssignment[];
  hardViolationCount: number;
  coverage: number;
  elapsedMs: number;
};

export function buildGeneratedScenarioRun(
  scenario: SchedulerBenchmarkScenario,
  idPrefix = scenario.run.id
): GeneratedScenarioRun {
  const plan = buildScheduleGenerationPlan({
    weekStartDate: scenario.weekStartDate,
    openingHours: scenario.openingHours,
    staffingRequirements: scenario.staffingRequirements,
    specialDayStaffingRequirements: scenario.specialDayStaffingRequirements,
    shiftTemplates: scenario.shiftTemplates,
    specialDays: scenario.specialDays
  });
  const slots = plan.slots.map((slot, index) =>
    createSlot({
      id: `${idPrefix}-slot-${index}`,
      runId: scenario.run.id,
      date: slot.date,
      roleId: slot.roleId,
      sourceId: slot.sourceId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      status: "unfilled",
      requirementGroupId: slot.requirementGroupId,
      minimumExperienceLevel: slot.minimumExperienceLevel,
      experiencedRequiredCount: slot.experiencedRequiredCount,
      slotNumber: slot.slotNumber
    })
  );

  return {
    scenario,
    slots,
    planWarnings: plan.warnings
  };
}

export function buildSchedulerData(
  scenario: Pick<
    SchedulerBenchmarkScenario,
    | "employeeRoles"
    | "employeeWorkRules"
    | "employeeDayConstraints"
    | "employeeShiftAvailability"
    | "employeeTimeConstraints"
    | "staffingRequirements"
    | "timeOff"
  >
): SchedulerData {
  return {
    employeeRoles: scenario.employeeRoles,
    employeeWorkRules: scenario.employeeWorkRules,
    employeeDayConstraints: scenario.employeeDayConstraints,
    employeeShiftAvailability: scenario.employeeShiftAvailability,
    employeeTimeConstraints: scenario.employeeTimeConstraints,
    staffingRequirements: scenario.staffingRequirements,
    timeOff: scenario.timeOff,
    weekStartsOn: 1,
    timezone: "Europe/Athens"
  };
}

export function buildRequestForScenario({
  scenario,
  slots,
  requestId,
  timeoutSeconds = 5
}: {
  scenario: SchedulerBenchmarkScenario;
  slots: ScheduleSlot[];
  requestId: string;
  timeoutSeconds?: number;
}): CpSatSolveRequest {
  return buildCpSatSolveRequest({
    requestId,
    run: scenario.run,
    runSlots: slots,
    employees: scenario.employees,
    employeeRoles: scenario.employeeRoles,
    data: buildSchedulerData(scenario),
    activeRunAssignments: scenario.existingAssignments,
    timeoutSeconds
  });
}

export async function solveAndValidateCpSat({
  python,
  scenario,
  slots,
  requestId,
  timeoutSeconds = 5
}: {
  python: PythonCommand | null;
  scenario: SchedulerBenchmarkScenario;
  slots: ScheduleSlot[];
  requestId: string;
  timeoutSeconds?: number;
}): Promise<CpSatValidatedRun> {
  const request = buildRequestForScenario({
    scenario,
    slots,
    requestId,
    timeoutSeconds
  });
  const result = python
    ? await runSolverProcess({
        python,
        scriptPath: getSolverScriptPath(),
        request,
        timeoutMs: Math.max(1_000, Math.ceil(timeoutSeconds * 1_000) + 1_000)
      })
    : buildSkippedSolverResult(request);

  assertValidSolverIds({ request, result });

  const assignments = buildScheduleAssignmentsFromCpSat({
    runId: scenario.run.id,
    assignments: result.assignments
  });
  const validation = validateScheduleHardConstraints({
    runSlots: slots,
    assignments,
    employees: scenario.employees,
    data: buildSchedulerData(scenario)
  });
  const accepted = result.status === "OPTIMAL" || result.status === "FEASIBLE";

  if (accepted && !validation.valid) {
    throw new Error(
      `${scenario.name}: accepted CP-SAT result has ${validation.violations.length} hard violation(s).`
    );
  }

  if (accepted) {
    assertLockedAssignmentsPreserved({
      scenario,
      resultAssignments: result.assignments
    });
  }

  return {
    request,
    result,
    assignments,
    hardViolationCount: validation.violations.length,
    coverage: result.objectiveValues.coverageRate,
    validated: accepted && validation.valid
  };
}

export function runAndValidateHeuristic({
  scenario,
  slots
}: {
  scenario: SchedulerBenchmarkScenario;
  slots: ScheduleSlot[];
}): HeuristicValidatedRun {
  const startedAt = performance.now();
  const result = optimizeScheduleInMemory({
    run: scenario.run,
    slots,
    employees: scenario.employees,
    employeeRoles: scenario.employeeRoles,
    employeeWorkRules: scenario.employeeWorkRules,
    employeeDayConstraints: scenario.employeeDayConstraints,
    employeeShiftAvailability: scenario.employeeShiftAvailability,
    employeeTimeConstraints: scenario.employeeTimeConstraints,
    timeOff: scenario.timeOff,
    assignments: scenario.existingAssignments,
    roles: scenario.roles,
    shiftTemplates: scenario.shiftTemplates,
    staffingRequirements: scenario.staffingRequirements
  });
  const elapsedMs = performance.now() - startedAt;
  const validation = validateScheduleHardConstraints({
    runSlots: slots,
    assignments: result.assignments,
    employees: scenario.employees,
    data: buildSchedulerData(scenario)
  });
  const evaluation = evaluateSchedule({
    run: scenario.run,
    slots,
    assignments: result.assignments,
    employees: scenario.employees,
    roles: scenario.roles,
    employeeRoles: scenario.employeeRoles,
    employeeWorkRules: scenario.employeeWorkRules,
    employeeDayConstraints: scenario.employeeDayConstraints,
    employeeShiftAvailability: scenario.employeeShiftAvailability,
    employeeTimeConstraints: scenario.employeeTimeConstraints,
    timeOff: scenario.timeOff,
    staffingRequirements: scenario.staffingRequirements,
    shiftTemplates: scenario.shiftTemplates
  });

  return {
    assignments: result.assignments,
    hardViolationCount: validation.violations.length,
    coverage: evaluation.metrics.coverageRate,
    elapsedMs
  };
}

export function buildScheduleAssignmentsFromCpSat({
  runId,
  assignments
}: {
  runId: string;
  assignments: CpSatAssignment[];
}): ScheduleAssignment[] {
  return assignments.map((assignment, index) =>
    createAssignment(
      `cp-sat-${runId}-${index}-${assignment.scheduleSlotId}`,
      runId,
      assignment.scheduleSlotId,
      assignment.employeeId
    )
  );
}

export function resolveTestPythonCommand(): PythonCommand | null {
  configureTestPythonRuntime();

  const root = process.cwd();
  const configuredTestPython = process.env.JPROGRAMMER_TEST_PYTHON?.trim();
  const configuredPython = process.env.JPROGRAMMER_PYTHON?.trim();
  const testPythonPath = process.env.JPROGRAMMER_TEST_PYTHONPATH?.trim();
  const localSitePackages = getLocalVenvSitePackages(root);
  const candidates: PythonCommand[] = [
    ...(configuredTestPython
      ? [
          {
            executable: configuredTestPython,
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
      executable: path.join(root, ".venv-solver", "Scripts", "python.exe"),
      args: [],
      label: ".venv-solver/Scripts/python.exe"
    },
    {
      executable: path.join(root, ".venv-solver", "bin", "python"),
      args: [],
      label: ".venv-solver/bin/python"
    },
    { executable: "py", args: ["-3.12"], label: "py -3.12" },
    { executable: "py", args: ["-3.11"], label: "py -3.11" },
    { executable: "python", args: [], label: "python" },
    { executable: "python3", args: [], label: "python3" }
  ];

  return candidates.map(hydratePythonCommand).find(Boolean) ?? null;
}

export function createScenarioSkeleton({
  name,
  run,
  openingHours,
  roles,
  shiftTemplates,
  staffingRequirements,
  employees,
  employeeRoles,
  employeeWorkRules,
  existingAssignments = []
}: {
  name: string;
  run: ScheduleRun;
  openingHours: OpeningHours[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  existingAssignments?: ScheduleAssignment[];
}): SchedulerBenchmarkScenario {
  return {
    name,
    difficulty: "medium",
    weekStartDate: run.start_date,
    run,
    openingHours,
    specialDays: [],
    specialDayStaffingRequirements: [],
    roles,
    shiftTemplates,
    staffingRequirements,
    employees,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints: [],
    employeeShiftAvailability: [],
    employeeTimeConstraints: [],
    timeOff: [],
    existingAssignments
  };
}

export function assertValidSolverIds({
  request,
  result
}: {
  request: CpSatSolveRequest;
  result: CpSatSolveResult;
}): void {
  if (result.requestId !== request.requestId) {
    throw new Error(
      `Solver request id mismatch: expected ${request.requestId}, got ${result.requestId}.`
    );
  }

  const employeeIds = new Set(request.employees.map((employee) => employee.id));
  const slotIds = new Set(request.slots.map((slot) => slot.id));
  const assignedSlotIds = new Set<string>();

  for (const assignment of result.assignments) {
    if (!employeeIds.has(assignment.employeeId)) {
      throw new Error(`Solver returned unknown employee id ${assignment.employeeId}.`);
    }
    if (!slotIds.has(assignment.scheduleSlotId)) {
      throw new Error(`Solver returned unknown slot id ${assignment.scheduleSlotId}.`);
    }
    if (assignedSlotIds.has(assignment.scheduleSlotId)) {
      throw new Error(`Solver assigned slot ${assignment.scheduleSlotId} more than once.`);
    }
    assignedSlotIds.add(assignment.scheduleSlotId);
  }
}

function assertLockedAssignmentsPreserved({
  scenario,
  resultAssignments
}: {
  scenario: SchedulerBenchmarkScenario;
  resultAssignments: CpSatAssignment[];
}): void {
  const resultKeys = new Set(
    resultAssignments.map(
      (assignment) => `${assignment.employeeId}|${assignment.scheduleSlotId}`
    )
  );

  for (const assignment of scenario.existingAssignments) {
    if (!resultKeys.has(`${assignment.employee_id}|${assignment.schedule_slot_id}`)) {
      throw new Error(
        `${scenario.name}: locked assignment ${assignment.id} was not preserved.`
      );
    }
  }
}

function configureTestPythonRuntime(): void {
  if (process.env.JPROGRAMMER_TEST_PYTHON || process.env.JPROGRAMMER_PYTHON) {
    return;
  }

  const root = process.cwd();
  const localSitePackages = path.join(root, ".venv-solver", "Lib", "site-packages");
  const bundledPython = path.join(
    process.env.USERPROFILE ?? "",
    ".cache",
    "codex-runtimes",
    "codex-primary-runtime",
    "dependencies",
    "python",
    "python.exe"
  );

  if (!existsSync(bundledPython) || !existsSync(localSitePackages)) {
    return;
  }

  process.env.JPROGRAMMER_TEST_PYTHON = bundledPython;
  process.env.JPROGRAMMER_TEST_PYTHONPATH = localSitePackages;
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

  return {
    ...command,
    pythonVersion,
    ortoolsVersion
  };
}

function getLocalVenvSitePackages(projectRoot: string): string | null {
  const windowsSitePackages = path.join(
    projectRoot,
    ".venv-solver",
    "Lib",
    "site-packages"
  );

  return existsSync(windowsSitePackages) ? windowsSitePackages : null;
}

function getSolverScriptPath(): string {
  return path.join(process.cwd(), "solver", "scheduler_solver.py");
}

function buildSkippedSolverResult(request: CpSatSolveRequest): CpSatSolveResult {
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
        value: null,
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
    message: "CP-SAT solver unavailable in this test environment."
  };
}
