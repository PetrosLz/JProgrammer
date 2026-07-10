import assert from "node:assert/strict";

import {
  buildCoverageCeilingAnalysis,
  buildManagerScheduleDiagnostics,
  buildScheduleGenerationPlan,
  diagnoseCoverageCeiling,
  evaluateSchedule,
  optimizeScheduleInMemory
} from "../src/renderer/services/scheduler";
import {
  createAssignment,
  createBenchmarkScenarios,
  createEmployee,
  createEmployeeRole,
  createFixture,
  createSlot,
  createTimeOff,
  createWorkRules
} from "./scheduler-fixtures";

function evaluateFixture(fixture: ReturnType<typeof createFixture>) {
  return evaluateSchedule({
    run: fixture.run,
    slots: fixture.slots,
    assignments: fixture.assignments,
    employees: fixture.employees,
    roles: fixture.roles,
    employeeRoles: fixture.employeeRoles,
    employeeWorkRules: fixture.employeeWorkRules,
    employeeDayConstraints: fixture.employeeDayConstraints,
    employeeShiftAvailability: fixture.employeeShiftAvailability,
    timeOff: fixture.timeOff,
    staffingRequirements: fixture.staffingRequirements,
    shiftTemplates: fixture.shiftTemplates
  });
}

function optimizeBenchmarkScenario(name: string) {
  const scenario = createBenchmarkScenarios().find((item) => item.name === name);

  if (!scenario) {
    throw new Error(`Missing benchmark scenario: ${name}`);
  }

  const plan = buildScheduleGenerationPlan({
    weekStartDate: scenario.weekStartDate,
    openingHours: scenario.openingHours,
    staffingRequirements: scenario.staffingRequirements,
    shiftTemplates: scenario.shiftTemplates,
    specialDays: scenario.specialDays
  });
  const slots = plan.slots.map((slot, index) =>
    createSlot({
      id: `${scenario.run.id}-test-slot-${index}`,
      runId: scenario.run.id,
      date: slot.date,
      roleId: slot.roleId,
      sourceId: slot.sourceId,
      startTime: slot.startTime,
      endTime: slot.endTime,
      status: "unfilled"
    })
  );

  return {
    scenario,
    slots,
    result: optimizeScheduleInMemory({
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
    })
  };
}

