import assert from "node:assert/strict";

import {
  buildScheduleGenerationPlan,
  getOwningDateMinuteContribution,
  getShiftDurationMinutes,
  getWeekKey,
  intervalsOverlap,
  validateScheduleHardConstraints
} from "../src/renderer/services/scheduler";
import {
  buildShiftInterval,
  formatTimeRange,
  isValidTimeString,
  timeToMinutes
} from "../src/renderer/services/scheduler/model/workingTime";
import type { DayOfWeek, OpeningHours } from "../src/renderer/types";
import {
  buildEmployeeScheduleRows,
  buildManagerReportPdfHtml,
  buildScheduleRows,
  buildTeamSchedulePdfHtml,
  formatSlotTime
} from "../src/renderer/src/utils/scheduleDisplay";
import {
  createAssignment,
  createEmployee,
  createEmployeeRole,
  createFixture,
  createOpeningHours,
  createRole,
  createRun,
  createShiftTemplate,
  createSpecialDay,
  createSpecialDayStaffingRequirement,
  createSlot,
  createStaffingRequirement,
  createTimeOff,
  createWorkRules
} from "./scheduler-fixtures";
import {
  buildGeneratedScenarioRun,
  buildRequestForScenario,
  buildScheduleAssignmentsFromCpSat,
  buildSchedulerData,
  createScenarioSkeleton,
  resolveTestPythonCommand,
  solveAndValidateCpSat
} from "./scheduler-verification-harness";
import {
  formatOpeningHoursSummary,
  isShiftContainedWithinOpeningIntervals
} from "../src/renderer/services/scheduler/model/openingIntervals";

type TestCase = {
  name: string;
  scenarios: number;
  run: () => void | Promise<void>;
};

const tests: TestCase[] = [
  {
    name: "opening-hours generation matrix",
    scenarios: 15,
    run: testOpeningHoursMatrix
  },
  {
    name: "continuous opening containment matrix",
    scenarios: 18,
    run: testContinuousOpeningContainmentMatrix
  },
  {
    name: "shift interval matrix",
    scenarios: 8,
    run: testShiftIntervalMatrix
  },
  {
    name: "overlap matrix",
    scenarios: 8,
    run: testOverlapMatrix
  },
  {
    name: "owning-date and limits matrix",
    scenarios: 8,
    run: testOwningDateAndLimitMatrix
  },
  {
    name: "UI/PDF interval formatting consistency",
    scenarios: 5,
    run: testUiPdfFormattingConsistency
  },
  {
    name: "opening-hours display helper",
    scenarios: 7,
    run: testOpeningHoursDisplayHelper
  },
  {
    name: "strict malformed time validation matrix",
    scenarios: 18,
    run: testMalformedTimeValidationMatrix
  },
  {
    name: "DST policy regression: scheduled wall-clock duration remains stable",
    scenarios: 2,
    run: testDstWallClockPolicy
  },
  {
    name: "24-hour end-to-end CP-SAT scenarios",
    scenarios: 13,
    run: testTwentyFourHourCpSatScenarios
  }
];

void main();

async function main(): Promise<void> {
  let passed = 0;
  let scenarios = 0;

  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      scenarios += test.scenarios;
      console.log(`ok ${passed} - ${test.name} (${test.scenarios} scenarios)`);
    } catch (error) {
      console.error(`not ok - ${test.name}`);
      console.error(error);
      process.exitCode = 1;
      break;
    }
  }

  if (process.exitCode !== 1) {
    console.log(
      `\n${passed}/${tests.length} time-model test groups passed; ${scenarios} deterministic scenarios executed.`
    );
  }

  process.exit(process.exitCode ?? 0);
}

function testOpeningHoursMatrix(): void {
  type OpeningCase = {
    name: string;
    mode: string;
    open: string | null;
    close: string | null;
    shift: readonly [string, string];
    slots: number;
    warning?: string;
  };
  const cases: OpeningCase[] = [
    { name: "closed day", mode: "closed", open: null, close: null, shift: ["09:00", "17:00"], slots: 0, warning: "closed_day_requirement" },
    { name: "standard same-day opening", mode: "custom", open: "08:00", close: "20:00", shift: ["09:00", "17:00"], slots: 1 },
    { name: "opening ending at midnight", mode: "custom", open: "16:00", close: "00:00", shift: ["18:00", "00:00"], slots: 1 },
    { name: "opening crossing midnight", mode: "custom", open: "20:00", close: "04:00", shift: ["22:00", "02:00"], slots: 1 },
    { name: "explicit 24-hour day", mode: "24", open: null, close: null, shift: ["09:00", "17:00"], slots: 1 },
    { name: "seven consecutive 24-hour days", mode: "all-24", open: null, close: null, shift: ["22:00", "06:00"], slots: 7 },
    { name: "24-hour day followed by closed day", mode: "24-next-closed", open: null, close: null, shift: ["23:00", "07:00"], slots: 0, warning: "slot_outside_opening_hours" },
    { name: "24-hour day followed by custom day", mode: "24-next-custom", open: null, close: null, shift: ["23:00", "07:00"], slots: 0, warning: "slot_outside_opening_hours" },
    { name: "equal-time custom opening rejected", mode: "custom", open: "08:00", close: "08:00", shift: ["09:00", "10:00"], slots: 0, warning: "invalid_opening_hours" },
    { name: "one minute before opening rejected", mode: "custom", open: "08:00", close: "20:00", shift: ["07:59", "09:00"], slots: 0, warning: "slot_outside_opening_hours" },
    { name: "one minute after closing rejected", mode: "custom", open: "08:00", close: "20:00", shift: ["19:00", "20:01"], slots: 0, warning: "slot_outside_opening_hours" },
    { name: "exact opening boundary accepted", mode: "custom", open: "08:00", close: "20:00", shift: ["08:00", "12:00"], slots: 1 },
    { name: "exact closing boundary accepted", mode: "custom", open: "08:00", close: "20:00", shift: ["16:00", "20:00"], slots: 1 },
    { name: "partially outside opening rejected", mode: "custom", open: "20:00", close: "04:00", shift: ["19:00", "22:00"], slots: 0, warning: "slot_outside_opening_hours" },
    { name: "fully outside opening rejected", mode: "custom", open: "08:00", close: "20:00", shift: ["21:00", "23:00"], slots: 0, warning: "slot_outside_opening_hours" }
  ];

  for (const item of cases) {
    const [startTime, endTime] = item.shift;
    const role = createRole(`role-${slug(item.name)}`, "Service");
    const shift = createShiftTemplate(`shift-${slug(item.name)}`, item.name, startTime, endTime);
    const dayOfWeek: DayOfWeek = item.mode === "all-24" ? 1 : 1;
    const days =
      item.mode === "all-24" ? ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]) : [dayOfWeek];
    const openingHours = openingHoursForCase(item.mode, item.open, item.close);
    const requirements = days.map((day) =>
      createStaffingRequirement({
        id: `req-${slug(item.name)}-${day}`,
        roleId: role.id,
        shiftTemplateId: shift.id,
        startTime,
        endTime,
        dayOfWeek: day
      })
    );
    const plan = buildScheduleGenerationPlan({
      weekStartDate: "2026-05-18",
      openingHours,
      staffingRequirements: requirements,
      specialDayStaffingRequirements: [],
      shiftTemplates: [shift],
      specialDays: []
    });

    assert.equal(plan.slots.length, item.slots, item.name);
    if (item.warning) {
      assert.equal(
        plan.warnings.some((warning) => warning.warningType === item.warning),
        true,
        `${item.name} should emit ${item.warning}`
      );
    }
  }
}

