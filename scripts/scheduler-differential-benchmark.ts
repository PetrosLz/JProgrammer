import fs from "node:fs";

import type { DayOfWeek, EmployeeRole, TimeOff } from "../src/renderer/types";
import {
  createAssignment,
  createEmployee,
  createEmployeeRole,
  createOpeningHours,
  createRole,
  createRun,
  createShiftTemplate,
  createStaffingRequirement,
  createTimeOff,
  createWorkRules,
  type SchedulerBenchmarkScenario
} from "./scheduler-fixtures";
import {
  buildGeneratedScenarioRun,
  buildRequestForScenario,
  createScenarioSkeleton,
  resolveTestPythonCommand,
  runAndValidateHeuristic,
  solveAndValidateCpSat
} from "./scheduler-verification-harness";

type ScenarioSpec = {
  name: string;
  employees: number;
  roles: number;
  shifts: Array<[string, string]>;
  days: DayOfWeek[];
  requiredCount: number;
  openingMode: "24" | "custom" | "overnight" | "closed";
  eligibility: "dense" | "sparse" | "single-role";
  maxShiftsPerWeek?: number;
  maxHoursPerDay?: number;
  canWorkWeekends?: boolean;
  minExperience?: boolean;
  timeOff?: boolean;
  locked?: boolean;
  zeroRequirements?: boolean;
};

