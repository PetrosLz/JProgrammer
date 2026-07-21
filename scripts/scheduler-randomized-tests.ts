import assert from "node:assert/strict";

import type {
  DayOfWeek,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  TimeOff
} from "../src/renderer/types";
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
  solveAndValidateCpSat
} from "./scheduler-verification-harness";

type RandomizedBatch = {
  label: "small" | "medium";
  seed: number;
  count: number;
};

const batches: RandomizedBatch[] = [
  { label: "small", seed: 4101, count: 100 },
  { label: "medium", seed: 9101, count: 50 }
];

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const python = resolveTestPythonCommand();
  if (!python) {
    throw new Error("CP-SAT Python runtime is unavailable; randomized CP-SAT verification cannot run.");
  }

  let executed = 0;

  for (const batch of batches) {
    const rng = createRng(batch.seed);

    for (let index = 0; index < batch.count; index += 1) {
      const scenarioSeed = Math.floor(rng() * 1_000_000_000);
      try {
        const scenario = createRandomScenario({
          label: batch.label,
          seed: scenarioSeed,
          index
        });
        const generated = buildGeneratedScenarioRun(
          scenario,
          `${batch.label}-${index}-${scenarioSeed}`
        );
        maybeAddLockedAssignment({ scenario, slots: generated.slots });

        const cpSat = await solveAndValidateCpSat({
          python,
          scenario,
          slots: generated.slots,
          requestId: `random-${batch.label}-${index}-${scenarioSeed}`,
          timeoutSeconds: batch.label === "small" ? 1.5 : 2.5
        });

        assert(cpSat.result.objectiveValues.coveredSlots <= generated.slots.length);
        if (cpSat.result.status === "OPTIMAL" || cpSat.result.status === "FEASIBLE") {
          assert.equal(cpSat.hardViolationCount, 0);
          assert.equal(cpSat.validated, true);
        }

        executed += 1;
      } catch (error) {
        console.error(
          JSON.stringify(
            {
              seed: scenarioSeed,
              batch: batch.label,
              index,
              error: error instanceof Error ? error.message : String(error)
            },
            null,
            2
          )
        );
        throw error;
      }
    }

    console.log(
      `ok - randomized ${batch.label} batch seed=${batch.seed} scenarios=${batch.count}`
    );
  }

  console.log(`\n${executed} randomized CP-SAT scenarios passed.`);
}

