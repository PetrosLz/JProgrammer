import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeTimeConstraint,
  EmployeeWorkRules,
  OpeningHours,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ShiftTemplate,
  SpecialDay,
  StaffingRequirement,
  TimeOff
} from "../src/renderer/types";

const timestamp = "2026-05-01T00:00:00.000Z";

export type SchedulerFixture = {
  run: ScheduleRun;
  openingHours: OpeningHours[];
  specialDays: SpecialDay[];
  slots: ScheduleSlot[];
  assignments: ScheduleAssignment[];
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  employeeTimeConstraints: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  staffingRequirements: StaffingRequirement[];
  shiftTemplates: ShiftTemplate[];
};

export type SchedulerBenchmarkScenario = {
  name: string;
  difficulty: "easy" | "medium" | "hard" | "impossible";
  weekStartDate: string;
  run: ScheduleRun;
  openingHours: OpeningHours[];
  specialDays: SpecialDay[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  employeeTimeConstraints: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  existingAssignments: ScheduleAssignment[];
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
    openingHours: overrides.openingHours ?? createOpeningHours(),
    specialDays: overrides.specialDays ?? [],
    slots,
    assignments,
    employees,
    roles,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints: overrides.employeeDayConstraints ?? [],
    employeeShiftAvailability: overrides.employeeShiftAvailability ?? [],
    employeeTimeConstraints: overrides.employeeTimeConstraints ?? [],
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
  requiredCount = 1,
  dayOfWeek = 1
}: {
  id: string;
  roleId: string;
  shiftTemplateId: string;
  startTime: string;
  endTime: string;
  requiredCount?: number;
  dayOfWeek?: DayOfWeek;
}): StaffingRequirement {
  return {
    id,
    day_of_week: dayOfWeek,
    shift_template_id: shiftTemplateId,
    role_id: roleId,
    start_time: startTime,
    end_time: endTime,
    required_count: requiredCount,
    minimum_experience_level: "no_experience",
    experienced_required_count: 0,
    priority: "normal",
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
  maxShiftsPerWeek = 5,
  maxHoursPerDay = 8,
  targetHoursPerDay: number | null = 8,
  canWorkWeekends: EmployeeWorkRules["can_work_weekends"] = 1
): EmployeeWorkRules {
  return {
    id,
    employee_id: employeeId,
    max_shifts_per_week: maxShiftsPerWeek,
    max_hours_per_day: maxHoursPerDay,
    target_hours_per_day: targetHoursPerDay,
    can_work_weekends: canWorkWeekends,
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

export function createOpeningHours(): OpeningHours[] {
  return ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map((dayOfWeek) => ({
    id: `hours-${dayOfWeek}`,
    day_of_week: dayOfWeek,
    is_open: 1,
    open_time: dayOfWeek === 0 ? "10:00" : "08:00",
    close_time: dayOfWeek === 6 ? "00:00" : "23:00",
    is_overnight: dayOfWeek === 6 ? 1 : 0,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  }));
}

export function createDayConstraint(
  id: string,
  employeeId: string,
  dayOfWeek: DayOfWeek,
  constraintType: string
): EmployeeDayConstraint {
  return {
    id,
    employee_id: employeeId,
    day_of_week: dayOfWeek,
    constraint_type: constraintType,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createShiftAvailability(
  id: string,
  employeeId: string,
  dayOfWeek: DayOfWeek,
  shiftTemplateId: string,
  availabilityType: string
): EmployeeShiftAvailability {
  return {
    id,
    employee_id: employeeId,
    day_of_week: dayOfWeek,
    shift_template_id: shiftTemplateId,
    availability_type: availabilityType,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createTimeConstraint({
  id,
  employeeId,
  date = null,
  dayOfWeek = null,
  startTime,
  endTime,
  constraintType = "cannot_work"
}: {
  id: string;
  employeeId: string;
  date?: string | null;
  dayOfWeek?: DayOfWeek | null;
  startTime: string;
  endTime: string;
  constraintType?: string;
}): EmployeeTimeConstraint {
  return {
    id,
    employee_id: employeeId,
    date,
    day_of_week: dayOfWeek,
    start_time: startTime,
    end_time: endTime,
    constraint_type: constraintType,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp
  };
}

export function createBenchmarkScenarios(): SchedulerBenchmarkScenario[] {
  return [
    createEasyCafeScenario(),
    createSplitShiftRequiredScenario(),
    createUnderstaffedCafeScenario(),
    createManyPartTimeEmployeesScenario(),
    createWeekendShortageScenario(),
    createOneExperiencedEmployeeScenario(),
    createImpossibleScheduleScenario(),
    createFlexibleEmployeesScenario(),
    createHighDemandSaturdayScenario(),
    createConflictingAvailabilityScenario(),
    createTimeWindowRestrictionScenario(),
    createExplicitRoleScarcityScenario()
  ];
}

function createScenarioBase(
  name: string,
  difficulty: SchedulerBenchmarkScenario["difficulty"]
): SchedulerBenchmarkScenario {
  const run = createRun(`run-${slug(name)}`);
  const roles = [
    createRole("role-service", "Service"),
    createRole("role-kitchen", "Kitchen"),
    createRole("role-cashier", "Cashier"),
    createRole("role-bar", "Bar"),
    createRole("role-manager", "Manager")
  ];
  const shiftTemplates = [
    createShiftTemplate("shift-morning", "Morning", "09:00", "17:00"),
    createShiftTemplate("shift-evening", "Evening", "17:00", "23:00"),
    createShiftTemplate("shift-saturday-evening", "Saturday Evening", "17:00", "00:00")
  ];

  return {
    name,
    difficulty,
    weekStartDate: run.start_date,
    run,
    openingHours: createOpeningHours(),
    specialDays: [],
    roles,
    shiftTemplates,
    staffingRequirements: [],
    employees: [],
    employeeRoles: [],
    employeeWorkRules: [],
    employeeDayConstraints: [],
    employeeShiftAvailability: [],
    employeeTimeConstraints: [],
    timeOff: [],
    existingAssignments: []
  };
}

function createEasyCafeScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("easy cafe", "easy");
  const service = scenario.roles[0];
  const kitchen = scenario.roles[1];
  const cashier = scenario.roles[2];
  const morning = scenario.shiftTemplates[0];
  const evening = scenario.shiftTemplates[1];

  scenario.staffingRequirements = ([1, 2, 3, 4, 5] as DayOfWeek[]).flatMap(
    (dayOfWeek) => [
      createRequirementFor(scenario, dayOfWeek, morning, service, 1),
      createRequirementFor(scenario, dayOfWeek, morning, kitchen, 1),
      createRequirementFor(scenario, dayOfWeek, evening, service, 1),
      createRequirementFor(scenario, dayOfWeek, evening, cashier, 1)
    ]
  );
  scenario.employees = [
    createEmployee("emp-maria", "Maria", "Service"),
    createEmployee("emp-giorgos", "Giorgos", "Kitchen"),
    createEmployee("emp-eleni", "Eleni", "Cashier"),
    createEmployee("emp-nikos", "Nikos", "Service"),
    createEmployee("emp-sofia", "Sofia", "Kitchen"),
    createEmployee("emp-anna", "Anna", "Cashier"),
    createEmployee("emp-petros", "Petros", "Bar"),
    createEmployee("emp-ioanna", "Ioanna", "Service")
  ];
  scenario.employeeRoles = [
    roleFor("er-maria-service", "emp-maria", service),
    roleFor("er-giorgos-kitchen", "emp-giorgos", kitchen),
    roleFor("er-eleni-cashier", "emp-eleni", cashier),
    roleFor("er-nikos-service", "emp-nikos", service),
    roleFor("er-sofia-kitchen", "emp-sofia", kitchen),
    roleFor("er-anna-cashier", "emp-anna", cashier),
    roleFor("er-petros-service", "emp-petros", service),
    roleFor("er-petros-bar", "emp-petros", scenario.roles[3]),
    roleFor("er-ioanna-service", "emp-ioanna", service)
  ];
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 6, 8, 8)
  );

  return scenario;
}

function createSplitShiftRequiredScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("split shifts required", "easy");
  const service = scenario.roles[0];
  const shortMorning = createShiftTemplate(
    "shift-split-morning",
    "Split Morning",
    "08:00",
    "12:00"
  );
  const shortEvening = createShiftTemplate(
    "shift-split-evening",
    "Split Evening",
    "16:00",
    "20:00"
  );
  scenario.shiftTemplates = [shortMorning, shortEvening];
  scenario.staffingRequirements = [
    createRequirementFor(scenario, 1, shortMorning, service, 1),
    createRequirementFor(scenario, 1, shortEvening, service, 1)
  ];
  scenario.employees = [
    createEmployee("emp-split-service", "Split", "Service")
  ];
  scenario.employeeRoles = [
    roleFor("er-split-service", "emp-split-service", service)
  ];
  scenario.employeeWorkRules = [
    createWorkRules("wr-split-service", "emp-split-service", 5, 8, 8)
  ];

  return scenario;
}

function createUnderstaffedCafeScenario(): SchedulerBenchmarkScenario {
  const scenario = createEasyCafeScenario();
  scenario.name = "understaffed cafe";
  scenario.difficulty = "hard";
  scenario.run = createRun("run-understaffed-cafe");
  scenario.employees = scenario.employees.slice(0, 3);
  const employeeIds = new Set(scenario.employees.map((employee) => employee.id));
  scenario.employeeRoles = scenario.employeeRoles.filter((employeeRole) =>
    employeeIds.has(employeeRole.employee_id)
  );
  scenario.employeeWorkRules = scenario.employeeWorkRules.filter((rules) =>
    employeeIds.has(rules.employee_id)
  );

  return scenario;
}

function createManyPartTimeEmployeesScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("many part-time employees", "medium");
  const service = scenario.roles[0];
  const bar = scenario.roles[3];
  const morning = createShiftTemplate("shift-short-morning", "Short Morning", "09:00", "13:00");
  const afternoon = createShiftTemplate("shift-short-afternoon", "Short Afternoon", "13:00", "17:00");
  scenario.shiftTemplates = [morning, afternoon];
  scenario.staffingRequirements = ([1, 2, 3, 4, 5] as DayOfWeek[]).flatMap(
    (dayOfWeek) => [
      createRequirementFor(scenario, dayOfWeek, morning, service, 2),
      createRequirementFor(scenario, dayOfWeek, afternoon, service, 2),
      createRequirementFor(scenario, dayOfWeek, afternoon, bar, 1)
    ]
  );
  scenario.employees = Array.from({ length: 12 }, (_, index) =>
    createEmployee(`emp-pt-${index}`, `Part${index + 1}`, "Timer")
  );
  scenario.employeeRoles = scenario.employees.flatMap((employee, index) => [
    roleFor(`er-${employee.id}-service`, employee.id, service),
    ...(index % 3 === 0 ? [roleFor(`er-${employee.id}-bar`, employee.id, bar)] : [])
  ]);
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 6, 6, 4)
  );

  return scenario;
}