const specs: ScenarioSpec[] = [
  { name: "24h balanced day", employees: 4, roles: 2, shifts: [["00:00", "08:00"], ["08:00", "16:00"], ["16:00", "00:00"]], days: [1], requiredCount: 1, openingMode: "24", eligibility: "dense" },
  { name: "overnight-heavy sparse", employees: 5, roles: 3, shifts: [["22:00", "06:00"], ["23:00", "07:00"]], days: [1, 2], requiredCount: 1, openingMode: "24", eligibility: "sparse" },
  { name: "understaffed 24h", employees: 2, roles: 2, shifts: [["00:00", "08:00"], ["08:00", "16:00"], ["16:00", "00:00"]], days: [1, 2], requiredCount: 2, openingMode: "24", eligibility: "dense", maxShiftsPerWeek: 2 },
  { name: "role scarcity", employees: 4, roles: 3, shifts: [["09:00", "17:00"]], days: [1, 2, 3], requiredCount: 1, openingMode: "custom", eligibility: "sparse" },
  { name: "experience scarcity", employees: 4, roles: 2, shifts: [["18:00", "02:00"]], days: [1], requiredCount: 2, openingMode: "24", eligibility: "dense", minExperience: true },
  { name: "dense eligibility", employees: 8, roles: 3, shifts: [["09:00", "17:00"], ["17:00", "23:00"]], days: [1, 2, 3], requiredCount: 1, openingMode: "custom", eligibility: "dense" },
  { name: "sparse eligibility", employees: 8, roles: 4, shifts: [["09:00", "17:00"], ["22:00", "06:00"]], days: [1, 2, 3], requiredCount: 1, openingMode: "24", eligibility: "sparse" },
  { name: "many part-time workers", employees: 12, roles: 3, shifts: [["08:00", "12:00"], ["12:00", "16:00"], ["16:00", "20:00"]], days: [1, 2, 3, 4], requiredCount: 1, openingMode: "custom", eligibility: "dense", maxShiftsPerWeek: 2, maxHoursPerDay: 4 },
  { name: "many multi-role workers", employees: 10, roles: 5, shifts: [["09:00", "17:00"], ["18:00", "02:00"]], days: [1, 2, 3], requiredCount: 1, openingMode: "24", eligibility: "dense" },
  { name: "locked overnight", employees: 3, roles: 2, shifts: [["22:00", "06:00"]], days: [1], requiredCount: 1, openingMode: "24", eligibility: "dense", locked: true },
  { name: "zero workers", employees: 0, roles: 1, shifts: [["09:00", "17:00"]], days: [1], requiredCount: 1, openingMode: "custom", eligibility: "dense" },
  { name: "zero slots", employees: 3, roles: 1, shifts: [["09:00", "17:00"]], days: [1], requiredCount: 1, openingMode: "custom", eligibility: "dense", zeroRequirements: true },
  { name: "cross-midnight time off", employees: 1, roles: 1, shifts: [["22:00", "06:00"]], days: [1], requiredCount: 1, openingMode: "24", eligibility: "dense", timeOff: true },
  { name: "weekend boundary saturday", employees: 3, roles: 2, shifts: [["22:00", "06:00"]], days: [6], requiredCount: 1, openingMode: "24", eligibility: "dense", canWorkWeekends: false },
  { name: "weekend boundary sunday", employees: 3, roles: 2, shifts: [["22:00", "06:00"]], days: [0], requiredCount: 1, openingMode: "24", eligibility: "dense", canWorkWeekends: true },
  { name: "custom overnight opening", employees: 4, roles: 2, shifts: [["20:00", "04:00"]], days: [1, 2], requiredCount: 1, openingMode: "overnight", eligibility: "dense" },
  { name: "closed opening rejects slots", employees: 4, roles: 2, shifts: [["09:00", "17:00"]], days: [1], requiredCount: 1, openingMode: "closed", eligibility: "dense" },
  { name: "balanced same-day split", employees: 4, roles: 1, shifts: [["08:00", "12:00"], ["16:00", "20:00"]], days: [1, 2], requiredCount: 1, openingMode: "custom", eligibility: "dense", maxHoursPerDay: 8 },
  { name: "daily limit pressure", employees: 2, roles: 1, shifts: [["08:00", "12:00"], ["12:00", "16:00"], ["16:00", "20:00"]], days: [1], requiredCount: 1, openingMode: "custom", eligibility: "dense", maxHoursPerDay: 4 },
  { name: "large-ish dense 24h", employees: 20, roles: 4, shifts: [["00:00", "08:00"], ["08:00", "16:00"], ["16:00", "00:00"]], days: [1, 2, 3, 4, 5, 6, 0], requiredCount: 1, openingMode: "24", eligibility: "dense" }
];

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  assertNoRoleNameOrPriorityWeighting();
  const python = resolveTestPythonCommand();
  if (!python) {
    throw new Error("CP-SAT Python runtime is unavailable; differential benchmark cannot run.");
  }

  console.log("\nDifferential CP-SAT vs heuristic matrix");
  console.log([
    "Scenario",
    "Employees",
    "Slots",
    "Eligible pairs",
    "CP-SAT status",
    "CP-SAT coverage",
    "Heuristic coverage",
    "Difference",
    "Hard violations",
    "Accepted",
    "Validation",
    "Coverage proof",
    "Lex proof",
    "CP-SAT time",
    "Heuristic time"
  ].join(" | "));

  for (const spec of specs) {
    const scenario = createScenario(spec);
    const generated = buildGeneratedScenarioRun(scenario, slug(spec.name));
    maybeLockFirstEligibleAssignment(scenario, generated.slots);
    const heuristic = runAndValidateHeuristic({ scenario, slots: generated.slots });
    const cpSat = await solveAndValidateCpSat({
      python,
      scenario,
      slots: generated.slots,
      requestId: `diff-${slug(spec.name)}`,
      timeoutSeconds: spec.name === "large-ish dense 24h" ? 5 : 2
    });
    const cpSatCoverage = coverageRatio(
      cpSat.result.objectiveValues.coveredSlots,
      cpSat.result.objectiveValues.totalSlots
    );
    const accepted = cpSat.result.status === "OPTIMAL" || cpSat.result.status === "FEASIBLE";
    const validHeuristicCoverage =
      heuristic.hardViolationCount === 0 ? heuristic.coverage : Number.NaN;

    if (accepted && !cpSat.validated) {
      throw new Error(`${spec.name}: accepted CP-SAT result did not validate.`);
    }

    if (!accepted && cpSat.validated) {
      throw new Error(`${spec.name}: unaccepted CP-SAT result was labelled validated.`);
    }

    if (cpSat.result.status === "UNKNOWN" && cpSat.result.assignments.length > 0) {
      throw new Error(`${spec.name}: UNKNOWN CP-SAT result returned accepted-looking assignments.`);
    }

    if (
      cpSat.result.status === "OPTIMAL" &&
      Number.isFinite(validHeuristicCoverage) &&
      cpSatCoverage + 0.0001 < validHeuristicCoverage
    ) {
      throw new Error(`${spec.name}: OPTIMAL CP-SAT coverage is below valid heuristic coverage.`);
    }

    console.log([
      spec.name,
      scenario.employees.length,
      generated.slots.length,
      cpSat.request.eligibility.length,
      cpSat.result.status,
      pct(cpSatCoverage),
      Number.isFinite(validHeuristicCoverage) ? pct(validHeuristicCoverage) : "ignored",
      Number.isFinite(validHeuristicCoverage)
        ? pct(cpSatCoverage - validHeuristicCoverage)
        : "n/a",
      cpSat.hardViolationCount,
      accepted ? "yes" : "no",
      accepted ? (cpSat.validated ? "pass" : "fail") : "n/a",
      cpSat.result.coverageProvenOptimal ? "yes" : "no",
      cpSat.result.fullLexicographicOptimality ? "yes" : "no",
      `${cpSat.result.runtimeMs}ms`,
      `${Math.round(heuristic.elapsedMs)}ms`
    ].join(" | "));
  }

  console.log(`Differential benchmark passed (${specs.length} scenarios).`);
}

