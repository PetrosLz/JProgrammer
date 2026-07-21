import { performance } from "node:perf_hooks";

import { runSolverProcess } from "../src/main/solver/solverProcess";
import { buildCpSatWarmStartHints } from "../src/renderer/services/scheduler/cpSatAdapter";
import { validateScheduleHardConstraints } from "../src/renderer/services/scheduler";
import type { DayOfWeek, EmployeeRole } from "../src/renderer/types";
import {
  createEmployee,
  createEmployeeRole,
  createOpeningHours,
  createRole,
  createRun,
  createShiftTemplate,
  createStaffingRequirement,
  createWorkRules,
  type SchedulerBenchmarkScenario
} from "./scheduler-fixtures";
import {
  assertValidSolverIds,
  buildGeneratedScenarioRun,
  buildRequestForScenario,
  buildScheduleAssignmentsFromCpSat,
  buildSchedulerData,
  createScenarioSkeleton,
  resolveTestPythonCommand
} from "./scheduler-verification-harness";

type StressTier = {
  name: string;
  employees: number;
  roles: number;
  shifts: number;
  requiredCount: number;
  timeoutSeconds: number;
  optional?: boolean;
};

const tiers: StressTier[] = [
  { name: "small", employees: 8, roles: 2, shifts: 2, requiredCount: 1, timeoutSeconds: 2 },
  { name: "medium", employees: 32, roles: 4, shifts: 4, requiredCount: 2, timeoutSeconds: 4 },
  { name: "large", employees: 120, roles: 8, shifts: 8, requiredCount: 2, timeoutSeconds: 8 },
  { name: "very-large", employees: 220, roles: 10, shifts: 10, requiredCount: 3, timeoutSeconds: 12, optional: true }
];

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const python = resolveTestPythonCommand();
  if (!python) {
    throw new Error("CP-SAT Python runtime is unavailable; stress benchmark cannot run.");
  }

  console.log("Scheduler stress benchmark");
  console.log([
    "Tier",
    "Classification",
    "Employees",
    "Slots",
    "Eligibility",
    "Preprocessing",
    "Hint time",
    "Solver time",
    "Validation time",
    "Total time",
    "Status",
    "Coverage",
    "Coverage proof",
    "Lex proof"
  ].join(" | "));

  let executed = 0;
  const tierFilter = parseTierFilter();

  for (const tier of tiers) {
    if (tierFilter && !tierFilter.has(tier.name)) {
      console.log(`${tier.name} | skipped by JPROGRAMMER_STRESS_TIERS`);
      continue;
    }

    if (tier.optional && process.env.JPROGRAMMER_RUN_VERY_LARGE_BENCHMARK !== "1") {
      console.log(`${tier.name} | skipped optional tier; set JPROGRAMMER_RUN_VERY_LARGE_BENCHMARK=1`);
      continue;
    }

    const totalStartedAt = performance.now();
    const scenario = createStressScenario(tier);
    const generated = buildGeneratedScenarioRun(scenario, `stress-${tier.name}`);
    const requestStartedAt = performance.now();
    const request = buildRequestForScenario({
      scenario,
      slots: generated.slots,
      requestId: `stress-${tier.name}`,
      timeoutSeconds: tier.timeoutSeconds
    });
    const preprocessingMs = performance.now() - requestStartedAt;
    const hintStartedAt = performance.now();
    const hints = buildCpSatWarmStartHints({
      request,
      timeBudgetMs: tier.name === "large" ? 500 : 200
    });
    const hintMs = performance.now() - hintStartedAt;
    const solverStartedAt = performance.now();
    const result = await runSolverProcess({
      python,
      scriptPath: "solver/scheduler_solver.py",
      request: {
        ...request,
        hints
      },
      timeoutMs: Math.ceil(tier.timeoutSeconds * 1_000) + 1_000
    });
    const solverMs = performance.now() - solverStartedAt;
    assertValidSolverIds({ request, result });

    const validationStartedAt = performance.now();
    const assignments = buildScheduleAssignmentsFromCpSat({
      runId: scenario.run.id,
      assignments: result.assignments
    });
    const validation = validateScheduleHardConstraints({
      runSlots: generated.slots,
      assignments,
      employees: scenario.employees,
      data: buildSchedulerData(scenario)
    });
    const validationMs = performance.now() - validationStartedAt;
    const accepted = result.status === "OPTIMAL" || result.status === "FEASIBLE";
    const classification = classifyStressResult(result.status);

    if (accepted && !validation.valid) {
      throw new Error(
        `${tier.name}: accepted stress result has ${validation.violations.length} hard violation(s).`
      );
    }

    if ((tier.name === "small" || tier.name === "medium") && !accepted) {
      throw new Error(`${tier.name}: required stress tier must solve, got ${result.status}.`);
    }

    console.log([
      tier.name,
      classification,
      scenario.employees.length,
      generated.slots.length,
      request.eligibility.length,
      `${Math.round(preprocessingMs)}ms`,
      `${Math.round(hintMs)}ms`,
      `${Math.round(solverMs)}ms`,
      `${Math.round(validationMs)}ms`,
      `${Math.round(performance.now() - totalStartedAt)}ms`,
      result.status,
      `${result.objectiveValues.coveredSlots}/${result.objectiveValues.totalSlots}`,
      result.coverageProvenOptimal ? "yes" : "no",
      result.fullLexicographicOptimality ? "yes" : "no"
    ].join(" | "));

    if (tier.name === "large" && result.status === "UNKNOWN") {
      console.warn(
        `${tier.name} | bounded_unknown | ${result.objectiveValues.coveredSlots}/${result.objectiveValues.totalSlots} | no feasible solution found within ${tier.timeoutSeconds}s; performance assessment is degraded`
      );
    }
    executed += 1;
  }

  console.log(`Stress benchmark completed (${executed} required tier(s) executed).`);
}

