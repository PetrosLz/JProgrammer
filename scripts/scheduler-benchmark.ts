import { performance } from "node:perf_hooks";

import {
  buildCoverageCeilingAnalysis,
  buildCpSatSolveRequest,
  buildManagerScheduleDiagnostics,
  buildScheduleGenerationPlan,
  defaultSchedulerOptimizationConfig,
  diagnoseCoverageCeiling,
  evaluateSchedule,
  optimizeScheduleInMemory,
  type CoverageCeilingClassification,
  type CoverageDiagnosis,
  type ManagerScheduleStatus,
  type SchedulerStopReason
} from "../src/renderer/services/scheduler";
import {
  getCpSatAvailability,
  solveScheduleWithCpSat
} from "../src/main/solver/cpSatClient";
import { validateScheduleHardConstraints } from "../src/renderer/services/scheduler/evaluation/scheduleValidator";
import type { ScheduleAssignment, ScheduleSlot } from "../src/renderer/types";
import {
  createAssignment,
  createBenchmarkScenarios,
  createSlot,
  type SchedulerBenchmarkScenario
} from "./scheduler-fixtures";

type BenchmarkResult = {
  scenario: SchedulerBenchmarkScenario;
  generatedSlots: number;
  assignedSlots: number;
  feasibleMaxAssignedSlots: number;
  coverageGap: number;
  diagnosis: CoverageDiagnosis;
  classification: CoverageCeilingClassification;
  unfilledSlots: number;
  coverageRate: number;
  hardViolationCount: number;
  overlapViolationCount: number;
  dailyHourViolationCount: number;
  weeklyShiftViolationCount: number;
  warningCount: number;
  reward: number;
  rewardPerSlot: number;
  normalizedScore: number;
  grade: string;
  managerStatus: ManagerScheduleStatus;
  elapsedMs: number;
  repairIterations: number;
  stopReason: SchedulerStopReason;
  ceilingExact: boolean;
  notes: string[];
};

