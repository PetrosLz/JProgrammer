import type { Role, ScheduleSlot } from "../../types";
import type {
  CoverageCeilingAnalysis,
  CoverageCeilingDiagnosis
} from "./coverageCeiling";
import type { ScheduleEvaluationResult } from "./evaluator";
import type { SchedulerWarningDraft } from "./warnings";

export type ManagerScheduleStatus =
  | "Excellent"
  | "Understaffed"
  | "Invalid";

export type ManagerScheduleDiagnostics = {
  status: ManagerScheduleStatus;
  mainIssues: string[];
  suggestedFixes: string[];
  groupedWarningCount: number;
};

export function buildManagerScheduleDiagnostics({
  evaluation,
  coverageCeiling,
  coverageDiagnosis,
  warnings = [],
  slots,
  roles
}: {
  evaluation: ScheduleEvaluationResult;
  coverageCeiling: CoverageCeilingAnalysis;
  coverageDiagnosis: CoverageCeilingDiagnosis;
  warnings?: SchedulerWarningDraft[];
  slots: ScheduleSlot[];
  roles: Role[];
}): ManagerScheduleDiagnostics {
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const status = getManagerStatus({ evaluation, coverageCeiling, coverageDiagnosis });
  const mainIssues = unique([
    ...buildCoverageIssueSummaries({
      evaluation,
      coverageCeiling,
      coverageDiagnosis,
      roleNameById
    }),
    ...buildGroupedWarningSummaries(warnings),
    ...buildEvaluatorIssueSummaries(evaluation)
  ]).slice(0, status === "Excellent" ? 1 : 4);
  const suggestedFixes = buildSuggestedFixes({
    coverageCeiling,
    coverageDiagnosis,
    slots,
    roleNameById
  });

  return {
    status,
    mainIssues:
      mainIssues.length > 0
        ? mainIssues
        : [buildDefaultStatusMessage(status, evaluation)],
    suggestedFixes,
    groupedWarningCount: mainIssues.length
  };
}

function getManagerStatus({
  evaluation,
  coverageCeiling,
  coverageDiagnosis
}: {
  evaluation: ScheduleEvaluationResult;
  coverageCeiling: CoverageCeilingAnalysis;
  coverageDiagnosis: CoverageCeilingDiagnosis;
}): ManagerScheduleStatus {
  if (evaluation.metrics.hardViolationCount > 0) {
    return "Invalid";
  }

  if (evaluation.metrics.coverageRate === 1) {
    return "Excellent";
  }

  if (
    coverageDiagnosis.diagnosis === "understaffed" ||
    coverageCeiling.feasibleMaxAssignedSlots < coverageCeiling.totalSlots
  ) {
    return "Understaffed";
  }

  return "Understaffed";
}

function buildCoverageIssueSummaries({
  evaluation,
  coverageCeiling,
  coverageDiagnosis,
  roleNameById
}: {
  evaluation: ScheduleEvaluationResult;
  coverageCeiling: CoverageCeilingAnalysis;
  coverageDiagnosis: CoverageCeilingDiagnosis;
  roleNameById: Map<string, string>;
}): string[] {
  if (
    evaluation.metrics.coverageRate === 1 &&
    evaluation.metrics.hardViolationCount === 0
  ) {
    return ["All required slots are covered with no hard-rule issues."];
  }

  const summaries: string[] = [];

  if (coverageDiagnosis.coverageGap > 0) {
    summaries.push(
      `Likely scheduler gap: ${coverageDiagnosis.coverageGap} more slot${
        coverageDiagnosis.coverageGap === 1 ? "" : "s"
      } appear feasible than were assigned.`
    );
  } else if (coverageCeiling.feasibleMaxAssignedSlots < coverageCeiling.totalSlots) {
    summaries.push(
      `Understaffed: ${coverageCeiling.feasibleMaxAssignedSlots}/${coverageCeiling.totalSlots} slots appear feasible with the current employees and hard rules.`
    );
  }

  const roleShortages = coverageCeiling.perRoleCapacity
    .filter(
      (capacity) =>
        capacity.feasibleCandidateSlots < capacity.requiredSlots ||
        capacity.distinctCandidates < capacity.requiredSlots
    )
    .sort(
      (left, right) =>
        shortageSize(right) - shortageSize(left) ||
        left.label.localeCompare(right.label)
    );

  for (const shortage of roleShortages.slice(0, 2)) {
    summaries.push(
      `${shortage.label} is constrained: ${shortage.requiredSlots} required slot${
        shortage.requiredSlots === 1 ? "" : "s"
      }, ${shortage.distinctCandidates} eligible employee${
        shortage.distinctCandidates === 1 ? "" : "s"
      }, ${shortage.feasibleCandidateSlots} slot${
        shortage.feasibleCandidateSlots === 1 ? "" : "s"
      } with at least one valid candidate.`
    );
  }

  const impossibleSlots = coverageCeiling.bottlenecks.filter(
    (bottleneck) => bottleneck.scope === "slot" && bottleneck.candidateCount === 0
  );

  if (impossibleSlots.length > 0) {
    const byRole = new Map<string, number>();
    for (const bottleneck of impossibleSlots) {
      const roleName =
        bottleneck.roleName ??
        (bottleneck.roleId ? roleNameById.get(bottleneck.roleId) : null) ??
        "required role";
      byRole.set(roleName, (byRole.get(roleName) ?? 0) + 1);
    }
    const [roleName, count] = [...byRole.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )[0];
    summaries.push(
      `${roleName} has ${count} slot${count === 1 ? "" : "s"} with no hard-valid candidate.`
    );
  }

  const scarceEmployee = coverageCeiling.bottlenecks.find(
    (bottleneck) => bottleneck.scope === "employee"
  );

  if (scarceEmployee?.employeeName && scarceEmployee.requiredSlots) {
    summaries.push(
      `${scarceEmployee.employeeName} is the only eligible employee for ${scarceEmployee.requiredSlots} slots.`
    );
  }

  return summaries;
}

