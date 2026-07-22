import { databaseApi } from "../databaseApi";
import type {
  Employee,
  DayOfWeek,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeTimeConstraint,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
  ScheduleSlot,
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
  employeeTimeConstraints?: EmployeeTimeConstraint[];
  staffingRequirements: StaffingRequirement[];
  roles: Role[];
  timeOff: TimeOff[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  weekStartsOn?: DayOfWeek;
};

export type ManualAssignmentSaveOptions = {
  allowHardOverride?: boolean;
};

export async function setManualAssignmentLock({
  assignment,
  locked
}: {
  assignment: ScheduleAssignment;
  locked: boolean;
}): Promise<void> {
  const updated = await databaseApi.updateRecord("schedule_assignments", assignment.id, {
    is_locked: locked
  });

  if (updated === null) {
    throw new Error(
      `Assignment ${assignment.id} no longer exists and could not be ${locked ? "locked" : "unlocked"}.`
    );
  }
}

export async function saveManualAssignmentChange(
  input: ManualAssignmentInput,
  options: ManualAssignmentSaveOptions = {}
): Promise<void> {
  // TODO: Future drag and drop should call this same validation/save path.
  const validation = validateManualAssignmentChange(input);

  if (!input.employeeId) {
    await databaseApi.persistManualAssignmentChange({
      scheduleRunId: input.slot.schedule_run_id,
      scheduleSlotId: input.slot.id,
      currentAssignmentId: input.currentAssignment?.id ?? null,
      nextAssignmentId: null,
      nextEmployeeId: null,
      assignmentNotes: "Manual override: assignment removed by manager.",
      softWarnings: [],
      hardWarnings: [],
      allowHardOverride: false
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

  const nextAssignmentId = createClientId("manual-assignment");
  await databaseApi.persistManualAssignmentChange({
    scheduleRunId: input.slot.schedule_run_id,
    scheduleSlotId: input.slot.id,
    currentAssignmentId: input.currentAssignment?.id ?? null,
    nextAssignmentId,
    nextEmployeeId: input.employeeId,
    assignmentNotes,
    softWarnings: splitViolations.soft.map((violation) => ({
      id: createClientId("manual-warning"),
      scheduleSlotId: input.slot.id,
      scheduleAssignmentId: null,
      severity: "warning",
      warningType: "manual_override_warning",
      message: `Manual override saved: ${violation}`
    })),
    hardWarnings:
      options.allowHardOverride === true
        ? splitViolations.hard.map((violation) => ({
            id: createClientId("manual-warning"),
            scheduleSlotId: input.slot.id,
            scheduleAssignmentId: null,
            severity: "critical",
            warningType: "manual_hard_override_violation",
            message: `Manual hard override saved: ${violation}`
          }))
        : [],
    allowHardOverride: options.allowHardOverride
  });
}

function createClientId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
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
  return /inactive|does not have the required role|Employee does not meet the required experience level for this role|time off|cannot work|not available|overlapping shift|cannot work weekends|exceed max daily hours|exceed max weekly shifts|during this time window|could not be found/i.test(
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
  employeeTimeConstraints = [],
  staffingRequirements,
  roles,
  timeOff,
  scheduleSlots,
  scheduleAssignments,
  weekStartsOn = 1
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
    employeeTimeConstraints,
    staffingRequirements,
    timeOff,
    weekStartsOn
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
    is_locked: 0,
    source: "manual",
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