function testContinuousOpeningContainmentMatrix(): void {
  const monday = "2026-05-18";
  const tuesday = "2026-05-19";
  const cases = [
    {
      name: "24h to closed accepts exact midnight boundary",
      openingHours: openingHoursFromRows({ 1: { mode: "24" }, 2: { mode: "closed" } }),
      date: monday,
      shift: ["23:00", "00:00"] as const,
      expectedSlots: 1
    },
    {
      name: "24h to closed rejects one minute after midnight",
      openingHours: openingHoursFromRows({ 1: { mode: "24" }, 2: { mode: "closed" } }),
      date: monday,
      shift: ["23:00", "00:01"] as const,
      expectedSlots: 0
    },
    {
      name: "24h to closed rejects overnight continuation",
      openingHours: openingHoursFromRows({ 1: { mode: "24" }, 2: { mode: "closed" } }),
      date: monday,
      shift: ["23:00", "07:00"] as const,
      expectedSlots: 0
    },
    {
      name: "24h to midnight custom accepts merged continuation",
      openingHours: openingHoursFromRows({ 1: { mode: "24" }, 2: { mode: "custom", open: "00:00", close: "08:00" } }),
      date: monday,
      shift: ["23:00", "07:00"] as const,
      expectedSlots: 1
    },
    {
      name: "24h to midnight custom rejects beyond close",
      openingHours: openingHoursFromRows({ 1: { mode: "24" }, 2: { mode: "custom", open: "00:00", close: "08:00" } }),
      date: monday,
      shift: ["23:00", "09:00"] as const,
      expectedSlots: 0
    },
    {
      name: "24h to late custom rejects closed early morning",
      openingHours: openingHoursFromRows({ 1: { mode: "24" }, 2: { mode: "custom", open: "10:00", close: "18:00" } }),
      date: monday,
      shift: ["23:00", "07:00"] as const,
      expectedSlots: 0
    },
    {
      name: "late custom Tuesday-owned shift is valid",
      openingHours: openingHoursFromRows({ 1: { mode: "24" }, 2: { mode: "custom", open: "10:00", close: "18:00" } }),
      date: tuesday,
      shift: ["10:00", "12:00"] as const,
      expectedSlots: 1
    },
    {
      name: "previous-day carryover accepts early next-day shift",
      openingHours: openingHoursFromRows({ 1: { mode: "custom", open: "20:00", close: "04:00" }, 2: { mode: "closed" } }),
      date: tuesday,
      shift: ["01:00", "03:00"] as const,
      expectedSlots: 1
    },
    {
      name: "previous-day carryover rejects beyond close",
      openingHours: openingHoursFromRows({ 1: { mode: "custom", open: "20:00", close: "04:00" }, 2: { mode: "closed" } }),
      date: tuesday,
      shift: ["03:00", "05:00"] as const,
      expectedSlots: 0
    },
    {
      name: "adjacent custom openings merge",
      openingHours: openingHoursFromRows({ 1: { mode: "custom", open: "20:00", close: "04:00" }, 2: { mode: "custom", open: "04:00", close: "12:00" } }),
      date: monday,
      shift: ["23:00", "08:00"] as const,
      expectedSlots: 1
    },
    {
      name: "one-minute gap breaks continuous opening",
      openingHours: openingHoursFromRows({ 1: { mode: "custom", open: "20:00", close: "04:00" }, 2: { mode: "custom", open: "04:01", close: "12:00" } }),
      date: monday,
      shift: ["23:00", "08:00"] as const,
      expectedSlots: 0
    }
  ];

  for (const item of cases) {
    const plan = buildPlanForSingleRequirement({
      date: item.date,
      openingHours: item.openingHours,
      startTime: item.shift[0],
      endTime: item.shift[1]
    });
    assert.equal(plan.slots.length, item.expectedSlots, item.name);
  }

  const carryoverOpeningHours = openingHoursFromRows({
    1: { mode: "custom", open: "20:00", close: "04:00" },
    2: { mode: "closed" }
  });
  const closedSpecialDay = createSpecialDay({
    id: "special-closed-tuesday",
    date: tuesday,
    isClosed: 1
  });
  const carryoverContainment = isShiftContainedWithinOpeningIntervals({
    date: tuesday,
    startTime: "01:00",
    endTime: "03:00",
    openingHours: carryoverOpeningHours,
    specialDays: [closedSpecialDay]
  });
  assert.equal(carryoverContainment.allowed, true, "special closed date preserves previous-day opening carryover");

  const closedSpecialGeneration = buildPlanForSingleRequirement({
    date: tuesday,
    openingHours: carryoverOpeningHours,
    startTime: "01:00",
    endTime: "03:00",
    specialDays: [closedSpecialDay]
  });
  assert.equal(closedSpecialGeneration.slots.length, 0, "closed special date prevents new requirement starts");

  const openSpecialDay = createSpecialDay({
    id: "special-open-tuesday",
    date: tuesday,
    isClosed: 0
  });
  assert.equal(
    buildPlanForSpecialRequirement({
      date: tuesday,
      openingHours: carryoverOpeningHours,
      specialDay: openSpecialDay,
      startTime: "01:00",
      endTime: "03:00"
    }).slots.length,
    1,
    "special-day staffing override inside carryover is generated"
  );
  const outsideSpecial = buildPlanForSpecialRequirement({
    date: tuesday,
    openingHours: carryoverOpeningHours,
    specialDay: openSpecialDay,
    startTime: "03:00",
    endTime: "05:00"
  });
  assert.equal(outsideSpecial.slots.length, 0, "special-day staffing override outside carryover is skipped");
  assert.equal(
    outsideSpecial.warnings.some((warning) => warning.warningType === "slot_outside_opening_hours"),
    true
  );

  const invalidWeekly = buildPlanForSingleRequirement({
    date: monday,
    openingHours: openingHoursFromRows({ 1: { mode: "24" } }),
    startTime: "09:00",
    endTime: "09:00"
  });
  assert.equal(invalidWeekly.slots.length, 0);
  assert.equal(invalidWeekly.warnings.some((warning) => warning.warningType === "invalid_slot_time_range"), true);

  const invalidSpecial = buildPlanForSpecialRequirement({
    date: tuesday,
    openingHours: openingHoursFromRows({ 2: { mode: "24" } }),
    specialDay: openSpecialDay,
    startTime: "09:00",
    endTime: "09:00"
  });
  assert.equal(invalidSpecial.slots.length, 0);
  assert.equal(invalidSpecial.warnings.some((warning) => warning.warningType === "invalid_slot_time_range"), true);
}

