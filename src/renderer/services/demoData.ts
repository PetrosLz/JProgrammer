import { databaseApi } from "./databaseApi";
import {
  experienceLevelToLegacySkillLevel,
  type CrudTableName,
  type DayOfWeek,
  type ExperienceLevel,
  type StaffingPriority
} from "../types";

type RoleKey = "bar" | "waiter" | "kitchen" | "cashier" | "manager";
type ShiftKey = "morning" | "evening" | "saturdayEvening";
type EmployeeKey =
  | "maria"
  | "giorgos"
  | "eleni"
  | "nikos"
  | "sofia"
  | "kostas"
  | "anna"
  | "dimitris";

export type DemoDataResult = {
  employeeCount: number;
  roleCount: number;
  staffingRequirementCount: number;
};

const setupCompletedKey = "setup.completedAt";
const demoCleanupBatchSize = 10000;

const deleteOrder: CrudTableName[] = [
  "schedule_warnings",
  "schedule_assignments",
  "schedule_slots",
  "schedule_runs",
  "time_off",
  "employee_time_constraints",
  "employee_shift_availability",
  "employee_day_constraints",
  "employee_work_rules",
  "employee_roles",
  "employees",
  "special_day_staffing_requirements",
  "special_days",
  "staffing_requirements",
  "shift_templates",
  "roles",
  "opening_hours",
  "business_settings"
];

export async function loadDemoData(): Promise<DemoDataResult> {
  await clearDemoTables();

  await databaseApi.createRecord("business_settings", {
    business_name: "Demo Cafe",
    business_type: "Cafe / bar",
    location: "Athens",
    timezone: "Europe/Athens",
    week_starts_on: 1,
    language: "el",
    locale: "el-GR",
    currency: "EUR"
  });

  await createOpeningHours();
  const roles = await createRoles();
  const shifts = await createShiftTemplates();
  const employees = await createEmployees();
  await createEmployeeRoles(employees, roles);
  await createEmployeeWorkRules(employees);
  await createEmployeeConstraints(employees);
  await createEmployeeShiftAvailability(employees, shifts);
  await createTimeOff();
  const staffingRequirementCount = await createStaffingRequirements(
    roles,
    shifts
  );

  await databaseApi.setSetting(setupCompletedKey, new Date().toISOString());
  await databaseApi.setSetting("demo.loadedAt", new Date().toISOString());

  return {
    employeeCount: Object.keys(employees).length,
    roleCount: Object.keys(roles).length,
    staffingRequirementCount
  };
}

async function clearDemoTables(): Promise<void> {
  for (const tableName of deleteOrder) {
    await deleteAllRecords(tableName);
  }
}

async function deleteAllRecords(tableName: CrudTableName): Promise<void> {
  while (true) {
    const records = await databaseApi.listRecords(tableName, {
      limit: demoCleanupBatchSize
    });

    if (records.length === 0) {
      return;
    }

    for (const record of records) {
      await databaseApi.deleteRecord(tableName, record.id);
    }
  }
}

async function createOpeningHours(): Promise<void> {
  const rows: Array<{
    dayOfWeek: DayOfWeek;
    openTime: string;
    closeTime: string;
    isOvernight: boolean;
  }> = [
    { dayOfWeek: 1, openTime: "08:00", closeTime: "22:00", isOvernight: false },
    { dayOfWeek: 2, openTime: "08:00", closeTime: "22:00", isOvernight: false },
    { dayOfWeek: 3, openTime: "08:00", closeTime: "22:00", isOvernight: false },
    { dayOfWeek: 4, openTime: "08:00", closeTime: "22:00", isOvernight: false },
    { dayOfWeek: 5, openTime: "08:00", closeTime: "22:00", isOvernight: false },
    { dayOfWeek: 6, openTime: "08:00", closeTime: "00:00", isOvernight: true },
    { dayOfWeek: 0, openTime: "10:00", closeTime: "20:00", isOvernight: false }
  ];

  for (const row of rows) {
    await databaseApi.createRecord("opening_hours", {
      day_of_week: row.dayOfWeek,
      is_open: true,
      open_time: row.openTime,
      close_time: row.closeTime,
      is_overnight: row.isOvernight,
      notes: null
    });
  }
}

async function createRoles(): Promise<Record<RoleKey, string>> {
  const roleRows: Array<{
    key: RoleKey;
    name: string;
    color: string;
    description: string;
  }> = [
    { key: "bar", name: "Bar", color: "#2563eb", description: "Coffee and drinks" },
    { key: "waiter", name: "Waiter", color: "#0f766e", description: "Floor service" },
    { key: "kitchen", name: "Kitchen", color: "#dc2626", description: "Kitchen prep" },
    { key: "cashier", name: "Cashier", color: "#ca8a04", description: "POS and payments" },
    { key: "manager", name: "Manager", color: "#9333ea", description: "Shift lead" }
  ];
  const roles = {} as Record<RoleKey, string>;

  for (const row of roleRows) {
    const role = await databaseApi.createRecord("roles", {
      name: row.name,
      color: row.color,
      description: row.description,
      is_active: true
    });
    roles[row.key] = role.id;
  }

  return roles;
}

