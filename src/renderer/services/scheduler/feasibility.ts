import type {
  Employee,
  Role,
  ScheduleSlot,
  ShiftTemplate
} from "../../types";
import {
  type AssignedShift,
  type ManualOverrideMap,
  type SchedulerData,
  checkHardConstraints,
  employeeHasRole,
  formatHours,
  getApproximateTargetHoursPerWeek,
  getEmployeeWorkRules,
  getSlotDurationHours,
  getSlotShiftTemplateId,
  isNightOrDifficultShift,
  isWeekendDate
} from "./constraints";
import { getDayOfWeek } from "./generateSlots";
import { getRoleGroupKey } from "./teamQuality";

export type FeasibilityStatus = "feasible" | "risky" | "infeasible";

export type FeasibilityBlockedReasons = {
  timeOff: number;
  cannotWork: number;
  shiftUnavailable: number;
  weekendUnavailable: number;
  missingRole: number;
  insufficientExperience: number;
  maxDailyHours: number;
  maxWeeklyShifts: number;
  timeWindowUnavailable: number;
  overlap: number;
};

export type FeasibilityRoleCapacity = {
  roleId: string;
  roleName: string;
  requiredSlots: number;
  requiredHours: number;
  activeEmployeesWithRole: number;
  availableHours: number;
  shortageHours: number;
  minimumCandidatesForSlot: number;
  blockedReasons: FeasibilityBlockedReasons;
};

export type FeasibilityDayCapacity = {
  date: string;
  requiredSlots: number;
  requiredHours: number;
  availableEmployees: number;
  availableHours: number;
  shortageSlots: number;
  shortageHours: number;
};

export type FeasibilityShiftCapacity = {
  key: string;
  date: string;
  shiftLabel: string;
  requiredSlots: number;
  availableCandidates: number;
  highRiskRoles: string[];
};

export type FeasibilityShortage = {
  scope: "total" | "role" | "day" | "day_role" | "shift" | "role_group";
  severity: "risk" | "critical";
  message: string;
  roleId?: string;
  roleName?: string;
  date?: string;
  shiftLabel?: string;
  requiredSlots?: number;
  availableCandidates?: number;
  requiredHours?: number;
  availableHours?: number;
  shortageHours?: number;
  blockedReasons?: FeasibilityBlockedReasons;
};

export type FeasibilityResult = {
  status: FeasibilityStatus;
  totalRequiredSlots: number;
  totalRequiredHours: number;
  totalAvailableHours: number;
  activeEmployeeCount: number;
  weekendRequiredSlots: number;
  weekendRequiredHours: number;
  saturdayRequiredSlots: number;
  saturdayRequiredHours: number;
  sundayRequiredSlots: number;
  sundayRequiredHours: number;
  requiredSlotsByRole: Record<string, number>;
  requiredHoursByRole: Record<string, number>;
  requiredSlotsByDate: Record<string, number>;
  requiredHoursByDate: Record<string, number>;
  requiredSlotsByDateRole: Record<string, number>;
  requiredHoursByDateRole: Record<string, number>;
  availableEmployeesByDate: Record<string, number>;
  availableEmployeesByDateRole: Record<string, number>;
  availableEmployeesByDayShift: Record<string, number>;
  roleCapacity: FeasibilityRoleCapacity[];
  dayCapacity: FeasibilityDayCapacity[];
  shiftCapacity: FeasibilityShiftCapacity[];
  shortages: FeasibilityShortage[];
  warnings: string[];
  recommendations: string[];
};

type SlotCandidateAnalysis = {
  slot: ScheduleSlot;
  candidateEmployeeIds: string[];
  blockedReasons: FeasibilityBlockedReasons;
};

const emptyBlockedReasons = (): FeasibilityBlockedReasons => ({
  timeOff: 0,
  cannotWork: 0,
  shiftUnavailable: 0,
  weekendUnavailable: 0,
  missingRole: 0,
  insufficientExperience: 0,
  maxDailyHours: 0,
  maxWeeklyShifts: 0,
  timeWindowUnavailable: 0,
  overlap: 0
});