type CpSatBenchmarkResult = {
  scenarioName: string;
  status: string;
  assignedSlots: number;
  totalSlots: number;
  coverageRate: number;
  runtimeMs: number;
  hardViolationCount: number;
  validated: boolean;
  coverageProvenOptimal: boolean;
  fullLexicographicOptimality: boolean;
  objectiveStages: Record<
    string,
    {
      value: number;
      status: string;
      provenOptimal: boolean;
    }
  >;
  message: string | null;
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
const results: BenchmarkResult[] = [];
const cpSatAvailability = await getCpSatAvailability();

if (!cpSatAvailability.available) {
  console.log(
    `CP-SAT benchmark skipped: ${cpSatAvailability.message ?? "solver unavailable"}`
  );
}

for (const scenario of createBenchmarkScenarios()) {
  const startedAt = performance.now();
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
      id: `${scenario.run.id}-slot-${index}`,
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
  const assignmentResult = optimizeScheduleInMemory({
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
  const evaluation = evaluateSchedule({
    run: scenario.run,
    slots,
    assignments: assignmentResult.assignments,
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
  const elapsedMs = performance.now() - startedAt;
  const warningCount =
    evaluation.metrics.warningCount +
    assignmentResult.warnings.filter(
      (warning) => warning.warningType !== "feasibility_feasible"
    ).length +
    plan.warnings.filter((warning) => warning.severity === "warning").length;
  const ceilingAnalysis = buildCoverageCeilingAnalysis({
    slots,
    employees: scenario.employees,
    employeeRoles: scenario.employeeRoles,
    employeeWorkRules: scenario.employeeWorkRules,
    employeeDayConstraints: scenario.employeeDayConstraints,
    employeeShiftAvailability: scenario.employeeShiftAvailability,
    employeeTimeConstraints: scenario.employeeTimeConstraints,
    timeOff: scenario.timeOff,
    staffingRequirements: scenario.staffingRequirements,
    shiftTemplates: scenario.shiftTemplates,
    roles: scenario.roles,
    existingAssignments: scenario.existingAssignments
  });
  const ceilingDiagnosis = diagnoseCoverageCeiling({
    analysis: ceilingAnalysis,
    assignedSlots: evaluation.metrics.filledSlots,
    hardViolationCount: evaluation.metrics.hardViolationCount
  });
  const managerDiagnostics = buildManagerScheduleDiagnostics({
    evaluation,
    coverageCeiling: ceilingAnalysis,
    coverageDiagnosis: ceilingDiagnosis,
    warnings: assignmentResult.warnings,
    slots,
    roles: scenario.roles
  });
  const notes = [
    ...managerDiagnostics.mainIssues.slice(0, 3),
    ...managerDiagnostics.suggestedFixes.slice(0, 1).map((fix) => `Fix: ${fix}`)
  ];
  const rewardPerSlot =
    slots.length === 0 ? evaluation.reward : evaluation.reward / slots.length;
  const result: BenchmarkResult = {
    scenario,
    generatedSlots: slots.length,
    assignedSlots: evaluation.metrics.filledSlots,
    feasibleMaxAssignedSlots: ceilingAnalysis.feasibleMaxAssignedSlots,
    coverageGap: ceilingDiagnosis.coverageGap,
    diagnosis: ceilingDiagnosis.diagnosis,
    classification: ceilingDiagnosis.classification,
    unfilledSlots: evaluation.metrics.unfilledSlots,
    coverageRate: evaluation.metrics.coverageRate,
    hardViolationCount: evaluation.metrics.hardViolationCount,
    overlapViolationCount: countHardViolations(evaluation.hardViolations, "overlap"),
    dailyHourViolationCount: countHardViolations(
      evaluation.hardViolations,
      "max_daily_hours"
    ),
    weeklyShiftViolationCount: countHardViolations(
      evaluation.hardViolations,
      "max_shifts"
    ),
    warningCount,
    reward: evaluation.reward,
    rewardPerSlot,
    normalizedScore: calculateNormalizedScore({
      coverageRate: evaluation.metrics.coverageRate,
      assignedSlots: evaluation.metrics.filledSlots,
      feasibleMaxAssignedSlots: ceilingAnalysis.feasibleMaxAssignedSlots,
      coverageGap: ceilingDiagnosis.coverageGap,
      hardViolationCount: evaluation.metrics.hardViolationCount,
      warningCount
    }),
    grade: evaluation.grade,
    managerStatus: managerDiagnostics.status,
    elapsedMs,
    repairIterations: assignmentResult.repairIterations,
    stopReason: assignmentResult.stopReason,
    ceilingExact: !ceilingAnalysis.isApproximate,
    notes
  };

  results.push(result);
  printResult(result);

  if (cpSatAvailability.available) {
    const cpSatResult = await runCpSatBenchmark({
      scenario,
      slots,
      heuristicAssignedSlots: result.assignedSlots
    });
    printCpSatResult(cpSatResult);
  }
}

assertBenchmarkThresholds(results);
console.log(`Scheduler optimized benchmark passed (${results.length} scenarios).`);
}

function printResult(result: BenchmarkResult) {
  console.log(
    [
      result.scenario.name.padEnd(28),
      result.scenario.difficulty.padEnd(10),
      `grade=${result.grade.padEnd(12)}`,
      `status=${result.managerStatus.replaceAll(" ", "_")}`,
      `diagnosis=${result.diagnosis}`,
      `slots=${String(result.generatedSlots).padStart(2)}`,
      `assigned=${String(result.assignedSlots).padStart(2)}/${String(
        result.generatedSlots
      ).padStart(2)}`,
      `feasibleMax=${result.feasibleMaxAssignedSlots}`,
      `gap=${result.coverageGap}`,
      `unfilled=${String(result.unfilledSlots).padStart(2)}`,
      `coverage=${Math.round(result.coverageRate * 100)
        .toString()
        .padStart(3)}%`,
      `hard=${result.hardViolationCount}`,
      `overlap=${result.overlapViolationCount}`,
      `daily=${result.dailyHourViolationCount}`,
      `weekly=${result.weeklyShiftViolationCount}`,
      `warnings=${result.warningCount}`,
      `reward=${Math.round(result.reward)}`,
      `reward/slot=${Math.round(result.rewardPerSlot)}`,
      `score=${result.normalizedScore}`,
      `repair=${result.repairIterations}`,
      `time=${result.elapsedMs.toFixed(0)}ms`,
      `stop=${result.stopReason}`,
      `classification=${result.classification}`,
      `ceiling=${result.ceilingExact ? "exact" : "approx"}`
    ].join(" | ")
  );

  if (result.notes.length > 0) {
    console.log(`  notes: ${result.notes.join(" / ")}`);
  }
}

async function runCpSatBenchmark({
  scenario,
  slots,
  heuristicAssignedSlots
}: {
  scenario: SchedulerBenchmarkScenario;
  slots: ScheduleSlot[];
  heuristicAssignedSlots: number;
}): Promise<CpSatBenchmarkResult> {
  const request = buildCpSatSolveRequest({
    requestId: `benchmark-${scenario.run.id}`,
    run: scenario.run,
    runSlots: slots,
    employees: scenario.employees,
    employeeRoles: scenario.employeeRoles,
    data: {
      employeeRoles: scenario.employeeRoles,
      employeeWorkRules: scenario.employeeWorkRules,
      employeeDayConstraints: scenario.employeeDayConstraints,
      employeeShiftAvailability: scenario.employeeShiftAvailability,
      employeeTimeConstraints: scenario.employeeTimeConstraints,
      staffingRequirements: scenario.staffingRequirements,
      timeOff: scenario.timeOff,
      weekStartsOn: 1
    },
    activeRunAssignments: scenario.existingAssignments,
    timeoutSeconds: 30
  });
  const result = await solveScheduleWithCpSat(request);
  const assignments = buildCpSatAssignments({
    runId: scenario.run.id,
    assignments: result.assignments
  });
  const validation = validateScheduleHardConstraints({
    runSlots: slots,
    assignments,
    employees: scenario.employees,
    data: {
      employeeRoles: scenario.employeeRoles,
      employeeWorkRules: scenario.employeeWorkRules,
      employeeDayConstraints: scenario.employeeDayConstraints,
      employeeShiftAvailability: scenario.employeeShiftAvailability,
      employeeTimeConstraints: scenario.employeeTimeConstraints,
      staffingRequirements: scenario.staffingRequirements,
      timeOff: scenario.timeOff,
      weekStartsOn: 1
    }
  });
  const accepted = result.status === "OPTIMAL" || result.status === "FEASIBLE";

  if (accepted && !validation.valid) {
    throw new Error(
      `${scenario.name} CP-SAT result produced ${validation.violations.length} TypeScript validator violation(s).`
    );
  }

  if (result.status === "OPTIMAL" && result.assignments.length < heuristicAssignedSlots) {
    throw new Error(
      `${scenario.name} CP-SAT OPTIMAL coverage ${result.assignments.length} is below heuristic coverage ${heuristicAssignedSlots}.`
    );
  }

  return {
    scenarioName: scenario.name,
    status: result.status,
    assignedSlots: result.objectiveValues.coveredSlots,
    totalSlots: result.objectiveValues.totalSlots,
    coverageRate: result.objectiveValues.coverageRate,
    runtimeMs: result.runtimeMs,
    hardViolationCount: validation.violations.length,
    validated: accepted && validation.valid,
    coverageProvenOptimal: result.coverageProvenOptimal,
    fullLexicographicOptimality: result.fullLexicographicOptimality,
    objectiveStages: result.objectiveStages,
    message: result.message
  };
}

function buildCpSatAssignments({
  runId,
  assignments
}: {
  runId: string;
  assignments: Array<{ scheduleSlotId: string; employeeId: string }>;
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

function printCpSatResult(result: CpSatBenchmarkResult) {
  console.log(
    [
      "  CP-SAT".padEnd(28),
      "production=cp_sat",
      `status=${result.status}`,
      `coverage=${Math.round(result.coverageRate * 100)}%`,
      `assigned=${result.assignedSlots}/${result.totalSlots}`,
      `hard=${result.hardViolationCount}`,
      `validated=${result.validated ? "yes" : "no"}`,
      `coverageOptimal=${result.coverageProvenOptimal ? "yes" : "no"}`,
      `lexOptimal=${result.fullLexicographicOptimality ? "yes" : "no"}`,
      `stages=${formatObjectiveStages(result.objectiveStages)}`,
      `time=${result.runtimeMs}ms`
    ].join(" | ")
  );

  if (result.message) {
    console.log(`  CP-SAT note: ${result.message}`);
  }
}

function formatObjectiveStages(
  stages: CpSatBenchmarkResult["objectiveStages"]
): string {
  return Object.entries(stages)
    .map(
      ([name, stage]) =>
        `${name}:${stage.value}/${stage.status}${stage.provenOptimal ? "*" : ""}`
    )
    .join(",");
}

function countHardViolations(
  hardViolations: Array<{ type: string }>,
  type: string
): number {
  return hardViolations.filter((violation) => violation.type === type).length;
}

function assertBenchmarkThresholds(resultsToCheck: BenchmarkResult[]) {
  const byScenario = new Map<string, BenchmarkResult[]>();

  for (const result of resultsToCheck) {
    const scenarioResults = byScenario.get(result.scenario.name) ?? [];
    byScenario.set(result.scenario.name, [...scenarioResults, result]);

    if (
      result.hardViolationCount > 0 &&
      result.scenario.difficulty !== "impossible"
    ) {
      throw new Error(
        `${result.scenario.name} produced ${result.hardViolationCount} hard violations.`
      );
    }
  }

  const easyCafe = byScenario.get("easy cafe") ?? [];
  for (const result of easyCafe) {
    if (result.coverageRate !== 1 || result.hardViolationCount !== 0) {
      throw new Error(
        "easy cafe should reach 100% coverage with 0 hard violations."
      );
    }

    if (result.feasibleMaxAssignedSlots !== result.generatedSlots) {
      throw new Error("easy cafe should have a feasible ceiling of all slots.");
    }

    if (result.assignedSlots !== result.feasibleMaxAssignedSlots) {
      throw new Error("easy cafe should assign every feasible slot.");
    }

    assertExcellentScenarioStopsEarly(result);
  }

  const impossibleSchedule = byScenario.get("impossible schedule") ?? [];
  for (const result of impossibleSchedule) {
    if (result.hardViolationCount !== 0) {
      throw new Error(
        "impossible schedule should not force hard violations."
      );
    }

    if (result.feasibleMaxAssignedSlots >= result.generatedSlots) {
      throw new Error(
        "impossible schedule should have feasible max below total slots."
      );
    }

    if (result.coverageRate >= 1 || result.warningCount === 0) {
      throw new Error(
        "impossible schedule should remain partially uncovered with warnings."
      );
    }
  }

  const splitShiftRequired = byScenario.get("split shifts required") ?? [];
  for (const result of splitShiftRequired) {
    if (result.coverageRate !== 1 || result.hardViolationCount !== 0) {
      throw new Error(
        "split shifts required should reach 100% coverage with 0 hard violations."
      );
    }

    if (result.feasibleMaxAssignedSlots !== result.generatedSlots) {
      throw new Error("split shifts required should have an exact full ceiling.");
    }
  }

  for (const result of resultsToCheck) {
    if (
      result.scenario.difficulty !== "easy" &&
      result.coverageRate < 1 &&
      result.warningCount === 0
    ) {
      throw new Error(
        `${result.scenario.name} is not fully covered but produced no useful warnings.`
      );
    }

    if (result.coverageGap > 1) {
      throw new Error(
        `${result.scenario.name} assigned ${result.assignedSlots}/${result.generatedSlots}, but the ceiling estimates ${result.feasibleMaxAssignedSlots}/${result.generatedSlots}.`
      );
    }

    if (
      result.grade === "excellent" &&
      result.coverageRate === 1 &&
      result.hardViolationCount === 0
    ) {
      assertExcellentScenarioStopsEarly(result);
      assertExcellentNotesAreClean(result);
    }

    if (!Number.isFinite(result.normalizedScore)) {
      throw new Error(`${result.scenario.name} did not produce a normalized score.`);
    }

    if (!result.stopReason) {
      throw new Error(`${result.scenario.name} did not produce a stop reason.`);
    }

    if (
      result.scenario.difficulty === "hard" &&
      result.coverageRate < 1 &&
      result.notes.length === 0
    ) {
      throw new Error(
        `${result.scenario.name} is uncovered but produced no grouped diagnostics.`
      );
    }
  }
}

function calculateNormalizedScore({
  coverageRate,
  assignedSlots,
  feasibleMaxAssignedSlots,
  coverageGap,
  hardViolationCount,
  warningCount
}: {
  coverageRate: number;
  assignedSlots: number;
  feasibleMaxAssignedSlots: number;
  coverageGap: number;
  hardViolationCount: number;
  warningCount: number;
}): number {
  if (hardViolationCount > 0) {
    return 0;
  }

  const feasibleEfficiency =
    feasibleMaxAssignedSlots === 0
      ? assignedSlots === 0
        ? 1
        : 0
      : assignedSlots / feasibleMaxAssignedSlots;
  const score =
    coverageRate * 70 +
    feasibleEfficiency * 20 +
    10 -
    Math.min(15, warningCount * 0.5) -
    Math.min(25, coverageGap * 5);

  return Math.max(0, Math.min(100, Math.round(score)));
}

function assertExcellentScenarioStopsEarly(result: BenchmarkResult) {
  const maximumExpectedRuntime =
    defaultSchedulerOptimizationConfig.timeBudgetMs + 1_000;

  if (result.elapsedMs >= maximumExpectedRuntime) {
    throw new Error(
      `${result.scenario.name} is excellent but consumed ${result.elapsedMs.toFixed(
        0
      )}ms of the ${defaultSchedulerOptimizationConfig.timeBudgetMs}ms budget.`
    );
  }

  if (result.stopReason === "time_budget") {
    throw new Error(
      `${result.scenario.name} is excellent but stopped by time budget.`
    );
  }
}

function assertExcellentNotesAreClean(result: BenchmarkResult) {
  const joinedNotes = result.notes.join(" ").toLocaleLowerCase();

  if (
    joinedNotes.includes("can improve") ||
    joinedNotes.includes("reward") ||
    joinedNotes.includes("warning")
  ) {
    throw new Error(
      `${result.scenario.name} is excellent but printed noisy top notes: ${result.notes.join(" / ")}`
    );
  }
}