function classifyStressResult(status: string): string {
  if (status === "OPTIMAL") {
    return "solved_optimal";
  }

  if (status === "FEASIBLE") {
    return "solved_feasible";
  }

  if (status === "UNKNOWN") {
    return "bounded_unknown";
  }

  if (status === "MODEL_INVALID" || status === "INFEASIBLE") {
    return "failed_invalid";
  }

  return "failed_runtime";
}

function parseTierFilter(): Set<string> | null {
  const raw = process.env.JPROGRAMMER_STRESS_TIERS;
  if (!raw) {
    return null;
  }

  return new Set(
    raw
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function createStressScenario(tier: StressTier): SchedulerBenchmarkScenario {
  const run = createRun(`run-stress-${tier.name}`);
  const roles = Array.from({ length: tier.roles }, (_, index) =>
    createRole(`role-stress-${tier.name}-${index}`, `Role ${index + 1}`)
  );
  const shiftPairs = buildShiftPairs(tier.shifts);
  const shiftTemplates = shiftPairs.map(([startTime, endTime], index) =>
    createShiftTemplate(
      `shift-stress-${tier.name}-${index}`,
      `Shift ${index + 1}`,
      startTime,
      endTime
    )
  );
  const days = [1, 2, 3, 4, 5, 6, 0] as DayOfWeek[];
  const staffingRequirements = days.flatMap((dayOfWeek) =>
    shiftTemplates.flatMap((shift) =>
      roles.map((role) =>
        createStaffingRequirement({
          id: `req-stress-${tier.name}-${dayOfWeek}-${shift.id}-${role.id}`,
          roleId: role.id,
          shiftTemplateId: shift.id,
          startTime: shift.start_time,
          endTime: shift.end_time,
          requiredCount: tier.requiredCount,
          dayOfWeek
        })
      )
    )
  );
  const employees = Array.from({ length: tier.employees }, (_, index) =>
    createEmployee(`emp-stress-${tier.name}-${index}`, `Emp${index}`, tier.name)
  );
  const employeeRoles: EmployeeRole[] = [];
  for (const [employeeIndex, employee] of employees.entries()) {
    const primaryRole = roles[employeeIndex % roles.length];
    const secondaryRole = roles[(employeeIndex + 1) % roles.length];
    employeeRoles.push(
      createEmployeeRole(
        `er-${employee.id}-${primaryRole.id}`,
        employee.id,
        primaryRole.id
      )
    );
    if (employeeIndex % 3 === 0) {
      employeeRoles.push(
        createEmployeeRole(
          `er-${employee.id}-${secondaryRole.id}`,
          employee.id,
          secondaryRole.id
        )
      );
    }
  }
  const employeeWorkRules = employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 10, 8, 8, 1)
  );

  return createScenarioSkeleton({
    name: `stress ${tier.name}`,
    run,
    openingHours: createOpeningHours().map((row) => ({
      ...row,
      is_open: 1 as const,
      is_24_hours: 1 as const,
      open_time: null,
      close_time: null,
      is_overnight: 0 as const
    })),
    roles,
    shiftTemplates,
    staffingRequirements,
    employees,
    employeeRoles,
    employeeWorkRules
  });
}

function buildShiftPairs(count: number): Array<[string, string]> {
  const base: Array<[string, string]> = [
    ["00:00", "08:00"],
    ["08:00", "16:00"],
    ["16:00", "00:00"],
    ["06:00", "12:00"],
    ["12:00", "18:00"],
    ["18:00", "02:00"],
    ["22:00", "06:00"],
    ["10:00", "14:00"],
    ["14:00", "22:00"],
    ["23:00", "07:00"]
  ];

  return base.slice(0, count);
}
