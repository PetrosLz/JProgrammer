import assert from "node:assert/strict";

import { databaseApi } from "../src/renderer/services/databaseApi";
import { loadDemoData } from "../src/renderer/services/demoData";
import {
  buildAutomaticScheduleCandidate,
  buildCanonicalScheduleSnapshot,
  buildCoverageCeilingAnalysis,
  buildScheduleGenerationPlan,
  diagnoseCoverageCeiling
} from "../src/renderer/services/scheduler";
import type {
  CrudTableName,
  DatabaseEntityMap,
  DatabaseRecordInput,
  DatabaseRecordUpdate,
  DayOfWeek,
  ScheduleRun,
  ScheduleWarning
} from "../src/renderer/types";
import { createRun, createSlot } from "./scheduler-fixtures";

const weekStartDate = "2026-05-18";
const timestamp = "2026-05-01T00:00:00.000Z";
const tableNames: CrudTableName[] = [
  "business_settings",
  "opening_hours",
  "roles",
  "shift_templates",
  "staffing_requirements",
  "special_days",
  "special_day_staffing_requirements",
  "employees",
  "employee_roles",
  "employee_work_rules",
  "employee_day_constraints",
  "employee_shift_availability",
  "employee_time_constraints",
  "time_off",
  "schedule_runs",
  "schedule_slots",
  "schedule_assignments",
  "schedule_warnings"
];

type StoredRecord = { id: string; [key: string]: unknown };

type DemoCafeMetrics = {
  totalRequestedSlots: number;
  assignedUniqueSlots: number;
  unfilledSlots: number;
  hardViolations: number;
  managerStatus: string;
  optimizerEngine: string;
  solverStatus: string;
  coverageProvenOptimal: boolean | null;
  coverageCeiling: number;
  coverageDiagnosis: string;
  saturdayUnfilledSlots: number;
  lockedAssignments: number;
};

const expectedMetrics: DemoCafeMetrics = {
  totalRequestedSlots: 40,
  assignedUniqueSlots: 28,
  unfilledSlots: 12,
  hardViolations: 0,
  managerStatus: "Understaffed",
  optimizerEngine: "heuristic_fallback",
  solverStatus: "HEURISTIC_FALLBACK",
  coverageProvenOptimal: false,
  coverageCeiling: 28,
  coverageDiagnosis: "understaffed",
  saturdayUnfilledSlots: 12,
  lockedAssignments: 0
};

let activeTables: Map<CrudTableName, StoredRecord[]> | null = null;