function assignmentSignature(assignments: Array<{ schedule_slot_id: string; employee_id: string }>) {
  return assignments
    .map((assignment) => `${assignment.schedule_slot_id}:${assignment.employee_id}`)
    .sort();
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "valid generated schedule has zero hard violations",
    run: () => {
      const evaluation = evaluateFixture(createFixture());
      assert.equal(evaluation.isValid, true);
      assert.equal(evaluation.metrics.hardViolationCount, 0);
      assert.equal(evaluation.metrics.coverageRate, 1);
    }
  },
  {
    name: "inactive employees are detected",
    run: () => {
      const fixture = createFixture();
      fixture.employees = [
        createEmployee("emp-inactive", "Inactive", "Service", 0)
      ];
      fixture.employeeRoles = [
        createEmployeeRole("er-inactive-service", "emp-inactive", fixture.roles[0].id)
      ];
      fixture.employeeWorkRules = [
        createWorkRules("wr-inactive", "emp-inactive")
      ];
      fixture.assignments = [
        createAssignment(
          "as-inactive",
          fixture.run.id,
          fixture.slots[0].id,
          "emp-inactive"
        )
      ];

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some(
          (violation) => violation.type === "inactive_employee"
        )
      );
    }
  },
  {
    name: "missing role is detected",
    run: () => {
      const fixture = createFixture();
      fixture.assignments = [
        createAssignment(
          "as-wrong-role",
          fixture.run.id,
          fixture.slots[0].id,
          fixture.employees[1].id
        )
      ];

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some(
          (violation) => violation.type === "missing_role_or_experience"
        )
      );
    }
  },
  {
    name: "time off is respected",
    run: () => {
      const fixture = createFixture({
        timeOff: [createTimeOff("to-alex", "emp-alex", "2026-05-18", "2026-05-18")]
      });

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some((violation) => violation.type === "time_off")
      );
    }
  },
  {
    name: "overlapping shifts and same-day assignments are detected",
    run: () => {
      const fixture = createFixture();
      const secondSlot = createSlot({
        id: "slot-service-overlap",
        runId: fixture.run.id,
        date: "2026-05-18",
        roleId: fixture.roles[0].id,
        sourceId: fixture.staffingRequirements[0].id,
        startTime: "13:00",
        endTime: "21:00"
      });
      fixture.slots = [...fixture.slots, secondSlot];
      fixture.assignments = [
        fixture.assignments[0],
        createAssignment("as-overlap", fixture.run.id, secondSlot.id, "emp-alex")
      ];

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some(
          (violation) =>
            violation.type === "same_day_assignment" ||
            violation.type === "overlap"
        )
      );
    }
  },
  {
    name: "max weekly hours are detected unless manual override exists",
    run: () => {
      const fixture = createFixture({
        employeeWorkRules: [createWorkRules("wr-alex", "emp-alex", 8, 8, 1, 2)]
      });
      const extraSlots = Array.from({ length: 2 }, (_, index) =>
        createSlot({
          id: `slot-extra-${index}`,
          runId: fixture.run.id,
          date: `2026-05-${19 + index}`,
          roleId: fixture.roles[0].id,
          sourceId: fixture.staffingRequirements[0].id,
          startTime: "09:00",
          endTime: "17:00"
        })
      );
      fixture.slots = [...fixture.slots, ...extraSlots];
      fixture.assignments = [
        createAssignment("as-alex-1", fixture.run.id, fixture.slots[0].id, "emp-alex"),
        createAssignment("as-alex-2", fixture.run.id, extraSlots[0].id, "emp-alex"),
        createAssignment("as-alex-3", fixture.run.id, extraSlots[1].id, "emp-alex")
      ];

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some((violation) => violation.type === "max_hours")
      );

      const overrideEvaluation = evaluateSchedule({
        run: fixture.run,
        slots: fixture.slots,
        assignments: fixture.assignments,
        employees: fixture.employees,
        roles: fixture.roles,
        employeeRoles: fixture.employeeRoles,
        employeeWorkRules: fixture.employeeWorkRules,
        employeeDayConstraints: fixture.employeeDayConstraints,
        employeeShiftAvailability: fixture.employeeShiftAvailability,
        timeOff: fixture.timeOff,
        staffingRequirements: fixture.staffingRequirements,
        shiftTemplates: fixture.shiftTemplates,
        manualOverrides: {
          [fixture.slots[0].id]: ["emp-alex"],
          [extraSlots[0].id]: ["emp-alex"],
          [extraSlots[1].id]: ["emp-alex"]
        }
      });
      assert.equal(
        overrideEvaluation.hardViolations.some(
          (violation) => violation.type === "max_hours"
        ),
        false
      );
    }
  },
  {
    name: "impossible schedules produce warnings instead of pretending coverage",
    run: () => {
      const fixture = createFixture({
        assignments: []
      });

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.metrics.coverageRate, 0);
      assert.equal(evaluation.metrics.unfilledSlots, 1);
      assert.ok(
        evaluation.softWarnings.some(
          (warning) =>
            warning.type === "zero_coverage" ||
            warning.type === "critical_zero_coverage"
        )
      );
    }
  },
  {
    name: "optimized scheduler is deterministic and stops early on easy scenario",
    run: () => {
      const first = optimizeBenchmarkScenario("easy cafe");
      const second = optimizeBenchmarkScenario("easy cafe");

      assert.deepEqual(
        assignmentSignature(first.result.generatedAssignments),
        assignmentSignature(second.result.generatedAssignments)
      );
      assert.equal(first.result.evaluation.metrics.coverageRate, 1);
      assert.equal(first.result.evaluation.metrics.hardViolationCount, 0);
      assert.equal(first.result.selectedScore, first.result.evaluation.reward);
      assert.ok(
        first.result.stopReason === "perfect_schedule" ||
          first.result.stopReason === "no_improvement"
      );
      assert.notEqual(first.result.stopReason, "time_budget");
      assert.ok(first.result.attemptsCompleted > 0);
      assert.ok(first.result.repairFinalScore >= first.result.repairInitialScore);

      if (first.result.repairIterations > 0) {
        assert.ok(first.result.repairFinalScore > first.result.repairInitialScore);
      }
    }
  },
  {
    name: "coverage ceiling explains feasible easy and impossible scenarios",
    run: () => {
      const easy = optimizeBenchmarkScenario("easy cafe");
      const easyCeiling = buildCoverageCeilingAnalysis({
        slots: easy.slots,
        employees: easy.scenario.employees,
        employeeRoles: easy.scenario.employeeRoles,
        employeeWorkRules: easy.scenario.employeeWorkRules,
        employeeDayConstraints: easy.scenario.employeeDayConstraints,
        employeeShiftAvailability: easy.scenario.employeeShiftAvailability,
        timeOff: easy.scenario.timeOff,
        staffingRequirements: easy.scenario.staffingRequirements,
        shiftTemplates: easy.scenario.shiftTemplates,
        roles: easy.scenario.roles,
        existingAssignments: easy.scenario.existingAssignments
      });
      const easyDiagnosis = diagnoseCoverageCeiling({
        analysis: easyCeiling,
        assignedSlots: easy.result.evaluation.metrics.filledSlots,
        hardViolationCount: easy.result.evaluation.metrics.hardViolationCount
      });

      assert.equal(easyCeiling.feasibleMaxAssignedSlots, easy.slots.length);
      assert.equal(easyDiagnosis.coverageGap, 0);
      assert.equal(easyDiagnosis.diagnosis, "fully_covered");

      const impossible = optimizeBenchmarkScenario("impossible schedule");
      const impossibleCeiling = buildCoverageCeilingAnalysis({
        slots: impossible.slots,
        employees: impossible.scenario.employees,
        employeeRoles: impossible.scenario.employeeRoles,
        employeeWorkRules: impossible.scenario.employeeWorkRules,
        employeeDayConstraints: impossible.scenario.employeeDayConstraints,
        employeeShiftAvailability: impossible.scenario.employeeShiftAvailability,
        timeOff: impossible.scenario.timeOff,
        staffingRequirements: impossible.scenario.staffingRequirements,
        shiftTemplates: impossible.scenario.shiftTemplates,
        roles: impossible.scenario.roles,
        existingAssignments: impossible.scenario.existingAssignments
      });

      assert.ok(
        impossibleCeiling.feasibleMaxAssignedSlots < impossible.slots.length
      );
      assert.ok(impossibleCeiling.impossibleSlotCount > 0);
    }
  },
  {
    name: "role scarcity produces grouped manager diagnostics",
    run: () => {
      const scarce = optimizeBenchmarkScenario("explicit role scarcity");
      const ceiling = buildCoverageCeilingAnalysis({
        slots: scarce.slots,
        employees: scarce.scenario.employees,
        employeeRoles: scarce.scenario.employeeRoles,
        employeeWorkRules: scarce.scenario.employeeWorkRules,
        employeeDayConstraints: scarce.scenario.employeeDayConstraints,
        employeeShiftAvailability: scarce.scenario.employeeShiftAvailability,
        timeOff: scarce.scenario.timeOff,
        staffingRequirements: scarce.scenario.staffingRequirements,
        shiftTemplates: scarce.scenario.shiftTemplates,
        roles: scarce.scenario.roles,
        existingAssignments: scarce.scenario.existingAssignments
      });
      const diagnosis = diagnoseCoverageCeiling({
        analysis: ceiling,
        assignedSlots: scarce.result.evaluation.metrics.filledSlots,
        hardViolationCount: scarce.result.evaluation.metrics.hardViolationCount
      });
      const diagnostics = buildManagerScheduleDiagnostics({
        evaluation: scarce.result.evaluation,
        coverageCeiling: ceiling,
        coverageDiagnosis: diagnosis,
        warnings: scarce.result.warnings,
        slots: scarce.slots,
        roles: scarce.scenario.roles
      });

      assert.equal(diagnostics.status, "Understaffed");
      assert.ok(diagnostics.mainIssues.length > 0);
      assert.ok(
        diagnostics.mainIssues.some((issue) => issue.includes("Cashier"))
      );
      assert.ok(diagnostics.suggestedFixes.length > 0);
    }
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

console.log(`Scheduler regression tests passed (${tests.length}).`);
