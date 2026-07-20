import type { DayOfWeek, ExperienceLevel, SqlBoolean } from "./types";

export const cpSatSolveStatuses = [
  "OPTIMAL",
  "FEASIBLE",
  "INFEASIBLE",
  "MODEL_INVALID",
  "UNKNOWN",
  "HEURISTIC_FALLBACK"
] as const;

export type CpSatSolveStatus = (typeof cpSatSolveStatuses)[number];

export type OptimizerEngine = "cp_sat" | "heuristic_fallback";

export type SolverAvailability = {
  available: boolean;
  pythonExecutable: string | null;
  ortoolsAvailable: boolean;
  message: string | null;
};

export type CpSatSolveEmployee = {
  id: string;
  isActive: boolean;
  maxShiftsPerWeek: number;
  maxHoursPerDayMinutes: number;
  canWorkWeekends: boolean;
};

export type CpSatSolveEmployeeRole = {
  employeeId: string;
  roleId: string;
  experienceLevel: ExperienceLevel;
};

export type CpSatSolveSlot = {
  id: string;
  requirementGroupId: string;
  date: string;
  roleId: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  absoluteStartMinute: number;
  absoluteEndMinute: number;
  minimumExperienceLevel: ExperienceLevel;
  experiencedRequiredCount: number;
};

export type CpSatSolveEligibility = {
  employeeId: string;
  slotId: string;
};

export type CpSatExistingAssignment = {
  employeeId: string;
  slotId: string;
  locked: boolean;
};

export type CpSatSolveRequest = {
  requestId: string;
  schedule: {
    runId: string;
    weekStartsOn: DayOfWeek;
  };
  employees: CpSatSolveEmployee[];
  employeeRoles: CpSatSolveEmployeeRole[];
  slots: CpSatSolveSlot[];
  eligibility: CpSatSolveEligibility[];
  existingAssignments: CpSatExistingAssignment[];
  timeoutSeconds: number;
};

export type CpSatAssignment = {
  scheduleSlotId: string;
  employeeId: string;
};

export type CpSatSolveResult = {
  requestId: string;
  assignments: CpSatAssignment[];
  status: CpSatSolveStatus;
  objectiveValues: {
    coveredSlots: number;
    totalSlots: number;
    coverageRate: number;
  };
  runtimeMs: number;
  message: string | null;
};

export type CpSatTelemetry = {
  engine: OptimizerEngine;
  solverStatus: CpSatSolveStatus;
  runtimeMs: number | null;
  coveredSlots: number | null;
  totalSlots: number | null;
  fallbackReason: string | null;
};

export type CpSatPersistedAssignment = {
  scheduleSlotId: string;
  employeeId: string;
  isManualOverride: SqlBoolean;
};