export function buildScheduleFeasibilityAnalysis({
  slots,
  employees,
  roles = [],
  shiftTemplates = [],
  data,
  assignedShifts,
  manualOverrides = {}
}: {
  slots: ScheduleSlot[];
  employees: Employee[];
  roles?: Role[];
  shiftTemplates?: ShiftTemplate[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  manualOverrides?: ManualOverrideMap;
}): FeasibilityResult {
  const activeEmployees = employees.filter((employee) => employee.is_active === 1);
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const slotAnalyses = slots.map((slot) =>
    analyzeSlotCandidates({
      slot,
      activeEmployees,
      data,
      assignedShifts,
      manualOverrides
    })
  );
  const slotAnalysisById = new Map(
    slotAnalyses.map((analysis) => [analysis.slot.id, analysis])
  );
  const requiredSlotsByRole = new Map<string, number>();
  const requiredHoursByRole = new Map<string, number>();
  const requiredSlotsByDate = new Map<string, number>();
  const requiredHoursByDate = new Map<string, number>();
  const requiredSlotsByDateRole = new Map<string, number>();
  const requiredHoursByDateRole = new Map<string, number>();
  const availableEmployeesByDate = new Map<string, Set<string>>();
  const availableEmployeesByDateRole = new Map<string, Set<string>>();
  const availableEmployeesByDayShift = new Map<string, Set<string>>();
  const possibleHoursByRoleEmployee = new Map<string, Map<string, number>>();
  const possibleDayHoursByEmployee = new Map<string, Map<string, number>>();
  let totalRequiredHours = 0;
  let weekendRequiredSlots = 0;
  let weekendRequiredHours = 0;
  let saturdayRequiredSlots = 0;
  let saturdayRequiredHours = 0;
  let sundayRequiredSlots = 0;
  let sundayRequiredHours = 0;

  for (const analysis of slotAnalyses) {
    const { slot } = analysis;
    const slotHours = getSlotDurationHours(slot);
    const dayOfWeek = getDayOfWeek(slot.date);
    const dateRoleKey = `${slot.date}|${slot.role_id}`;

    totalRequiredHours += slotHours;
    increment(requiredSlotsByRole, slot.role_id, 1);
    increment(requiredHoursByRole, slot.role_id, slotHours);
    increment(requiredSlotsByDate, slot.date, 1);
    increment(requiredHoursByDate, slot.date, slotHours);
    increment(requiredSlotsByDateRole, dateRoleKey, 1);
    increment(requiredHoursByDateRole, dateRoleKey, slotHours);

    if (isWeekendDate(slot.date)) {
      weekendRequiredSlots += 1;
      weekendRequiredHours += slotHours;
    }

    if (dayOfWeek === 6) {
      saturdayRequiredSlots += 1;
      saturdayRequiredHours += slotHours;
    }

    if (dayOfWeek === 0) {
      sundayRequiredSlots += 1;
      sundayRequiredHours += slotHours;
    }

    for (const employeeId of analysis.candidateEmployeeIds) {
      addToSetMap(availableEmployeesByDate, slot.date, employeeId);
      addToSetMap(availableEmployeesByDateRole, dateRoleKey, employeeId);
      addToSetMap(availableEmployeesByDayShift, shiftKey(slot, data), employeeId);

      const roleEmployeeHours =
        possibleHoursByRoleEmployee.get(slot.role_id) ?? new Map<string, number>();
      roleEmployeeHours.set(
        employeeId,
        (roleEmployeeHours.get(employeeId) ?? 0) + slotHours
      );
      possibleHoursByRoleEmployee.set(slot.role_id, roleEmployeeHours);

      const dayEmployeeHours =
        possibleDayHoursByEmployee.get(slot.date) ?? new Map<string, number>();
      dayEmployeeHours.set(
        employeeId,
        Math.max(dayEmployeeHours.get(employeeId) ?? 0, slotHours)
      );
      possibleDayHoursByEmployee.set(slot.date, dayEmployeeHours);
    }
  }

  const totalAvailableHours = activeEmployees.reduce((total, employee) => {
    const workRules = getEmployeeWorkRules(employee.id, data.employeeWorkRules);
    return total + (getApproximateTargetHoursPerWeek(workRules) ?? 40);
  }, 0);
  const roleCapacity = buildRoleCapacity({
    roleIds: new Set(requiredSlotsByRole.keys()),
    activeEmployees,
    data,
    roleNameById,
    requiredSlotsByRole,
    requiredHoursByRole,
    possibleHoursByRoleEmployee,
    slotAnalyses
  });
  const dayCapacity = buildDayCapacity({
    requiredSlotsByDate,
    requiredHoursByDate,
    possibleDayHoursByEmployee
  });
  const shiftCapacity = buildShiftCapacity({
    slots,
    slotAnalysisById,
    roles,
    shiftTemplates,
    data
  });
  const shortages = buildShortages({
    slots,
    slotAnalyses,
    roleCapacity,
    dayCapacity,
    shiftCapacity,
    roles,
    shiftTemplates,
    data,
    totalRequiredHours,
    totalAvailableHours
  });
  const hasCriticalShortage = shortages.some(
    (shortage) => shortage.severity === "critical"
  );
  const hasRiskShortage = shortages.length > 0;
  const status: FeasibilityStatus = hasCriticalShortage
    ? "infeasible"
    : hasRiskShortage || totalAvailableHours < totalRequiredHours * 1.1
      ? "risky"
      : "feasible";
  const warnings = buildWarnings(status, shortages);
  const recommendations = buildRecommendations(shortages);

  return {
    status,
    totalRequiredSlots: slots.length,
    totalRequiredHours,
    totalAvailableHours,
    activeEmployeeCount: activeEmployees.length,
    weekendRequiredSlots,
    weekendRequiredHours,
    saturdayRequiredSlots,
    saturdayRequiredHours,
    sundayRequiredSlots,
    sundayRequiredHours,
    requiredSlotsByRole: toRecord(requiredSlotsByRole),
    requiredHoursByRole: toRecord(requiredHoursByRole),
    requiredSlotsByDate: toRecord(requiredSlotsByDate),
    requiredHoursByDate: toRecord(requiredHoursByDate),
    requiredSlotsByDateRole: toRecord(requiredSlotsByDateRole),
    requiredHoursByDateRole: toRecord(requiredHoursByDateRole),
    availableEmployeesByDate: setSizeRecord(availableEmployeesByDate),
    availableEmployeesByDateRole: setSizeRecord(availableEmployeesByDateRole),
    availableEmployeesByDayShift: setSizeRecord(availableEmployeesByDayShift),
    roleCapacity,
    dayCapacity,
    shiftCapacity,
    shortages,
    warnings,
    recommendations
  };
}

function analyzeSlotCandidates({
  slot,
  activeEmployees,
  data,
  assignedShifts,
  manualOverrides
}: {
  slot: ScheduleSlot;
  activeEmployees: Employee[];
  data: SchedulerData;
  assignedShifts: AssignedShift[];
  manualOverrides: ManualOverrideMap;
}): SlotCandidateAnalysis {
  const candidateEmployeeIds: string[] = [];
  const blockedReasons = emptyBlockedReasons();

  for (const employee of activeEmployees) {
    const result = checkHardConstraints({
      employee,
      slot,
      data,
      assignedShifts,
      manualOverrides
    });

    if (result.allowed) {
      candidateEmployeeIds.push(employee.id);
      continue;
    }

    addBlockedReasons(
      blockedReasons,
      result.violations.map((violation) => violation.code)
    );
  }

  return { slot, candidateEmployeeIds, blockedReasons };
}

function addBlockedReasons(
  blockedReasons: FeasibilityBlockedReasons,
  reasonCodes: string[]
) {
  if (reasonCodes.includes("TIME_OFF")) {
    blockedReasons.timeOff += 1;
  }

  if (reasonCodes.includes("DAY_UNAVAILABLE")) {
    blockedReasons.cannotWork += 1;
  }

  if (reasonCodes.includes("SHIFT_UNAVAILABLE")) {
    blockedReasons.shiftUnavailable += 1;
  }

  if (reasonCodes.includes("WEEKEND_NOT_ALLOWED")) {
    blockedReasons.weekendUnavailable += 1;
  }

  if (reasonCodes.includes("MISSING_ROLE")) {
    blockedReasons.missingRole += 1;
  }

  if (reasonCodes.includes("INSUFFICIENT_EXPERIENCE")) {
    blockedReasons.insufficientExperience += 1;
  }

  if (reasonCodes.includes("MAX_DAILY_HOURS")) {
    blockedReasons.maxDailyHours += 1;
  }

  if (reasonCodes.includes("MAX_WEEKLY_SHIFTS")) {
    blockedReasons.maxWeeklyShifts += 1;
  }

  if (reasonCodes.includes("TIME_WINDOW_UNAVAILABLE")) {
    blockedReasons.timeWindowUnavailable += 1;
  }

  if (reasonCodes.includes("SHIFT_OVERLAP")) {
    blockedReasons.overlap += 1;
  }
}

function buildRoleCapacity({
  roleIds,
  activeEmployees,
  data,
  roleNameById,
  requiredSlotsByRole,
  requiredHoursByRole,
  possibleHoursByRoleEmployee,
  slotAnalyses
}: {
  roleIds: Set<string>;
  activeEmployees: Employee[];
  data: SchedulerData;
  roleNameById: Map<string, string>;
  requiredSlotsByRole: Map<string, number>;
  requiredHoursByRole: Map<string, number>;
  possibleHoursByRoleEmployee: Map<string, Map<string, number>>;
  slotAnalyses: SlotCandidateAnalysis[];
}): FeasibilityRoleCapacity[] {
  return [...roleIds]
    .map((roleId) => {
      const employeeHours = possibleHoursByRoleEmployee.get(roleId) ?? new Map();
      const availableHours = [...employeeHours.entries()].reduce(
        (total, [employeeId, possibleHours]) => {
          const workRules = getEmployeeWorkRules(employeeId, data.employeeWorkRules);
          return (
            total + Math.min(possibleHours, getApproximateTargetHoursPerWeek(workRules) ?? 40)
          );
        },
        0
      );
      const requiredHours = requiredHoursByRole.get(roleId) ?? 0;
      const roleSlotAnalyses = slotAnalyses.filter(
        (analysis) => analysis.slot.role_id === roleId
      );
      const blockedReasons = roleSlotAnalyses.reduce(
        (total, analysis) => mergeBlockedReasons(total, analysis.blockedReasons),
        emptyBlockedReasons()
      );

      return {
        roleId,
        roleName: roleNameById.get(roleId) ?? "Role",
        requiredSlots: requiredSlotsByRole.get(roleId) ?? 0,
        requiredHours,
        activeEmployeesWithRole: activeEmployees.filter((employee) =>
          employeeHasRole(employee.id, roleId, data.employeeRoles)
        ).length,
        availableHours,
        shortageHours: Math.max(0, requiredHours - availableHours),
        minimumCandidatesForSlot:
          roleSlotAnalyses.length > 0
            ? Math.min(
                ...roleSlotAnalyses.map(
                  (analysis) => analysis.candidateEmployeeIds.length
                )
              )
            : 0,
        blockedReasons
      };
    })
    .sort((left, right) => left.roleName.localeCompare(right.roleName));
}

function buildDayCapacity({
  requiredSlotsByDate,
  requiredHoursByDate,
  possibleDayHoursByEmployee
}: {
  requiredSlotsByDate: Map<string, number>;
  requiredHoursByDate: Map<string, number>;
  possibleDayHoursByEmployee: Map<string, Map<string, number>>;
}): FeasibilityDayCapacity[] {
  return [...requiredSlotsByDate.keys()]
    .map((date) => {
      const possibleEmployeeHours = possibleDayHoursByEmployee.get(date) ?? new Map();
      const requiredSlots = requiredSlotsByDate.get(date) ?? 0;
      const requiredHours = requiredHoursByDate.get(date) ?? 0;
      const availableHours = [...possibleEmployeeHours.values()].reduce(
        (total, hours) => total + hours,
        0
      );
      const availableEmployees = possibleEmployeeHours.size;

      return {
        date,
        requiredSlots,
        requiredHours,
        availableEmployees,
        availableHours,
        shortageSlots: Math.max(0, requiredSlots - availableEmployees),
        shortageHours: Math.max(0, requiredHours - availableHours)
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

function buildShiftCapacity({
  slots,
  slotAnalysisById,
  roles,
  shiftTemplates,
  data
}: {
  slots: ScheduleSlot[];
  slotAnalysisById: Map<string, SlotCandidateAnalysis>;
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  data: SchedulerData;
}): FeasibilityShiftCapacity[] {
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const shifts = new Map<string, ScheduleSlot[]>();

  for (const slot of slots) {
    const key = shiftKey(slot, data);
    shifts.set(key, [...(shifts.get(key) ?? []), slot]);
  }

  return [...shifts.entries()]
    .map(([key, shiftSlots]) => {
      const candidateIds = new Set<string>();
      const roleCandidateCounts = new Map<string, number>();

      for (const slot of shiftSlots) {
        const analysis = slotAnalysisById.get(slot.id);
        const existingCount = roleCandidateCounts.get(slot.role_id) ?? Number.MAX_SAFE_INTEGER;
        const nextCount = analysis?.candidateEmployeeIds.length ?? 0;
        roleCandidateCounts.set(slot.role_id, Math.min(existingCount, nextCount));

        for (const employeeId of analysis?.candidateEmployeeIds ?? []) {
          candidateIds.add(employeeId);
        }
      }

      return {
        key,
        date: shiftSlots[0]?.date ?? "",
        shiftLabel: shiftSlots[0]
          ? formatShiftLabel(shiftSlots[0], shiftTemplates, data)
          : "Shift",
        requiredSlots: shiftSlots.length,
        availableCandidates: candidateIds.size,
        highRiskRoles: [...roleCandidateCounts.entries()]
          .filter(([, candidateCount]) => candidateCount <= 1)
          .map(([roleId]) => roleNameById.get(roleId) ?? "Role")
      };
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.shiftLabel.localeCompare(right.shiftLabel)
    );
}

function buildShortages({
  slots,
  slotAnalyses,
  roleCapacity,
  dayCapacity,
  shiftCapacity,
  roles,
  shiftTemplates,
  data,
  totalRequiredHours,
  totalAvailableHours
}: {
  slots: ScheduleSlot[];
  slotAnalyses: SlotCandidateAnalysis[];
  roleCapacity: FeasibilityRoleCapacity[];
  dayCapacity: FeasibilityDayCapacity[];
  shiftCapacity: FeasibilityShiftCapacity[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  data: SchedulerData;
  totalRequiredHours: number;
  totalAvailableHours: number;
}): FeasibilityShortage[] {
  const roleNameById = new Map(roles.map((role) => [role.id, role.name]));
  const shortages: FeasibilityShortage[] = [];

  if (totalRequiredHours > totalAvailableHours) {
    shortages.push({
      scope: "total",
      severity: "critical",
      message: `Το πρόγραμμα ζητά ${formatHours(totalRequiredHours)} ώρες, αλλά οι διαθέσιμες ώρες είναι περίπου ${formatHours(totalAvailableHours)}.`,
      requiredHours: totalRequiredHours,
      availableHours: totalAvailableHours,
      shortageHours: totalRequiredHours - totalAvailableHours
    });
  } else if (totalAvailableHours < totalRequiredHours * 1.1) {
    shortages.push({
      scope: "total",
      severity: "risk",
      message: "Το πρόγραμμα είναι οριακό. Υπάρχει μικρό περιθώριο για απουσίες ή αλλαγές.",
      requiredHours: totalRequiredHours,
      availableHours: totalAvailableHours
    });
  }

  for (const capacity of roleCapacity) {
    if (capacity.shortageHours > 0) {
      shortages.push({
        scope: "role",
        severity: "critical",
        roleId: capacity.roleId,
        roleName: capacity.roleName,
        message: `Λείπουν περίπου ${formatHours(capacity.shortageHours)} ώρες για τον ρόλο ${capacity.roleName} αυτή την εβδομάδα.`,
        requiredSlots: capacity.requiredSlots,
        requiredHours: capacity.requiredHours,
        availableHours: capacity.availableHours,
        shortageHours: capacity.shortageHours,
        availableCandidates: capacity.activeEmployeesWithRole,
        blockedReasons: capacity.blockedReasons
      });
    } else if (capacity.minimumCandidatesForSlot <= 1) {
      shortages.push({
        scope: "role",
        severity: "risk",
        roleId: capacity.roleId,
        roleName: capacity.roleName,
        message: `Ο ρόλος ${capacity.roleName} είναι οριακός: τουλάχιστον μία βάρδια έχει ${capacity.minimumCandidatesForSlot} πιθανό υποψήφιο.`,
        requiredSlots: capacity.requiredSlots,
        requiredHours: capacity.requiredHours,
        availableHours: capacity.availableHours,
        availableCandidates: capacity.activeEmployeesWithRole,
        blockedReasons: capacity.blockedReasons
      });
    }
  }

  for (const capacity of dayCapacity) {
    if (capacity.shortageSlots > 0) {
      shortages.push({
        scope: "day",
        severity: "critical",
        date: capacity.date,
        message: `${formatDayAndDate(capacity.date)}: ζητούνται ${capacity.requiredSlots} άτομα, αλλά με τους τωρινούς περιορισμούς μπορούν να καλυφθούν περίπου ${capacity.availableEmployees}.`,
        requiredSlots: capacity.requiredSlots,
        availableCandidates: capacity.availableEmployees,
        requiredHours: capacity.requiredHours,
        availableHours: capacity.availableHours,
        shortageHours: capacity.shortageHours
      });
    } else if (capacity.availableEmployees <= capacity.requiredSlots + 1) {
      shortages.push({
        scope: "day",
        severity: "risk",
        date: capacity.date,
        message: `${formatDayAndDate(capacity.date)} είναι οριακή ημέρα: ${capacity.requiredSlots} θέσεις και ${capacity.availableEmployees} διαθέσιμοι εργαζόμενοι.`,
        requiredSlots: capacity.requiredSlots,
        availableCandidates: capacity.availableEmployees,
        requiredHours: capacity.requiredHours,
        availableHours: capacity.availableHours
      });
    }
  }

  for (const capacity of shiftCapacity) {
    if (capacity.availableCandidates < capacity.requiredSlots) {
      shortages.push({
        scope: "shift",
        severity: "critical",
        date: capacity.date,
        shiftLabel: capacity.shiftLabel,
        message: `${formatDayAndDate(capacity.date)} ${capacity.shiftLabel}: ζητούνται ${capacity.requiredSlots} άτομα, αλλά υπάρχουν περίπου ${capacity.availableCandidates} διαθέσιμοι υποψήφιοι.`,
        requiredSlots: capacity.requiredSlots,
        availableCandidates: capacity.availableCandidates
      });
    } else if (capacity.highRiskRoles.length > 0) {
      shortages.push({
        scope: "shift",
        severity: "risk",
        date: capacity.date,
        shiftLabel: capacity.shiftLabel,
        message: `${formatDayAndDate(capacity.date)} ${capacity.shiftLabel}: οριακοί ρόλοι: ${capacity.highRiskRoles.join(", ")}.`,
        requiredSlots: capacity.requiredSlots,
        availableCandidates: capacity.availableCandidates
      });
    }
  }

  const roleGroups = new Map<string, ScheduleSlot[]>();
  for (const slot of slots) {
    const key = getRoleGroupKey(slot, data.staffingRequirements ?? []);
    roleGroups.set(key, [...(roleGroups.get(key) ?? []), slot]);
  }

  for (const groupSlots of roleGroups.values()) {
    const representativeSlot = groupSlots[0];

    if (!representativeSlot) {
      continue;
    }

    const groupCandidateIds = new Set<string>();
    const groupBlockedReasons = emptyBlockedReasons();

    for (const slot of groupSlots) {
      const analysis = slotAnalyses.find((item) => item.slot.id === slot.id);

      for (const employeeId of analysis?.candidateEmployeeIds ?? []) {
        groupCandidateIds.add(employeeId);
      }

      if (analysis) {
        mergeBlockedReasons(groupBlockedReasons, analysis.blockedReasons);
      }
    }

    if (groupCandidateIds.size === 0) {
      const roleName = roleNameById.get(representativeSlot.role_id) ?? "Role";
      shortages.push({
        scope: "role_group",
        severity: "critical",
        roleId: representativeSlot.role_id,
        roleName,
        date: representativeSlot.date,
        shiftLabel: formatShiftLabel(representativeSlot, shiftTemplates, data),
        message: `${formatDayAndDate(representativeSlot.date)} ${formatShiftLabel(
          representativeSlot,
          shiftTemplates,
          data
        )} ${roleName}: δεν υπάρχει διαθέσιμος υποψήφιος.`,
        requiredSlots: groupSlots.length,
        availableCandidates: 0,
        blockedReasons: groupBlockedReasons
      });
    } else if (groupCandidateIds.size <= groupSlots.length) {
      const roleName = roleNameById.get(representativeSlot.role_id) ?? "Role";
      shortages.push({
        scope: "role_group",
        severity: "risk",
        roleId: representativeSlot.role_id,
        roleName,
        date: representativeSlot.date,
        shiftLabel: formatShiftLabel(representativeSlot, shiftTemplates, data),
        message: `${formatDayAndDate(representativeSlot.date)} ${formatShiftLabel(
          representativeSlot,
          shiftTemplates,
          data
        )} ${roleName}: ζητούνται ${groupSlots.length}, διαθέσιμοι υποψήφιοι ${groupCandidateIds.size}.`,
        requiredSlots: groupSlots.length,
        availableCandidates: groupCandidateIds.size,
        blockedReasons: groupBlockedReasons
      });
    }
  }

  return shortages;
}

function buildWarnings(
  status: FeasibilityStatus,
  shortages: FeasibilityShortage[]
): string[] {
  const summary =
    status === "feasible"
      ? "Το πρόγραμμα φαίνεται εφικτό."
      : status === "risky"
        ? "Το πρόγραμμα δημιουργήθηκε, αλλά είναι οριακό."
        : "Το πρόγραμμα δεν μπορεί να καλυφθεί πλήρως με τα τωρινά δεδομένα.";

  return unique([summary, ...shortages.map((shortage) => shortage.message)]).slice(0, 12);
}

function buildRecommendations(shortages: FeasibilityShortage[]): string[] {
  const recommendations = shortages.flatMap((shortage) => {
    if (shortage.scope === "role" && shortage.roleName) {
      return [
        `Προσθέστε ακόμη έναν εργαζόμενο με ρόλο ${shortage.roleName}.`,
        `Δώστε δεύτερο ρόλο ${shortage.roleName} σε κάποιον διαθέσιμο εργαζόμενο.`
      ];
    }

    if (shortage.scope === "day" && shortage.date) {
      return [
        `Αυξήστε τη διαθεσιμότητα εργαζομένων για ${formatDayAndDate(
          shortage.date
        )}.`
      ];
    }

    if (shortage.scope === "shift" && shortage.shiftLabel) {
      return [
        `Μειώστε προσωρινά τις ανάγκες προσωπικού στη βάρδια ${shortage.shiftLabel} ή αυξήστε τη διαθεσιμότητα.`
      ];
    }

    if (shortage.scope === "role_group" && shortage.roleName) {
      return [
        `Ελέγξτε αν οι περιορισμοί availability είναι πολύ αυστηροί για ${shortage.roleName}.`
      ];
    }

    return ["Ελέγξτε αν οι περιορισμοί availability είναι πολύ αυστηροί."];
  });

  return unique(recommendations).slice(0, 8);
}

function mergeBlockedReasons(
  target: FeasibilityBlockedReasons,
  source: FeasibilityBlockedReasons
): FeasibilityBlockedReasons {
  target.timeOff += source.timeOff;
  target.cannotWork += source.cannotWork;
  target.shiftUnavailable += source.shiftUnavailable;
  target.weekendUnavailable += source.weekendUnavailable;
  target.missingRole += source.missingRole;
  target.insufficientExperience += source.insufficientExperience;
  target.maxDailyHours += source.maxDailyHours;
  target.maxWeeklyShifts += source.maxWeeklyShifts;
  target.timeWindowUnavailable += source.timeWindowUnavailable;
  target.overlap += source.overlap;
  return target;
}

function increment(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string
) {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function toRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].map(([key, value]) => [
      key,
      Number.isInteger(value) ? value : Number(value.toFixed(2))
    ])
  );
}

function setSizeRecord(map: Map<string, Set<string>>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].map(([key, values]) => [key, values.size])
  );
}

function shiftKey(slot: ScheduleSlot, data: SchedulerData): string {
  const shiftTemplateId = getSlotShiftTemplateId(
    slot,
    data.staffingRequirements ?? []
  );

  return `${slot.date}|${shiftTemplateId ?? `${slot.start_time}-${slot.end_time}`}`;
}

function formatShiftLabel(
  slot: ScheduleSlot,
  shiftTemplates: ShiftTemplate[],
  data: SchedulerData
): string {
  const shiftTemplateId = getSlotShiftTemplateId(
    slot,
    data.staffingRequirements ?? []
  );
  const shiftTemplate = shiftTemplateId
    ? shiftTemplates.find((item) => item.id === shiftTemplateId)
    : null;
  const suffix = isNightOrDifficultShift(slot.start_time, slot.end_time)
    ? " δύσκολη/βραδινή"
    : "";

  return `${shiftTemplate?.name ?? "Βάρδια"} ${slot.start_time}-${slot.end_time}${suffix}`;
}

function formatDayAndDate(date: string): string {
  const dayLabel = dayLabels[getDayOfWeek(date)];
  const [year, month, day] = date.split("-");
  return `${dayLabel} ${day}/${month}/${year}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

const dayLabels = [
  "Κυριακή",
  "Δευτέρα",
  "Τρίτη",
  "Τετάρτη",
  "Πέμπτη",
  "Παρασκευή",
  "Σάββατο"
];
