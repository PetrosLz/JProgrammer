import { performance } from "node:perf_hooks";

import {
  buildScheduleGenerationPlan,
  evaluateSchedule,
  optimizeScheduleInMemory
} from "../src/renderer/services/scheduler";
import {
  createBenchmarkScenarios,
  createSlot,
  type SchedulerBenchmarkScenario
} from "./scheduler-fixtures";

type BenchmarkResult = {
  scenario: SchedulerBenchmarkScenario;
  generatedSlots: number;
  assignedSlots: number;
  unfilledSlots: number;
  coverageRate: number;
  hardViolationCount: number;
  warningCount: number;
  reward: number;
  grade: string;
  elapsedMs: number;
  repairIterations: number;
  notes: string[];
};

const results: BenchmarkResult[] = [];

for (const scenario of createBenchmarkScenarios()) {
  const startedAt = performance.now();
  const plan = buildScheduleGenerationPlan({
    weekStartDate: scenario.weekStartDate,
    openingHours: scenario.openingHours,
    staffingRequirements: scenario.staffingRequirements,
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
      status: "unfilled"
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
  const notes = [
    ...evaluation.explanations,
    ...evaluation.softWarnings.map((warning) => warning.message),
    ...assignmentResult.warnings.map((warning) => warning.message),
    ...plan.warnings
      .filter((warning) => warning.severity === "warning")
      .map((warning) => warning.message)
  ].slice(0, 3);
  const result: BenchmarkResult = {
    scenario,
    generatedSlots: slots.length,
    assignedSlots: assignmentResult.assignments.length,
    unfilledSlots: evaluation.metrics.unfilledSlots,
    coverageRate: evaluation.metrics.coverageRate,
    hardViolationCount: evaluation.metrics.hardViolationCount,
    warningCount,
    reward: evaluation.reward,
    grade: evaluation.grade,
    elapsedMs,
    repairIterations: assignmentResult.repairIterations,
    notes
  };

  results.push(result);
  printResult(result);
}

assertBenchmarkThresholds(results);
console.log(`Scheduler optimized benchmark passed (${results.length} scenarios).`);

function printResult(result: BenchmarkResult) {
  console.log(
    [
      result.scenario.name.padEnd(28),
      result.scenario.difficulty.padEnd(10),
      `grade=${result.grade.padEnd(12)}`,
      `slots=${String(result.generatedSlots).padStart(2)}`,
      `assigned=${String(result.assignedSlots).padStart(2)}`,
      `unfilled=${String(result.unfilledSlots).padStart(2)}`,
      `coverage=${Math.round(result.coverageRate * 100)
        .toString()
        .padStart(3)}%`,
      `hard=${result.hardViolationCount}`,
      `warnings=${result.warningCount}`,
      `reward=${Math.round(result.reward)}`,
      `repair=${result.repairIterations}`,
      `time=${result.elapsedMs.toFixed(0)}ms`
    ].join(" | ")
  );

  if (result.notes.length > 0) {
    console.log(`  notes: ${result.notes.join(" / ")}`);
  }
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
  }

  const impossibleSchedule = byScenario.get("impossible schedule") ?? [];
  for (const result of impossibleSchedule) {
    if (result.hardViolationCount !== 0) {
      throw new Error(
        "impossible schedule should not force hard violations."
      );
    }

    if (result.coverageRate >= 1 || result.warningCount === 0) {
      throw new Error(
        "impossible schedule should remain partially uncovered with warnings."
      );
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
  }
}
