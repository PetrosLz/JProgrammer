import type {
  DayOfWeek,
  ExperienceLevel,
  ScheduleAssignmentSource,
  SqlBoolean
} from "./types";

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
  pythonVersion: string | null;
  ortoolsAvailable: boolean;
  ortoolsVersion: string | null;
  message: string | null;
};

export type CpSatSolveEmployee = {
  id: string;
  isActive: boolean;
  maxShiftsPerWeek: number;
  maxHoursPerDayMinutes: number;
  targetHoursPerDayMinutes: number | null;
  canWorkWeekends: boolean;
};

export type CpSatSolveEmployeeRole = {
  employeeId: string;
  roleId: string;
  experienceLevel: ExperienceLevel;
  isPreferredRole: boolean;
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
  preferenceScore: number;
};

export type CpSatExistingAssignment = {
  employeeId: string;
  slotId: string;
  locked: boolean;
};

export type CpSatHint = {
  employeeId: string;
  slotId: string;
};

export type CpSatHintDiagnostics = {
  received: number;
  accepted: number;
  ignored: number;
};

export type CpSatAttemptTelemetry = {
  attempted: boolean;
  status: CpSatSolveStatus | null;
  runtimeMs: number | null;
  hintDiagnostics: CpSatHintDiagnostics;
  pythonVersion: string | null;
  ortoolsVersion: string | null;
  failureOrFallbackReason: string | null;
};

export type CpSatObjectiveStageResult = {
  value: number | null;
  status: CpSatSolveStatus;
  provenOptimal: boolean;
};

export type CpSatObjectiveStages = {
  coverage: CpSatObjectiveStageResult;
  targetHours?: CpSatObjectiveStageResult;
  shiftFairness?: CpSatObjectiveStageResult;
  minuteFairness?: CpSatObjectiveStageResult;
  preferences?: CpSatObjectiveStageResult;
  stability?: CpSatObjectiveStageResult;
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
  hints: CpSatHint[];
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
  coverageProvenOptimal: boolean;
  fullLexicographicOptimality: boolean;
  objectiveStages: CpSatObjectiveStages;
  hintDiagnostics: CpSatHintDiagnostics;
  pythonVersion: string | null;
  ortoolsVersion: string | null;
  runtimeMs: number;
  message: string | null;
};

export type CpSatTelemetry = {
  engine: OptimizerEngine;
  solverStatus: CpSatSolveStatus;
  runtimeMs: number | null;
  coveredSlots: number | null;
  totalSlots: number | null;
  coverageRate: number | null;
  coverageProvenOptimal: boolean;
  fullLexicographicOptimality: boolean;
  objectiveStages: CpSatObjectiveStages | null;
  hintDiagnostics: CpSatHintDiagnostics;
  previousAssignmentHintCount: number;
  warmStartHintCount: number;
  ignoredPreviousAssignmentHintCount: number;
  cpSatAttempt: CpSatAttemptTelemetry;
  pythonVersion: string | null;
  ortoolsVersion: string | null;
  fallbackReason: string | null;
};

export type CpSatPersistedAssignment = {
  scheduleSlotId: string;
  employeeId: string;
  isManualOverride: SqlBoolean;
  isLocked: SqlBoolean;
  source: ScheduleAssignmentSource;
};