async function main() {
  const restoreDatabaseApi = installInMemoryDatabaseApi();

  try {
    await loadDemoData();
    const fixture = readDemoCafeFixture();
    const plan = buildScheduleGenerationPlan({
      weekStartDate,
      openingHours: fixture.openingHours,
      staffingRequirements: fixture.staffingRequirements,
      specialDayStaffingRequirements: fixture.specialDayStaffingRequirements,
      shiftTemplates: fixture.shiftTemplates,
      specialDays: fixture.specialDays
    });
    const run = {
      ...createRun("demo-cafe-acceptance-run"),
      start_date: weekStartDate,
      end_date: "2026-05-24"
    };
    const slots = plan.slots.map((slot, index) =>
      createSlot({
        id: `demo-cafe-slot-${String(index + 1).padStart(3, "0")}`,
        runId: run.id,
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
    const candidate = await buildAutomaticScheduleCandidate({
      run,
      slots,
      employees: fixture.employees,
      employeeRoles: fixture.employeeRoles,
      employeeWorkRules: fixture.employeeWorkRules,
      employeeDayConstraints: fixture.employeeDayConstraints,
      employeeShiftAvailability: fixture.employeeShiftAvailability,
      employeeTimeConstraints: fixture.employeeTimeConstraints,
      timeOff: fixture.timeOff,
      assignments: [],
      roles: fixture.roles,
      shiftTemplates: fixture.shiftTemplates,
      staffingRequirements: fixture.staffingRequirements
    });
    const completedRun: ScheduleRun = {
      ...run,
      status: candidate.runUpdate.status,
      parameters_json: candidate.runUpdate.parametersJson,
      completed_at: candidate.runUpdate.completedAt,
      updated_at: candidate.runUpdate.completedAt
    };
    const warnings = candidate.warnings.map<ScheduleWarning>((warning, index) => ({
      id: `demo-cafe-warning-${index + 1}`,
      schedule_run_id: warning.scheduleRunId,
      schedule_slot_id: warning.scheduleSlotId,
      schedule_assignment_id: warning.scheduleAssignmentId,
      severity: warning.severity,
      warning_type: warning.warningType,
      message: warning.message,
      created_at: timestamp,
      updated_at: timestamp
    }));
    const snapshot = buildCanonicalScheduleSnapshot({
      run: completedRun,
      scheduleSlots: slots,
      scheduleAssignments: candidate.finalAssignments,
      scheduleWarnings: warnings,
      employees: fixture.employees,
      roles: fixture.roles,
      employeeRoles: fixture.employeeRoles,
      employeeWorkRules: fixture.employeeWorkRules,
      employeeDayConstraints: fixture.employeeDayConstraints,
      employeeShiftAvailability: fixture.employeeShiftAvailability,
      employeeTimeConstraints: fixture.employeeTimeConstraints,
      timeOff: fixture.timeOff,
      shiftTemplates: fixture.shiftTemplates,
      staffingRequirements: fixture.staffingRequirements,
      weekStartsOn: 1
    });
    const coverageCeiling = buildCoverageCeilingAnalysis({
      slots,
      employees: fixture.employees,
      employeeRoles: fixture.employeeRoles,
      employeeWorkRules: fixture.employeeWorkRules,
      employeeDayConstraints: fixture.employeeDayConstraints,
      employeeShiftAvailability: fixture.employeeShiftAvailability,
      employeeTimeConstraints: fixture.employeeTimeConstraints,
      timeOff: fixture.timeOff,
      staffingRequirements: fixture.staffingRequirements,
      shiftTemplates: fixture.shiftTemplates,
      roles: fixture.roles,
      existingAssignments: []
    });
    const diagnosis = diagnoseCoverageCeiling({
      analysis: coverageCeiling,
      assignedSlots: snapshot.uniqueAssignedSlotCount,
      hardViolationCount: snapshot.hardIssueCount
    });
    const metrics: DemoCafeMetrics = {
      totalRequestedSlots: snapshot.totalSlots,
      assignedUniqueSlots: snapshot.uniqueAssignedSlotCount,
      unfilledSlots: snapshot.unfilledSlotCount,
      hardViolations: snapshot.hardIssueCount,
      managerStatus: snapshot.managerStatus,
      optimizerEngine: snapshot.solver.engine,
      solverStatus: snapshot.solver.solverStatus,
      coverageProvenOptimal: snapshot.solver.coverageProvenOptimal,
      coverageCeiling: coverageCeiling.feasibleMaxAssignedSlots,
      coverageDiagnosis: diagnosis.diagnosis,
      saturdayUnfilledSlots: snapshot.unfilledSlots.filter(
        (slot) => slot.date === "2026-05-23"
      ).length,
      lockedAssignments: snapshot.lockedAssignmentCount
    };

    assert.deepEqual(metrics, expectedMetrics);
    assert.equal(snapshot.validationStatus, "passed");
    assert.equal(snapshot.duplicateActiveAssignments.length, 0);
    assert.equal(snapshot.malformedTimeIssues.length, 0);
    assert.equal(candidate.validation.valid, true);
    assert.equal(
      candidate.finalAssignmentInputs.length,
      snapshot.uniqueAssignedSlotCount
    );
    assertWeekendRestrictions(snapshot, fixture.employeeWorkRules);
    assertDailyHours(snapshot, fixture.employeeWorkRules);
    assertWeeklyShifts(snapshot, fixture.employeeWorkRules);
    assertExperienceRulesAreClean(snapshot);

    console.log("Demo Cafe acceptance metrics:");
    console.table([metrics]);
  } finally {
    restoreDatabaseApi();
  }
}

function installInMemoryDatabaseApi(): () => void {
  const tables = new Map<CrudTableName, StoredRecord[]>(
    tableNames.map((tableName) => [tableName, []])
  );
  const counters = new Map<CrudTableName, number>();
  const settings = new Map<string, string>();
  const original = {
    listRecords: databaseApi.listRecords,
    createRecord: databaseApi.createRecord,
    updateRecord: databaseApi.updateRecord,
    deleteRecord: databaseApi.deleteRecord,
    getSetting: databaseApi.getSetting,
    setSetting: databaseApi.setSetting
  };

  activeTables = tables;
  databaseApi.listRecords = (async (tableName, options) => {
    const rows = tables.get(tableName) ?? [];
    const limit = options?.limit ?? rows.length;
    return rows.slice(0, limit) as unknown as DatabaseEntityMap[typeof tableName][];
  }) as typeof databaseApi.listRecords;
  databaseApi.createRecord = (async (tableName, data) => {
    const rows = tables.get(tableName);
    if (!rows) {
      throw new Error(`Unsupported in-memory table: ${tableName}`);
    }

    const next = (counters.get(tableName) ?? 0) + 1;
    counters.set(tableName, next);
    const record: StoredRecord = {
      id: `${tableName}-${next}`,
      ...normalizeInput(data),
      created_at: timestamp,
      updated_at: timestamp
    };
    rows.push(record);
    return record as unknown as DatabaseEntityMap[typeof tableName];
  }) as typeof databaseApi.createRecord;
  databaseApi.updateRecord = (async (tableName, id, data) => {
    const rows = tables.get(tableName) ?? [];
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) {
      return null;
    }

    const updated = {
      ...rows[index],
      ...normalizeInput(data),
      updated_at: timestamp
    };
    rows[index] = updated;
    return updated as DatabaseEntityMap[typeof tableName];
  }) as typeof databaseApi.updateRecord;
  databaseApi.deleteRecord = (async (tableName, id) => {
    const rows = tables.get(tableName) ?? [];
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0) {
      return false;
    }

    rows.splice(index, 1);
    return true;
  }) as typeof databaseApi.deleteRecord;
  databaseApi.getSetting = (async (key) => {
    const value = settings.get(key);
    return value === undefined
      ? null
      : {
          key,
          value,
          created_at: timestamp,
          updated_at: timestamp
        };
  }) as typeof databaseApi.getSetting;
  databaseApi.setSetting = (async (key, value) => {
    settings.set(key, value);
    return {
      key,
      value,
      created_at: timestamp,
      updated_at: timestamp
    };
  }) as typeof databaseApi.setSetting;

  return () => {
    activeTables = null;
    databaseApi.listRecords = original.listRecords;
    databaseApi.createRecord = original.createRecord;
    databaseApi.updateRecord = original.updateRecord;
    databaseApi.deleteRecord = original.deleteRecord;
    databaseApi.getSetting = original.getSetting;
    databaseApi.setSetting = original.setSetting;
  };
}

function readDemoCafeFixture() {
  return {
    openingHours: readTable("opening_hours"),
    roles: readTable("roles"),
    shiftTemplates: readTable("shift_templates"),
    staffingRequirements: readTable("staffing_requirements"),
    specialDays: readTable("special_days"),
    specialDayStaffingRequirements: readTable("special_day_staffing_requirements"),
    employees: readTable("employees"),
    employeeRoles: readTable("employee_roles"),
    employeeWorkRules: readTable("employee_work_rules"),
    employeeDayConstraints: readTable("employee_day_constraints"),
    employeeShiftAvailability: readTable("employee_shift_availability"),
    employeeTimeConstraints: readTable("employee_time_constraints"),
    timeOff: readTable("time_off")
  };
}

function readTable<T extends CrudTableName>(
  tableName: T
): DatabaseEntityMap[T][] {
  const rows = activeTables?.get(tableName);
  if (!rows) {
    throw new Error(`readTable(${tableName}) called before database mock installed.`);
  }

  return rows as unknown as DatabaseEntityMap[T][];
}

function normalizeInput(
  input: DatabaseRecordInput | DatabaseRecordUpdate
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }

    normalized[key] = typeof value === "boolean" ? (value ? 1 : 0) : value;
  }

  return normalized;
}