function testShiftIntervalMatrix(): void {
  const cases = [
    ["09:00", "17:00", 480, "09:00–17:00"],
    ["16:00", "01:00", 540, "16:00–01:00 (+1 ημέρα)"],
    ["22:00", "06:00", 480, "22:00–06:00 (+1 ημέρα)"],
    ["08:00", "00:00", 960, "08:00–00:00 (+1 ημέρα)"],
    ["00:00", "08:00", 480, "00:00–08:00"],
    ["23:59", "00:01", 2, "23:59–00:01 (+1 ημέρα)"],
    ["00:00", "00:00", null, "ordinary shift rejected"],
    ["16:00", "01:00", 540, "16:00–01:00 (+1 ημέρα)"]
  ] as const;

  for (const [startTime, endTime, expectedDuration, expectedDisplay] of cases) {
    if (expectedDuration === null) {
      assert.throws(() =>
        getShiftDurationMinutes({
          date: "2026-05-18",
          startTime,
          endTime
        })
      );
      continue;
    }

    assert.equal(
      getShiftDurationMinutes({ date: "2026-05-18", startTime, endTime }),
      expectedDuration
    );
    assert.equal(formatTimeRange({ startTime, endTime, language: "el" }), expectedDisplay);
  }

  const scenario = createCoverableScenario({
    name: "duration adapter agreement",
    shiftStart: "16:00",
    shiftEnd: "01:00",
    requiredCount: 1,
    employeeCount: 1,
    openingMode: "all-24"
  });
  const { slots } = buildGeneratedScenarioRun(scenario, "duration-adapter");
  const request = buildRequestForScenario({
    scenario,
    slots,
    requestId: "duration-adapter-request"
  });
  assert.equal(request.slots[0].durationMinutes, getShiftDurationMinutes({
    date: slots[0].date,
    startTime: slots[0].start_time,
    endTime: slots[0].end_time
  }));
}

function testOverlapMatrix(): void {
  const cases = [
    ["same-day overlap", "2026-05-18", "09:00", "13:00", "2026-05-18", "12:00", "16:00", true],
    ["adjacent same-day shifts", "2026-05-18", "09:00", "13:00", "2026-05-18", "13:00", "17:00", false],
    ["overnight overlap with next-day shift", "2026-05-18", "22:00", "06:00", "2026-05-19", "05:00", "09:00", true],
    ["overnight adjacency", "2026-05-18", "22:00", "06:00", "2026-05-19", "06:00", "10:00", false],
    ["two overlapping overnight shifts", "2026-05-18", "22:00", "06:00", "2026-05-18", "23:00", "07:00", true],
    ["cross-week overlap", "2026-05-24", "22:00", "06:00", "2026-05-25", "05:00", "09:00", true],
    ["cross-month overlap", "2026-05-31", "22:00", "06:00", "2026-06-01", "05:00", "09:00", true],
    ["locked assignment overlap", "2026-05-18", "22:00", "06:00", "2026-05-19", "05:00", "09:00", true]
  ] as const;

  for (const [, firstDate, firstStart, firstEnd, secondDate, secondStart, secondEnd, expected] of cases) {
    assert.equal(
      intervalsOverlap(
        buildShiftInterval({ date: firstDate, startTime: firstStart, endTime: firstEnd }),
        buildShiftInterval({ date: secondDate, startTime: secondStart, endTime: secondEnd })
      ),
      expected
    );
  }

  const fixture = createTwoSlotFixture({
    firstDate: "2026-05-18",
    firstStart: "22:00",
    firstEnd: "06:00",
    secondDate: "2026-05-19",
    secondStart: "05:00",
    secondEnd: "09:00",
    maxShiftsPerWeek: 5,
    maxHoursPerDay: 12
  });
  const validation = validateScheduleHardConstraints({
    runSlots: fixture.slots,
    assignments: fixture.assignments,
    employees: fixture.employees,
    data: buildSchedulerData(fixture)
  });
  assert.equal(validation.valid, false);
  assert.equal(
    validation.violations.some((violation) => violation.code === "SHIFT_OVERLAP"),
    true
  );
}