async function createShiftTemplates(): Promise<Record<ShiftKey, string>> {
  const shiftRows: Array<{
    key: ShiftKey;
    name: string;
    startTime: string;
    endTime: string;
    isOvernight: boolean;
    color: string;
  }> = [
    {
      key: "morning",
      name: "Morning",
      startTime: "08:00",
      endTime: "16:00",
      isOvernight: false,
      color: "#0f766e"
    },
    {
      key: "evening",
      name: "Evening",
      startTime: "16:00",
      endTime: "22:00",
      isOvernight: false,
      color: "#2563eb"
    },
    {
      key: "saturdayEvening",
      name: "Saturday Evening",
      startTime: "16:00",
      endTime: "00:00",
      isOvernight: true,
      color: "#9333ea"
    }
  ];
  const shifts = {} as Record<ShiftKey, string>;

  for (const row of shiftRows) {
    const shift = await databaseApi.createRecord("shift_templates", {
      name: row.name,
      role_id: null,
      start_time: row.startTime,
      end_time: row.endTime,
      is_overnight: row.isOvernight,
      color: row.color,
      notes: null,
      is_active: true
    });
    shifts[row.key] = shift.id;
  }

  return shifts;
}

async function createEmployees(): Promise<Record<EmployeeKey, string>> {
  const employeeRows: Array<{
    key: EmployeeKey;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
  }> = [
    {
      key: "maria",
      firstName: "Maria",
      lastName: "Papadopoulou",
      phone: "6900000001",
      email: "maria@example.local"
    },
    {
      key: "giorgos",
      firstName: "Giorgos",
      lastName: "Antoniou",
      phone: "6900000002",
      email: "giorgos@example.local"
    },
    {
      key: "eleni",
      firstName: "Eleni",
      lastName: "Nikolaou",
      phone: "6900000003",
      email: "eleni@example.local"
    },
    {
      key: "nikos",
      firstName: "Nikos",
      lastName: "Stavrou",
      phone: "6900000004",
      email: "nikos@example.local"
    },
    {
      key: "sofia",
      firstName: "Sofia",
      lastName: "Markaki",
      phone: "6900000005",
      email: "sofia@example.local"
    },
    {
      key: "kostas",
      firstName: "Kostas",
      lastName: "Markou",
      phone: "6900000006",
      email: "kostas@example.local"
    },
    {
      key: "anna",
      firstName: "Anna",
      lastName: "Georgiou",
      phone: "6900000007",
      email: "anna@example.local"
    },
    {
      key: "dimitris",
      firstName: "Dimitris",
      lastName: "Ioannou",
      phone: "6900000008",
      email: "dimitris@example.local"
    }
  ];
  const employees = {} as Record<EmployeeKey, string>;

  for (const row of employeeRows) {
    const employee = await databaseApi.createRecord("employees", {
      first_name: row.firstName,
      last_name: row.lastName,
      phone: row.phone,
      email: row.email,
      is_active: true,
      notes: "Demo employee"
    });
    employees[row.key] = employee.id;
  }

  return employees;
}

async function createEmployeeRoles(
  employees: Record<EmployeeKey, string>,
  roles: Record<RoleKey, string>
): Promise<void> {
  const assignments: Array<{
    employee: EmployeeKey;
    roles: Array<{
      role: RoleKey;
      experienceLevel: ExperienceLevel;
      canLeadRole?: boolean;
      isPreferredRole?: boolean;
    }>;
  }> = [
    {
      employee: "maria",
      roles: [
        { role: "cashier", experienceLevel: "some_experience", canLeadRole: true, isPreferredRole: true },
        { role: "bar", experienceLevel: "some_experience" }
      ]
    },
    {
      employee: "giorgos",
      roles: [
        { role: "bar", experienceLevel: "some_experience", canLeadRole: true, isPreferredRole: true }
      ]
    },
    {
      employee: "eleni",
      roles: [
        { role: "waiter", experienceLevel: "some_experience", canLeadRole: true, isPreferredRole: true }
      ]
    },
    {
      employee: "nikos",
      roles: [
        { role: "kitchen", experienceLevel: "some_experience", canLeadRole: true, isPreferredRole: true }
      ]
    },
    {
      employee: "anna",
      roles: [
        { role: "bar", experienceLevel: "some_experience", isPreferredRole: true },
        { role: "manager", experienceLevel: "some_experience", canLeadRole: true }
      ]
    },
    {
      employee: "kostas",
      roles: [
        { role: "kitchen", experienceLevel: "some_experience", isPreferredRole: true },
        { role: "waiter", experienceLevel: "no_experience" }
      ]
    },
    {
      employee: "dimitris",
      roles: [
        { role: "waiter", experienceLevel: "some_experience", isPreferredRole: true },
        { role: "cashier", experienceLevel: "some_experience" }
      ]
    },
    {
      employee: "sofia",
      roles: [
        { role: "waiter", experienceLevel: "some_experience", isPreferredRole: true }
      ]
    }
  ];

  for (const assignment of assignments) {
    for (const [index, roleAssignment] of assignment.roles.entries()) {
      await databaseApi.createRecord("employee_roles", {
        employee_id: employees[assignment.employee],
        role_id: roles[roleAssignment.role],
        is_primary: index === 0,
        experience_level: roleAssignment.experienceLevel,
        skill_level: experienceLevelToLegacySkillLevel(
          roleAssignment.experienceLevel
        ),
        can_lead_role: Boolean(roleAssignment.canLeadRole),
        is_preferred_role: Boolean(roleAssignment.isPreferredRole)
      });
    }
  }
}

