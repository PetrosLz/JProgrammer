import type {
  CpSatHint,
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
  getDayConstraint,
  getDayOfWeek,
  getEmployeeWorkRules,
  getEmployeeShiftAvailability,
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
  hints?: Array<{ employeeId: string; slotId: string }>;
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
  hints = [],
  manualOverrides = {}
}: BuildCpSatSolveRequestInput): CpSatSolveRequest {
  const activeAssignments = activeRunAssignments.filter(
    (assignment) =>
      assignment.status !== "cancelled" && assignment.status !== "removed"
  );
  const lockedAssignments = activeAssignments.filter(isLockedAssignment);
  const assignedSlotIds = new Set(
    lockedAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const initialAssignedShifts = buildExistingAssignedShifts({
    slots: runSlots,
    assignments: lockedAssignments,
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
        const targetHoursPerDayMinutes =
          workRules?.target_hours_per_day !== null &&
          workRules?.target_hours_per_day !== undefined
            ? Math.round(workRules.target_hours_per_day * 60)
            : null;

        return {
          id: employee.id,
          isActive: employee.is_active === 1,
          maxShiftsPerWeek,
          maxHoursPerDayMinutes,
          targetHoursPerDayMinutes,
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
        experienceLevel: employeeRole.experience_level,
        isPreferredRole: employeeRole.is_preferred_role === 1
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
        locked: isLockedAssignment(assignment)
      }))
      .sort(
        (left, right) =>
          left.slotId.localeCompare(right.slotId) ||
          left.employeeId.localeCompare(right.employeeId)
      ),
    hints: sanitizeHints(hints),
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
          assignment.status !== "cancelled" &&
          assignment.status !== "removed" &&
          isLockedAssignment(assignment)
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

export function buildCpSatWarmStartHints({
  request,
  timeBudgetMs = 200
}: {
  request: CpSatSolveRequest;
  timeBudgetMs?: number;
}): CpSatHint[] {
  const deadline = Date.now() + Math.max(0, timeBudgetMs);
  const slotById = new Map(request.slots.map((slot) => [slot.id, slot]));
  const employeeById = new Map(
    request.employees.map((employee) => [employee.id, employee])
  );
  const lockedSlotIds = new Set<string>();
  const assignedSlotIds = new Set<string>();
  const weeklyShiftCountByEmployee = new Map<string, number>();
  const dailyMinutesByEmployeeAndDate = new Map<string, number>();
  const intervalsByEmployee = new Map<
    string,
    Array<{ start: number; end: number }>
  >();

  for (const assignment of request.existingAssignments) {
    const slot = slotById.get(assignment.slotId);
    if (!slot) {
      continue;
    }

    assignedSlotIds.add(slot.id);
    if (assignment.locked) {
      lockedSlotIds.add(slot.id);
    }
    addHintState({
      employeeId: assignment.employeeId,
      slot,
      weeklyShiftCountByEmployee,
      dailyMinutesByEmployeeAndDate,
      intervalsByEmployee
    });
  }

  const eligibilityBySlot = new Map<string, typeof request.eligibility>();
  for (const pair of request.eligibility) {
    const existing = eligibilityBySlot.get(pair.slotId) ?? [];
    existing.push(pair);
    eligibilityBySlot.set(pair.slotId, existing);
  }

  const slots = [...request.slots]
    .filter((slot) => !lockedSlotIds.has(slot.id))
    .sort((left, right) => {
      const leftCandidates = eligibilityBySlot.get(left.id)?.length ?? 0;
      const rightCandidates = eligibilityBySlot.get(right.id)?.length ?? 0;
      return (
        leftCandidates - rightCandidates ||
        left.date.localeCompare(right.date) ||
        left.startTime.localeCompare(right.startTime) ||
        left.id.localeCompare(right.id)
      );
    });
  const hints: CpSatHint[] = [];

  for (const slot of slots) {
    if (Date.now() >= deadline) {
      break;
    }
    if (assignedSlotIds.has(slot.id)) {
      continue;
    }

    const candidates = [...(eligibilityBySlot.get(slot.id) ?? [])].sort(
      (left, right) => {
        const leftShiftCount =
          weeklyShiftCountByEmployee.get(left.employeeId) ?? 0;
        const rightShiftCount =
          weeklyShiftCountByEmployee.get(right.employeeId) ?? 0;

        return (
          right.preferenceScore - left.preferenceScore ||
          leftShiftCount - rightShiftCount ||
          left.employeeId.localeCompare(right.employeeId)
        );
      }
    );

    for (const candidate of candidates) {
      const employee = employeeById.get(candidate.employeeId);
      if (!employee || !canAddHint({
        employee,
        slot,
        weeklyShiftCountByEmployee,
        dailyMinutesByEmployeeAndDate,
        intervalsByEmployee
      })) {
        continue;
      }

      hints.push({
        employeeId: candidate.employeeId,
        slotId: slot.id
      });
      assignedSlotIds.add(slot.id);
      addHintState({
        employeeId: candidate.employeeId,
        slot,
        weeklyShiftCountByEmployee,
        dailyMinutesByEmployeeAndDate,
        intervalsByEmployee
      });
      break;
    }
  }

  return hints;
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
    activeAssignments
      .filter(isLockedAssignment)
      .map(
        (assignment) =>
          `${assignment.employee_id}|${assignment.schedule_slot_id}`
      )
  );
  const pairs: Array<{
    employeeId: string;
    slotId: string;
    preferenceScore: number;
  }> = [];

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
          slotId: slot.id,
          preferenceScore: getPreferenceScore({ employee, slot, data })
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

function isLockedAssignment(assignment: ScheduleAssignment): boolean {
  return assignment.is_locked === 1;
}

function getPreferenceScore({
  employee,
  slot,
  data
}: {
  employee: Employee;
  slot: ScheduleSlot;
  data: SchedulerData;
}): number {
  const preferredRoleScore = data.employeeRoles.some(
    (employeeRole) =>
      employeeRole.employee_id === employee.id &&
      employeeRole.role_id === slot.role_id &&
      employeeRole.is_preferred_role === 1
  )
    ? 3
    : 0;
  const shiftPreferenceScore =
    getEmployeeShiftAvailability({
      employeeId: employee.id,
      slot,
      data
    })?.availability_type === "prefers_to_work"
      ? 2
      : 0;
  const dayPreferenceScore =
    getDayConstraint(employee.id, getDayOfWeek(slot.date), data.employeeDayConstraints)
      ?.constraint_type === "prefers_to_work"
      ? 1
      : 0;

  return preferredRoleScore + shiftPreferenceScore + dayPreferenceScore;
}

function canAddHint({
  employee,
  slot,
  weeklyShiftCountByEmployee,
  dailyMinutesByEmployeeAndDate,
  intervalsByEmployee
}: {
  employee: CpSatSolveRequest["employees"][number];
  slot: CpSatSolveRequest["slots"][number];
  weeklyShiftCountByEmployee: Map<string, number>;
  dailyMinutesByEmployeeAndDate: Map<string, number>;
  intervalsByEmployee: Map<string, Array<{ start: number; end: number }>>;
}): boolean {
  const weeklyShiftCount =
    weeklyShiftCountByEmployee.get(employee.id) ?? 0;
  if (weeklyShiftCount + 1 > employee.maxShiftsPerWeek) {
    return false;
  }

  const dailyKey = getDailyHintKey(employee.id, slot.date);
  const dailyMinutes = dailyMinutesByEmployeeAndDate.get(dailyKey) ?? 0;
  if (dailyMinutes + slot.durationMinutes > employee.maxHoursPerDayMinutes) {
    return false;
  }

  return !(intervalsByEmployee.get(employee.id) ?? []).some((interval) =>
    intervalsOverlap(interval, {
      start: slot.absoluteStartMinute,
      end: slot.absoluteEndMinute
    })
  );
}

function addHintState({
  employeeId,
  slot,
  weeklyShiftCountByEmployee,
  dailyMinutesByEmployeeAndDate,
  intervalsByEmployee
}: {
  employeeId: string;
  slot: CpSatSolveRequest["slots"][number];
  weeklyShiftCountByEmployee: Map<string, number>;
  dailyMinutesByEmployeeAndDate: Map<string, number>;
  intervalsByEmployee: Map<string, Array<{ start: number; end: number }>>;
}): void {
  weeklyShiftCountByEmployee.set(
    employeeId,
    (weeklyShiftCountByEmployee.get(employeeId) ?? 0) + 1
  );

  const dailyKey = getDailyHintKey(employeeId, slot.date);
  dailyMinutesByEmployeeAndDate.set(
    dailyKey,
    (dailyMinutesByEmployeeAndDate.get(dailyKey) ?? 0) + slot.durationMinutes
  );

  const intervals = intervalsByEmployee.get(employeeId) ?? [];
  intervals.push({
    start: slot.absoluteStartMinute,
    end: slot.absoluteEndMinute
  });
  intervalsByEmployee.set(employeeId, intervals);
}

function intervalsOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number }
): boolean {
  return left.start < right.end && right.start < left.end;
}

function getDailyHintKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

function sanitizeHints(
  hints: Array<{ employeeId: string; slotId: string }>
): Array<{ employeeId: string; slotId: string }> {
  return hints
    .filter(
      (hint) =>
        typeof hint.employeeId === "string" && typeof hint.slotId === "string"
    )
    .sort(
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