function createWeekendShortageScenario(): SchedulerBenchmarkScenario {
  const scenario = createEasyCafeScenario();
  scenario.name = "weekend shortage";
  scenario.difficulty = "hard";
  scenario.run = createRun("run-weekend-shortage");
  const service = scenario.roles[0];
  const kitchen = scenario.roles[1];
  const cashier = scenario.roles[2];
  const saturdayEvening = scenario.shiftTemplates[2];
  scenario.staffingRequirements = [
    createRequirementFor(scenario, 6, saturdayEvening, service, 3),
    createRequirementFor(scenario, 6, saturdayEvening, kitchen, 2),
    createRequirementFor(scenario, 6, saturdayEvening, cashier, 1)
  ];
  scenario.employeeDayConstraints = [
    createDayConstraint("dc-sofia-sat", "emp-sofia", 6, "cannot_work"),
    createDayConstraint("dc-anna-sat", "emp-anna", 6, "cannot_work"),
    createDayConstraint("dc-ioanna-sat", "emp-ioanna", 6, "cannot_work")
  ];

  return scenario;
}

function createOneExperiencedEmployeeScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("one prior-experience employee", "medium");
  const service = scenario.roles[0];
  const morning = scenario.shiftTemplates[0];
  scenario.staffingRequirements = [
    createRequirementFor(scenario, 1, morning, service, 2),
    createRequirementFor(scenario, 2, morning, service, 2)
  ];
  scenario.employees = [
    createEmployee("emp-senior", "Senior", "Service"),
    createEmployee("emp-new-1", "New", "One"),
    createEmployee("emp-new-2", "New", "Two"),
    createEmployee("emp-new-3", "New", "Three")
  ];
  scenario.employeeRoles = [
    createEmployeeRole("er-senior-service", "emp-senior", service.id, "some_experience"),
    createEmployeeRole("er-new-1-service", "emp-new-1", service.id, "no_experience"),
    createEmployeeRole("er-new-2-service", "emp-new-2", service.id, "no_experience"),
    createEmployeeRole("er-new-3-service", "emp-new-3", service.id, "no_experience")
  ];
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 5, 8, 6)
  );

  return scenario;
}

function createImpossibleScheduleScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("impossible schedule", "impossible");
  const kitchen = scenario.roles[1];
  const morning = scenario.shiftTemplates[0];
  scenario.staffingRequirements = ([1, 2, 3, 4, 5, 6] as DayOfWeek[]).map(
    (dayOfWeek) => createRequirementFor(scenario, dayOfWeek, morning, kitchen, 2)
  );
  scenario.employees = [
    createEmployee("emp-service-only-1", "Service", "OnlyOne"),
    createEmployee("emp-service-only-2", "Service", "OnlyTwo")
  ];
  scenario.employeeRoles = scenario.employees.map((employee) =>
    roleFor(`er-${employee.id}-service`, employee.id, scenario.roles[0])
  );
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 6, 8, 8)
  );

  return scenario;
}

function createFlexibleEmployeesScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("multi-role flexible employees", "medium");
  const service = scenario.roles[0];
  const kitchen = scenario.roles[1];
  const cashier = scenario.roles[2];
  const morning = scenario.shiftTemplates[0];
  scenario.staffingRequirements = ([1, 2, 3, 4, 5] as DayOfWeek[]).flatMap(
    (dayOfWeek) => [
      createRequirementFor(scenario, dayOfWeek, morning, service, 1),
      createRequirementFor(scenario, dayOfWeek, morning, kitchen, 1),
      createRequirementFor(scenario, dayOfWeek, morning, cashier, 1)
    ]
  );
  scenario.employees = [
    createEmployee("emp-service-specialist", "Service", "Specialist"),
    createEmployee("emp-kitchen-specialist", "Kitchen", "Specialist"),
    createEmployee("emp-cashier-specialist", "Cashier", "Specialist"),
    createEmployee("emp-flex-1", "Flexible", "One"),
    createEmployee("emp-flex-2", "Flexible", "Two"),
    createEmployee("emp-flex-3", "Flexible", "Three")
  ];
  scenario.employeeRoles = [
    roleFor("er-service-specialist", "emp-service-specialist", service),
    roleFor("er-kitchen-specialist", "emp-kitchen-specialist", kitchen),
    roleFor("er-cashier-specialist", "emp-cashier-specialist", cashier),
    ...["emp-flex-1", "emp-flex-2", "emp-flex-3"].flatMap((employeeId) => [
      roleFor(`er-${employeeId}-service`, employeeId, service),
      roleFor(`er-${employeeId}-kitchen`, employeeId, kitchen),
      roleFor(`er-${employeeId}-cashier`, employeeId, cashier)
    ])
  ];
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 6, 8, 8)
  );

  return scenario;
}

function createHighDemandSaturdayScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("high-demand Saturday", "hard");
  const [service, kitchen, cashier, bar, manager] = scenario.roles;
  const morning = scenario.shiftTemplates[0];
  const saturdayEvening = scenario.shiftTemplates[2];
  scenario.staffingRequirements = [
    createRequirementFor(scenario, 6, morning, service, 2),
    createRequirementFor(scenario, 6, morning, kitchen, 1),
    createRequirementFor(scenario, 6, morning, cashier, 1),
    createRequirementFor(scenario, 6, morning, bar, 2),
    createRequirementFor(scenario, 6, saturdayEvening, service, 3),
    createRequirementFor(scenario, 6, saturdayEvening, kitchen, 2),
    createRequirementFor(scenario, 6, saturdayEvening, cashier, 1),
    createRequirementFor(scenario, 6, saturdayEvening, bar, 2),
    createRequirementFor(scenario, 6, saturdayEvening, manager, 1)
  ];
  scenario.employees = [
    createEmployee("emp-service-1", "Service", "One"),
    createEmployee("emp-service-2", "Service", "Two"),
    createEmployee("emp-kitchen-1", "Kitchen", "One"),
    createEmployee("emp-kitchen-2", "Kitchen", "Two"),
    createEmployee("emp-cashier-1", "Cashier", "One"),
    createEmployee("emp-bar-1", "Bar", "One"),
    createEmployee("emp-bar-2", "Bar", "Two"),
    createEmployee("emp-manager-1", "Manager", "One"),
    createEmployee("emp-flex-sat", "Flexible", "Saturday")
  ];
  scenario.employeeRoles = [
    roleFor("er-service-1", "emp-service-1", service),
    roleFor("er-service-2", "emp-service-2", service),
    roleFor("er-kitchen-1", "emp-kitchen-1", kitchen),
    roleFor("er-kitchen-2", "emp-kitchen-2", kitchen),
    roleFor("er-cashier-1", "emp-cashier-1", cashier),
    roleFor("er-bar-1", "emp-bar-1", bar),
    roleFor("er-bar-2", "emp-bar-2", bar),
    roleFor("er-manager-1", "emp-manager-1", manager),
    roleFor("er-flex-service", "emp-flex-sat", service),
    roleFor("er-flex-bar", "emp-flex-sat", bar),
    roleFor("er-flex-cashier", "emp-flex-sat", cashier)
  ];
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 6, 8, 8)
  );

  return scenario;
}

function createConflictingAvailabilityScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("conflicting availability", "hard");
  const service = scenario.roles[0];
  const evening = scenario.shiftTemplates[1];
  scenario.staffingRequirements = ([1, 2, 3, 4, 5] as DayOfWeek[]).map(
    (dayOfWeek) => createRequirementFor(scenario, dayOfWeek, evening, service, 2)
  );
  scenario.employees = [
    createEmployee("emp-evening-1", "Evening", "One"),
    createEmployee("emp-morning-1", "Morning", "One"),
    createEmployee("emp-morning-2", "Morning", "Two"),
    createEmployee("emp-morning-3", "Morning", "Three")
  ];
  scenario.employeeRoles = scenario.employees.map((employee) =>
    roleFor(`er-${employee.id}-service`, employee.id, service)
  );
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 6, 6, 6)
  );
  scenario.employeeShiftAvailability = ([1, 2, 3, 4, 5] as DayOfWeek[]).flatMap(
    (dayOfWeek) =>
      ["emp-morning-1", "emp-morning-2", "emp-morning-3"].map((employeeId) =>
        createShiftAvailability(
          `sa-${employeeId}-${dayOfWeek}`,
          employeeId,
          dayOfWeek,
          evening.id,
          "cannot_work"
        )
      )
  );

  return scenario;
}

function createTimeWindowRestrictionScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("time-window restriction", "hard");
  const service = scenario.roles[0];
  const morning = createShiftTemplate(
    "shift-window-morning",
    "Window Morning",
    "08:00",
    "12:00"
  );
  const midday = createShiftTemplate(
    "shift-window-midday",
    "Window Midday",
    "11:00",
    "15:00"
  );
  scenario.shiftTemplates = [morning, midday];
  scenario.staffingRequirements = [
    createRequirementFor(scenario, 1, morning, service, 1),
    createRequirementFor(scenario, 1, midday, service, 1)
  ];
  scenario.employees = [
    createEmployee("emp-window-service", "Window", "Service")
  ];
  scenario.employeeRoles = [
    roleFor("er-window-service", "emp-window-service", service)
  ];
  scenario.employeeWorkRules = [
    createWorkRules("wr-window-service", "emp-window-service", 5, 8, 8)
  ];
  scenario.employeeTimeConstraints = [
    createTimeConstraint({
      id: "tc-window-service",
      employeeId: "emp-window-service",
      dayOfWeek: 1,
      startTime: "12:00",
      endTime: "16:00"
    })
  ];

  return scenario;
}

function createExplicitRoleScarcityScenario(): SchedulerBenchmarkScenario {
  const scenario = createScenarioBase("explicit role scarcity", "hard");
  const cashier = scenario.roles[2];
  const service = scenario.roles[0];
  const morning = scenario.shiftTemplates[0];
  scenario.staffingRequirements = ([1, 2, 3, 4, 5, 6] as DayOfWeek[]).flatMap(
    (dayOfWeek) => [
      createRequirementFor(scenario, dayOfWeek, morning, cashier, 2),
      createRequirementFor(scenario, dayOfWeek, morning, service, 1)
    ]
  );
  scenario.employees = [
    createEmployee("emp-cashier-only", "Cashier", "Only"),
    createEmployee("emp-service-1", "Service", "One"),
    createEmployee("emp-service-2", "Service", "Two"),
    createEmployee("emp-service-3", "Service", "Three"),
    createEmployee("emp-flex-cashier", "Flexible", "Cashier")
  ];
  scenario.employeeRoles = [
    roleFor("er-cashier-only", "emp-cashier-only", cashier),
    roleFor("er-service-1", "emp-service-1", service),
    roleFor("er-service-2", "emp-service-2", service),
    roleFor("er-service-3", "emp-service-3", service),
    roleFor("er-flex-service", "emp-flex-cashier", service)
  ];
  scenario.employeeWorkRules = scenario.employees.map((employee) =>
    createWorkRules(`wr-${employee.id}`, employee.id, 6, 8, 8)
  );

  return scenario;
}

function createRequirementFor(
  scenario: SchedulerBenchmarkScenario,
  dayOfWeek: DayOfWeek,
  shiftTemplate: ShiftTemplate,
  role: Role,
  requiredCount: number
): StaffingRequirement {
  return createStaffingRequirement({
    id: `req-${dayOfWeek}-${shiftTemplate.id}-${role.id}`,
    roleId: role.id,
    shiftTemplateId: shiftTemplate.id,
    startTime: shiftTemplate.start_time,
    endTime: shiftTemplate.end_time,
    requiredCount,
    dayOfWeek
  });
}

function roleFor(id: string, employeeId: string, role: Role): EmployeeRole {
  return createEmployeeRole(id, employeeId, role.id);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