async function createEmployeeWorkRules(
  employees: Record<EmployeeKey, string>
): Promise<void> {
  const workRules: Array<{
    employee: EmployeeKey;
    maxShiftsPerWeek: number;
    maxHoursPerDay: number;
    targetHoursPerDay: number;
    canWorkWeekends: boolean;
  }> = [
    { employee: "maria", maxShiftsPerWeek: 5, maxHoursPerDay: 8, targetHoursPerDay: 8, canWorkWeekends: true },
    { employee: "giorgos", maxShiftsPerWeek: 5, maxHoursPerDay: 8, targetHoursPerDay: 8, canWorkWeekends: false },
    { employee: "eleni", maxShiftsPerWeek: 5, maxHoursPerDay: 6, targetHoursPerDay: 6, canWorkWeekends: true },
    { employee: "nikos", maxShiftsPerWeek: 5, maxHoursPerDay: 8, targetHoursPerDay: 8, canWorkWeekends: true },
    { employee: "anna", maxShiftsPerWeek: 5, maxHoursPerDay: 6, targetHoursPerDay: 6, canWorkWeekends: true },
    { employee: "kostas", maxShiftsPerWeek: 8, maxHoursPerDay: 8, targetHoursPerDay: 8, canWorkWeekends: true },
    { employee: "dimitris", maxShiftsPerWeek: 4, maxHoursPerDay: 8, targetHoursPerDay: 8, canWorkWeekends: false },
    { employee: "sofia", maxShiftsPerWeek: 4, maxHoursPerDay: 6, targetHoursPerDay: 6, canWorkWeekends: true }
  ];

  for (const rule of workRules) {
    await databaseApi.createRecord("employee_work_rules", {
      employee_id: employees[rule.employee],
      max_shifts_per_week: rule.maxShiftsPerWeek,
      max_hours_per_day: rule.maxHoursPerDay,
      target_hours_per_day: rule.targetHoursPerDay,
      can_work_weekends: rule.canWorkWeekends,
      notes: "Demo work rules"
    });
  }
}

async function createEmployeeConstraints(
  employees: Record<EmployeeKey, string>
): Promise<void> {
  const constraints: Array<{
    employee: EmployeeKey;
    dayOfWeek: DayOfWeek;
    type: string;
    notes: string;
  }> = [
    { employee: "giorgos", dayOfWeek: 0, type: "cannot_work", notes: "Family day" },
    { employee: "dimitris", dayOfWeek: 0, type: "cannot_work", notes: "Family day" }
  ];

  for (const constraint of constraints) {
    await databaseApi.createRecord("employee_day_constraints", {
      employee_id: employees[constraint.employee],
      day_of_week: constraint.dayOfWeek,
      constraint_type: constraint.type,
      notes: constraint.notes
    });
  }
}