function assertWeekendRestrictions(
  snapshot: ReturnType<typeof buildCanonicalScheduleSnapshot>,
  workRules: DatabaseEntityMap["employee_work_rules"][]
) {
  const rulesByEmployee = new Map(workRules.map((rule) => [rule.employee_id, rule]));

  for (const assignment of snapshot.uniqueActiveAssignments) {
    const slot = snapshot.runSlots.find(
      (item) => item.id === assignment.schedule_slot_id
    );
    const rule = rulesByEmployee.get(assignment.employee_id);
    const day = slot ? new Date(`${slot.date}T00:00:00.000Z`).getUTCDay() : null;
    assert.notEqual(
      day !== null &&
        (day === 0 || day === 6) &&
        rule?.can_work_weekends === 0,
      true,
      `weekend restriction violated for ${assignment.employee_id}`
    );
  }
}

function assertDailyHours(
  snapshot: ReturnType<typeof buildCanonicalScheduleSnapshot>,
  workRules: DatabaseEntityMap["employee_work_rules"][]
) {
  const rulesByEmployee = new Map(workRules.map((rule) => [rule.employee_id, rule]));
  const hoursByEmployeeDate = new Map<string, number>();

  for (const assignment of snapshot.uniqueActiveAssignments) {
    const slot = snapshot.runSlots.find(
      (item) => item.id === assignment.schedule_slot_id
    );
    if (!slot) {
      continue;
    }

    const slotTime = snapshot.slotTimeById.get(slot.id);
    const key = `${assignment.employee_id}|${slot.date}`;
    hoursByEmployeeDate.set(
      key,
      (hoursByEmployeeDate.get(key) ?? 0) +
        ((slotTime?.durationMinutes ?? 0) / 60)
    );
  }

  for (const [key, hours] of hoursByEmployeeDate.entries()) {
    const [employeeId = ""] = key.split("|");
    const rule = rulesByEmployee.get(employeeId);
    if (rule?.max_hours_per_day !== null && rule?.max_hours_per_day !== undefined) {
      assert.ok(
        hours <= rule.max_hours_per_day,
        `${employeeId} exceeded daily hours: ${hours}/${rule.max_hours_per_day}`
      );
    }
  }
}

function assertWeeklyShifts(
  snapshot: ReturnType<typeof buildCanonicalScheduleSnapshot>,
  workRules: DatabaseEntityMap["employee_work_rules"][]
) {
  const rulesByEmployee = new Map(workRules.map((rule) => [rule.employee_id, rule]));

  for (const [employeeId, shiftCount] of snapshot.employeeShiftCount.entries()) {
    const rule = rulesByEmployee.get(employeeId);
    if (rule?.max_shifts_per_week !== null && rule?.max_shifts_per_week !== undefined) {
      assert.ok(
        shiftCount <= rule.max_shifts_per_week,
        `${employeeId} exceeded weekly shifts: ${shiftCount}/${rule.max_shifts_per_week}`
      );
    }
  }
}

function assertExperienceRulesAreClean(
  snapshot: ReturnType<typeof buildCanonicalScheduleSnapshot>
) {
  assert.equal(
    snapshot.validation.violations.some(
      (violation) =>
        violation.code === "INSUFFICIENT_EXPERIENCE" ||
        violation.code === "INSUFFICIENT_GROUP_EXPERIENCE"
    ),
    false
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
