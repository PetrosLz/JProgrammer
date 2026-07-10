export type SchedulerStopReason =
  | "perfect_schedule"
  | "no_improvement"
  | "time_budget"
  | "attempt_limit";

export type OptimizationConfig = {
  attempts: number;
  maxRepairIterations: number;
  timeBudgetMs: number;
  minimumAttemptsBeforeEarlyStop: number;
  noImprovementAttemptLimit: number;
  rewardImprovementTolerance: number;
  repairNoImprovementLimit: number;
};

export const defaultSchedulerOptimizationConfig: OptimizationConfig = {
  attempts: 300,
  maxRepairIterations: 600,
  timeBudgetMs: 15000,
  minimumAttemptsBeforeEarlyStop: 14,
  noImprovementAttemptLimit: 28,
  rewardImprovementTolerance: 1,
  repairNoImprovementLimit: 2
};