function testOwningDateAndLimitMatrix(): void {
  assert.deepEqual(
    getOwningDateMinuteContribution({
      date: "2026-05-18",
      startTime: "22:00",
      endTime: "06:00"
    }),
    { date: "2026-05-18", minutes: 480 }
  );
  assert.equal(validateFixture(createTwoSlotFixture({
    firstStart: "08:00",
    firstEnd: "12:00",
    secondStart: "16:00",
    secondEnd: "20:00",
    maxHoursPerDay: 8
  })).valid, true);
  assert.equal(validateFixture(createTwoSlotFixture({
    firstStart: "08:00",
    firstEnd: "12:00",
    secondStart: "16:00",
    secondEnd: "20:01",
    maxHoursPerDay: 8
  })).valid, false);
  assert.equal(validateFixture(createWeeklyShiftCountFixture(5, 5)).valid, true);
  assert.equal(validateFixture(createWeeklyShiftCountFixture(6, 5)).valid, false);
  assert.equal(
    validateFixture(createSingleOvernightFixture("2026-05-23", "22:00", "06:00", 0)).valid,
    false
  );
  assert.equal(
    validateFixture(createSingleOvernightFixture("2026-05-24", "22:00", "06:00", 1)).valid,
    true
  );
  assert.notEqual(
    getWeekKey({ date: "2026-05-24", weekStartsOn: 1 }),
    getWeekKey({ date: "2026-05-24", weekStartsOn: 0 })
  );
}

function testUiPdfFormattingConsistency(): void {
  const role = createRole("role-service", "Service");
  const employee = createEmployee("emp-service", "Demo", "Employee");
  const run = createRun("run-formatting");
  const slots = [
    createSlot({
      id: "slot-day",
      runId: run.id,
      date: "2026-05-18",
      roleId: role.id,
      sourceId: null,
      startTime: "08:00",
      endTime: "16:00",
      status: "filled"
    }),
    createSlot({
      id: "slot-night",
      runId: run.id,
      date: "2026-05-18",
      roleId: role.id,
      sourceId: null,
      startTime: "22:00",
      endTime: "06:00",
      status: "filled"
    })
  ];
  const assignments = [
    createAssignment("as-format-day", run.id, slots[0].id, employee.id),
    createAssignment("as-format-night", run.id, slots[1].id, employee.id)
  ];
  const expectedDay = "08:00–16:00";
  const expectedNight = "22:00–06:00 (+1 ημέρα)";

  assert.equal(formatSlotTime(slots[0], "el"), expectedDay);
  assert.equal(formatSlotTime(slots[1], "el"), expectedNight);
  assert.equal(formatTimeRange({ startTime: "16:00", endTime: "01:00", language: "el" }), "16:00–01:00 (+1 ημέρα)");

  const rows = buildScheduleRows(slots, [], [], "el");
  assert.equal(rows.some((row) => row.label === expectedDay), true);
  assert.equal(rows.some((row) => row.label === expectedNight), true);

  const employeeRows = buildEmployeeScheduleRows({
    employees: [employee],
    runSlots: slots,
    runAssignments: assignments,
    roles: [role],
    shiftTemplates: [],
    staffingRequirements: [],
    warningsBySlotId: new Map(),
    coverageIssues: [],
    language: "el"
  });
  const dates = ["2026-05-18"];
  const teamPdf = buildTeamSchedulePdfHtml({
    businessName: "Demo",
    run,
    dates,
    employeeRows
  });
  const managerPdf = buildManagerReportPdfHtml({
    businessName: "Demo",
    run,
    dates,
    employeeRows,
    runSlots: slots,
    roles: [role],
    shiftTemplates: [],
    staffingRequirements: [],
    warnings: [],
    unfilledSlots: [],
    employeeWorkRules: [],
    coverageIssues: [],
    language: "el"
  });

  assert.equal(teamPdf.includes(expectedNight), true);
  assert.equal(managerPdf.includes(expectedNight), true);
}

