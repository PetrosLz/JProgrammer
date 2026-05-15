import type { Employee, ScheduleSlot } from "../../types";
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
  scarcityPenalty: number;
  roleSkillLevel: number;
  candidateCanLeadRole: boolean;
  candidatePrefersRole: boolean;
  roleGroupRequiredCount: number;
  roleGroupAssignedSkillLevels: number[];
  roleGroupHasLead: boolean;
  strongerCandidateAvailableForGroup: boolean;
  highSkillScarcityPenalty: number;
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
  skillStep: 12,
  preferredRole: 8,
  leadMissingGroup: 24,
  strongEmployeeNeeded: 45,
  weakEmployeeCreatesWeakGroup: -50,
  lowSkillIntoWeakGroup: -35,
  highSkillOverStacking: -25
} as const;

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
    add(
      `Role skill level ${context.roleSkillLevel}`,
      (context.roleSkillLevel - 3) * scoreWeights.skillStep
    );

    if (context.candidatePrefersRole) {
      add("Preferred role", scoreWeights.preferredRole);
    }

    const groupSkillLevels = context.roleGroupAssignedSkillLevels;
    const groupHasExperienced = groupSkillLevels.some((skillLevel) => skillLevel >= 4);
    const groupAverageSkill =
      groupSkillLevels.length > 0
        ? groupSkillLevels.reduce((total, skillLevel) => total + skillLevel, 0) /
          groupSkillLevels.length
        : 3;

    if (
      context.roleGroupRequiredCount >= 2 &&
      !groupHasExperienced &&
      context.roleSkillLevel >= 4
    ) {
      add("Adds experienced employee to role group", scoreWeights.strongEmployeeNeeded);
    }

    if (
      context.roleGroupRequiredCount >= 2 &&
      !groupHasExperienced &&
      context.roleSkillLevel <= 2 &&
      context.strongerCandidateAvailableForGroup
    ) {
      add(
        "Would create weak role group",
        scoreWeights.weakEmployeeCreatesWeakGroup
      );
      warnings.push({
        severity: "info",
        warningType: "weak_role_group_risk",
        message: `${employee.first_name} ${employee.last_name} is low skill for this role group.`
      });
    }

    if (groupAverageSkill <= 2.5 && context.roleSkillLevel <= 2) {
      add("Low skill into already weak group", scoreWeights.lowSkillIntoWeakGroup);
    }

    if (context.candidateCanLeadRole && !context.roleGroupHasLead) {
      add("Adds role lead", scoreWeights.leadMissingGroup);
    }

    if (
      groupHasExperienced &&
      context.roleSkillLevel >= 4 &&
      context.roleGroupRequiredCount >= 2
    ) {
      add("Avoid stacking high-skill employees", scoreWeights.highSkillOverStacking);
    }

    if (context.highSkillScarcityPenalty < 0) {
      add("Protect scarce high-skill employee", context.highSkillScarcityPenalty);
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