function createScenario(spec: ScenarioSpec): SchedulerBenchmarkScenario {
  const run = createRun(`run-${slug(spec.name)}`);
  const roles = Array.from({ length: spec.roles }, (_, index) =>
    createRole(`role-${slug(spec.name)}-${index}`, `Role ${index + 1}`)
  );
  const shiftTemplates = spec.shifts.map(([startTime, endTime], index) =>
    createShiftTemplate(`shift-${slug(spec.name)}-${index}`, `Shift ${index + 1}`, startTime, endTime)
  );
  const staffingRequirements = spec.zeroRequirements
    ? []
    : spec.days.flatMap((dayOfWeek) =>
        shiftTemplates.flatMap((shift) =>
          roles.slice(0, Math.min(roles.length, 2)).map((role) => ({
            ...createStaffingRequirement({
              id: `req-${slug(spec.name)}-${dayOfWeek}-${shift.id}-${role.id}`,
              roleId: role.id,
              shiftTemplateId: shift.id,
              startTime: shift.start_time,
              endTime: shift.end_time,
              requiredCount: spec.requiredCount,
              dayOfWeek
            }),
            minimum_experience_level: spec.minExperience ? "some_experience" as const : "no_experience" as const,
            experienced_required_count: spec.minExperience ? 1 : 0
          }))
        )
      );
  const employees = Array.from({ length: spec.employees }, (_, index) =>
    createEmployee(`emp-${slug(spec.name)}-${index}`, `Emp${index}`, "Diff")
  );
  const employeeRoles: EmployeeRole[] = [];
  for (const [employeeIndex, employee] of employees.entries()) {
    const assignedRoles =
      spec.eligibility === "dense"
        ? roles
        : spec.eligibility === "single-role"
          ? [roles[employeeIndex % roles.length]]
          : [roles[employeeIndex % roles.length]];
    for (const role of assignedRoles) {
      employeeRoles.push(
        createEmployeeRole(
          `er-${employee.id}-${role.id}`,
          employee.id,
          role.id,
          spec.minExperience && employeeIndex > 0 ? "no_experience" : "some_experience"
        )
      );
    }
  }
  const employeeWorkRules = employees.map((employee) =>
    createWorkRules(
      `wr-${employee.id}`,
      employee.id,
      spec.maxShiftsPerWeek ?? 7,
      spec.maxHoursPerDay ?? 8,
      spec.maxHoursPerDay ?? 8,
      spec.canWorkWeekends === false ? 0 : 1
    )
  );
  const scenario = createScenarioSkeleton({
    name: spec.name,
    run,
    openingHours: createOpeningHoursForSpec(spec),
    roles,
    shiftTemplates,
    staffingRequirements,
    employees,
    employeeRoles,
    employeeWorkRules
  });

  if (spec.timeOff && employees[0]) {
    const timeOff: TimeOff = createTimeOff(
      `to-${slug(spec.name)}`,
      employees[0].id,
      "2026-05-18",
      "2026-05-19"
    );
    scenario.timeOff = [timeOff];
  }

  return scenario;
}

function maybeLockFirstEligibleAssignment(
  scenario: SchedulerBenchmarkScenario,
  slots: ReturnType<typeof buildGeneratedScenarioRun>["slots"]
): void {
  if (!scenario.name.includes("locked") || slots.length === 0) {
    return;
  }

  const request = buildRequestForScenario({
    scenario,
    slots,
    requestId: `lock-${slug(scenario.name)}`,
    timeoutSeconds: 1
  });
  const pair = request.eligibility[0];
  if (!pair) {
    return;
  }

  scenario.existingAssignments = [
    {
      ...createAssignment(
        `locked-${slug(scenario.name)}`,
        scenario.run.id,
        pair.slotId,
        pair.employeeId
      ),
      is_locked: 1 as const
    }
  ];
}

function createOpeningHoursForSpec(spec: ScenarioSpec) {
  const daySet = new Set(spec.days);
  return createOpeningHours().map((row) => {
    if (!daySet.has(row.day_of_week) || spec.openingMode === "closed") {
      return { ...row, is_open: 0 as const, is_24_hours: 0 as const, open_time: null, close_time: null, is_overnight: 0 as const };
    }
    if (spec.openingMode === "24") {
      return { ...row, is_open: 1 as const, is_24_hours: 1 as const, open_time: null, close_time: null, is_overnight: 0 as const };
    }
    if (spec.openingMode === "overnight") {
      return { ...row, is_open: 1 as const, is_24_hours: 0 as const, open_time: "18:00", close_time: "06:00", is_overnight: 1 as const };
    }
    return { ...row, is_open: 1 as const, is_24_hours: 0 as const, open_time: "08:00", close_time: "23:00", is_overnight: 0 as const };
  });
}

function assertNoRoleNameOrPriorityWeighting(): void {
  const schedulerSource = fs.readFileSync(
    "src/renderer/services/scheduler/cpSatAdapter.ts",
    "utf8"
  );
  const initSql = fs.readFileSync("src/main/migrations/init.sql", "utf8");

  for (const forbidden of ["Cashier", "Kitchen", "Manager", "priority TEXT"]) {
    if (schedulerSource.includes(forbidden) || initSql.includes(forbidden)) {
      throw new Error(`Forbidden role-name/priority weighting marker found: ${forbidden}`);
    }
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function coverageRatio(assigned: number, total: number): number {
  if (total === 0) {
    return 1;
  }

  return assigned / total;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
