export type OptimizationConfig = {
  attempts: number;
  maxRepairIterations: number;
  timeBudgetMs: number;
};

export const defaultSchedulerOptimizationConfig: OptimizationConfig = {
  attempts: 300,
  maxRepairIterations: 600,
  timeBudgetMs: 15000
};
