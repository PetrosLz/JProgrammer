import assert from "node:assert/strict";

import {
  buildCoverageCeilingAnalysis,
  buildManagerScheduleDiagnostics,
  buildScheduleGenerationPlan,
  diagnoseCoverageCeiling,
  evaluateSchedule,
  optimizeScheduleInMemory,
  validateScheduleHardConstraints
} from "../src/renderer/services/scheduler";
import {
  buildShiftInterval,
  getShiftDurationMinutes,
  getWeekKey,
  getOwningDateMinuteContribution,
  intervalsOverlap,
} from "../src/renderer/services/scheduler/model/workingTime";
import {
  createAssignment,
  createBenchmarkScenarios,
  createDayConstraint,
  createEmployee,
  createEmployeeRole,
  createFixture,
  createSpecialDay,
  createSpecialDayStaffingRequirement,
  createSlot,
  createTimeConstraint,
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
    employeeTimeConstraints: fixture.employeeTimeConstraints,
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
    specialDayStaffingRequirements: scenario.specialDayStaffingRequirements,
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
    result: optimizeScheduleInMemory({
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
    })
  };
}

function assignmentSignature(assignments: Array<{ schedule_slot_id: string; employee_id: string }>) {
  return assignments
    .map((assignment) => `${assignment.schedule_slot_id}:${assignment.employee_id}`)
    .sort();
}

