import type {
  CpSatSolveRequest,
  CpSatSolveResult
} from "../../../shared/solverTypes";
import type {
  Employee,
  EmployeeRole,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot
} from "../../types";
import {
  type ManualOverrideMap,
  type SchedulerData,
  buildExistingAssignedShifts,
  checkHardConstraints,
  getEffectiveMaxShiftsPerWeek,
  getEmployeeWorkRules,
  getSlotExperiencedRequiredCount,
  getSlotMinimumExperienceLevel
} from "./constraints";
import {
  buildShiftInterval,
  getShiftDurationMinutes
} from "./model/workingTime";

const millisecondsPerMinute = 60 * 1000;

export type BuildCpSatSolveRequestInput = {
  requestId: string;
  run: ScheduleRun;
  runSlots: ScheduleSlot[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  data: SchedulerData;
  activeRunAssignments: ScheduleAssignment[];
  timeoutSeconds: number;
  manualOverrides?: ManualOverrideMap;
};

export function buildCpSatSolveRequest({
  requestId,
  run,
  runSlots,
  employees,
  employeeRoles,
  data,
  activeRunAssignments,
  timeoutSeconds,
  manualOverrides = {}
}: BuildCpSatSolveRequestInput): CpSatSolveRequest {
  const activeAssignments = activeRunAssignments.filter(
    (assignment) =>
      assignment.status !== "cancelled" && assignment.status !== "removed"
  );
  const assignedSlotIds = new Set(
    activeAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const initialAssignedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: activeAssignments,
    data
  });

  return {
    requestId,
    schedule: {
      runId: run.id,
      weekStartsOn: data.weekStartsOn ?? 1
    },
    employees: [...employees]
      .sort(compareEmployees)
      .map((employee) => {
        const workRules = getEmployeeWorkRules(employee.id, data.employeeWorkRules);
        const maxShiftsPerWeek =
          getEffectiveMaxShiftsPerWeek(workRules) ?? runSlots.length;
        const maxHoursPerDayMinutes =
          workRules?.max_hours_per_day !== null && workRules?.max_hours_per_day !== undefined
            ? Math.round(workRules.max_hours_per_day * 60)
            : 24 * 60;

        return {
          id: employee.id,
          isActive: employee.is_active === 1,
          maxShiftsPerWeek,
          maxHoursPerDayMinutes,
          canWorkWeekends: workRules?.can_work_weekends !== 0
        };
      }),
    employeeRoles: [...employeeRoles]
      .sort(
        (left, right) =>
          left.employee_id.localeCompare(right.employee_id) ||
          left.role_id.localeCompare(right.role_id)
      )
      .map((employeeRole) => ({
        employeeId: employeeRole.employee_id,
        roleId: employeeRole.role_id,
        experienceLevel: employeeRole.experience_level
      })),
    slots: [...runSlots].sort(compareSlots).map((slot) => {
      const interval = buildShiftInterval({
        date: slot.date,
        startTime: slot.start_time,
        endTime: slot.end_time
      });
      return {
        id: slot.id,
        requirementGroupId: slot.requirement_group_id ?? slot.id,
        date: slot.date,
        roleId: slot.role_id,
        startTime: slot.start_time,
        endTime: slot.end_time,
        durationMinutes: getShiftDurationMinutes({
          date: slot.date,
          startTime: slot.start_time,
          endTime: slot.end_time
        }),
        absoluteStartMinute: Math.round(interval.startMs / millisecondsPerMinute),
        absoluteEndMinute: Math.round(interval.endMs / millisecondsPerMinute),
        minimumExperienceLevel: getSlotMinimumExperienceLevel(
          slot,
          data.staffingRequirements ?? []
        ),
        experiencedRequiredCount: getSlotExperiencedRequiredCount(
          slot,
          data.staffingRequirements ?? []
        )
      };
    }),
    eligibility: buildEligibilityPairs({
      runSlots,
      employees,
      data,
      assignedSlotIds,
      activeAssignments,
      initialAssignedShifts,
      manualOverrides
    }),
    existingAssignments: activeAssignments
      .map((assignment) => ({
        employeeId: assignment.employee_id,
        slotId: assignment.schedule_slot_id,
        locked: true
      }))
      .sort(
        (left, right) =>
          left.slotId.localeCompare(right.slotId) ||
          left.employeeId.localeCompare(right.employeeId)
      ),
    timeoutSeconds
  };
}

export function getCpSatGeneratedAssignments({
  result,
  activeRunAssignments
}: {
  result: CpSatSolveResult;
  activeRunAssignments: ScheduleAssignment[];
}): Array<{ scheduleSlotId: string; employeeId: string }> {
  const fixedSlotIds = new Set(
    activeRunAssignments
      .filter(
        (assignment) =>
          assignment.status !== "cancelled" && assignment.status !== "removed"
      )
      .map((assignment) => assignment.schedule_slot_id)
  );

  return result.assignments
    .filter((assignment) => !fixedSlotIds.has(assignment.scheduleSlotId))
    .sort(
      (left, right) =>
        left.scheduleSlotId.localeCompare(right.scheduleSlotId) ||
        left.employeeId.localeCompare(right.employeeId)
    );
}

function buildEligibilityPairs({
  runSlots,
  employees,
  data,
  assignedSlotIds,
  activeAssignments,
  initialAssignedShifts,
  manualOverrides
}: {
  runSlots: ScheduleSlot[];
  employees: Employee[];
  data: SchedulerData;
  assignedSlotIds: Set<string>;
  activeAssignments: ScheduleAssignment[];
  initialAssignedShifts: ReturnType<typeof buildExistingAssignedShifts>;
  manualOverrides: ManualOverrideMap;
}) {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const lockedPairs = new Set(
    activeAssignments.map(
      (assignment) => `${assignment.employee_id}|${assignment.schedule_slot_id}`
    )
  );
  const pairs: Array<{ employeeId: string; slotId: string }> = [];

  for (const slot of [...runSlots].sort(compareSlots)) {
    for (const employee of [...employees].sort(compareEmployees)) {
      const pairKey = `${employee.id}|${slot.id}`;
      const isLockedPair = lockedPairs.has(pairKey);

      if (assignedSlotIds.has(slot.id) && !isLockedPair) {
        continue;
      }

      const assignedShifts = isLockedPair
        ? buildExistingAssignedShifts({
            slots: runSlots,
            assignments: activeAssignments.filter(
              (assignment) =>
                !(
                  assignment.employee_id === employee.id &&
                  assignment.schedule_slot_id === slot.id
                )
            ),
            data
          })
        : initialAssignedShifts;

      const hardConstraintResult = checkHardConstraints({
        employee,
        slot: slotById.get(slot.id) ?? slot,
        data,
        assignedShifts,
        manualOverrides
      });

      if (hardConstraintResult.allowed) {
        pairs.push({
          employeeId: employee.id,
          slotId: slot.id
        });
      }
    }
  }

  return pairs.sort(
    (left, right) =>
      left.employeeId.localeCompare(right.employeeId) ||
      left.slotId.localeCompare(right.slotId)
  );
}

function compareEmployees(left: Employee, right: Employee): number {
  return (
    left.last_name.localeCompare(right.last_name) ||
    left.first_name.localeCompare(right.first_name) ||
    left.id.localeCompare(right.id)
  );
}

function compareSlots(left: ScheduleSlot, right: ScheduleSlot): number {
  return (
    left.date.localeCompare(right.date) ||
    left.start_time.localeCompare(right.start_time) ||
    left.end_time.localeCompare(right.end_time) ||
    left.role_id.localeCompare(right.role_id) ||
    left.id.localeCompare(right.id)
  );
}
