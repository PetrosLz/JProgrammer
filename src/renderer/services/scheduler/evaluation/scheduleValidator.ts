import type {
  Employee,
  EmployeeRole,
  ScheduleAssignment,
  ScheduleSlot
} from "../../../types";
import { experienceLevelRank } from "../../../types";
import {
  type HardConstraintViolation,
  type ManualOverrideMap,
  type SchedulerData,
  buildExistingAssignedShifts,
  checkHardConstraints,
  getEmployeeRoleExperienceLevel,
  getSlotExperiencedRequiredCount
} from "../constraints";
import { getRoleGroupKey } from "../teamQuality";

export type ScheduleValidationResult = {
  valid: boolean;
  violations: HardConstraintViolation[];
};

export function validateScheduleHardConstraints({
  runSlots,
  assignments,
  employees,
  data,
  manualOverrides = {}
}: {
  runSlots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  employees: Employee[];
  data: SchedulerData;
  manualOverrides?: ManualOverrideMap;
}): ScheduleValidationResult {
  const violations: HardConstraintViolation[] = [];
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.status !== "cancelled" && assignment.status !== "removed"
  );
  const assignmentsBySlotId = new Map<string, ScheduleAssignment[]>();
  const employeeSlotPairs = new Set<string>();

  for (const assignment of activeAssignments) {
    const slotAssignments = assignmentsBySlotId.get(assignment.schedule_slot_id) ?? [];
    assignmentsBySlotId.set(assignment.schedule_slot_id, [
      ...slotAssignments,
      assignment
    ]);

    const pairKey = `${assignment.employee_id}|${assignment.schedule_slot_id}`;
    if (employeeSlotPairs.has(pairKey)) {
      violations.push(createStructuralViolation({
        assignment,
        message: `Assignment ${assignment.id} duplicates employee-slot pair ${pairKey}.`,
        issue: "duplicate_employee_slot"
      }));
    }
    employeeSlotPairs.add(pairKey);
  }

  for (const [slotId, slotAssignments] of assignmentsBySlotId.entries()) {
    if (slotAssignments.length > 1) {
      violations.push(
        createStructuralViolation({
          assignment: slotAssignments[0],
          message: `Slot ${slotId} has ${slotAssignments.length} active assignments.`,
          issue: "duplicate_slot_assignment"
        })
      );
    }
  }

  for (const assignment of activeAssignments) {
    const slot = slotById.get(assignment.schedule_slot_id);
    const employee = employeeById.get(assignment.employee_id);

    if (!slot) {
      violations.push(
        createStructuralViolation({
          assignment,
          message: `Assignment ${assignment.id} references a missing schedule slot.`,
          issue: "missing_slot"
        })
      );
      continue;
    }

    if (!employee) {
      violations.push(
        createStructuralViolation({
          assignment,
          message: `Assignment ${assignment.id} references a missing employee.`,
          issue: "missing_employee",
          slot
        })
      );
      continue;
    }

    const otherAssignments = activeAssignments.filter(
      (candidate) => candidate.id !== assignment.id
    );
    const assignedShiftsWithoutCurrent = buildExistingAssignedShifts({
      slots: runSlots,
      assignments: otherAssignments,
      data
    });
    const hardConstraintResult = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts: assignedShiftsWithoutCurrent,
      manualOverrides
    });

    violations.push(...hardConstraintResult.violations);
  }

  violations.push(
    ...validateGroupExperienceComposition({
      runSlots,
      activeAssignments,
      employeeRoles: data.employeeRoles,
      data
    })
  );

  return {
    valid: violations.length === 0,
    violations
  };
}

function validateGroupExperienceComposition({
  runSlots,
  activeAssignments,
  employeeRoles,
  data
}: {
  runSlots: ScheduleSlot[];
  activeAssignments: ScheduleAssignment[];
  employeeRoles: EmployeeRole[];
  data: SchedulerData;
}): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const groups = new Map<
    string,
    {
      representativeSlot: ScheduleSlot;
      assignments: ScheduleAssignment[];
      experiencedRequiredCount: number;
    }
  >();

  for (const assignment of activeAssignments) {
    const slot = slotById.get(assignment.schedule_slot_id);

    if (!slot) {
      continue;
    }

    const groupKey = getRoleGroupKey(slot, data.staffingRequirements ?? []);
    const existing = groups.get(groupKey) ?? {
      representativeSlot: slot,
      assignments: [],
      experiencedRequiredCount: getSlotExperiencedRequiredCount(
        slot,
        data.staffingRequirements ?? []
      )
    };

    existing.assignments.push(assignment);
    existing.experiencedRequiredCount = Math.max(
      existing.experiencedRequiredCount,
      getSlotExperiencedRequiredCount(slot, data.staffingRequirements ?? [])
    );
    groups.set(groupKey, existing);
  }

  for (const [groupKey, group] of groups.entries()) {
    const assignedCount = group.assignments.length;
    if (assignedCount === 0 || group.experiencedRequiredCount <= 0) {
      continue;
    }

    const requiredExperienced = Math.min(
      group.experiencedRequiredCount,
      assignedCount
    );
    const experiencedAssignedCount = group.assignments.filter((assignment) => {
      const slot = slotById.get(assignment.schedule_slot_id);
      return (
        slot &&
        experienceLevelRank(
          getEmployeeRoleExperienceLevel(
            assignment.employee_id,
            slot.role_id,
            employeeRoles
          )
        ) >= 2
      );
    }).length;

    if (experiencedAssignedCount >= requiredExperienced) {
      continue;
    }

    const slot = group.representativeSlot;
    violations.push({
      code: "INSUFFICIENT_GROUP_EXPERIENCE",
      message: `Requirement group ${groupKey} has ${experiencedAssignedCount}/${requiredExperienced} prior-experience assignments.`,
      employeeId: group.assignments[0]?.employee_id ?? "group",
      slotId: slot.id,
      metadata: {
        issue: "insufficient_group_experience",
        requirementGroupId: groupKey,
        assignedCount,
        experiencedAssignedCount,
        experiencedRequiredCount: group.experiencedRequiredCount,
        roleId: slot.role_id,
        date: slot.date,
        startTime: slot.start_time,
        endTime: slot.end_time
      }
    });
  }

  return violations;
}

function createStructuralViolation({
  assignment,
  message,
  issue,
  slot
}: {
  assignment: ScheduleAssignment;
  message: string;
  issue: string;
  slot?: ScheduleSlot;
}): HardConstraintViolation {
  return {
    code: "INVALID_SHIFT_INTERVAL",
    message,
    employeeId: assignment.employee_id,
    slotId: slot?.id ?? assignment.schedule_slot_id,
    metadata: {
      issue,
      assignmentId: assignment.id
    }
  };
}
