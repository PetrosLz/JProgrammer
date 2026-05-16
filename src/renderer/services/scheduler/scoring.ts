import type { Employee, ExperienceLevel, ScheduleSlot } from "../../types";
import { experienceLevelRank, experienceLevelToLabel } from "../../types";
import {
  type AssignedShift,
  type SchedulerData,
  getAssignedDayCount,
  getAssignedHours,
  getConsecutiveDayCountIfAssigned,
  getDayConstraint,
  getEmployeeWorkRules,
  getEmployeeShiftAvailability,
  getNightShiftCount,
  getSlotDurationHours,
  getWeekendShiftCount,
  isNightOrDifficultShift,
  isWeekendDate
} from "./constraints";
import { getDayOfWeek } from "./generateSlots";

export type ScoreDetail = {
  label: string;
  points: number;
};

export type CandidateScoreWarning = {
  severity: "info" | "warning";
  warningType: string;
  message: string;
};

export type CandidateScore = {
  employeeId: string;
  baseScore: number;
  totalScore: number;
  details: ScoreDetail[];
  warnings: CandidateScoreWarning[];
};

export type CandidateScoringContext = {
  averageAssignedHours: number;
  averageAssignedDays: number;
  averageWeekendAssignments: number;
  averageDifficultAssignments: number;
  averageRecentWeekendAssignments: number;
  averageRecentDifficultAssignments: number;
  scarcityPenalty: number;
  roleExperienceLevel: ExperienceLevel;
  roleExperienceRank: number;
  candidateCanLeadRole: boolean;
  candidatePrefersRole: boolean;
  roleFlexibility: number;
  candidateIsSpecialistForRole: boolean;
  specialistAvailableForRole: boolean;
  activeRoleEmployeeCount: number;
  slotHardCandidateCount: number;
  roleGroupRequiredCount: number;
  roleGroupAssignedCount: number;
  roleGroupIsUncovered: boolean;
  sameDaySameRoleUncoveredGroupCount: number;
  roleGroupAssignedExperienceLevels: ExperienceLevel[];
  experiencedRequiredCount: number;
  roleGroupHasLead: boolean;
  strongerCandidateAvailableForGroup: boolean;
  highExperienceScarcityPenalty: number;
  coverageScarcityPenalty: number;
  rareRoleCapacityPenalty: number;
  wildcardPreservationPenalty: number;
  recentWeekendAssignments: number;
  recentDifficultAssignments: number;
  recentSameAssignment: boolean;
};

export const scoreWeights = {
  prefersToWork: 30,
  prefersNotToWork: -30,
  belowTargetHours: 25,
  belowTargetDays: 20,
  fewerHoursThanAverage: 20,
  fewerDaysThanAverage: 15,
  fewerWeekendAssignments: 20,
  fewerDifficultAssignments: 15,
  goodRoleFit: 10,
  closeToMaxHours: -50,
  closeToMaxDays: -35,
  tooManyConsecutiveDays: -35,
  alreadyHasWeekendAssignment: -25,
  alreadyHasDifficultShift: -20,
  futureDifficultSlotProtection: -60,
  cannotUsuallyWorkWeekends: -25,
  experienceStep: 18,
  preferredRole: 8,
  rareRoleFit: 120,
  fewValidCandidatesForSlot: 100,
  specialistForRole: 80,
  focusedRoleSet: 40,
  preventsSpecialistIdle: 60,
  flexibleUsedWhereSpecialistFits: -50,
  preserveFlexibleWildcard: -60,
  preserveRareRoleCapacity: -80,
  leadMissingGroup: 24,
  experiencedEmployeeNeeded: 45,
  weakEmployeeCreatesWeakGroup: -80,
  noExperienceIntoWeakGroup: -35,
  experiencedOverStacking: -25,
  firstRoleGroupCoverage: 500,
  singleSlotGroupCoverage: 300,
  weekendUncoveredGroupCoverage: 200,
  alreadyCoveredWhileSameRoleUncovered: -300,
  protectUncoveredGroupCandidate: -500,
  fewerRecentWeekendAssignments: 10,
  fewerRecentDifficultAssignments: 8,
  recentWeekendRotation: -20,
  recentDifficultRotation: -15,
  repeatRecentSameAssignment: -12
} as const;

