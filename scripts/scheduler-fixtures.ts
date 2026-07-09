import type {
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ShiftTemplate,
  StaffingRequirement,
  TimeOff
} from "../src/renderer/types";

const timestamp = "2026-05-01T00:00:00.000Z";

export type SchedulerFixture = {
  run: ScheduleRun;
  slots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  timeOff: TimeOff[];
  staffingRequirements: StaffingRequirement[];
  shiftTemplates: ShiftTemplate[];
};

export function createFixture(
  overrides: Partial<SchedulerFixture> = {}
): SchedulerFixture {
  const roles = overrides.roles ?? [
    createRole("role-service", "Service"),
    createRole("role-kitchen", "Kitchen")
  ];
  const shiftTemplates = overrides.shiftTemplates ?? [
    createShiftTemplate("shift-morning", "Morning", "09:00", "17:00"),
    createShiftTemplate("shift-evening", "Evening", "17:00", "23:00")
  ];
  const staffingRequirements =
    overrides.staffingRequirements ??
    [
      createStaffingRequirement({
        id: "req-service-morning",
        roleId: roles[0].id,
        shiftTemplateId: shiftTemplates[0].id,
        startTime: "09:00",
        endTime: "17:00"
      })
    ];
  const run = overrides.run ?? createRun();
  const slots =
    overrides.slots ??
    [
      createSlot({
        id: "slot-service-monday",
        runId: run.id,
        date: "2026-05-18",
        roleId: roles[0].id,
        sourceId: staffingRequirements[0].id,
        startTime: "09:00",
        endTime: "17:00"
      })
    ];
  const employees = overrides.employees ?? [
    createEmployee("emp-alex", "Alex", "Service"),
    createEmployee("emp-nina", "Nina", "Kitchen")
  ];
  const employeeRoles =
    overrides.employeeRoles ??
    [
      createEmployeeRole("er-alex-service", employees[0].id, roles[0].id),
      createEmployeeRole("er-nina-kitchen", employees[1].id, roles[1].id)
    ];
  const employeeWorkRules =
    overrides.employeeWorkRules ??
    employees.map((employee) => createWorkRules(`wr-${employee.id}`, employee.id));
  const assignments =
    overrides.assignments ??
    [createAssignment("as-alex-service", run.id, slots[0].id, employees[0].id)];

  return {
    run,
    slots,
    assignments,
    employees,
    roles,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints: overrides.employeeDayConstraints ?? [],
    employeeShiftAvailability: overrides.employeeShiftAvailability ?? [],
    timeOff: overrides.timeOff ?? [],
    staffingRequirements,
    shiftTemplates
  };
}

export function createRun(id = "run-week"): ScheduleRun {
  return {
    id,
    name: "Benchmark week",
    start_date: "2026-05-18",
    end_date: "2026-05-24",
    status: "generated",
    parameters_json: null,
    completed_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createRole(id: string, name: string): Role {
  return {
    id,
    name,
    color: "#2563eb",
    description: null,
    is_active: 1,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createShiftTemplate(
  id: string,
  name: string,
  startTime: string,
  endTime: string
): ShiftTemplate {
  return {
    id,
    name,
    role_id: null,
    start_time: startTime,
    end_time: endTime,
    is_overnight: endTime <= startTime ? 1 : 0,
    break_minutes: 0,
    color: "#0f766e",
    notes: null,
    is_active: 1,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createStaffingRequirement({
  id,
  roleId,
  shiftTemplateId,
  startTime,
  endTime,
  requiredCount = 1
}: {
  id: string;
  roleId: string;
  shiftTemplateId: string;
  startTime: string;
  endTime: string;
  requiredCount?: number;
}): StaffingRequirement {
  return {
    id,
    day_of_week: 1,
    shift_template_id: shiftTemplateId,
    role_id: roleId,
    start_time: startTime,
    end_time: endTime,
    required_count: requiredCount,
    minimum_experience_level: "no_experience",
    experienced_required_count: 0,
    priority: null,
    is_active: 1,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createSlot({
  id,
  runId,
  date,
  roleId,
  sourceId,
  startTime,
  endTime,
  status = "filled"
}: {
  id: string;
  runId: string;
  date: string;
  roleId: string;
  sourceId: string | null;
  startTime: string;
  endTime: string;
  status?: string;
}): ScheduleSlot {
  return {
    id,
    schedule_run_id: runId,
    date,
    role_id: roleId,
    start_time: startTime,
    end_time: endTime,
    required_count: 1,
    status,
    source_type: "staffing_requirement",
    source_id: sourceId,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createEmployee(
  id: string,
  firstName: string,
  lastName: string,
  isActive: Employee["is_active"] = 1
): Employee {
  return {
    id,
    first_name: firstName,
    last_name: lastName,
    email: null,
    phone: null,
    is_active: isActive,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createEmployeeRole(
  id: string,
  employeeId: string,
  roleId: string,
  experienceLevel: EmployeeRole["experience_level"] = "some_experience"
): EmployeeRole {
  return {
    id,
    employee_id: employeeId,
    role_id: roleId,
    is_primary: 1,
    experience_level: experienceLevel,
    skill_level: null,
    can_lead_role: 0,
    is_preferred_role: 1,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createWorkRules(
  id: string,
  employeeId: string,
  contractHours = 40,
  maxHours = 44,
  contractDays = 5,
  maxDays = 6
): EmployeeWorkRules {
  return {
    id,
    employee_id: employeeId,
    employment_type: "full_time",
    contract_days_per_week: contractDays,
    contract_hours_per_week: contractHours,
    preferred_hours_per_day: 8,
    min_days_per_week: null,
    max_hours_per_week: maxHours,
    min_hours_per_week: null,
    max_shifts_per_week: null,
    max_days_per_week: maxDays,
    target_days_per_week: contractDays,
    target_hours_per_week: contractHours,
    max_consecutive_days: null,
    can_work_weekends: 1,
    min_hours_between_shifts: null,
    preferred_hours_per_week: null,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createAssignment(
  id: string,
  runId: string,
  slotId: string,
  employeeId: string
): ScheduleAssignment {
  return {
    id,
    schedule_run_id: runId,
    schedule_slot_id: slotId,
    employee_id: employeeId,
    status: "assigned",
    is_manual_override: 0,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createTimeOff(
  id: string,
  employeeId: string,
  startDate: string,
  endDate: string
): TimeOff {
  return {
    id,
    employee_id: employeeId,
    type: "vacation",
    start_date: startDate,
    end_date: endDate,
    reason: null,
    status: "approved",
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}