function testOpeningHoursDisplayHelper(): void {
  assert.equal(
    formatOpeningHoursSummary({
      isOpen: false,
      is24Hours: false,
      openTime: null,
      closeTime: null,
      language: "el"
    }),
    "Κλειστά"
  );
  assert.equal(
    formatOpeningHoursSummary({
      isOpen: false,
      is24Hours: false,
      openTime: null,
      closeTime: null,
      language: "en"
    }),
    "Closed"
  );
  assert.equal(
    formatOpeningHoursSummary({
      isOpen: true,
      is24Hours: true,
      openTime: null,
      closeTime: null,
      language: "el"
    }),
    "24 Ώρες"
  );
  assert.equal(
    formatOpeningHoursSummary({
      isOpen: true,
      is24Hours: true,
      openTime: null,
      closeTime: null,
      language: "en"
    }),
    "Open 24 hours"
  );
  assert.equal(
    formatOpeningHoursSummary({
      isOpen: true,
      is24Hours: false,
      openTime: "08:00",
      closeTime: "16:00",
      language: "en"
    }),
    "08:00–16:00"
  );
  assert.equal(
    formatOpeningHoursSummary({
      isOpen: true,
      is24Hours: false,
      openTime: "20:00",
      closeTime: "04:00",
      language: "en"
    }),
    "20:00–04:00 (+1 day)"
  );
  assert.equal(
    formatOpeningHoursSummary({
      isOpen: true,
      is24Hours: false,
      openTime: "08:00",
      closeTime: "08:00",
      language: "el"
    }),
    "Μη έγκυρο"
  );
}

function testMalformedTimeValidationMatrix(): void {
  const invalidValues = ["24:00", "25:00", "12:60", "abc", "", "9:00", "09:0", "09:000"];
  for (const value of invalidValues) {
    assert.equal(isValidTimeString(value), false, `${value} should be rejected`);
    assert.throws(() => timeToMinutes(value), `${value} should throw`);
  }

  for (const value of ["00:00", "08:30", "23:59"]) {
    assert.equal(isValidTimeString(value), true, `${value} should be accepted`);
    assert.equal(Number.isInteger(timeToMinutes(value)), true, `${value} should convert to minutes`);
  }

  assert.throws(() =>
    buildShiftInterval({
      date: "2026-05-18",
      startTime: "24:00",
      endTime: "01:00"
    })
  );
  assert.throws(() =>
    buildShiftInterval({
      date: "2026-05-18",
      startTime: "09:00",
      endTime: "09:00"
    })
  );

  const malformedWeekly = buildPlanForSingleRequirement({
    date: "2026-05-18",
    openingHours: openingHoursFromRows({ 1: { mode: "24" } }),
    startTime: "24:00",
    endTime: "01:00"
  });
  assert.equal(malformedWeekly.slots.length, 0, "malformed weekly shift creates no slots");
  assert.equal(
    malformedWeekly.warnings.some((warning) => warning.warningType === "invalid_slot_time_range"),
    true,
    "malformed weekly shift creates controlled invalid slot warning"
  );

  const malformedSpecial = buildPlanForSpecialRequirement({
    date: "2026-05-19",
    openingHours: openingHoursFromRows({ 2: { mode: "24" } }),
    specialDay: createSpecialDay({
      id: "special-malformed-time",
      date: "2026-05-19",
      isClosed: 0
    }),
    startTime: "12:60",
    endTime: "14:00"
  });
  assert.equal(malformedSpecial.slots.length, 0, "malformed special-day shift creates no slots");
  assert.equal(
    malformedSpecial.warnings.some((warning) => warning.warningType === "invalid_slot_time_range"),
    true,
    "malformed special-day shift creates controlled invalid slot warning"
  );

  const malformedOpening = buildPlanForSingleRequirement({
    date: "2026-05-18",
    openingHours: openingHoursFromRows({ 1: { mode: "custom", open: "abc", close: "17:00" } }),
    startTime: "09:00",
    endTime: "12:00"
  });
  assert.equal(malformedOpening.slots.length, 0, "malformed opening hours create no slots");
  assert.equal(
    malformedOpening.warnings.some((warning) => warning.warningType === "invalid_opening_hours"),
    true,
    "malformed opening hours create controlled warning"
  );

  const containment = isShiftContainedWithinOpeningIntervals({
    date: "2026-05-18",
    startTime: "09:00",
    endTime: "25:00",
    openingHours: openingHoursFromRows({ 1: { mode: "24" } })
  });
  assert.equal(containment.allowed, false);
  assert.equal(containment.reasonCode, "INVALID_SLOT_INTERVAL");

  assert.equal(
    formatOpeningHoursSummary({
      isOpen: true,
      is24Hours: false,
      openTime: "24:00",
      closeTime: "08:00",
      language: "en"
    }),
    "Invalid time range"
  );
}

function testDstWallClockPolicy(): void {
  assert.equal(
    getShiftDurationMinutes({
      date: "2026-03-29",
      startTime: "01:00",
      endTime: "05:00",
      timezone: "Europe/Athens"
    }),
    240,
    "spring-forward uses scheduled wall-clock minutes"
  );
  assert.equal(
    getShiftDurationMinutes({
      date: "2026-10-25",
      startTime: "01:00",
      endTime: "05:00",
      timezone: "Europe/Athens"
    }),
    240,
    "autumn fallback uses scheduled wall-clock minutes"
  );
  console.log("DST policy: Scheduler V2 uses scheduled wall-clock minutes, not elapsed UTC minutes.");
}

async function testTwentyFourHourCpSatScenarios(): Promise<void> {
  const python = resolveTestPythonCommand();
  const scenarios = createTwentyFourHourScenarios();

  for (const item of scenarios) {
    const { slots } = buildGeneratedScenarioRun(item.scenario, slug(item.scenario.name));
    assert.equal(slots.length, item.expectedSlots, item.scenario.name);
    for (const slot of slots) {
      assert.equal(
        getOwningDateMinuteContribution({
          date: slot.date,
          startTime: slot.start_time,
          endTime: slot.end_time
        }).date,
        slot.date
      );
      assert.equal(getShiftDurationMinutes({
        date: slot.date,
        startTime: slot.start_time,
        endTime: slot.end_time
      }) > 0, true);
    }

    const cpSat = await solveAndValidateCpSat({
      python,
      scenario: item.scenario,
      slots,
      requestId: `time-model-${slug(item.scenario.name)}`,
      timeoutSeconds: 3
    });

    assert.equal(
      cpSat.result.objectiveValues.totalSlots,
      item.expectedSlots,
      `${item.scenario.name}: total slots`
    );
    assert.equal(
      cpSat.result.objectiveValues.coveredSlots,
      item.expectedCoverage,
      `${item.scenario.name}: covered slots (${cpSat.result.status}; ${cpSat.result.message ?? "no message"})`
    );
    assert.equal(cpSat.hardViolationCount, 0, `${item.scenario.name}: hard violations`);
    if (cpSat.result.status === "OPTIMAL") {
      assert.equal(cpSat.result.coverageProvenOptimal, true);
    }
  }
}