export type RotationStrength = "none" | "low" | "medium" | "high";
export const rotationStrength: RotationStrength = "medium";

export function scoreCandidate({
  employee,
  slot,
  data,
  assignedShifts,
  context
}: {
  employee: Employee;
  slot: ScheduleSlot;
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  context?: CandidateScoringContext;
}): CandidateScore {
  const baseScore = 100;
  let totalScore = baseScore;
  const details: ScoreDetail[] = [{ label: "Base score", points: baseScore }];
  const warnings: CandidateScoreWarning[] = [];
  const workRules = getEmployeeWorkRules(employee.id, data.employeeWorkRules);
  const currentHours = getAssignedHours(employee.id, assignedShifts);
  const slotHours = getSlotDurationHours(slot);
  const projectedHours = currentHours + slotHours;
  const currentDays = getAssignedDayCount(employee.id, assignedShifts);
  const projectedDays = getAssignedDayCount(employee.id, assignedShifts, slot.date);
  const weekendAssignments = getWeekendShiftCount(employee.id, assignedShifts);
  const difficultAssignments = getNightShiftCount(employee.id, assignedShifts);
  const dayConstraint = getDayConstraint(
    employee.id,
    getDayOfWeek(slot.date),
    data.employeeDayConstraints
  );
  const shiftAvailability = getEmployeeShiftAvailability({
    employeeId: employee.id,
    slot,
    data
  });

  function add(label: string, points: number) {
    if (points === 0) {
      return;
    }

    totalScore += points;
    details.push({ label, points });
  }

  if (shiftAvailability?.availability_type === "prefers_to_work") {
    add("Prefers this shift", scoreWeights.prefersToWork);
  } else if (shiftAvailability?.availability_type === "prefers_not_to_work") {
    add("Prefers not to work this shift", scoreWeights.prefersNotToWork);
    warnings.push({
      severity: "info",
      warningType: "assigned_prefers_not_to_work_shift",
      message: `${employee.first_name} ${employee.last_name} prefers not to work this shift on ${slot.date}.`
    });
  } else {
    if (dayConstraint?.constraint_type === "prefers_to_work") {
      add("Prefers to work this day", scoreWeights.prefersToWork);
    }

    if (dayConstraint?.constraint_type === "prefers_not_to_work") {
      add("Prefers not to work this day", scoreWeights.prefersNotToWork);
      warnings.push({
        severity: "info",
        warningType: "assigned_prefers_not_to_work",
        message: `${employee.first_name} ${employee.last_name} prefers not to work on ${slot.date}.`
      });
    }
  }

  if (
    workRules?.target_hours_per_week !== null &&
    workRules?.target_hours_per_week !== undefined &&
    currentHours < workRules.target_hours_per_week
  ) {
    add("Below target hours", scoreWeights.belowTargetHours);
  }

  if (
    workRules?.target_days_per_week !== null &&
    workRules?.target_days_per_week !== undefined &&
    currentDays < workRules.target_days_per_week
  ) {
    add("Below target days", scoreWeights.belowTargetDays);
  }

  if (context && currentHours < context.averageAssignedHours) {
    add("Fewer assigned hours than average", scoreWeights.fewerHoursThanAverage);
  }

  if (context && currentDays < context.averageAssignedDays) {
    add("Fewer assigned days than average", scoreWeights.fewerDaysThanAverage);
  }

  if (
    isWeekendDate(slot.date) &&
    context &&
    weekendAssignments < context.averageWeekendAssignments
  ) {
    add("Fewer weekend assignments than average", scoreWeights.fewerWeekendAssignments);
  }

  if (
    isNightOrDifficultShift(slot.start_time, slot.end_time) &&
    context &&
    difficultAssignments < context.averageDifficultAssignments
  ) {
    add(
      "Fewer difficult shifts than average",
      scoreWeights.fewerDifficultAssignments
    );
  }

  add("Good role fit", scoreWeights.goodRoleFit);

  if (
    workRules?.max_hours_per_week !== null &&
    workRules?.max_hours_per_week !== undefined &&
    projectedHours >= workRules.max_hours_per_week * 0.85
  ) {
    add("Close to max weekly hours", scoreWeights.closeToMaxHours);
  }

  if (
    workRules?.max_days_per_week !== null &&
    workRules?.max_days_per_week !== undefined &&
    projectedDays >= workRules.max_days_per_week
  ) {
    add("Close to max weekly days", scoreWeights.closeToMaxDays);
  }

  const consecutiveDays = getConsecutiveDayCountIfAssigned(
    employee.id,
    assignedShifts,
    slot.date
  );

  if (
    (workRules?.max_consecutive_days !== null &&
      workRules?.max_consecutive_days !== undefined &&
      consecutiveDays > workRules.max_consecutive_days) ||
    consecutiveDays > 4
  ) {
    add("Too many consecutive days", scoreWeights.tooManyConsecutiveDays);
    warnings.push({
      severity: "info",
      warningType: "long_consecutive_days",
      message: `${employee.first_name} ${employee.last_name} would reach ${consecutiveDays} consecutive days.`
    });
  }

  if (isWeekendDate(slot.date) && weekendAssignments > 0) {
    add("Already has weekend assignment", scoreWeights.alreadyHasWeekendAssignment);
  }

  if (isNightOrDifficultShift(slot.start_time, slot.end_time) && difficultAssignments > 0) {
    add("Already has difficult shifts", scoreWeights.alreadyHasDifficultShift);
  }

  if (isWeekendDate(slot.date) && workRules?.can_work_weekends === 0) {
    add("Cannot usually work weekends", scoreWeights.cannotUsuallyWorkWeekends);
  }

  if (context) {
    if (context.roleGroupIsUncovered) {
      add(
        "Gives first coverage to role group",
        scoreWeights.firstRoleGroupCoverage
      );

      if (context.roleGroupRequiredCount === 1) {
        add(
          "Covers single-person role group",
          scoreWeights.singleSlotGroupCoverage
        );
      }

      if (isWeekendDate(slot.date)) {
        add(
          "Covers uncovered weekend group",
          scoreWeights.weekendUncoveredGroupCoverage
        );
      }
    } else if (context.sameDaySameRoleUncoveredGroupCount > 0) {
      add(
        "Same role has uncovered shift on this day",
        scoreWeights.alreadyCoveredWhileSameRoleUncovered
      );
    }

    if (context.activeRoleEmployeeCount > 0 && context.activeRoleEmployeeCount <= 3) {
      add("Fills scarce role", scoreWeights.rareRoleFit);
    }

    if (
      context.slotHardCandidateCount > 0 &&
      context.slotHardCandidateCount <= 2
    ) {
      add("One of few valid candidates for this slot", scoreWeights.fewValidCandidatesForSlot);
    }

    if (context.candidateIsSpecialistForRole) {
      add("Specialist for this role", scoreWeights.specialistForRole);
      add("Uses specialist before flexible wildcard", scoreWeights.preventsSpecialistIdle);
    } else if (context.roleFlexibility <= 2) {
      add("Focused role set", scoreWeights.focusedRoleSet);
    }

    if (
      !context.candidateIsSpecialistForRole &&
      context.specialistAvailableForRole
    ) {
      add(
        "Flexible employee used where specialist can cover",
        scoreWeights.flexibleUsedWhereSpecialistFits
      );
    }

    add(
      `Role experience ${experienceLevelToLabel(
        context.roleExperienceLevel,
        "en"
      )}`,
      (context.roleExperienceRank - 2) * scoreWeights.experienceStep
    );

    if (context.candidatePrefersRole) {
      add("Preferred role", scoreWeights.preferredRole);
    }

    const groupExperienceLevels = context.roleGroupAssignedExperienceLevels;
    const groupHasExperienced = groupExperienceLevels.some(
      (experienceLevel) => experienceLevel === "experienced"
    );
    const groupHasExperience = groupExperienceLevels.some(
      (experienceLevel) => experienceLevelRank(experienceLevel) >= 2
    );
    const experiencedAssignedCount = groupExperienceLevels.filter(
      (experienceLevel) => experienceLevel === "experienced"
    ).length;
    const groupAverageExperience =
      groupExperienceLevels.length > 0
        ? groupExperienceLevels.reduce(
            (total, experienceLevel) =>
              total + experienceLevelRank(experienceLevel),
            0
          ) / groupExperienceLevels.length
        : 2;
    const candidateIsExperienced = context.roleExperienceLevel === "experienced";
    const candidateHasNoExperience =
      context.roleExperienceLevel === "no_experience";

    if (
      context.roleGroupRequiredCount >= 2 &&
      !groupHasExperience &&
      context.roleExperienceRank >= 2
    ) {
      add(
        "Adds prior experience to role group",
        scoreWeights.experiencedEmployeeNeeded
      );
    }

    if (
      context.experiencedRequiredCount > experiencedAssignedCount &&
      candidateIsExperienced
    ) {
      add(
        "Helps meet experienced employee requirement",
        scoreWeights.experiencedEmployeeNeeded
      );
    }

    if (
      context.roleGroupRequiredCount >= 2 &&
      !groupHasExperience &&
      candidateHasNoExperience &&
      context.strongerCandidateAvailableForGroup
    ) {
      add(
        "Would create weak role group",
        scoreWeights.weakEmployeeCreatesWeakGroup
      );
      warnings.push({
        severity: "info",
        warningType: "weak_role_group_risk",
        message: `${employee.first_name} ${employee.last_name} has no experience for this role group.`
      });
    }

    if (groupAverageExperience <= 1.5 && candidateHasNoExperience) {
      add(
        "No experience into already weak group",
        scoreWeights.noExperienceIntoWeakGroup
      );
    }

    if (context.candidateCanLeadRole && !context.roleGroupHasLead) {
      add("Adds role lead", scoreWeights.leadMissingGroup);
    }

    if (
      groupHasExperienced &&
      candidateIsExperienced &&
      context.roleGroupRequiredCount >= 2 &&
      experiencedAssignedCount >= Math.max(1, context.experiencedRequiredCount)
    ) {
      add(
        "Avoid stacking experienced employees",
        scoreWeights.experiencedOverStacking
      );
    }

    if (context.highExperienceScarcityPenalty < 0) {
      add(
        "Protect scarce experienced employee",
        context.highExperienceScarcityPenalty
      );
    }

    if (context.coverageScarcityPenalty < 0) {
      add(
        "Protect uncovered role group candidate",
        context.coverageScarcityPenalty
      );
    }

    if (context.rareRoleCapacityPenalty < 0) {
      add("Preserve rare-role capacity", context.rareRoleCapacityPenalty);
    }

    if (context.wildcardPreservationPenalty < 0) {
      add("Preserve flexible wildcard", context.wildcardPreservationPenalty);
    }

    const rotationMultiplier = getRotationMultiplier(rotationStrength);

    if (rotationMultiplier > 0) {
      if (
        isWeekendDate(slot.date) &&
        context.recentWeekendAssignments > context.averageRecentWeekendAssignments
      ) {
        add(
          "Recent weekend rotation",
          scoreWeights.recentWeekendRotation * rotationMultiplier
        );
      } else if (
        isWeekendDate(slot.date) &&
        context.recentWeekendAssignments < context.averageRecentWeekendAssignments
      ) {
        add(
          "Fewer recent weekend shifts",
          scoreWeights.fewerRecentWeekendAssignments * rotationMultiplier
        );
      }

      if (
        isNightOrDifficultShift(slot.start_time, slot.end_time) &&
        context.recentDifficultAssignments >
          context.averageRecentDifficultAssignments
      ) {
        add(
          "Recent difficult-shift rotation",
          scoreWeights.recentDifficultRotation * rotationMultiplier
        );
      } else if (
        isNightOrDifficultShift(slot.start_time, slot.end_time) &&
        context.recentDifficultAssignments <
          context.averageRecentDifficultAssignments
      ) {
        add(
          "Fewer recent difficult shifts",
          scoreWeights.fewerRecentDifficultAssignments * rotationMultiplier
        );
      }

      if (context.recentSameAssignment) {
        add(
          "Avoid repeating exact recent assignment",
          scoreWeights.repeatRecentSameAssignment * rotationMultiplier
        );
      }
    }
  }

  if (context && context.scarcityPenalty < 0) {
    add("Protect future difficult slots", context.scarcityPenalty);
  }

  return {
    employeeId: employee.id,
    baseScore,
    totalScore,
    details,
    warnings
  };
}

function getRotationMultiplier(strength: RotationStrength): number {
  if (strength === "none") {
    return 0;
  }

  if (strength === "low") {
    return 0.5;
  }

  if (strength === "high") {
    return 1.5;
  }

  return 1;
}