async function createEmployeeShiftAvailability(
  employees: Record<EmployeeKey, string>,
  shifts: Record<ShiftKey, string>
): Promise<void> {
  const rows: Array<{
    employee: EmployeeKey;
    days: DayOfWeek[];
    shifts: ShiftKey[];
    type: string;
    notes: string;
  }> = [
    {
      employee: "eleni",
      days: [1, 2, 3, 4, 5],
      shifts: ["morning"],
      type: "cannot_work",
      notes: "Demo: Eleni can only work weekday evenings"
    },
    {
      employee: "eleni",
      days: [1, 2, 3, 4, 5],
      shifts: ["evening"],
      type: "prefers_to_work",
      notes: "Demo: Eleni prefers weekday evenings"
    },
    {
      employee: "eleni",
      days: [6],
      shifts: ["saturdayEvening"],
      type: "available",
      notes: "Demo: Eleni can work Saturday evening if needed"
    },
    {
      employee: "sofia",
      days: [1, 2, 3, 4, 5],
      shifts: ["morning"],
      type: "prefers_to_work",
      notes: "Demo: Sofia prefers weekday mornings"
    },
    {
      employee: "sofia",
      days: [1, 2, 3, 4, 5],
      shifts: ["evening"],
      type: "cannot_work",
      notes: "Demo: Sofia cannot work weekday evenings"
    },
    {
      employee: "sofia",
      days: [0],
      shifts: ["morning"],
      type: "available",
      notes: "Demo: Sofia can work Sunday morning"
    },
    {
      employee: "anna",
      days: [6],
      shifts: ["saturdayEvening"],
      type: "prefers_to_work",
      notes: "Demo: Anna prefers Saturday evening"
    }
  ];

  for (const row of rows) {
    for (const dayOfWeek of row.days) {
      for (const shiftKey of row.shifts) {
        await databaseApi.createRecord("employee_shift_availability", {
          employee_id: employees[row.employee],
          day_of_week: dayOfWeek,
          shift_template_id: shifts[shiftKey],
          availability_type: row.type,
          notes: row.notes
        });
      }
    }
  }
}

async function createTimeOff(): Promise<void> {
  // Keep demo absences empty so the availability examples stay easy to inspect.
}

async function createStaffingRequirements(
  roles: Record<RoleKey, string>,
  shifts: Record<ShiftKey, string>
): Promise<number> {
  let count = 0;

  async function addRequirement({
    dayOfWeek,
    shift,
    role,
    requiredCount,
    minimumExperienceLevel = "no_experience",
    experiencedRequiredCount = 0,
    priority = "normal"
  }: {
    dayOfWeek: DayOfWeek;
    shift: ShiftKey;
    role: RoleKey;
    requiredCount: number;
    minimumExperienceLevel?: ExperienceLevel;
    experiencedRequiredCount?: number;
    priority?: StaffingPriority;
  }) {
    const time = shiftTime(shift);
    await databaseApi.createRecord("staffing_requirements", {
      day_of_week: dayOfWeek,
      shift_template_id: shifts[shift],
      role_id: roles[role],
      start_time: time.startTime,
      end_time: time.endTime,
      required_count: requiredCount,
      minimum_experience_level: minimumExperienceLevel,
      experienced_required_count: experiencedRequiredCount,
      priority,
      is_active: true,
      notes: "Demo requirement"
    });
    count += 1;
  }

  const weekdays: DayOfWeek[] = [1, 2, 3, 4, 5];
  for (const dayOfWeek of weekdays) {
    await addRequirement({ dayOfWeek, shift: "morning", role: "bar", requiredCount: 1 });
    await addRequirement({ dayOfWeek, shift: "morning", role: "waiter", requiredCount: 1 });
    await addRequirement({ dayOfWeek, shift: "morning", role: "kitchen", requiredCount: 1, minimumExperienceLevel: "some_experience" });
    await addRequirement({ dayOfWeek, shift: "evening", role: "bar", requiredCount: 1 });
    await addRequirement({ dayOfWeek, shift: "evening", role: "waiter", requiredCount: 1 });
  }

  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "bar", requiredCount: 2, experiencedRequiredCount: 1, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "waiter", requiredCount: 2, experiencedRequiredCount: 1, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "kitchen", requiredCount: 1, minimumExperienceLevel: "some_experience" });
  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "cashier", requiredCount: 1, minimumExperienceLevel: "some_experience" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "bar", requiredCount: 2, experiencedRequiredCount: 1, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "waiter", requiredCount: 3, experiencedRequiredCount: 1, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "kitchen", requiredCount: 2, minimumExperienceLevel: "some_experience", experiencedRequiredCount: 1, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "cashier", requiredCount: 1, minimumExperienceLevel: "some_experience" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "manager", requiredCount: 1, minimumExperienceLevel: "some_experience", priority: "high" });

  await addRequirement({ dayOfWeek: 0, shift: "morning", role: "bar", requiredCount: 1 });
  await addRequirement({ dayOfWeek: 0, shift: "morning", role: "waiter", requiredCount: 1 });
  await addRequirement({ dayOfWeek: 0, shift: "morning", role: "kitchen", requiredCount: 1, minimumExperienceLevel: "some_experience" });
  await addRequirement({ dayOfWeek: 0, shift: "evening", role: "waiter", requiredCount: 1 });

  return count;
}

function shiftTime(shift: ShiftKey): { startTime: string; endTime: string } {
  if (shift === "morning") {
    return { startTime: "08:00", endTime: "16:00" };
  }

  if (shift === "saturdayEvening") {
    return { startTime: "16:00", endTime: "00:00" };
  }

  return { startTime: "16:00", endTime: "22:00" };
}