function createTwentyFourHourScenarios(): Array<{
  scenario: ReturnType<typeof createCoverableScenario>;
  expectedSlots: number;
  expectedCoverage: number;
}> {
  return [
    {
      scenario: createCoverableScenario({ name: "isolated 24-hour day", shiftStart: "09:00", shiftEnd: "17:00", requiredCount: 1, employeeCount: 1, openingMode: "24" }),
      expectedSlots: 1,
      expectedCoverage: 1
    },
    {
      scenario: createCoverableScenario({ name: "full 7-day 24-hour business", shiftStart: "09:00", shiftEnd: "17:00", requiredCount: 1, employeeCount: 7, openingMode: "all-24", days: [0, 1, 2, 3, 4, 5, 6] }),
      expectedSlots: 7,
      expectedCoverage: 7
    },
    {
      scenario: createCoverableScenario({ name: "night-only staffing requirement", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 1, employeeCount: 1, openingMode: "all-24" }),
      expectedSlots: 1,
      expectedCoverage: 1
    },
    {
      scenario: createCoverableScenario({ name: "23 to 07 shift", shiftStart: "23:00", shiftEnd: "07:00", requiredCount: 1, employeeCount: 1, openingMode: "all-24" }),
      expectedSlots: 1,
      expectedCoverage: 1
    },
    {
      scenario: createCoverableScenario({ name: "continuous 24-hour day shifts", shifts: [["00:00", "08:00"], ["08:00", "16:00"], ["16:00", "00:00"]], requiredCount: 1, employeeCount: 3, openingMode: "24" }),
      expectedSlots: 3,
      expectedCoverage: 3
    },
    {
      scenario: createCoverableScenario({ name: "24-hour weekend forbidden employee", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 1, employeeCount: 1, openingMode: "all-24", day: 6, canWorkWeekends: false }),
      expectedSlots: 1,
      expectedCoverage: 0
    },
    {
      scenario: createCoverableScenario({ name: "24-hour time off crossing midnight", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 1, employeeCount: 1, openingMode: "all-24", timeOff: true }),
      expectedSlots: 1,
      expectedCoverage: 0
    },
    {
      scenario: createCoverableScenario({ name: "sparse night-role eligibility", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 2, employeeCount: 2, openingMode: "all-24", sparseRoles: true }),
      expectedSlots: 2,
      expectedCoverage: 1
    },
    {
      scenario: createCoverableScenario({ name: "experienced night shift required", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 1, employeeCount: 1, openingMode: "all-24", minimumExperience: "some_experience" }),
      expectedSlots: 1,
      expectedCoverage: 1
    },
    {
      scenario: createCoverableScenario({ name: "locked overnight assignment", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 1, employeeCount: 1, openingMode: "all-24", locked: true }),
      expectedSlots: 1,
      expectedCoverage: 1
    },
    {
      scenario: createCoverableScenario({ name: "understaffed 24-hour business", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 3, employeeCount: 1, openingMode: "all-24" }),
      expectedSlots: 3,
      expectedCoverage: 1
    },
    {
      scenario: createCoverableScenario({ name: "zero-worker 24-hour business", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 1, employeeCount: 0, openingMode: "all-24" }),
      expectedSlots: 1,
      expectedCoverage: 0
    },
    {
      scenario: createCoverableScenario({ name: "fully coverable 24-hour business", shiftStart: "22:00", shiftEnd: "06:00", requiredCount: 2, employeeCount: 2, openingMode: "all-24" }),
      expectedSlots: 2,
      expectedCoverage: 2
    }
  ];
}

