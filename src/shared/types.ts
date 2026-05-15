export const databaseTableNames = [
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
  "employee_time_constraints",
  "time_off",
  "schedule_runs",
  "schedule_slots",
  "schedule_assignments",
  "schedule_warnings",
  "settings"
] as const;

export type DatabaseTableName = (typeof databaseTableNames)[number];
export type CrudTableName = Exclude<DatabaseTableName, "settings">;
export type DbValue = string | number | boolean | null;
export type DbStoredValue = string | number | null;
export type DatabaseRecordInput = Record<string, DbValue | undefined>;
export type DatabaseRecordUpdate = Record<string, DbValue | undefined>;
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type SqlBoolean = 0 | 1;

export interface EntityBase {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface BusinessSettings extends EntityBase {
  business_name: string;
  timezone: string;
  week_starts_on: DayOfWeek;
  locale: string;
  currency: string;
}

export interface OpeningHours extends EntityBase {
  day_of_week: DayOfWeek;
  is_open: SqlBoolean;
  open_time: string | null;
  close_time: string | null;
  notes: string | null;
}

export interface Role extends EntityBase {
  name: string;
  color: string | null;
  description: string | null;
  is_active: SqlBoolean;
}

export interface ShiftTemplate extends EntityBase {
  name: string;
  role_id: string | null;
  start_time: string;
  end_time: string;
  break_minutes: number;
  color: string | null;
  notes: string | null;
  is_active: SqlBoolean;
}

export interface StaffingRequirement extends EntityBase {
  day_of_week: DayOfWeek;
  role_id: string;
  start_time: string;
  end_time: string;
  required_count: number;
  notes: string | null;
}

export interface SpecialDay extends EntityBase {
  date: string;
  name: string;
  is_closed: SqlBoolean;
  notes: string | null;
}

export interface SpecialDayStaffingRequirement extends EntityBase {
  special_day_id: string;
  role_id: string;
  start_time: string;
  end_time: string;
  required_count: number;
  notes: string | null;
}

export interface Employee extends EntityBase {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  is_active: SqlBoolean;
  notes: string | null;
}

export interface EmployeeRole extends EntityBase {
  employee_id: string;
  role_id: string;
  is_primary: SqlBoolean;
}

export interface EmployeeWorkRules extends EntityBase {
  employee_id: string;
  max_hours_per_week: number | null;
  max_shifts_per_week: number | null;
  max_days_per_week: number | null;
  min_hours_between_shifts: number | null;
  preferred_hours_per_week: number | null;
  notes: string | null;
}

export interface EmployeeDayConstraint extends EntityBase {
  employee_id: string;
  day_of_week: DayOfWeek;
  constraint_type: string;
  notes: string | null;
}

export interface EmployeeTimeConstraint extends EntityBase {
  employee_id: string;
  date: string | null;
  day_of_week: DayOfWeek | null;
  start_time: string;
  end_time: string;
  constraint_type: string;
  notes: string | null;
}

export interface TimeOff extends EntityBase {
  employee_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  notes: string | null;
}

export interface ScheduleRun extends EntityBase {
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  parameters_json: string | null;
  completed_at: string | null;
}

export interface ScheduleSlot extends EntityBase {
  schedule_run_id: string;
  date: string;
  role_id: string;
  start_time: string;
  end_time: string;
  required_count: number;
  source_type: string | null;
  source_id: string | null;
  notes: string | null;
}

export interface ScheduleAssignment extends EntityBase {
  schedule_run_id: string;
  schedule_slot_id: string;
  employee_id: string;
  status: string;
  notes: string | null;
}

export interface ScheduleWarning extends EntityBase {
  schedule_run_id: string;
  schedule_slot_id: string | null;
  schedule_assignment_id: string | null;
  severity: string;
  warning_type: string;
  message: string;
}

export interface SettingRecord {
  key: string;
  value: string;
  updated_at: string;
}

export interface DatabaseEntityMap {
  business_settings: BusinessSettings;
  opening_hours: OpeningHours;
  roles: Role;
  shift_templates: ShiftTemplate;
  staffing_requirements: StaffingRequirement;
  special_days: SpecialDay;
  special_day_staffing_requirements: SpecialDayStaffingRequirement;
  employees: Employee;
  employee_roles: EmployeeRole;
  employee_work_rules: EmployeeWorkRules;
  employee_day_constraints: EmployeeDayConstraint;
  employee_time_constraints: EmployeeTimeConstraint;
  time_off: TimeOff;
  schedule_runs: ScheduleRun;
  schedule_slots: ScheduleSlot;
  schedule_assignments: ScheduleAssignment;
  schedule_warnings: ScheduleWarning;
  settings: SettingRecord;
}

export interface ListRecordsOptions {
  limit?: number;
  offset?: number;
}

export interface DatabaseStatus {
  databasePath: string;
  initialized: boolean;
  tableCounts: Record<DatabaseTableName, number>;
}

export interface DatabaseApiErrorPayload {
  code: string;
  message: string;
}

export type DatabaseResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: DatabaseApiErrorPayload;
    };
