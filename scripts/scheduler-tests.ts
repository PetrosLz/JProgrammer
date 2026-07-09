import assert from "node:assert/strict";

import { evaluateSchedule } from "../src/renderer/services/scheduler/evaluator";
import {
  createAssignment,
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
  }
];

for (const test of tests) {
  test.run();
  console.log(`ok - ${test.name}`);
}

console.log(`Scheduler regression tests passed (${tests.length}).`);