function createCoverableScenario({
  name,
  shiftStart = "09:00",
  shiftEnd = "17:00",
  shifts,
  requiredCount,
  employeeCount,
  openingMode,
  day = 1,
  days,
  canWorkWeekends = true,
  timeOff = false,
  sparseRoles = false,
  minimumExperience = "no_experience",
  locked = false
}: {
  name: string;
  shiftStart?: string;
  shiftEnd?: string;
  shifts?: Array<[string, string]>;
  requiredCount: number;
  employeeCount: number;
  openingMode: "24" | "all-24" | "custom";
  day?: DayOfWeek;
  days?: DayOfWeek[];
  canWorkWeekends?: boolean;
  timeOff?: boolean;
  sparseRoles?: boolean;
  minimumExperience?: "no_experience" | "some_experience";
  locked?: boolean;
}) {
  const run = createRun(`run-${slug(name)}`);
  const role = createRole(`role-${slug(name)}`, "Service");
  const otherRole = createRole(`role-other-${slug(name)}`, "Other");
  const shiftPairs = shifts ?? [[shiftStart, shiftEnd] as [string, string]];
  const shiftTemplates = shiftPairs.map(([start, end], index) =>
    createShiftTemplate(`shift-${slug(name)}-${index}`, `Shift ${index + 1}`, start, end)
  );
  const requirementDays = days ?? [day];
  const staffingRequirements = requirementDays.flatMap((dayOfWeek) =>
    shiftTemplates.map((shift, index) =>
      createStaffingRequirement({
        id: `req-${slug(name)}-${dayOfWeek}-${index}`,
        roleId: role.id,
        shiftTemplateId: shift.id,
        startTime: shift.start_time,
        endTime: shift.end_time,
        requiredCount,
        dayOfWeek
      })
    )
  ).map((requirement) => ({
    ...requirement,
    minimum_experience_level: minimumExperience
  }));
  const employees = Array.from({ length: employeeCount }, (_, index) =>
    createEmployee(`emp-${slug(name)}-${index}`, `Emp${index}`, "Demo")
  );
  const employeeRoles = employees.map((employee, index) =>
    createEmployeeRole(
      `er-${employee.id}`,
      employee.id,
      sparseRoles && index > 0 ? otherRole.id : role.id,
      minimumExperience
    )
  );
  const employeeWorkRules = employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 7, 8, 8, canWorkWeekends ? 1 : 0)
  );
  const scenario = createScenarioSkeleton({
    name,
    run,
    openingHours:
      openingMode === "all-24"
        ? createOpeningHours().map((row) => ({
            ...row,
            is_open: 1 as const,
            is_24_hours: 1 as const,
            open_time: null,
            close_time: null,
            is_overnight: 0 as const
          }))
        : openingHoursForScenarioDays(requirementDays, openingMode),
    roles: sparseRoles ? [role, otherRole] : [role],
    shiftTemplates,
    staffingRequirements,
    employees,
    employeeRoles,
    employeeWorkRules
  });

  if (timeOff && employees[0]) {
    scenario.timeOff = [
      createTimeOff(`to-${employees[0].id}`, employees[0].id, "2026-05-18", "2026-05-19")
    ];
  }

  if (locked && employees[0]) {
    const { slots } = buildGeneratedScenarioRun(scenario, slug(name));
    scenario.existingAssignments = [
      createAssignment(`locked-${slug(name)}`, run.id, slots[0].id, employees[0].id)
    ];
  }

  return scenario;
}

function openingHoursForCase(
  mode: string,
  openTime: string | null,
  closeTime: string | null
): OpeningHours[] {
  return createOpeningHours().map((row) => {
    if (mode === "all-24") {
      return { ...row, is_open: 1 as const, is_24_hours: 1 as const, open_time: null, close_time: null, is_overnight: 0 as const };
    }

    if (row.day_of_week === 2 && mode === "24-next-closed") {
      return { ...row, is_open: 0 as const, is_24_hours: 0 as const, open_time: null, close_time: null, is_overnight: 0 as const };
    }

    if (row.day_of_week === 2 && mode === "24-next-custom") {
      return { ...row, is_open: 1 as const, is_24_hours: 0 as const, open_time: "10:00", close_time: "18:00", is_overnight: 0 as const };
    }

    if (row.day_of_week !== 1) {
      return { ...row, is_open: 0 as const, is_24_hours: 0 as const, open_time: null, close_time: null, is_overnight: 0 as const };
    }

    if (mode === "closed") {
      return { ...row, is_open: 0 as const, is_24_hours: 0 as const, open_time: null, close_time: null, is_overnight: 0 as const };
    }

    if (mode === "24" || mode === "24-next-closed" || mode === "24-next-custom") {
      return { ...row, is_open: 1 as const, is_24_hours: 1 as const, open_time: null, close_time: null, is_overnight: 0 as const };
    }

    return {
      ...row,
      is_open: 1 as const,
      is_24_hours: 0 as const,
      open_time: openTime,
      close_time: closeTime,
      is_overnight: openTime && closeTime && closeTime < openTime ? 1 as const : 0 as const
    };
  });
}

function buildPlanForSingleRequirement({
  date,
  openingHours,
  startTime,
  endTime,
  specialDays = []
}: {
  date: string;
  openingHours: OpeningHours[];
  startTime: string;
  endTime: string;
  specialDays?: ReturnType<typeof createSpecialDay>[];
}) {
  const role = createRole(`role-${slug(date)}-${startTime}-${endTime}`, "Service");
  const shift = createShiftTemplate(`shift-${slug(date)}-${startTime}-${endTime}`, "Shift", startTime, endTime);
  const dayOfWeek = getDayOfWeekFromDateForTest(date);
  return buildScheduleGenerationPlan({
    weekStartDate: "2026-05-18",
    openingHours,
    staffingRequirements: [
      createStaffingRequirement({
        id: `req-${slug(date)}-${startTime}-${endTime}`,
        roleId: role.id,
        shiftTemplateId: shift.id,
        startTime,
        endTime,
        dayOfWeek
      })
    ],
    specialDayStaffingRequirements: [],
    shiftTemplates: [shift],
    specialDays
  });
}

function buildPlanForSpecialRequirement({
  date,
  openingHours,
  specialDay,
  startTime,
  endTime
}: {
  date: string;
  openingHours: OpeningHours[];
  specialDay: ReturnType<typeof createSpecialDay>;
  startTime: string;
  endTime: string;
}) {
  const role = createRole(`role-special-${slug(date)}-${startTime}-${endTime}`, "Service");
  return buildScheduleGenerationPlan({
    weekStartDate: "2026-05-18",
    openingHours,
    staffingRequirements: [],
    specialDayStaffingRequirements: [
      createSpecialDayStaffingRequirement({
        id: `special-req-${slug(date)}-${startTime}-${endTime}`,
        specialDayId: specialDay.id,
        roleId: role.id,
        startTime,
        endTime
      })
    ],
    shiftTemplates: [],
    specialDays: [specialDay]
  });
}

type OpeningRowMode =
  | { mode: "closed" }
  | { mode: "24" }
  | { mode: "custom"; open: string; close: string };