function createTwoSlotSameEmployeeFixture({
  firstStart,
  firstEnd,
  secondStart,
  secondEnd,
  secondDate = "2026-05-18",
  maxShiftsPerWeek = 5,
  maxHoursPerDay = 8
}: {
  firstStart: string;
  firstEnd: string;
  secondStart: string;
  secondEnd: string;
  secondDate?: string;
  maxShiftsPerWeek?: number;
  maxHoursPerDay?: number;
}) {
  const fixture = createFixture({
    assignments: []
  });
  const firstSlot = createSlot({
    id: "slot-service-first",
    runId: fixture.run.id,
    date: "2026-05-18",
    roleId: fixture.roles[0].id,
    sourceId: fixture.staffingRequirements[0].id,
    startTime: firstStart,
    endTime: firstEnd
  });
  const secondSlot = createSlot({
    id: "slot-service-second",
    runId: fixture.run.id,
    date: secondDate,
    roleId: fixture.roles[0].id,
    sourceId: fixture.staffingRequirements[0].id,
    startTime: secondStart,
    endTime: secondEnd
  });
  fixture.slots = [firstSlot, secondSlot];
  fixture.assignments = [
    createAssignment("as-first", fixture.run.id, firstSlot.id, "emp-alex"),
    createAssignment("as-second", fixture.run.id, secondSlot.id, "emp-alex")
  ];
  fixture.employeeWorkRules = [
    createWorkRules(
      "wr-alex",
      "emp-alex",
      maxShiftsPerWeek,
      maxHoursPerDay,
      Math.min(maxHoursPerDay, 8)
    ),
    createWorkRules("wr-nina", "emp-nina")
  ];

  return fixture;
}

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: "working-time engine handles duration overlap owning-date minutes and week keys",
    run: () => {
      assert.equal(
        getShiftDurationMinutes({
          date: "2026-05-18",
          startTime: "08:00",
          endTime: "12:00"
        }),
        240
      );
      assert.equal(
        getShiftDurationMinutes({
          date: "2026-05-18",
          startTime: "22:00",
          endTime: "02:00"
        }),
        240
      );
      assert.equal(
        intervalsOverlap(
          buildShiftInterval({
            date: "2026-05-18",
            startTime: "08:00",
            endTime: "12:00"
          }),
          buildShiftInterval({
            date: "2026-05-18",
            startTime: "12:00",
            endTime: "16:00"
          })
        ),
        false
      );
      assert.equal(
        intervalsOverlap(
          buildShiftInterval({
            date: "2026-05-18",
            startTime: "08:00",
            endTime: "12:00"
          }),
          buildShiftInterval({
            date: "2026-05-18",
            startTime: "11:00",
            endTime: "15:00"
          })
        ),
        true
      );
      assert.deepEqual(
        getOwningDateMinuteContribution({
          date: "2026-05-18",
          startTime: "22:00",
          endTime: "02:00"
        }),
        { date: "2026-05-18", minutes: 240 }
      );
      assert.equal(
        getWeekKey({ date: "2026-05-24", weekStartsOn: 1 }),
        "2026-05-18"
      );
      assert.equal(
        getWeekKey({ date: "2026-05-24", weekStartsOn: 0 }),
        "2026-05-24"
      );
    }
  },
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
    name: "special-day generation overrides or falls back to weekly requirements",
    run: () => {
      const fixture = createFixture({ assignments: [] });
      const openSpecialDay = createSpecialDay({
        id: "special-open",
        date: "2026-05-18",
        name: "Open event"
      });
      const openFallbackPlan = buildScheduleGenerationPlan({
        weekStartDate: "2026-05-18",
        openingHours: fixture.openingHours,
        staffingRequirements: fixture.staffingRequirements,
        specialDayStaffingRequirements: [],
        shiftTemplates: fixture.shiftTemplates,
        specialDays: [openSpecialDay]
      });

      assert.equal(openFallbackPlan.slots.length, 1);
      assert.equal(openFallbackPlan.slots[0].sourceType, "weekly_requirement");

      const closedPlan = buildScheduleGenerationPlan({
        weekStartDate: "2026-05-18",
        openingHours: fixture.openingHours,
        staffingRequirements: fixture.staffingRequirements,
        specialDayStaffingRequirements: [],
        shiftTemplates: fixture.shiftTemplates,
        specialDays: [
          createSpecialDay({
            id: "special-closed",
            date: "2026-05-18",
            name: "Closed event",
            isClosed: 1
          })
        ]
      });

      assert.equal(closedPlan.slots.length, 0);

      const specialRequirement = createSpecialDayStaffingRequirement({
        id: "special-req-service",
        specialDayId: openSpecialDay.id,
        roleId: fixture.roles[0].id,
        startTime: "10:00",
        endTime: "14:00",
        requiredCount: 2,
        minimumExperienceLevel: "some_experience",
        experiencedRequiredCount: 1
      });
      const specialPlan = buildScheduleGenerationPlan({
        weekStartDate: "2026-05-18",
        openingHours: fixture.openingHours,
        staffingRequirements: fixture.staffingRequirements,
        specialDayStaffingRequirements: [specialRequirement],
        shiftTemplates: fixture.shiftTemplates,
        specialDays: [openSpecialDay]
      });

      assert.equal(specialPlan.slots.length, 2);
      assert.ok(
        specialPlan.slots.every(
          (slot) =>
            slot.sourceType === "special_day_requirement" &&
            slot.sourceId === specialRequirement.id &&
            slot.requirementGroupId ===
              "2026-05-18|special_day_requirement|special-req-service" &&
            slot.minimumExperienceLevel === "some_experience" &&
            slot.experiencedRequiredCount === 1
        )
      );
      assert.deepEqual(
        specialPlan.slots.map((slot) => slot.slotNumber),
        [1, 2]
      );
    }
  },
  {
    name: "requirement group prior-experience count is a hard group rule",
    run: () => {
      const fixture = createFixture({ assignments: [] });
      const groupId = "2026-05-18|weekly_requirement|req-service-experience";
      fixture.slots = [
        createSlot({
          id: "slot-service-exp-1",
          runId: fixture.run.id,
          date: "2026-05-18",
          roleId: fixture.roles[0].id,
          sourceId: fixture.staffingRequirements[0].id,
          startTime: "09:00",
          endTime: "13:00",
          requirementGroupId: groupId,
          experiencedRequiredCount: 1,
          slotNumber: 1
        }),
        createSlot({
          id: "slot-service-exp-2",
          runId: fixture.run.id,
          date: "2026-05-18",
          roleId: fixture.roles[0].id,
          sourceId: fixture.staffingRequirements[0].id,
          startTime: "13:00",
          endTime: "17:00",
          requirementGroupId: groupId,
          experiencedRequiredCount: 1,
          slotNumber: 2
        })
      ];
      fixture.employees = [
        createEmployee("emp-new-a", "New", "A"),
        createEmployee("emp-new-b", "New", "B"),
        createEmployee("emp-prior", "Prior", "Worker")
      ];
      fixture.employeeRoles = [
        createEmployeeRole(
          "er-new-a-service",
          "emp-new-a",
          fixture.roles[0].id,
          "no_experience"
        ),
        createEmployeeRole(
          "er-new-b-service",
          "emp-new-b",
          fixture.roles[0].id,
          "no_experience"
        ),
        createEmployeeRole(
          "er-prior-service",
          "emp-prior",
          fixture.roles[0].id,
          "some_experience"
        )
      ];
      fixture.employeeWorkRules = fixture.employees.map((employee) =>
        createWorkRules(`wr-${employee.id}`, employee.id, 5, 8, 8)
      );

      const invalidAssignments = [
        createAssignment(
          "as-new-a",
          fixture.run.id,
          fixture.slots[0].id,
          "emp-new-a"
        ),
        createAssignment(
          "as-new-b",
          fixture.run.id,
          fixture.slots[1].id,
          "emp-new-b"
        )
      ];
      const invalidEvaluation = evaluateSchedule({
        run: fixture.run,
        slots: fixture.slots,
        assignments: invalidAssignments,
        employees: fixture.employees,
        roles: fixture.roles,
        employeeRoles: fixture.employeeRoles,
        employeeWorkRules: fixture.employeeWorkRules,
        employeeDayConstraints: fixture.employeeDayConstraints,
        employeeShiftAvailability: fixture.employeeShiftAvailability,
        employeeTimeConstraints: fixture.employeeTimeConstraints,
        timeOff: fixture.timeOff,
        staffingRequirements: fixture.staffingRequirements,
        shiftTemplates: fixture.shiftTemplates
      });

      assert.equal(invalidEvaluation.isValid, false);
      assert.ok(
        invalidEvaluation.hardViolations.some(
          (violation) => violation.type === "insufficient_group_experience"
        )
      );

      const validAssignments = [
        createAssignment(
          "as-new-a-valid",
          fixture.run.id,
          fixture.slots[0].id,
          "emp-new-a"
        ),
        createAssignment(
          "as-prior-valid",
          fixture.run.id,
          fixture.slots[1].id,
          "emp-prior"
        )
      ];
      const validValidation = validateScheduleHardConstraints({
        runSlots: fixture.slots,
        assignments: validAssignments,
        employees: fixture.employees,
        data: {
          employeeRoles: fixture.employeeRoles,
          employeeWorkRules: fixture.employeeWorkRules,
          employeeDayConstraints: fixture.employeeDayConstraints,
          employeeShiftAvailability: fixture.employeeShiftAvailability,
          employeeTimeConstraints: fixture.employeeTimeConstraints,
          staffingRequirements: fixture.staffingRequirements,
          timeOff: fixture.timeOff
        }
      });

      assert.equal(validValidation.valid, true);
    }
  },
  {
    name: "optimizer leaves experience-required group empty rather than invalid",
    run: () => {
      const fixture = createFixture({ assignments: [] });
      fixture.slots = [
        createSlot({
          id: "slot-needs-prior-experience",
          runId: fixture.run.id,
          date: "2026-05-18",
          roleId: fixture.roles[0].id,
          sourceId: fixture.staffingRequirements[0].id,
          startTime: "09:00",
          endTime: "13:00",
          status: "unfilled",
          experiencedRequiredCount: 1
        })
      ];
      fixture.employees = [createEmployee("emp-new-only", "New", "Only")];
      fixture.employeeRoles = [
        createEmployeeRole(
          "er-new-only-service",
          "emp-new-only",
          fixture.roles[0].id,
          "no_experience"
        )
      ];
      fixture.employeeWorkRules = [
        createWorkRules("wr-new-only", "emp-new-only", 5, 8, 8)
      ];

      const result = optimizeScheduleInMemory({
        run: fixture.run,
        slots: fixture.slots,
        employees: fixture.employees,
        employeeRoles: fixture.employeeRoles,
        employeeWorkRules: fixture.employeeWorkRules,
        employeeDayConstraints: fixture.employeeDayConstraints,
        employeeShiftAvailability: fixture.employeeShiftAvailability,
        employeeTimeConstraints: fixture.employeeTimeConstraints,
        timeOff: fixture.timeOff,
        assignments: fixture.assignments,
        roles: fixture.roles,
        shiftTemplates: fixture.shiftTemplates,
        staffingRequirements: fixture.staffingRequirements
      });

      assert.equal(result.evaluation.metrics.filledSlots, 0);
      assert.equal(result.evaluation.metrics.hardViolationCount, 0);
      assert.equal(result.evaluation.metrics.unfilledSlots, 1);
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
    name: "overlapping same-day shifts are detected",
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
          (violation) => violation.type === "overlap"
        )
      );
    }
  },
  {
    name: "split same-day shifts are allowed when non-overlapping and within daily hours",
    run: () => {
      const fixture = createTwoSlotSameEmployeeFixture({
        firstStart: "08:00",
        firstEnd: "12:00",
        secondStart: "16:00",
        secondEnd: "20:00",
        maxHoursPerDay: 8
      });

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, true);
      assert.equal(evaluation.metrics.hardViolationCount, 0);
    }
  },
  {
    name: "adjacent same-day shifts are allowed",
    run: () => {
      const fixture = createTwoSlotSameEmployeeFixture({
        firstStart: "08:00",
        firstEnd: "12:00",
        secondStart: "12:00",
        secondEnd: "16:00",
        maxHoursPerDay: 8
      });

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, true);
    }
  },
  {
    name: "daily-hour excess is detected across split shifts",
    run: () => {
      const fixture = createTwoSlotSameEmployeeFixture({
        firstStart: "08:00",
        firstEnd: "14:00",
        secondStart: "16:00",
        secondEnd: "20:00",
        maxHoursPerDay: 8
      });

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some(
          (violation) => violation.type === "max_daily_hours"
        )
      );
    }
  },
  {
    name: "weekly shift-block excess is detected",
    run: () => {
      const fixture = createFixture({ assignments: [] });
      fixture.slots = Array.from({ length: 6 }, (_, index) =>
        createSlot({
          id: `slot-weekly-${index}`,
          runId: fixture.run.id,
          date: `2026-05-${18 + index}`,
          roleId: fixture.roles[0].id,
          sourceId: fixture.staffingRequirements[0].id,
          startTime: "08:00",
          endTime: "10:00"
        })
      );
      fixture.assignments = fixture.slots.map((slot, index) =>
        createAssignment(`as-weekly-${index}`, fixture.run.id, slot.id, "emp-alex")
      );
      fixture.employeeWorkRules = [
        createWorkRules("wr-alex", "emp-alex", 5, 8, 8),
        createWorkRules("wr-nina", "emp-nina")
      ];

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some(
          (violation) => violation.type === "max_shifts"
        )
      );
    }
  },
  {
    name: "overnight shifts overlap next-day shifts by absolute interval",
    run: () => {
      const fixture = createTwoSlotSameEmployeeFixture({
        firstStart: "22:00",
        firstEnd: "02:00",
        secondDate: "2026-05-19",
        secondStart: "01:00",
        secondEnd: "03:00",
        maxHoursPerDay: 8
      });

      const evaluation = evaluateFixture(fixture);
      assert.equal(evaluation.isValid, false);
      assert.ok(
        evaluation.hardViolations.some(
          (violation) => violation.type === "overlap"
        )
      );
    }
  },
  {
    name: "overnight whole-day availability belongs to the owning date",
    run: () => {
      const nextDayBlocked = createFixture({ assignments: [] });
      nextDayBlocked.slots = [
        createSlot({
          id: "slot-monday-overnight",
          runId: nextDayBlocked.run.id,
          date: "2026-05-18",
          roleId: nextDayBlocked.roles[0].id,
          sourceId: nextDayBlocked.staffingRequirements[0].id,
          startTime: "22:00",
          endTime: "02:00"
        })
      ];
      nextDayBlocked.assignments = [
        createAssignment(
          "as-monday-overnight",
          nextDayBlocked.run.id,
          nextDayBlocked.slots[0].id,
          "emp-alex"
        )
      ];
      nextDayBlocked.employeeDayConstraints = [
        createDayConstraint("dc-alex-tuesday", "emp-alex", 2, "cannot_work")
      ];

      assert.equal(evaluateFixture(nextDayBlocked).isValid, true);

      const owningDayBlocked = createFixture({ assignments: [] });
      owningDayBlocked.slots = nextDayBlocked.slots;
      owningDayBlocked.assignments = nextDayBlocked.assignments;
      owningDayBlocked.employeeDayConstraints = [
        createDayConstraint("dc-alex-monday", "emp-alex", 1, "cannot_work")
      ];

      const owningEvaluation = evaluateFixture(owningDayBlocked);
      assert.equal(owningEvaluation.isValid, false);
      assert.ok(
        owningEvaluation.hardViolations.some(
          (violation) => violation.type === "cannot_work"
        )
      );
    }
  },
  {
    name: "overnight weekend rule uses the owning date",
    run: () => {
      const fridayOvernight = createFixture({ assignments: [] });
      fridayOvernight.slots = [
        createSlot({
          id: "slot-friday-overnight",
          runId: fridayOvernight.run.id,
          date: "2026-05-22",
          roleId: fridayOvernight.roles[0].id,
          sourceId: fridayOvernight.staffingRequirements[0].id,
          startTime: "22:00",
          endTime: "02:00"
        })
      ];
      fridayOvernight.assignments = [
        createAssignment(
          "as-friday-overnight",
          fridayOvernight.run.id,
          fridayOvernight.slots[0].id,
          "emp-alex"
        )
      ];
      fridayOvernight.employeeWorkRules = [
        createWorkRules("wr-alex", "emp-alex", 5, 8, 8, 0),
        createWorkRules("wr-nina", "emp-nina", 5, 8, 8, 0)
      ];

      assert.equal(evaluateFixture(fridayOvernight).isValid, true);

      const saturdayOvernight = createFixture({ assignments: [] });
      saturdayOvernight.slots = [
        {
          ...fridayOvernight.slots[0],
          id: "slot-saturday-overnight",
          schedule_run_id: saturdayOvernight.run.id,
          date: "2026-05-23"
        }
      ];
      saturdayOvernight.assignments = [
        createAssignment(
          "as-saturday-overnight",
          saturdayOvernight.run.id,
          saturdayOvernight.slots[0].id,
          "emp-alex"
        )
      ];
      saturdayOvernight.employeeWorkRules = fridayOvernight.employeeWorkRules;

      const saturdayEvaluation = evaluateFixture(saturdayOvernight);
      assert.equal(saturdayEvaluation.isValid, false);
      assert.ok(
        saturdayEvaluation.hardViolations.some(
          (violation) => violation.type === "weekend_not_allowed"
        )
      );
    }
  },
  {
    name: "time-window cannot_work blocks only overlapping intervals",
    run: () => {
      const blocked = createFixture({ assignments: [] });
      blocked.slots = [
        createSlot({
          id: "slot-time-window",
          runId: blocked.run.id,
          date: "2026-05-18",
          roleId: blocked.roles[0].id,
          sourceId: blocked.staffingRequirements[0].id,
          startTime: "11:00",
          endTime: "13:00"
        })
      ];
      blocked.assignments = [
        createAssignment("as-time-window", blocked.run.id, blocked.slots[0].id, "emp-alex")
      ];
      blocked.employeeTimeConstraints = [
        createTimeConstraint({
          id: "tc-alex-midday",
          employeeId: "emp-alex",
          dayOfWeek: 1,
          startTime: "12:00",
          endTime: "16:00"
        })
      ];

      const blockedEvaluation = evaluateFixture(blocked);
      assert.equal(blockedEvaluation.isValid, false);
      assert.ok(
        blockedEvaluation.hardViolations.some(
          (violation) => violation.type === "time_window_unavailable"
        )
      );

      const adjacent = createFixture({ assignments: [] });
      adjacent.slots = [
        createSlot({
          id: "slot-time-window-adjacent",
          runId: adjacent.run.id,
          date: "2026-05-18",
          roleId: adjacent.roles[0].id,
          sourceId: adjacent.staffingRequirements[0].id,
          startTime: "08:00",
          endTime: "12:00"
        })
      ];
      adjacent.assignments = [
        createAssignment("as-time-window-adjacent", adjacent.run.id, adjacent.slots[0].id, "emp-alex")
      ];
      adjacent.employeeTimeConstraints = blocked.employeeTimeConstraints;

      const adjacentEvaluation = evaluateFixture(adjacent);
      assert.equal(adjacentEvaluation.isValid, true);
    }
  },
  {
    name: "max weekly shifts are detected unless manual override exists",
    run: () => {
      const fixture = createFixture({
        employeeWorkRules: [createWorkRules("wr-alex", "emp-alex", 2, 8, 8)]
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
        evaluation.hardViolations.some((violation) => violation.type === "max_shifts")
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
          (violation) => violation.type === "max_shifts"
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
            warning.type === "partial_coverage"
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
        employeeTimeConstraints: easy.scenario.employeeTimeConstraints,
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
        employeeTimeConstraints: impossible.scenario.employeeTimeConstraints,
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
        employeeTimeConstraints: scarce.scenario.employeeTimeConstraints,
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