function createRandomScenario({
  label,
  seed,
  index
}: {
  label: "small" | "medium";
  seed: number;
  index: number;
}): SchedulerBenchmarkScenario {
  const rng = createRng(seed);
  const roleCount = label === "small" ? randomInteger(rng, 1, 3) : randomInteger(rng, 2, 5);
  const employeeCount =
    label === "small" ? randomInteger(rng, 5, 10) : randomInteger(rng, 20, 40);
  const shiftCount =
    label === "small" ? randomInteger(rng, 2, 4) : randomInteger(rng, 4, 8);
  const activeDays =
    label === "small"
      ? chooseMany(rng, [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[], randomInteger(rng, 2, 4))
      : ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]);
  const name = `random ${label} ${index} seed ${seed}`;
  const run = createRun(`run-${label}-${index}-${seed}`);
  const roles = Array.from({ length: roleCount }, (_, roleIndex) =>
    createRole(`role-${label}-${index}-${roleIndex}`, `Role ${roleIndex + 1}`)
  );
  const shiftTemplates = Array.from({ length: shiftCount }, (_, shiftIndex) => {
    const [startTime, endTime] = chooseShiftPair(rng);
    return createShiftTemplate(
      `shift-${label}-${index}-${shiftIndex}`,
      `Shift ${shiftIndex + 1}`,
      startTime,
      endTime
    );
  });
  const openingHours = createOpeningHours().map((row) => {
    if (!activeDays.includes(row.day_of_week)) {
      return {
        ...row,
        is_open: 0 as const,
        is_24_hours: 0 as const,
        open_time: null,
        close_time: null,
        is_overnight: 0 as const
      };
    }

    const mode = randomInteger(rng, 0, 3);
    if (mode === 0) {
      return {
        ...row,
        is_open: 1 as const,
        is_24_hours: 1 as const,
        open_time: null,
        close_time: null,
        is_overnight: 0 as const
      };
    }

    const [openTime, closeTime] = mode === 1 ? ["08:00", "23:00"] : ["18:00", "04:00"];
    return {
      ...row,
      is_open: 1 as const,
      is_24_hours: 0 as const,
      open_time: openTime,
      close_time: closeTime,
      is_overnight: closeTime < openTime ? 1 as const : 0 as const
    };
  });
  const staffingRequirements = activeDays.flatMap((dayOfWeek) =>
    chooseMany(rng, shiftTemplates, randomInteger(rng, 1, Math.min(shiftTemplates.length, 3))).flatMap((shift) =>
      chooseMany(rng, roles, randomInteger(rng, 1, Math.min(roles.length, 2))).map((role) => ({
        ...createStaffingRequirement({
          id: `req-${label}-${index}-${dayOfWeek}-${shift.id}-${role.id}`,
          roleId: role.id,
          shiftTemplateId: shift.id,
          startTime: shift.start_time,
          endTime: shift.end_time,
          requiredCount: randomInteger(rng, 1, label === "small" ? 2 : 3),
          dayOfWeek
        }),
        minimum_experience_level: rng() < 0.2 ? "some_experience" as const : "no_experience" as const,
        experienced_required_count: rng() < 0.15 ? 1 : 0
      }))
    )
  );
  const employees = Array.from({ length: employeeCount }, (_, employeeIndex) =>
    createEmployee(
      `emp-${label}-${index}-${employeeIndex}`,
      `Emp${employeeIndex}`,
      `Seed${seed}`
    )
  );
  const employeeRoles: EmployeeRole[] = [];
  for (const employee of employees) {
    const assignedRoles = chooseMany(
      rng,
      roles,
      randomInteger(rng, 1, Math.min(roles.length, rng() < 0.25 ? 3 : 2))
    );
    for (const role of assignedRoles) {
      employeeRoles.push(
        createEmployeeRole(
          `er-${employee.id}-${role.id}`,
          employee.id,
          role.id,
          rng() < 0.3 ? "no_experience" : "some_experience"
        )
      );
    }
  }
  const employeeWorkRules = employees.map((employee) =>
    createWorkRules(
      `wr-${employee.id}`,
      employee.id,
      randomInteger(rng, label === "small" ? 2 : 3, label === "small" ? 7 : 10),
      randomInteger(rng, 4, 10),
      rng() < 0.5 ? randomInteger(rng, 4, 8) : null,
      rng() < 0.15 ? 0 : 1
    )
  );
  const employeeDayConstraints: EmployeeDayConstraint[] = employees
    .filter(() => rng() < 0.12)
    .map((employee, constraintIndex) => ({
      id: `dc-${employee.id}-${constraintIndex}`,
      employee_id: employee.id,
      day_of_week: chooseOne(rng, [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]),
      constraint_type: "cannot_work",
      notes: null,
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z"
    }));
  const employeeShiftAvailability: EmployeeShiftAvailability[] = employees
    .filter(() => rng() < 0.1)
    .map((employee, availabilityIndex) => ({
      id: `sa-${employee.id}-${availabilityIndex}`,
      employee_id: employee.id,
      day_of_week: chooseOne(rng, [0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]),
      shift_template_id: chooseOne(rng, shiftTemplates).id,
      availability_type: "cannot_work",
      notes: null,
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z"
    }));
  const timeOff: TimeOff[] = employees
    .filter(() => rng() < 0.08)
    .map((employee, timeOffIndex) =>
      createTimeOff(
        `to-${employee.id}-${timeOffIndex}`,
        employee.id,
        "2026-05-20",
        rng() < 0.5 ? "2026-05-20" : "2026-05-21"
      )
    );

  const scenario = createScenarioSkeleton({
    name,
    run,
    openingHours,
    roles,
    shiftTemplates,
    staffingRequirements,
    employees,
    employeeRoles,
    employeeWorkRules
  });
  scenario.employeeDayConstraints = employeeDayConstraints;
  scenario.employeeShiftAvailability = employeeShiftAvailability;
  scenario.timeOff = timeOff;

  return scenario;
}

function maybeAddLockedAssignment({
  scenario,
  slots
}: {
  scenario: SchedulerBenchmarkScenario;
  slots: ReturnType<typeof buildGeneratedScenarioRun>["slots"];
}): void {
  if (slots.length === 0 || scenario.employees.length === 0) {
    return;
  }

  const request = buildRequestForScenario({
    scenario,
    slots,
    requestId: `lock-seed-${scenario.run.id}`,
    timeoutSeconds: 1
  });
  const pair = request.eligibility[0];
  if (!pair) {
    return;
  }

  scenario.existingAssignments = [
    createAssignment(
      `locked-${scenario.run.id}`,
      scenario.run.id,
      pair.slotId,
      pair.employeeId
    )
  ];
}

function chooseShiftPair(rng: () => number): [string, string] {
  return chooseOne(rng, [
    ["08:00", "12:00"],
    ["09:00", "17:00"],
    ["16:00", "00:00"],
    ["18:00", "02:00"],
    ["22:00", "06:00"],
    ["23:00", "07:00"],
    ["00:00", "08:00"]
  ]);
}

function chooseMany<T>(rng: () => number, values: T[], count: number): T[] {
  const copy = [...values];
  const result: T[] = [];
  while (result.length < count && copy.length > 0) {
    const index = randomInteger(rng, 0, copy.length - 1);
    result.push(copy.splice(index, 1)[0]);
  }
  return result;
}

function chooseOne<T>(rng: () => number, values: T[]): T {
  return values[randomInteger(rng, 0, values.length - 1)];
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInteger(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
