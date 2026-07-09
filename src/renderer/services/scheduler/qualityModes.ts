export type SchedulerQualityMode = "fast" | "balanced" | "best";

export type OptimizationConfig = {
  attempts: number;
  maxRepairIterations: number;
  timeBudgetMs: number;
};

export const schedulerQualityConfigs: Record<
  SchedulerQualityMode,
  OptimizationConfig
> = {
  fast: {
    attempts: 20,
    maxRepairIterations: 80,
    timeBudgetMs: 1500
  },
  balanced: {
    attempts: 80,
    maxRepairIterations: 200,
    timeBudgetMs: 5000
  },
  best: {
    attempts: 300,
    maxRepairIterations: 600,
    timeBudgetMs: 15000
  }
};

export function normalizeSchedulerQualityMode(
  value: unknown
): SchedulerQualityMode {
  return value === "fast" || value === "best" || value === "balanced"
    ? value
    : "balanced";
}

export function getSchedulerOptimizationConfig(
  mode: SchedulerQualityMode
): OptimizationConfig {
  return schedulerQualityConfigs[mode];
}
