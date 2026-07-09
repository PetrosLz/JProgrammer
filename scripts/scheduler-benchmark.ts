import { performance } from "node:perf_hooks";

import { evaluateSchedule } from "../src/renderer/services/scheduler/evaluator";
import type { SchedulerFixture } from "./scheduler-fixtures";
import {
  createAssignment,
  createEmployee,
  createEmployeeRole,
  createFixture,
  createRole,
  createSlot,
  createStaffingRequirement,
  createWorkRules
} from "./scheduler-fixtures";

type BenchmarkScenario = {
  name: string;
  fixture: SchedulerFixture;
};

const scenarios: BenchmarkScenario[] = [
  {
    name: "easy cafe",
    fixture: createFixture()
  },
  {
    name: "understaffed cafe",
    fixture: createUnderstaffedCafe()
  },
  {
    name: "many part-time employees",
    fixture: createManyPartTimeEmployees()
  },
  {
    name: "weekend shortage",
    fixture: createWeekendShortage()
  },
  {
    name: "one prior-experience employee",
    fixture: createOneExperiencedEmployee()
  },
  {
    name: "impossible schedule",
    fixture: createImpossibleSchedule()
  },
  {
    name: "multi-role flexible employees",
    fixture: createFlexibleEmployees()
  },
  {
    name: "high-demand Saturday",
    fixture: createHighDemandSaturday()
  }
];

for (const scenario of scenarios) {
  const startedAt = performance.now();
  const evaluation = evaluateSchedule({
    run: scenario.fixture.run,
    slots: scenario.fixture.slots,
    assignments: scenario.fixture.assignments,
    employees: scenario.fixture.employees,
    roles: scenario.fixture.roles,
    employeeRoles: scenario.fixture.employeeRoles,
    employeeWorkRules: scenario.fixture.employeeWorkRules,
    employeeDayConstraints: scenario.fixture.employeeDayConstraints,
    employeeShiftAvailability: scenario.fixture.employeeShiftAvailability,
    timeOff: scenario.fixture.timeOff,
    staffingRequirements: scenario.fixture.staffingRequirements,
    shiftTemplates: scenario.fixture.shiftTemplates
  });
  const elapsedMs = performance.now() - startedAt;

  console.log(
    [
      scenario.name.padEnd(28),
      `grade=${evaluation.grade.padEnd(12)}`,
      `coverage=${Math.round(evaluation.metrics.coverageRate * 100)
        .toString()
        .padStart(3)}%`,
      `hard=${evaluation.metrics.hardViolationCount}`,
      `warnings=${evaluation.metrics.warningCount}`,
      `reward=${Math.round(evaluation.reward)}`,
      `weekendRange=${evaluation.metrics.weekendDistributionRange}`,
      `difficultRange=${evaluation.metrics.difficultShiftDistributionRange}`,
      `time=${elapsedMs.toFixed(2)}ms`
    ].join(" | ")
  );
}

function createUnderstaffedCafe(): SchedulerFixture {
  const fixture = createFixture({ assignments: [] });
  fixture.slots = [
    ...fixture.slots,
    createSlot({
      id: "slot-service-tuesday",
      runId: fixture.run.id,
      date: "2026-05-19",
      roleId: fixture.roles[0].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "09:00",
      endTime: "17:00",
      status: "unfilled"
    }),
    createSlot({
      id: "slot-kitchen-tuesday",
      runId: fixture.run.id,
      date: "2026-05-19",
      roleId: fixture.roles[1].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "09:00",
      endTime: "17:00",
      status: "unfilled"
    })
  ];

  return fixture;
}

function createManyPartTimeEmployees(): SchedulerFixture {
  const employees = Array.from({ length: 8 }, (_, index) =>
    createEmployee(`emp-pt-${index}`, `Part${index}`, "Timer")
  );
  const fixture = createFixture({ employees });
  fixture.employeeRoles = employees.map((employee, index) =>
    createEmployeeRole(`er-pt-${index}`, employee.id, fixture.roles[0].id)
  );
  fixture.employeeWorkRules = employees.map((employee, index) =>
    createWorkRules(`wr-pt-${index}`, employee.id, 20, 24, 4, 5)
  );
  fixture.slots = Array.from({ length: 8 }, (_, index) =>
    createSlot({
      id: `slot-pt-${index}`,
      runId: fixture.run.id,
      date: `2026-05-${18 + index}`,
      roleId: fixture.roles[0].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "09:00",
      endTime: "13:00"
    })
  );
  fixture.assignments = fixture.slots.map((slot, index) =>
    createAssignment(`as-pt-${index}`, fixture.run.id, slot.id, employees[index].id)
  );

  return fixture;
}

