import type {
  BusinessSettings,
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
  ScheduleWarning,
  ShiftTemplate,
  SpecialDay,
  StaffingRequirement,
  TimeOff
} from "../../types";

export type DashboardSummary = {
  businessSettings: BusinessSettings | null;
  openingHours: OpeningHours[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  specialDays: SpecialDay[];
  staffingRequirements: StaffingRequirement[];
  scheduleRuns: ScheduleRun[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  scheduleWarnings: ScheduleWarning[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  employeeTimeConstraints: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  setupCompletedAt: string | null;
};

export const emptySummary: DashboardSummary = {
  businessSettings: null,
  openingHours: [],
  roles: [],
  shiftTemplates: [],
  specialDays: [],
  staffingRequirements: [],
  scheduleRuns: [],
  scheduleSlots: [],
  scheduleAssignments: [],
  scheduleWarnings: [],
  employees: [],
  employeeRoles: [],
  employeeWorkRules: [],
  employeeDayConstraints: [],
  employeeShiftAvailability: [],
  employeeTimeConstraints: [],
  timeOff: [],
  setupCompletedAt: null
};