function buildGroupedWarningSummaries(
  warnings: SchedulerWarningDraft[]
): string[] {
  const visibleWarnings = warnings.filter(
    (warning) => warning.warningType !== "feasibility_feasible"
  );
  const countsByType = new Map<string, number>();

  for (const warning of visibleWarnings) {
    countsByType.set(
      warning.warningType,
      (countsByType.get(warning.warningType) ?? 0) + 1
    );
  }

  return [...countsByType.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 2)
    .flatMap(([warningType, count]) => {
      if (count <= 1) {
        return [];
      }

      return [`${humanizeWarningType(warningType)} appears ${count} times.`];
    });
}

function buildEvaluatorIssueSummaries(
  evaluation: ScheduleEvaluationResult
): string[] {
  if (evaluation.metrics.hardViolationCount > 0) {
    return [
      `${evaluation.metrics.hardViolationCount} hard-rule issue${
        evaluation.metrics.hardViolationCount === 1 ? "" : "s"
      } must be fixed before this schedule can be trusted.`
    ];
  }

  if (evaluation.metrics.unfilledSlots > 0) {
    return [
      `${evaluation.metrics.unfilledSlots} position${
        evaluation.metrics.unfilledSlots === 1 ? "" : "s"
      } remain unfilled.`
    ];
  }

  return [];
}

function buildSuggestedFixes({
  coverageCeiling,
  coverageDiagnosis,
  slots,
  roleNameById
}: {
  coverageCeiling: CoverageCeilingAnalysis;
  coverageDiagnosis: CoverageCeilingDiagnosis;
  slots: ScheduleSlot[];
  roleNameById: Map<string, string>;
}): string[] {
  if (coverageDiagnosis.diagnosis === "fully_covered") {
    return [];
  }

  if (coverageDiagnosis.diagnosis === "likely_scheduler_gap") {
    return ["Review scheduler output against the feasible ceiling before changing staffing rules."];
  }

  const fixes: string[] = [];
  const roleShortages = coverageCeiling.perRoleCapacity
    .filter(
      (capacity) =>
        capacity.feasibleCandidateSlots < capacity.requiredSlots ||
        capacity.distinctCandidates < capacity.requiredSlots
    )
    .sort(
      (left, right) =>
        shortageSize(right) - shortageSize(left) ||
        left.label.localeCompare(right.label)
    );

  for (const shortage of roleShortages.slice(0, 2)) {
    fixes.push(`Add availability or another employee for ${shortage.label}.`);
  }

  if (coverageCeiling.impossibleSlotCount > 0) {
    const missingRoleId = slots.find((slot) =>
      coverageCeiling.bottlenecks.some(
        (bottleneck) => bottleneck.scope === "slot" && bottleneck.slotId === slot.id
      )
    )?.role_id;

    if (missingRoleId) {
      fixes.push(
        `Give ${roleNameById.get(missingRoleId) ?? "the missing role"} to an available employee or reduce that requirement.`
      );
    }
  }

  if (fixes.length === 0) {
    fixes.push("Review availability limits, role assignments, and staffing requirements for the uncovered shifts.");
  }

  return unique(fixes).slice(0, 3);
}

function buildDefaultStatusMessage(
  status: ManagerScheduleStatus,
  evaluation: ScheduleEvaluationResult
): string {
  if (status === "Excellent") {
    return "All required slots are covered with no hard-rule issues.";
  }

  if (status === "Invalid") {
    return `${evaluation.metrics.hardViolationCount} hard-rule issues need review.`;
  }

  return `${evaluation.metrics.filledSlots}/${evaluation.metrics.totalSlots} required slots are covered.`;
}

function shortageSize(capacity: {
  requiredSlots: number;
  feasibleCandidateSlots: number;
  distinctCandidates: number;
}): number {
  return Math.max(
    capacity.requiredSlots - capacity.feasibleCandidateSlots,
    capacity.requiredSlots - capacity.distinctCandidates,
    0
  );
}

function humanizeWarningType(warningType: string): string {
  const knownLabels: Record<string, string> = {
    feasibility_shortage: "Feasibility shortage",
    role_group_zero_coverage: "Role group without coverage",
    partial_coverage: "Partial coverage",
    role_under_supplied: "Role shortage",
    team_quality: "Team quality issue",
    final_hard_constraint_violation: "Final hard-rule validation issue"
  };

  if (knownLabels[warningType]) {
    return knownLabels[warningType];
  }

  return warningType
    .split("_")
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
    .join(" ");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