function createWeekendShortage(): SchedulerFixture {
  const fixture = createFixture();
  fixture.slots = [
    createSlot({
      id: "slot-sat-service",
      runId: fixture.run.id,
      date: "2026-05-23",
      roleId: fixture.roles[0].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "17:00",
      endTime: "23:00"
    }),
    createSlot({
      id: "slot-sat-kitchen",
      runId: fixture.run.id,
      date: "2026-05-23",
      roleId: fixture.roles[1].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "17:00",
      endTime: "23:00",
      status: "unfilled"
    })
  ];
  fixture.assignments = [
    createAssignment("as-sat-service", fixture.run.id, fixture.slots[0].id, "emp-alex")
  ];

  return fixture;
}

function createOneExperiencedEmployee(): SchedulerFixture {
  const fixture = createFixture();
  fixture.employeeRoles = [
    createEmployeeRole("er-alex-service", "emp-alex", fixture.roles[0].id, "some_experience"),
    createEmployeeRole("er-nina-service", "emp-nina", fixture.roles[0].id, "no_experience")
  ];
  fixture.slots = [
    fixture.slots[0],
    createSlot({
      id: "slot-service-second",
      runId: fixture.run.id,
      date: "2026-05-18",
      roleId: fixture.roles[0].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "09:00",
      endTime: "17:00"
    })
  ];
  fixture.assignments = [
    createAssignment("as-alex-service", fixture.run.id, fixture.slots[0].id, "emp-alex"),
    createAssignment("as-nina-service", fixture.run.id, fixture.slots[1].id, "emp-nina")
  ];

  return fixture;
}

function createImpossibleSchedule(): SchedulerFixture {
  const fixture = createFixture();
  fixture.slots = Array.from({ length: 6 }, (_, index) =>
    createSlot({
      id: `slot-impossible-${index}`,
      runId: fixture.run.id,
      date: `2026-05-${18 + index}`,
      roleId: fixture.roles[1].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "09:00",
      endTime: "17:00",
      status: "unfilled"
    })
  );
  fixture.assignments = [];

  return fixture;
}

function createFlexibleEmployees(): SchedulerFixture {
  const fixture = createFixture();
  fixture.employeeRoles = [
    createEmployeeRole("er-alex-service", "emp-alex", fixture.roles[0].id),
    createEmployeeRole("er-alex-kitchen", "emp-alex", fixture.roles[1].id),
    createEmployeeRole("er-nina-kitchen", "emp-nina", fixture.roles[1].id)
  ];
  fixture.slots = [
    fixture.slots[0],
    createSlot({
      id: "slot-flex-kitchen",
      runId: fixture.run.id,
      date: "2026-05-19",
      roleId: fixture.roles[1].id,
      sourceId: fixture.staffingRequirements[0].id,
      startTime: "09:00",
      endTime: "17:00"
    })
  ];
  fixture.assignments = [
    createAssignment("as-alex-service", fixture.run.id, fixture.slots[0].id, "emp-alex"),
    createAssignment("as-nina-kitchen", fixture.run.id, fixture.slots[1].id, "emp-nina")
  ];

  return fixture;
}

function createHighDemandSaturday(): SchedulerFixture {
  const roles = [
    createRole("role-service", "Service"),
    createRole("role-kitchen", "Kitchen"),
    createRole("role-cashier", "Cashier")
  ];
  const fixture = createFixture({ roles });
  fixture.employeeRoles = [
    createEmployeeRole("er-alex-service", "emp-alex", roles[0].id),
    createEmployeeRole("er-alex-cashier", "emp-alex", roles[2].id),
    createEmployeeRole("er-nina-kitchen", "emp-nina", roles[1].id)
  ];
  fixture.staffingRequirements = roles.map((role) =>
    createStaffingRequirement({
      id: `req-sat-${role.id}`,
      roleId: role.id,
      shiftTemplateId: fixture.shiftTemplates[1].id,
      startTime: "17:00",
      endTime: "23:00"
    })
  );
  fixture.slots = roles.flatMap((role, roleIndex) =>
    Array.from({ length: roleIndex === 0 ? 3 : 2 }, (_, index) =>
      createSlot({
        id: `slot-sat-${role.id}-${index}`,
        runId: fixture.run.id,
        date: "2026-05-23",
        roleId: role.id,
        sourceId: fixture.staffingRequirements[roleIndex].id,
        startTime: "17:00",
        endTime: "23:00",
        status: index === 0 ? "filled" : "unfilled"
      })
    )
  );
  fixture.assignments = [
    createAssignment("as-sat-service", fixture.run.id, fixture.slots[0].id, "emp-alex"),
    createAssignment("as-sat-kitchen", fixture.run.id, fixture.slots[3].id, "emp-nina")
  ];

  return fixture;
}