function openingHoursFromRows(rows: Partial<Record<DayOfWeek, OpeningRowMode>>): OpeningHours[] {
  return createOpeningHours().map((row) => {
    const next = rows[row.day_of_week] ?? { mode: "closed" as const };

    if (next.mode === "closed") {
      return {
        ...row,
        is_open: 0 as const,
        is_24_hours: 0 as const,
        open_time: null,
        close_time: null,
        is_overnight: 0 as const
      };
    }

    if (next.mode === "24") {
      return {
        ...row,
        is_open: 1 as const,
        is_24_hours: 1 as const,
        open_time: null,
        close_time: null,
        is_overnight: 0 as const
      };
    }

    return {
      ...row,
      is_open: 1 as const,
      is_24_hours: 0 as const,
      open_time: next.open,
      close_time: next.close,
      is_overnight: next.close < next.open ? 1 as const : 0 as const
    };
  });
}

function getDayOfWeekFromDateForTest(date: string): DayOfWeek {
  const parsed = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return parsed as DayOfWeek;
}

function openingHoursForScenarioDays(
  days: DayOfWeek[],
  mode: "24" | "custom"
): OpeningHours[] {
  const daySet = new Set(days);

  return createOpeningHours().map((row) => {
    if (!daySet.has(row.day_of_week)) {
      return {
        ...row,
        is_open: 0 as const,
        is_24_hours: 0 as const,
        open_time: null,
        close_time: null,
        is_overnight: 0 as const
      };
    }

    if (mode === "24") {
      return {
        ...row,
        is_open: 1 as const,
        is_24_hours: 1 as const,
        open_time: null,
        close_time: null,
        is_overnight: 0 as const
      };
    }

    return {
      ...row,
      is_open: 1 as const,
      is_24_hours: 0 as const,
      open_time: "08:00",
      close_time: "20:00",
      is_overnight: 0 as const
    };
  });
}

function createTwoSlotFixture({
  firstDate = "2026-05-18",
  firstStart,
  firstEnd,
  secondDate = "2026-05-18",
  secondStart,
  secondEnd,
  maxShiftsPerWeek = 5,
  maxHoursPerDay = 8
}: {
  firstDate?: string;
  firstStart: string;
  firstEnd: string;
  secondDate?: string;
  secondStart: string;
  secondEnd: string;
  maxShiftsPerWeek?: number;
  maxHoursPerDay?: number;
}) {
  const role = createRole("role-two-slot", "Service");
  const employee = createEmployee("emp-two-slot", "Two", "Slot");
  const run = createRun("run-two-slot");
  const slots = [
    createSlot({ id: "slot-a", runId: run.id, date: firstDate, roleId: role.id, sourceId: null, startTime: firstStart, endTime: firstEnd, status: "filled" }),
    createSlot({ id: "slot-b", runId: run.id, date: secondDate, roleId: role.id, sourceId: null, startTime: secondStart, endTime: secondEnd, status: "filled" })
  ];

  return createFixture({
    run,
    roles: [role],
    shiftTemplates: [],
    staffingRequirements: [],
    slots,
    employees: [employee],
    employeeRoles: [createEmployeeRole("er-two-slot", employee.id, role.id)],
    employeeWorkRules: [createWorkRules("wr-two-slot", employee.id, maxShiftsPerWeek, maxHoursPerDay, maxHoursPerDay, 1)],
    assignments: [
      createAssignment("as-a", run.id, slots[0].id, employee.id),
      createAssignment("as-b", run.id, slots[1].id, employee.id)
    ]
  });
}

function createSingleOvernightFixture(
  date: string,
  startTime: string,
  endTime: string,
  canWorkWeekends: 0 | 1
) {
  const role = createRole("role-single-night", "Service");
  const employee = createEmployee("emp-single-night", "Single", "Night");
  const run = createRun("run-single-night");
  const slot = createSlot({
    id: "slot-single-night",
    runId: run.id,
    date,
    roleId: role.id,
    sourceId: null,
    startTime,
    endTime,
    status: "filled"
  });

  return createFixture({
    run,
    roles: [role],
    shiftTemplates: [],
    staffingRequirements: [],
    slots: [slot],
    employees: [employee],
    employeeRoles: [createEmployeeRole("er-single-night", employee.id, role.id)],
    employeeWorkRules: [createWorkRules("wr-single-night", employee.id, 5, 8, 8, canWorkWeekends)],
    assignments: [createAssignment("as-single-night", run.id, slot.id, employee.id)]
  });
}

function createWeeklyShiftCountFixture(shiftCount: number, maxShiftsPerWeek: number) {
  const role = createRole("role-weekly", "Service");
  const employee = createEmployee("emp-weekly", "Weekly", "Worker");
  const run = createRun("run-weekly");
  const slots = Array.from({ length: shiftCount }, (_, index) =>
    createSlot({
      id: `slot-weekly-${index}`,
      runId: run.id,
      date: `2026-05-${String(18 + index).padStart(2, "0")}`,
      roleId: role.id,
      sourceId: null,
      startTime: "08:00",
      endTime: "10:00",
      status: "filled"
    })
  );

  return createFixture({
    run,
    roles: [role],
    shiftTemplates: [],
    staffingRequirements: [],
    slots,
    employees: [employee],
    employeeRoles: [createEmployeeRole("er-weekly", employee.id, role.id)],
    employeeWorkRules: [createWorkRules("wr-weekly", employee.id, maxShiftsPerWeek, 8, 8, 1)],
    assignments: slots.map((slot, index) =>
      createAssignment(`as-weekly-${index}`, run.id, slot.id, employee.id)
    )
  });
}

function validateFixture(fixture: ReturnType<typeof createFixture>) {
  return validateScheduleHardConstraints({
    runSlots: fixture.slots,
    assignments: fixture.assignments,
    employees: fixture.employees,
    data: buildSchedulerData(fixture)
  });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
