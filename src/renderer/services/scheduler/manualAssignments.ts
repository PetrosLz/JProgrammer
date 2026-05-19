import { databaseApi } from "../databaseApi";
import type {
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
  ScheduleSlot,
  ScheduleWarning,
  StaffingRequirement,
  TimeOff
} from "../../types";
import {
  buildExistingAssignedShifts,
  checkHardConstraints,
  type SchedulerData
} from "./constraints";
import { assessRoleGroupQuality } from "./teamQuality";

export type ManualAssignmentValidation = {
  employee: Employee | null;
  violations: string[];
  explanation: string;
};

export type ManualAssignmentInput = {
  slot: ScheduleSlot;
  employeeId: string | null;
  currentAssignment: ScheduleAssignment | null;
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  staffingRequirements: StaffingRequirement[];
  roles: Role[];
  timeOff: TimeOff[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
};

export type ManualAssignmentSaveOptions = {
  allowHardOverride?: boolean;
};

export async function saveManualAssignmentChange(
  input: ManualAssignmentInput,
  options: ManualAssignmentSaveOptions = {}
): Promise<void> {
  // TODO: Future drag and drop should call this same validation/save path.
  const validation = validateManualAssignmentChange(input);

  if (!input.employeeId) {
    if (input.currentAssignment) {
      await databaseApi.updateRecord(
        "schedule_assignments",
        input.currentAssignment.id,
        {
          status: "removed",
          is_manual_override: true,
          notes: "Manual override: assignment removed by manager."
        }
      );
    }

    await databaseApi.updateRecord("schedule_slots", input.slot.id, {
      status: "unfilled"
    });
    return;
  }

  if (!validation.employee) {
    throw new Error("Selected employee could not be found.");
  }

  const splitViolations = splitManualAssignmentViolations(validation.violations);

  if (splitViolations.hard.length > 0 && options.allowHardOverride !== true) {
    throw new Error(
      `Manual assignment blocked by hard rules: ${splitViolations.hard.join(" ")}`
    );
  }

  const assignmentNotes =
    splitViolations.hard.length > 0
      ? `Manual hard override: ${validation.employee.first_name} ${
          validation.employee.last_name
        } assigned with hard rule violations: ${splitViolations.hard.join(" ")}${
          splitViolations.soft.length > 0
            ? ` Soft warnings: ${splitViolations.soft.join(" ")}`
            : ""
        }`
      : validation.explanation;

  const reusableAssignment = input.scheduleAssignments.find(
    (assignment) =>
      assignment.schedule_slot_id === input.slot.id &&
      assignment.employee_id === input.employeeId &&
      assignment.id !== input.currentAssignment?.id
  );

  if (input.currentAssignment && reusableAssignment) {
    await databaseApi.updateRecord(
      "schedule_assignments",
      input.currentAssignment.id,
      {
        status: "removed",
        is_manual_override: true,
        notes: "Manual override: assignment replaced by manager."
      }
    );
    await databaseApi.updateRecord("schedule_assignments", reusableAssignment.id, {
      status: "assigned",
      is_manual_override: true,
      notes: assignmentNotes
    });
  } else if (input.currentAssignment) {
    await databaseApi.updateRecord(
      "schedule_assignments",
      input.currentAssignment.id,
      {
        employee_id: input.employeeId,
        status: "assigned",
        is_manual_override: true,
        notes: assignmentNotes
      }
    );
  } else if (reusableAssignment) {
    await databaseApi.updateRecord("schedule_assignments", reusableAssignment.id, {
      status: "assigned",
      is_manual_override: true,
      notes: assignmentNotes
    });
  } else {
    await databaseApi.createRecord("schedule_assignments", {
      schedule_run_id: input.slot.schedule_run_id,
      schedule_slot_id: input.slot.id,
      employee_id: input.employeeId,
      status: "assigned",
      is_manual_override: true,
      notes: assignmentNotes
    });
  }

  await databaseApi.updateRecord("schedule_slots", input.slot.id, {
    status: "filled"
  });

  for (const violation of splitViolations.soft) {
    await databaseApi.createRecord("schedule_warnings", {
      schedule_run_id: input.slot.schedule_run_id,
      schedule_slot_id: input.slot.id,
      schedule_assignment_id: null,
      severity: "warning",
      warning_type: "manual_override_warning",
      message: `Manual override saved: ${violation}`
    } satisfies Omit<ScheduleWarning, "id" | "created_at" | "updated_at">);
  }

  if (options.allowHardOverride === true) {
    for (const violation of splitViolations.hard) {
      await databaseApi.createRecord("schedule_warnings", {
        schedule_run_id: input.slot.schedule_run_id,
        schedule_slot_id: input.slot.id,
        schedule_assignment_id: null,
        severity: "critical",
        warning_type: "manual_hard_override_violation",
        message: `Manual hard override saved: ${violation}`
      } satisfies Omit<ScheduleWarning, "id" | "created_at" | "updated_at">);
    }
  }
}

export function splitManualAssignmentViolations(violations: string[]): {
  hard: string[];
  soft: string[];
} {
  return violations.reduce(
    (result, violation) => {
      if (isHardManualAssignmentViolation(violation)) {
        result.hard.push(violation);
      } else {
        result.soft.push(violation);
      }

      return result;
    },
    { hard: [] as string[], soft: [] as string[] }
  );
}

function isHardManualAssignmentViolation(violation: string): boolean {
  return /inactive|does not have the required role|Employee does not meet the required experience level for this role|time off|cannot work|not available|already has a shift|overlapping shift|cannot work weekends|exceed max weekly hours|exceed max weekly days|could not be found/i.test(
    violation
  );
}

export function validateManualAssignmentChange({
  slot,
  employeeId,
  currentAssignment,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  staffingRequirements,
  roles,
  timeOff,
  scheduleSlots,
  scheduleAssignments
}: ManualAssignmentInput): ManualAssignmentValidation {
  if (!employeeId) {
    return {
      employee: null,
      violations: [],
      explanation: "Manual override: slot left unfilled by manager."
    };
  }

  const employee = employees.find((item) => item.id === employeeId) ?? null;

  if (!employee) {
    return {
      employee: null,
      violations: ["Selected employee could not be found."],
      explanation: "Manual override failed: selected employee could not be found."
    };
  }

  const activeAssignments = scheduleAssignments.filter(
    (assignment) =>
      assignment.status !== "cancelled" &&
      assignment.status !== "removed" &&
      assignment.id !== currentAssignment?.id &&
      assignment.schedule_slot_id !== slot.id
  );
  const assignedShifts = buildExistingAssignedShifts({
    slots: scheduleSlots,
    assignments: activeAssignments
  });
  const data: SchedulerData = {
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    staffingRequirements,
    timeOff
  };
  const hardConstraintResult = checkHardConstraints({
    employee,
    slot,
    data,
    assignedShifts
  });
  const hypotheticalAssignment: ScheduleAssignment = {
    id: currentAssignment?.id ?? "manual-preview",
    schedule_run_id: slot.schedule_run_id,
    schedule_slot_id: slot.id,
    employee_id: employee.id,
    status: "assigned",
    is_manual_override: 1,
    notes: null,
    created_at: "",
    updated_at: ""
  };
  const teamQuality = assessRoleGroupQuality({
    slot,
    slots: scheduleSlots,
    assignments: [...activeAssignments, hypotheticalAssignment],
    employees,
    employeeRoles,
    roles,
    staffingRequirements
  });
  const violations = [...hardConstraintResult.reasons, ...teamQuality.warnings];
  const explanation =
    violations.length > 0
      ? `Manual override: ${employee.first_name} ${employee.last_name} assigned with confirmed warnings: ${violations.join(" ")}`
      : `Manual override: ${employee.first_name} ${employee.last_name} assigned by manager after validation.`;

  return {
    employee,
    violations,
    explanation
  };
}
