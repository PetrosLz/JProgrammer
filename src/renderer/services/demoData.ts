import { databaseApi } from "./databaseApi";
import type { CrudTableName, DayOfWeek } from "../types";

type RoleKey = "bar" | "waiter" | "kitchen" | "cashier" | "manager";
type ShiftKey = "morning" | "evening" | "saturdayEvening";
type EmployeeKey =
  | "maria"
  | "giorgos"
  | "eleni"
  | "nikos"
  | "anna"
  | "kostas"
  | "dimitris"
  | "sofia";

export type DemoDataResult = {
  employeeCount: number;
  roleCount: number;
  staffingRequirementCount: number;
};

const setupCompletedKey = "setup.completedAt";

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
    business_type: "Cafe",
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
  await createTimeOff(employees);
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
    const records = await databaseApi.listRecords(tableName, { limit: 10000 });

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
      break_minutes: 0,
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
      key: "anna",
      firstName: "Anna",
      lastName: "Georgiou",
      phone: "6900000005",
      email: "anna@example.local"
    },
    {
      key: "kostas",
      firstName: "Kostas",
      lastName: "Markou",
      phone: "6900000006",
      email: "kostas@example.local"
    },
    {
      key: "dimitris",
      firstName: "Dimitris",
      lastName: "Ioannou",
      phone: "6900000007",
      email: "dimitris@example.local"
    },
    {
      key: "sofia",
      firstName: "Sofia",
      lastName: "Markaki",
      phone: "6900000008",
      email: "sofia@example.local"
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
      skillLevel: number;
      canLeadRole?: boolean;
      isPreferredRole?: boolean;
    }>;
  }> = [
    {
      employee: "maria",
      roles: [
        { role: "manager", skillLevel: 5, canLeadRole: true },
        { role: "bar", skillLevel: 5, canLeadRole: true, isPreferredRole: true },
        { role: "cashier", skillLevel: 4, canLeadRole: true },
        { role: "waiter", skillLevel: 3 }
      ]
    },
    {
      employee: "giorgos",
      roles: [
        { role: "waiter", skillLevel: 4, canLeadRole: true, isPreferredRole: true },
        { role: "bar", skillLevel: 3 },
        { role: "cashier", skillLevel: 2 }
      ]
    },
    {
      employee: "eleni",
      roles: [
        { role: "waiter", skillLevel: 5, canLeadRole: true, isPreferredRole: true },
        { role: "manager", skillLevel: 3 },
        { role: "cashier", skillLevel: 3 },
        { role: "bar", skillLevel: 3 }
      ]
    },
    {
      employee: "nikos",
      roles: [
        { role: "kitchen", skillLevel: 5, canLeadRole: true, isPreferredRole: true },
        { role: "waiter", skillLevel: 2 }
      ]
    },
    {
      employee: "anna",
      roles: [
        { role: "bar", skillLevel: 4, canLeadRole: true, isPreferredRole: true },
        { role: "manager", skillLevel: 4, canLeadRole: true },
        { role: "cashier", skillLevel: 3 }
      ]
    },
    {
      employee: "kostas",
      roles: [
        { role: "kitchen", skillLevel: 4, canLeadRole: true, isPreferredRole: true },
        { role: "waiter", skillLevel: 3 },
        { role: "cashier", skillLevel: 2 }
      ]
    },
    {
      employee: "dimitris",
      roles: [
        { role: "bar", skillLevel: 3, isPreferredRole: true },
        { role: "kitchen", skillLevel: 3 },
        { role: "waiter", skillLevel: 2 }
      ]
    },
    {
      employee: "sofia",
      roles: [
        { role: "waiter", skillLevel: 3, isPreferredRole: true },
        { role: "cashier", skillLevel: 3 },
        { role: "bar", skillLevel: 2 }
      ]
    }
  ];

  for (const assignment of assignments) {
    for (const [index, roleAssignment] of assignment.roles.entries()) {
      await databaseApi.createRecord("employee_roles", {
        employee_id: employees[assignment.employee],
        role_id: roles[roleAssignment.role],
        is_primary: index === 0,
        skill_level: roleAssignment.skillLevel,
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
    targetDays: number;
    maxDays: number;
    targetHours: number;
    maxHours: number;
    maxConsecutiveDays: number;
    canWorkWeekends: boolean;
  }> = [
    { employee: "maria", targetDays: 5, maxDays: 6, targetHours: 38, maxHours: 48, maxConsecutiveDays: 5, canWorkWeekends: true },
    { employee: "giorgos", targetDays: 5, maxDays: 6, targetHours: 36, maxHours: 44, maxConsecutiveDays: 5, canWorkWeekends: true },
    { employee: "eleni", targetDays: 5, maxDays: 6, targetHours: 34, maxHours: 42, maxConsecutiveDays: 5, canWorkWeekends: true },
    { employee: "nikos", targetDays: 5, maxDays: 6, targetHours: 36, maxHours: 44, maxConsecutiveDays: 5, canWorkWeekends: true },
    { employee: "anna", targetDays: 5, maxDays: 6, targetHours: 34, maxHours: 42, maxConsecutiveDays: 5, canWorkWeekends: true },
    { employee: "kostas", targetDays: 5, maxDays: 6, targetHours: 34, maxHours: 42, maxConsecutiveDays: 5, canWorkWeekends: true },
    { employee: "dimitris", targetDays: 4, maxDays: 5, targetHours: 30, maxHours: 36, maxConsecutiveDays: 4, canWorkWeekends: true },
    { employee: "sofia", targetDays: 4, maxDays: 5, targetHours: 30, maxHours: 36, maxConsecutiveDays: 4, canWorkWeekends: true }
  ];

  for (const rule of workRules) {
    await databaseApi.createRecord("employee_work_rules", {
      employee_id: employees[rule.employee],
      min_days_per_week: 2,
      max_days_per_week: rule.maxDays,
      target_days_per_week: rule.targetDays,
      min_hours_per_week: 12,
      max_hours_per_week: rule.maxHours,
      target_hours_per_week: rule.targetHours,
      max_consecutive_days: rule.maxConsecutiveDays,
      can_work_weekends: rule.canWorkWeekends,
      max_shifts_per_week: rule.maxDays,
      min_hours_between_shifts: null,
      preferred_hours_per_week: rule.targetHours,
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
    { employee: "nikos", dayOfWeek: 5, type: "cannot_work", notes: "School" },
    { employee: "maria", dayOfWeek: 1, type: "prefers_to_work", notes: "Prefers Monday leadership shift" },
    { employee: "anna", dayOfWeek: 6, type: "prefers_to_work", notes: "Likes Saturday shifts" },
    { employee: "eleni", dayOfWeek: 6, type: "prefers_not_to_work", notes: "Avoid Saturday when possible" },
    { employee: "kostas", dayOfWeek: 0, type: "prefers_not_to_work", notes: "Avoid Sunday when possible" },
    { employee: "dimitris", dayOfWeek: 4, type: "prefers_to_work", notes: "Prefers Thursday" },
    { employee: "sofia", dayOfWeek: 2, type: "prefers_not_to_work", notes: "Avoid Tuesday when possible" }
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
      employee: "maria",
      days: [1, 2, 3, 4, 5],
      shifts: ["evening"],
      type: "cannot_work",
      notes: "Demo: Maria is mostly morning-only on weekdays"
    },
    {
      employee: "maria",
      days: [6],
      shifts: ["saturdayEvening"],
      type: "cannot_work",
      notes: "Demo: Maria avoids Saturday late shifts"
    },
    {
      employee: "giorgos",
      days: [1, 2, 3, 4, 5],
      shifts: ["morning"],
      type: "cannot_work",
      notes: "Demo: Giorgos attends classes in the morning"
    },
    {
      employee: "giorgos",
      days: [1, 2, 3, 4, 5],
      shifts: ["evening"],
      type: "prefers_to_work",
      notes: "Demo: Giorgos prefers weekday evenings"
    },
    {
      employee: "eleni",
      days: [6],
      shifts: ["saturdayEvening"],
      type: "cannot_work",
      notes: "Demo: Eleni cannot work Saturday evening"
    },
    {
      employee: "anna",
      days: [6],
      shifts: ["saturdayEvening"],
      type: "prefers_to_work",
      notes: "Demo: Anna prefers Saturday evening"
    },
    {
      employee: "dimitris",
      days: [1, 2, 3, 4, 5],
      shifts: ["evening"],
      type: "prefers_not_to_work",
      notes: "Demo: Dimitris prefers to avoid weekday evenings"
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

async function createTimeOff(employees: Record<EmployeeKey, string>): Promise<void> {
  const entries: Array<{
    employee: EmployeeKey;
    type: string;
    startDate: string;
    endDate: string;
    reason: string;
  }> = [
    {
      employee: "sofia",
      type: "vacation",
      startDate: "2026-05-15",
      endDate: "2026-05-16",
      reason: "Demo vacation"
    },
    {
      employee: "nikos",
      type: "personal",
      startDate: "2026-05-13",
      endDate: "2026-05-13",
      reason: "Demo personal day"
    }
  ];

  for (const entry of entries) {
    await databaseApi.createRecord("time_off", {
      employee_id: employees[entry.employee],
      type: entry.type,
      start_date: entry.startDate,
      end_date: entry.endDate,
      reason: entry.reason,
      status: "recorded",
      notes: null
    });
  }
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
    priority = "normal"
  }: {
    dayOfWeek: DayOfWeek;
    shift: ShiftKey;
    role: RoleKey;
    requiredCount: number;
    priority?: string;
  }) {
    const time = shiftTime(shift);
    await databaseApi.createRecord("staffing_requirements", {
      day_of_week: dayOfWeek,
      shift_template_id: shifts[shift],
      role_id: roles[role],
      start_time: time.startTime,
      end_time: time.endTime,
      required_count: requiredCount,
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
    await addRequirement({ dayOfWeek, shift: "morning", role: "kitchen", requiredCount: 1 });
    await addRequirement({ dayOfWeek, shift: "evening", role: "bar", requiredCount: 1 });
    await addRequirement({ dayOfWeek, shift: "evening", role: "waiter", requiredCount: 1 });
  }

  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "bar", requiredCount: 2, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "waiter", requiredCount: 2, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "kitchen", requiredCount: 1 });
  await addRequirement({ dayOfWeek: 6, shift: "morning", role: "cashier", requiredCount: 1 });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "bar", requiredCount: 2, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "waiter", requiredCount: 2, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "kitchen", requiredCount: 2, priority: "high" });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "cashier", requiredCount: 1 });
  await addRequirement({ dayOfWeek: 6, shift: "saturdayEvening", role: "manager", requiredCount: 1, priority: "high" });

  await addRequirement({ dayOfWeek: 0, shift: "morning", role: "bar", requiredCount: 1 });
  await addRequirement({ dayOfWeek: 0, shift: "morning", role: "waiter", requiredCount: 1 });
  await addRequirement({ dayOfWeek: 0, shift: "morning", role: "kitchen", requiredCount: 1 });
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
