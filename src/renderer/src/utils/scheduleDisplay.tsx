import type {
  DayOfWeek,
  Employee,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ScheduleWarning,
  ShiftTemplate,
  StaffingRequirement
} from "../../types";
import { getDayOfWeek, getSlotDurationHours } from "../../services/scheduler";
import { formatTimeRange } from "../../services/scheduler/model/workingTime";
import { dayLabels } from "../setupData";
import type { UiLanguage } from "./localization";

function roleLabel(roleId: string, roles: Role[]): string {
  return roles.find((role) => role.id === roleId)?.name ?? "Unknown role";
}

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function roleCoverageSummary(slots: ScheduleSlot[], roles: Role[]): string {
  const counts = new Map<string, number>();

  for (const slot of slots) {
    counts.set(slot.role_id, (counts.get(slot.role_id) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([roleId, count]) => `${roleLabel(roleId, roles)}: ${count}`)
    .join(", ");
}

function formatSlotTime(slot: ScheduleSlot, language: UiLanguage = "en"): string {
  return formatTimeRange({
    startTime: slot.start_time,
    endTime: slot.end_time,
    language
  });
}

type ScheduleRow = {
  key: string;
  label: string;
  startTime: string;
  endTime: string;
};

type EmployeeScheduleItem = {
  employee: Employee;
  assignment: ScheduleAssignment;
  slot: ScheduleSlot;
  role: Role | null;
  shiftName: string;
  warningCount: number;
  warningMessages: string[];
};

type EmployeeScheduleRow = {
  employee: Employee;
  assignmentsByDate: Map<string, EmployeeScheduleItem[]>;
  assignmentCount: number;
};

type ManagerCoverageIssue = {
  groupKey: string;
  severity: "critical" | "partial";
  date: string;
  dateLabel: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  roleName: string;
  requiredCount: number;
  assignedCount: number;
  missingCount: number;
  missingHours: number;
  summary: string;
  cause: string;
  recommendations: string[];
};

function scheduleCoverageGroupKey(
  slot: ScheduleSlot,
  requirements: StaffingRequirement[]
): string {
  const requirement = requirements.find((item) => item.id === slot.source_id);
  const shiftKey = requirement?.shift_template_id
    ? `template:${requirement.shift_template_id}`
    : `time:${slot.start_time}-${slot.end_time}`;

  return `${slot.date}|${shiftKey}|${slot.role_id}`;
}

function buildManagerCoverageIssues({
  runSlots,
  runAssignments,
  roles,
  shiftTemplates,
  staffingRequirements,
  language
}: {
  runSlots: ScheduleSlot[];
  runAssignments: ScheduleAssignment[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  language: UiLanguage;
}): ManagerCoverageIssue[] {
  const assignedSlotIds = new Set(
    runAssignments
      .filter(
        (assignment) =>
          assignment.status !== "cancelled" && assignment.status !== "removed"
      )
      .map((assignment) => assignment.schedule_slot_id)
  );
  const groups = new Map<string, ScheduleSlot[]>();

  for (const slot of runSlots) {
    const key = scheduleCoverageGroupKey(slot, staffingRequirements);
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }

  return [...groups.entries()]
    .flatMap(([groupKey, slots]) => {
      const sortedSlots = [...slots].sort(
        (left, right) =>
          left.start_time.localeCompare(right.start_time) ||
          left.end_time.localeCompare(right.end_time) ||
          left.id.localeCompare(right.id)
      );
      const representativeSlot = sortedSlots[0];

      if (!representativeSlot) {
        return [];
      }

      const assignedCount = sortedSlots.filter((slot) =>
        assignedSlotIds.has(slot.id)
      ).length;
      const requiredCount = sortedSlots.length;

      if (assignedCount >= requiredCount) {
        return [];
      }

      const roleName =
        roles.find((role) => role.id === representativeSlot.role_id)?.name ??
        (language === "en" ? "role" : "ρόλο");
      const shiftName = shiftNameForSlot(
        representativeSlot,
        staffingRequirements,
        shiftTemplates
      );
      const missingCount = requiredCount - assignedCount;
      const missingHours = missingCount * getSlotDurationHours(representativeSlot);
      const dateLabel = `${localizedDayName(
        getDayOfWeek(representativeSlot.date),
        language
      )} ${formatDateEu(representativeSlot.date)}`;
      const requiredLabel = formatManagerEmployeeCount(requiredCount, language);
      const assignedLabel = formatManagerEmployeeCount(assignedCount, language);
      const severity: ManagerCoverageIssue["severity"] =
        assignedCount === 0 ? "critical" : "partial";

      return [
        {
          groupKey,
          severity,
          date: representativeSlot.date,
          dateLabel,
          shiftName,
          startTime: representativeSlot.start_time,
          endTime: representativeSlot.end_time,
          roleName,
          requiredCount,
          assignedCount,
          missingCount,
          missingHours,
          summary:
            language === "en"
              ? `${requiredLabel} ${
                  requiredCount === 1 ? "is" : "are"
                } needed, but only ${assignedLabel} ${
                  assignedCount === 1 ? "was" : "were"
                } assigned.`
              : `${requiredCount === 1 ? "Χρειάζεται" : "Χρειάζονται"} ${requiredLabel}, αλλά ${
                  assignedCount === 1 ? "καλύφθηκε" : "καλύφθηκαν"
                } ${assignedLabel}.`,
          cause:
            language === "en"
              ? `There is no other available ${roleName} employee without breaking work rules.`
              : `Δεν υπάρχει άλλος διαθέσιμος εργαζόμενος για ${roleName} χωρίς να παραβιαστούν οι κανόνες εργασίας.`,
          recommendations:
            language === "en"
              ? [
                  `Add another ${roleName} employee.`,
                  `Give the ${roleName} role to an available employee.`,
                  `Reduce the ${roleName} requirement for this shift from ${requiredCount} to ${assignedCount}.`
                ]
              : [
                  `Πρόσθεσε έναν ακόμη εργαζόμενο με ρόλο ${roleName}.`,
                  `Δώσε ρόλο ${roleName} σε κάποιον διαθέσιμο εργαζόμενο.`,
                  `Μείωσε την ανάγκη ${roleName} για αυτή τη βάρδια από ${requiredCount} σε ${assignedCount}.`
                ]
        }
      ];
    })
    .sort(
      (left, right) =>
        (left.severity === "critical" && right.severity !== "critical" ? -1 : 0) ||
        (right.severity === "critical" && left.severity !== "critical" ? 1 : 0) ||
        left.date.localeCompare(right.date) ||
        left.startTime.localeCompare(right.startTime) ||
        left.roleName.localeCompare(right.roleName)
    );
}

function buildRoleShortageSummaries(
  issues: ManagerCoverageIssue[],
  language: UiLanguage
): string[] {
  const byRole = new Map<string, { missingCount: number; missingHours: number }>();

  for (const issue of issues) {
    const existing = byRole.get(issue.roleName) ?? {
      missingCount: 0,
      missingHours: 0
    };
    byRole.set(issue.roleName, {
      missingCount: existing.missingCount + issue.missingCount,
      missingHours: existing.missingHours + issue.missingHours
    });
  }

  return [...byRole.entries()]
    .sort(
      (left, right) =>
        right[1].missingCount - left[1].missingCount ||
        right[1].missingHours - left[1].missingHours ||
        left[0].localeCompare(right[0])
    )
    .map(([roleName, shortage]) =>
      language === "en"
        ? `${roleName}: about ${formatHours(shortage.missingHours)} more hours are needed (${shortage.missingCount} unfilled position${
            shortage.missingCount === 1 ? "" : "s"
          }).`
        : `${roleName}: χρειάζονται περίπου ${formatHours(
            shortage.missingHours
          )} επιπλέον ώρες (${shortage.missingCount} κεν${
            shortage.missingCount === 1 ? "ή θέση" : "ές θέσεις"
          }).`
    );
}

function buildShortageSummaryLines({
  issues,
  unfilledSlotCount,
  language
}: {
  issues: ManagerCoverageIssue[];
  unfilledSlotCount: number;
  language: UiLanguage;
}): string[] {
  if (unfilledSlotCount === 0) {
    return [
      language === "en"
        ? "The schedule is fully covered."
        : "Το πρόγραμμα καλύπτεται πλήρως."
    ];
  }

  const roleShortages = buildRoleShortageSummaries(issues, language);
  const primaryRole =
    issues.length > 0
      ? buildPrimaryShortageRole(issues)
      : language === "en"
        ? "one role"
        : "έναν ρόλο";

  return [
    language === "en"
      ? `The schedule was generated, but it is not fully covered. There ${
          unfilledSlotCount === 1 ? "is" : "are"
        } ${unfilledSlotCount} unfilled position${
          unfilledSlotCount === 1 ? "" : "s"
        }.`
      : `Το πρόγραμμα δημιουργήθηκε, αλλά δεν καλύπτεται πλήρως. Υπάρχ${
          unfilledSlotCount === 1 ? "ει" : "ουν"
        } ${unfilledSlotCount} κεν${unfilledSlotCount === 1 ? "ή θέση" : "ές θέσεις"}.`,
    language === "en"
      ? `The main shortage is in ${primaryRole}.`
      : `Το πρόβλημα εντοπίζεται κυρίως στον ρόλο ${primaryRole}.`,
    ...roleShortages.slice(0, 3)
  ];
}

function buildPrimaryShortageRole(issues: ManagerCoverageIssue[]): string {
  const counts = new Map<string, number>();

  for (const issue of issues) {
    counts.set(issue.roleName, (counts.get(issue.roleName) ?? 0) + issue.missingCount);
  }

  return (
    [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )[0]?.[0] ?? "Role"
  );
}

function formatManagerEmployeeCount(count: number, language: UiLanguage): string {
  if (language === "en") {
    return `${count} employee${count === 1 ? "" : "s"}`;
  }

  return `${count} ${count === 1 ? "άτομο" : "άτομα"}`;
}

function uniqueRecommendations(issues: ManagerCoverageIssue[]): string[] {
  return Array.from(new Set(issues.flatMap((issue) => issue.recommendations)));
}

function managerFriendlyWarningMessage({
  warning,
  slot,
  coverageIssues,
  staffingRequirements,
  language
}: {
  warning: ScheduleWarning;
  slot: ScheduleSlot;
  coverageIssues: ManagerCoverageIssue[];
  staffingRequirements: StaffingRequirement[];
  language: UiLanguage;
}): string {
  const coverageIssue = coverageIssues.find(
    (issue) => issue.groupKey === scheduleCoverageGroupKey(slot, staffingRequirements)
  );

  if (
    coverageIssue &&
    ["role_group_zero_coverage", "role_group_understaffed", "slot_unfilled"].includes(
      warning.warning_type
    )
  ) {
    return `${coverageIssue.dateLabel} · ${coverageIssue.shiftName} · ${coverageIssue.roleName}: ${coverageIssue.summary} ${coverageIssue.cause}`;
  }

  if (warning.warning_type === "weak_team_composition") {
    return language === "en"
      ? "This shift needs at least one employee with prior experience for this role."
      : "Η βάρδια χρειάζεται τουλάχιστον έναν εργαζόμενο με προϋπηρεσία για αυτόν τον ρόλο.";
  }

  return humanizeSchedulerWarningText(warning.message, language);
}

function humanizeSchedulerWarningText(message: string, language: UiLanguage): string {
  if (/Manual override/i.test(message)) {
    return language === "en"
      ? "This assignment was changed manually and has manager-confirmed warnings."
      : "Αυτή η ανάθεση άλλαξε χειροκίνητα και έχει προειδοποιήσεις που επιβεβαιώθηκαν από manager.";
  }

  if (/Employee (is inactive|does not have|has time off|cannot work|is not available|already has|would exceed)/.test(message)) {
    return language === "en"
      ? "This warning is related to an employee work rule or availability limit."
      : "Η προειδοποίηση σχετίζεται με κανόνα εργασίας ή διαθεσιμότητα εργαζομένου.";
  }

  if (/This schedule run has no unfilled slots to assign/i.test(message)) {
    return language === "en"
      ? "There were no open positions left for automatic assignment."
      : "Δεν υπήρχαν κενές θέσεις για αυτόματη ανάθεση.";
  }

  const hidesDebugDetails =
    /Score|Main factors|Blocked by|Missing role|candidate|max daily hours|max weekly shifts|overlapping shift|time-window constraint|weekend rule|Μπλοκαρισ|Δεν έχουν τον ρόλο|Ενεργοί με αυτόν τον ρόλο|Διαθέσιμοι μετά/.test(
      message
    );

  if (!hidesDebugDetails) {
    return message;
  }

  return language === "en"
    ? "This warning is related to employee availability or work-rule limits."
    : "Η προειδοποίηση σχετίζεται με διαθεσιμότητα εργαζομένων ή όρια εργασίας.";
}

function buildEmployeeScheduleRows({
  employees,
  runSlots,
  runAssignments,
  roles,
  shiftTemplates,
  staffingRequirements,
  warningsBySlotId,
  coverageIssues,
  language
}: {
  employees: Employee[];
  runSlots: ScheduleSlot[];
  runAssignments: ScheduleAssignment[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  warningsBySlotId: Map<string, ScheduleWarning[]>;
  coverageIssues: ManagerCoverageIssue[];
  language: UiLanguage;
}): EmployeeScheduleRow[] {
  const slotById = new Map(runSlots.map((slot) => [slot.id, slot]));
  const assignedEmployeeIds = new Set(
    runAssignments.map((assignment) => assignment.employee_id)
  );
  const rowEmployees = employees
    .filter((employee) => employee.is_active === 1 || assignedEmployeeIds.has(employee.id))
    .sort(
      (left, right) =>
        left.last_name.localeCompare(right.last_name) ||
        left.first_name.localeCompare(right.first_name) ||
        left.id.localeCompare(right.id)
    );

  return rowEmployees.map((employee) => {
    const assignmentsByDate = new Map<string, EmployeeScheduleItem[]>();

    for (const assignment of runAssignments) {
      if (assignment.employee_id !== employee.id) {
        continue;
      }

      const slot = slotById.get(assignment.schedule_slot_id);

      if (!slot) {
        continue;
      }

      const existing = assignmentsByDate.get(slot.date) ?? [];
      assignmentsByDate.set(slot.date, [
        ...existing,
        {
          employee,
          assignment,
          slot,
          role: roles.find((role) => role.id === slot.role_id) ?? null,
          shiftName: shiftNameForSlot(slot, staffingRequirements, shiftTemplates),
          warningCount: warningsBySlotId.get(slot.id)?.length ?? 0,
          warningMessages: (warningsBySlotId.get(slot.id) ?? []).map(
            (warning) =>
              managerFriendlyWarningMessage({
                warning,
                slot,
                coverageIssues,
                staffingRequirements,
                language
              })
          )
        }
      ]);
    }

    for (const [date, items] of assignmentsByDate.entries()) {
      assignmentsByDate.set(
        date,
        [...items].sort(
          (left, right) =>
            left.slot.start_time.localeCompare(right.slot.start_time) ||
            left.slot.end_time.localeCompare(right.slot.end_time) ||
            (left.role?.name ?? "").localeCompare(right.role?.name ?? "")
        )
      );
    }

    return {
      employee,
      assignmentsByDate,
      assignmentCount: [...assignmentsByDate.values()].reduce(
        (total, items) => total + items.length,
        0
      )
    };
  });
}

function groupUnfilledSlotsByDate({
  runSlots,
  assignmentBySlotId
}: {
  runSlots: ScheduleSlot[];
  assignmentBySlotId: Map<string, ScheduleAssignment>;
}): Map<string, ScheduleSlot[]> {
  const grouped = new Map<string, ScheduleSlot[]>();

  for (const slot of runSlots) {
    if (slot.status === "filled" || assignmentBySlotId.has(slot.id)) {
      continue;
    }

    const existing = grouped.get(slot.date) ?? [];
    grouped.set(slot.date, [...existing, slot]);
  }

  for (const [date, slots] of grouped.entries()) {
    grouped.set(
      date,
      [...slots].sort(
        (left, right) =>
          left.start_time.localeCompare(right.start_time) ||
          left.end_time.localeCompare(right.end_time) ||
          left.role_id.localeCompare(right.role_id)
      )
    );
  }

  return grouped;
}

function buildScheduleRows(
  slots: ScheduleSlot[],
  requirements: StaffingRequirement[],
  shiftTemplates: ShiftTemplate[],
  language: UiLanguage = "en"
): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();

  for (const slot of slots) {
    const key = scheduleRowKey(slot, requirements);

    if (rows.has(key)) {
      continue;
    }

    const requirement = requirements.find((item) => item.id === slot.source_id);
    const shiftTemplate = requirement?.shift_template_id
      ? shiftTemplates.find((item) => item.id === requirement.shift_template_id)
      : null;

    rows.set(key, {
      key,
      label: shiftTemplate?.name ?? formatSlotTime(slot, language),
      startTime: slot.start_time,
      endTime: slot.end_time
    });
  }

  return [...rows.values()].sort(
    (left, right) =>
      left.startTime.localeCompare(right.startTime) ||
      left.endTime.localeCompare(right.endTime) ||
      left.label.localeCompare(right.label)
  );
}

function shiftNameForSlot(
  slot: ScheduleSlot,
  requirements: StaffingRequirement[],
  shiftTemplates: ShiftTemplate[]
): string {
  const requirement = requirements.find((item) => item.id === slot.source_id);
  const shiftTemplate = requirement?.shift_template_id
    ? shiftTemplates.find((item) => item.id === requirement.shift_template_id)
    : null;

  return shiftTemplate?.name ?? formatSlotTime(slot);
}

function shortEmployeeName(employee: Employee): string {
  const firstInitial = employee.first_name.slice(0, 1).toUpperCase();
  return `${firstInitial}. ${employee.last_name}`;
}

function scheduleRowKey(
  slot: ScheduleSlot,
  requirements: StaffingRequirement[]
): string {
  const requirement = requirements.find((item) => item.id === slot.source_id);

  if (requirement?.shift_template_id) {
    return `template:${requirement.shift_template_id}`;
  }

  return `time:${slot.start_time}-${slot.end_time}`;
}

function groupWarningsBySlot(
  warnings: ScheduleWarning[],
  runId: string
): Map<string, ScheduleWarning[]> {
  const grouped = new Map<string, ScheduleWarning[]>();

  for (const warning of warnings) {
    if (warning.schedule_run_id !== runId || !warning.schedule_slot_id) {
      continue;
    }

    const existing = grouped.get(warning.schedule_slot_id) ?? [];
    grouped.set(warning.schedule_slot_id, [...existing, warning]);
  }

  return grouped;
}

function scheduleRunTypeLabel(run: ScheduleRun): string {
  try {
    const parameters = run.parameters_json
      ? (JSON.parse(run.parameters_json) as { type?: string })
      : {};
    return parameters.type === "weekly" ? "Weekly" : "Program";
  } catch {
    return "Program";
  }
}

function programStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    generated: "Generated",
    assigned: "Proposed",
    partially_assigned: "Needs review",
    needs_review: "Needs review",
    unfilled: "Needs review",
    draft: "Draft"
  };

  return labels[status] ?? status;
}

function formatDateEu(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function formatDateRangeEu(startDate: string, endDate: string): string {
  return `${formatDateEu(startDate)} - ${formatDateEu(endDate)}`;
}

function formatCompactDateRange(
  startDate: string,
  endDate: string,
  language: UiLanguage
): string {
  const start = parseDateParts(startDate);
  const end = parseDateParts(endDate);

  if (!start || !end) {
    return formatDateRangeEu(startDate, endDate);
  }

  const [startYear, startMonth, startDay] = start;
  const [endYear, endMonth, endDay] = end;
  const greekMonths = [
    "Ιανουαρίου",
    "Φεβρουαρίου",
    "Μαρτίου",
    "Απριλίου",
    "Μαΐου",
    "Ιουνίου",
    "Ιουλίου",
    "Αυγούστου",
    "Σεπτεμβρίου",
    "Οκτωβρίου",
    "Νοεμβρίου",
    "Δεκεμβρίου"
  ];
  const englishMonths = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ];

  if (language === "en") {
    const startMonthName = englishMonths[startMonth - 1] ?? "";
    const endMonthName = englishMonths[endMonth - 1] ?? "";

    if (startYear === endYear && startMonth === endMonth) {
      return `${startMonthName} ${startDay}–${endDay}, ${startYear}`;
    }

    if (startYear === endYear) {
      return `${startMonthName} ${startDay}\u00a0–\u00a0${endMonthName} ${endDay}, ${startYear}`;
    }

    return `${startMonthName} ${startDay}, ${startYear}\u00a0–\u00a0${endMonthName} ${endDay}, ${endYear}`;
  }

  const startMonthName = greekMonths[startMonth - 1] ?? "";
  const endMonthName = greekMonths[endMonth - 1] ?? "";

  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay}–${endDay} ${startMonthName} ${startYear}`;
  }

  if (startYear === endYear) {
    return `${startDay} ${startMonthName}\u00a0–\u00a0${endDay} ${endMonthName} ${startYear}`;
  }

  return `${startDay} ${startMonthName} ${startYear}\u00a0–\u00a0${endDay} ${endMonthName} ${endYear}`;
}

function parseDateParts(date: string): [number, number, number] | null {
  const [year, month, day] = date.split("-").map(Number);

  if (!year || !month || !day) {
    return null;
  }

  return [year, month, day];
}

function formatWeekRangeWithDays(startDate: string, endDate: string): string {
  return `${dayLabel(getDayOfWeek(startDate))} ${formatDateEu(startDate)} - ${dayLabel(
    getDayOfWeek(endDate)
  )} ${formatDateEu(endDate)}`;
}

function RolePill({ role }: { role: Role | null }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded bg-slate-100 px-2 py-1 font-semibold text-slate-700">
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: role?.color ?? "#64748b" }}
      />
      <span className="truncate">{role?.name ?? "Role"}</span>
    </span>
  );
}

function WarningBadge({ messages }: { messages: string[] }) {
  const label = messages.length > 0 ? messages.join("\n") : "Προειδοποίηση";

  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200"
    >
      !
    </span>
  );
}

function buildTeamSchedulePdfHtml({
  businessName,
  run,
  dates,
  employeeRows
}: {
  businessName: string;
  run: ScheduleRun;
  dates: string[];
  employeeRows: EmployeeScheduleRow[];
}): string {
  return `<!doctype html>
<html lang="el">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(businessName)} Program</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #111827;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10px;
      line-height: 1.35;
      background: white;
    }
    .header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 14px;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 10px;
    }
    h1 { margin: 0; font-size: 21px; letter-spacing: 0; }
    .subtitle { margin: 4px 0 0; color: #475569; font-size: 12px; }
    .meta { text-align: right; color: #64748b; font-size: 10px; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #cbd5e1; vertical-align: top; padding: 6px; }
    th { background: #f1f5f9; color: #334155; font-size: 9px; text-transform: uppercase; }
    th.employee, td.employee { width: 18%; font-weight: 700; }
    .cell-off { color: #94a3b8; font-weight: 600; }
    .shift {
      border-left: 4px solid #64748b;
      border-radius: 4px;
      padding-left: 6px;
      break-inside: avoid;
    }
    .shift + .shift { margin-top: 5px; }
    .shift-name { font-weight: 700; }
    .shift-time, .shift-role { color: #475569; }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <h1>${escapeHtml(businessName)}</h1>
      <p class="subtitle">Πρόγραμμα εβδομάδας: ${escapeHtml(
        formatDateRangeEu(run.start_date, run.end_date)
      )}</p>
    </div>
    <div class="meta">Πρόγραμμα ομάδας</div>
  </header>

  <table>
    <thead>
      <tr>
        <th class="employee">Εργαζόμενος</th>
        ${dates
          .map(
            (date) =>
              `<th>${escapeHtml(dayLabel(getDayOfWeek(date)))}<br />${escapeHtml(
                formatDateEu(date)
              )}</th>`
          )
          .join("")}
      </tr>
    </thead>
    <tbody>
      ${employeeRows
        .map(
          (employeeRow) => `<tr>
            <td class="employee">${escapeHtml(
              employeeName(employeeRow.employee.id, [employeeRow.employee], "el")
            )}</td>
            ${dates
              .map((date) => {
                const items = employeeRow.assignmentsByDate.get(date) ?? [];

                if (items.length === 0) {
                  return `<td><span class="cell-off">Ρεπό</span></td>`;
                }

                return `<td>${items
                  .map(
                    (item) =>
                      `<div class="shift" style="border-left-color: ${escapeHtml(
                        item.role?.color ?? "#64748b"
                      )};">
                        <div class="shift-name">${escapeHtml(item.shiftName)}</div>
                        <div class="shift-time">${escapeHtml(
                          formatSlotTime(item.slot, "el")
                        )}</div>
                        <div class="shift-role">${escapeHtml(
                          item.role?.name ?? "Ρόλος"
                        )}</div>
                      </div>`
                  )
                  .join("")}</td>`;
              })
              .join("")}
          </tr>`
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;
}

function buildManagerReportPdfHtml({
  businessName,
  run,
  dates,
  employeeRows,
  runSlots,
  roles,
  shiftTemplates,
  staffingRequirements,
  warnings,
  unfilledSlots,
  employeeWorkRules,
  coverageIssues,
  language
}: {
  businessName: string;
  run: ScheduleRun;
  dates: string[];
  employeeRows: EmployeeScheduleRow[];
  runSlots: ScheduleSlot[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  warnings: ScheduleWarning[];
  unfilledSlots: ScheduleSlot[];
  employeeWorkRules: EmployeeWorkRules[];
  coverageIssues: ManagerCoverageIssue[];
  language: UiLanguage;
}): string {
  const shortageSummaryRows = buildShortageSummaryLines({
    issues: coverageIssues,
    unfilledSlotCount: unfilledSlots.length,
    language
  })
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
  const issueRows = coverageIssues
    .map(
      (issue) => `<article class="issue-card ${
        issue.severity === "critical" ? "critical" : ""
      }">
        <h3>${escapeHtml(issue.dateLabel)} · ${escapeHtml(
          issue.shiftName
        )} · ${escapeHtml(issue.roleName)}</h3>
        <p>${escapeHtml(issue.summary)}</p>
        <p>${escapeHtml(issue.cause)}</p>
        <ul>${issue.recommendations
          .map((recommendation) => `<li>${escapeHtml(recommendation)}</li>`)
          .join("")}</ul>
      </article>`
    )
    .join("");
  const coverageIssueKeys = new Set(coverageIssues.map((issue) => issue.groupKey));
  const coverageWarningTypes = new Set([
    "role_group_zero_coverage",
    "role_group_understaffed",
    "slot_unfilled"
  ]);
  const managerWarningRows = Array.from(
    new Set(
      warnings.flatMap((warning) => {
        const slot = warning.schedule_slot_id
          ? runSlots.find((item) => item.id === warning.schedule_slot_id)
          : null;

        if (
          slot &&
          coverageWarningTypes.has(warning.warning_type) &&
          coverageIssueKeys.has(scheduleCoverageGroupKey(slot, staffingRequirements))
        ) {
          return [];
        }

        const friendlyMessage = slot
          ? managerFriendlyWarningMessage({
              warning,
              slot,
              coverageIssues,
              staffingRequirements,
              language
            })
          : humanizeSchedulerWarningText(warning.message, language);

        if (
          friendlyMessage ===
          (language === "en"
            ? "This warning is related to employee availability or work-rule limits."
            : "Η προειδοποίηση σχετίζεται με διαθεσιμότητα εργαζομένων ή όρια εργασίας.")
        ) {
          return [];
        }

        return [friendlyMessage];
      })
    )
  )
    .map((message) => `<li>${escapeHtml(message)}</li>`)
    .join("");
  const recommendationRows = uniqueRecommendations(coverageIssues)
    .map((recommendation) => `<li>${escapeHtml(recommendation)}</li>`)
    .join("");
  const technicalWarningCount = warnings.filter((warning) =>
    /Score|Main factors|Blocked by|Missing role|candidate|max daily hours|max weekly shifts|overlapping shift|time-window constraint|weekend rule|Μπλοκαρισ|Δεν έχουν τον ρόλο|Ενεργοί με αυτόν τον ρόλο|Διαθέσιμοι μετά/.test(
      warning.message
    )
  ).length;
  const employeeSummaryRows = employeeRows
    .map((employeeRow) => {
      const totalHours = getEmployeeScheduleHours(employeeRow);
      const weekendShifts = getEmployeeWeekendShiftCount(employeeRow);
      const difficultShifts = getEmployeeDifficultShiftCount(employeeRow);
      const workRules = employeeWorkRules.find(
        (rules) => rules.employee_id === employeeRow.employee.id
      );
      const targetHours =
        workRules?.target_hours_per_day !== null &&
        workRules?.target_hours_per_day !== undefined
          ? workRules.target_hours_per_day * workRules.max_shifts_per_week
          : null;
      const maxShifts = workRules?.max_shifts_per_week ?? null;

      return `<tr>
        <td>${escapeHtml(
          employeeName(employeeRow.employee.id, [employeeRow.employee], language)
        )}</td>
        <td>${employeeRow.assignmentCount}</td>
        <td>${escapeHtml(formatHours(totalHours))}</td>
        <td>${weekendShifts}</td>
        <td>${difficultShifts}</td>
        <td>${escapeHtml(formatOptionalHours(targetHours))}</td>
        <td>${escapeHtml(maxShifts === null ? "-" : String(maxShifts))}</td>
      </tr>`;
    })
    .join("");
  const overLimitRows = employeeRows
    .flatMap((employeeRow) => {
      const totalHours = getEmployeeScheduleHours(employeeRow);
      const workRules = employeeWorkRules.find(
        (rules) => rules.employee_id === employeeRow.employee.id
      );
      const rows: string[] = [];

      if (
        workRules?.max_shifts_per_week !== null &&
        workRules?.max_shifts_per_week !== undefined &&
        employeeRow.assignmentCount > workRules.max_shifts_per_week
      ) {
        rows.push(
          language === "en"
            ? `${employeeName(
                employeeRow.employee.id,
                [employeeRow.employee],
                language
              )}: above the configured weekly shift limit (${formatHours(
                totalHours
              )}/${workRules.max_shifts_per_week} shifts).`
            : `${employeeName(
                employeeRow.employee.id,
                [employeeRow.employee],
                language
              )}: πάνω από το εβδομαδιαίο όριο (${formatHours(
                totalHours
              )}/${workRules.max_shifts_per_week} βάρδιες).`
        );
      }

      return rows;
    })
    .map((row) => `<li>${escapeHtml(row)}</li>`)
    .join("");
  const assignedShiftCount = employeeRows.reduce(
    (total, employeeRow) => total + employeeRow.assignmentCount,
    0
  );
  const text =
    language === "en"
      ? {
          assignedShifts: "Assigned shifts",
          difficult: "Difficult",
          employee: "Employee",
          employeeSummary: "Employee hours summary",
          employees: "Employees",
          exportMeta: "PDF export",
          hours: "Hours",
          issueSection: "Issues to fix",
          max: "Limit",
          notesTitle: "Notes / limitations",
          off: "Off",
          recommendations: "Recommendations",
          role: "Role",
          scheduleTitle: "Weekly schedule",
          shifts: "Shifts",
          summaryTitle: "Coverage summary",
          target: "Contract",
          technicalDetails: "Technical details",
          technicalHidden:
            "Detailed scoring factors and blocked-candidate counts are kept internally and are not included in the normal manager report.",
          totalHours: "Total hours",
          unfilled: "Unfilled shifts",
          warnings: "Warnings",
          week: "Schedule week",
          weekend: "Weekend"
        }
      : {
          assignedShifts: "Ανατεθειμένες βάρδιες",
          difficult: "Δύσκολες",
          employee: "Εργαζόμενος",
          employeeSummary: "Σύνοψη ωρών εργαζομένων",
          employees: "Εργαζόμενοι",
          exportMeta: "Εξαγωγή PDF",
          hours: "Ώρες",
          issueSection: "Θέματα προς διόρθωση",
          max: "Όριο",
          notesTitle: "Σημειώσεις / περιορισμοί",
          off: "Ρεπό",
          recommendations: "Προτάσεις",
          role: "Ρόλος",
          scheduleTitle: "Εβδομαδιαίο πρόγραμμα",
          shifts: "Βάρδιες",
          summaryTitle: "Σύνοψη κάλυψης",
          target: "Συμφωνία",
          technicalDetails: "Τεχνικές λεπτομέρειες",
          technicalHidden:
            "Οι αναλυτικοί παράγοντες βαθμολόγησης και οι τεχνικές μετρήσεις υποψηφίων παραμένουν εσωτερικά και δεν εμφανίζονται στην κανονική αναφορά manager.",
          totalHours: "Σύνολο ωρών",
          unfilled: "Κενές βάρδιες",
          warnings: "Προειδοποιήσεις",
          week: "Πρόγραμμα εβδομάδας",
          weekend: "Σ/Κ"
        };

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(businessName)} Manager Report</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      font-family: "Segoe UI", Arial, sans-serif;
      font-size: 10px;
      line-height: 1.35;
      background: white;
    }
    .header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 14px;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 10px;
    }
    h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0;
    }
    .subtitle {
      margin: 4px 0 0;
      color: #475569;
      font-size: 12px;
    }
    .meta {
      text-align: right;
      color: #475569;
      font-size: 11px;
      white-space: nowrap;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #cbd5e1;
      vertical-align: top;
      padding: 6px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-size: 9px;
      text-transform: uppercase;
    }
    th.employee, td.employee {
      width: 18%;
      font-weight: 700;
    }
    .cell-off {
      color: #94a3b8;
      font-weight: 600;
    }
    .shift {
      border-left: 4px solid #64748b;
      border-radius: 4px;
      padding-left: 6px;
      break-inside: avoid;
    }
    .shift + .shift { margin-top: 5px; }
    .shift-name { font-weight: 700; }
    .shift-time, .shift-role { color: #475569; }
    .warning-mark {
      display: inline-block;
      margin-left: 4px;
      border-radius: 999px;
      background: #fef3c7;
      color: #92400e;
      font-weight: 800;
      min-width: 14px;
      text-align: center;
    }
    .hours {
      margin-top: 4px;
      color: #64748b;
      font-size: 9px;
      font-weight: 600;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin: 10px 0 12px;
    }
    .summary-item {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 7px 8px;
      background: #f8fafc;
    }
    .summary-label { color: #64748b; font-size: 9px; }
    .summary-value { margin-top: 2px; font-size: 13px; font-weight: 700; }
    .manager-summary {
      border: 1px solid #f59e0b;
      border-radius: 7px;
      background: #fffbeb;
      color: #78350f;
      padding: 9px 10px;
      margin: 10px 0 12px;
    }
    .manager-summary p { margin: 0 0 3px; }
    .section {
      margin-top: 14px;
      break-inside: avoid;
    }
    .section h2 {
      margin: 0 0 6px;
      font-size: 13px;
    }
    .section ul {
      margin: 0;
      padding-left: 18px;
    }
    .section li {
      margin-bottom: 3px;
    }
    .section table {
      table-layout: auto;
    }
    .section .numeric {
      text-align: right;
      white-space: nowrap;
    }
    .issue-card {
      border: 1px solid #fed7aa;
      border-radius: 7px;
      background: #fff7ed;
      padding: 8px 10px;
      margin-bottom: 8px;
      break-inside: avoid;
    }
    .issue-card.critical {
      border-color: #fecaca;
      background: #fef2f2;
    }
    .issue-card h3 {
      margin: 0 0 4px;
      font-size: 12px;
    }
    .issue-card p {
      margin: 0 0 4px;
    }
    .technical-note {
      color: #64748b;
      font-size: 9px;
    }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <h1>${escapeHtml(businessName)}</h1>
      <p class="subtitle">${escapeHtml(text.week)}: ${escapeHtml(
        formatDateRangeEu(run.start_date, run.end_date)
      )}</p>
    </div>
    <div class="meta">${escapeHtml(text.exportMeta)} · ${escapeHtml(formatDateEu(todayInputValue()))}</div>
  </header>

  <section class="summary">
    <div class="summary-item"><div class="summary-label">${escapeHtml(text.employees)}</div><div class="summary-value">${employeeRows.length}</div></div>
    <div class="summary-item"><div class="summary-label">${escapeHtml(text.assignedShifts)}</div><div class="summary-value">${assignedShiftCount}</div></div>
    <div class="summary-item"><div class="summary-label">${escapeHtml(text.unfilled)}</div><div class="summary-value">${unfilledSlots.length}</div></div>
    <div class="summary-item"><div class="summary-label">${escapeHtml(text.warnings)}</div><div class="summary-value">${warnings.length}</div></div>
  </section>

  <section class="manager-summary">
    <strong>${escapeHtml(text.summaryTitle)}</strong>
    ${shortageSummaryRows}
  </section>

  <section class="section">
    <h2>${escapeHtml(text.scheduleTitle)}</h2>
  <table>
    <thead>
      <tr>
        <th class="employee">${escapeHtml(text.employee)}</th>
        ${dates
          .map(
            (date) =>
              `<th>${escapeHtml(
                localizedDayName(getDayOfWeek(date), language)
              )}<br />${escapeHtml(
                formatDateEu(date)
              )}</th>`
          )
          .join("")}
      </tr>
    </thead>
    <tbody>
      ${employeeRows
        .map((employeeRow) => {
          const totalHours = getEmployeeScheduleHours(employeeRow);

          return `<tr>
            <td class="employee">${escapeHtml(
              employeeName(employeeRow.employee.id, [employeeRow.employee], language)
            )}<div class="hours">${escapeHtml(text.totalHours)}: ${escapeHtml(formatHours(totalHours))}</div></td>
            ${dates
              .map((date) => {
                const items = employeeRow.assignmentsByDate.get(date) ?? [];

                if (items.length === 0) {
                  return `<td><span class="cell-off">${escapeHtml(text.off)}</span></td>`;
                }

                return `<td>${items
                  .map(
                    (item) =>
                      `<div class="shift" style="border-left-color: ${escapeHtml(
                        item.role?.color ?? "#64748b"
                      )};">
                        <div class="shift-name">${escapeHtml(item.shiftName)}${
                          item.warningCount > 0
                            ? `<span class="warning-mark">!</span>`
                            : ""
                        }</div>
                        <div class="shift-time">${escapeHtml(
                          formatSlotTime(item.slot, language)
                        )}</div>
                        <div class="shift-role">${escapeHtml(
                          item.role?.name ?? text.role
                        )}</div>
                      </div>`
                  )
                  .join("")}</td>`;
              })
              .join("")}
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>
  </section>

  <section class="section">
    <h2>${escapeHtml(text.employeeSummary)}</h2>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(text.employee)}</th>
          <th class="numeric">${escapeHtml(text.shifts)}</th>
          <th class="numeric">${escapeHtml(text.hours)}</th>
          <th class="numeric">${escapeHtml(text.weekend)}</th>
          <th class="numeric">${escapeHtml(text.difficult)}</th>
          <th class="numeric">${escapeHtml(text.target)}</th>
          <th class="numeric">${escapeHtml(text.max)}</th>
        </tr>
      </thead>
      <tbody>${employeeSummaryRows}</tbody>
    </table>
  </section>

  ${
    overLimitRows
      ? `<section class="section"><h2>${escapeHtml(
          language === "en" ? "Employee limit issues" : "Υπερβάσεις ορίων"
        )}</h2><ul>${overLimitRows}</ul></section>`
      : ""
  }

  ${
    issueRows
      ? `<section class="section"><h2>${escapeHtml(text.issueSection)}</h2>${issueRows}</section>`
      : `<section class="section"><h2>${escapeHtml(text.issueSection)}</h2><p>${escapeHtml(
          language === "en"
            ? "No unfilled shift issues were found."
            : "Δεν εντοπίστηκαν κενές θέσεις."
        )}</p></section>`
  }
  ${
    recommendationRows
      ? `<section class="section"><h2>${escapeHtml(text.recommendations)}</h2><ul>${recommendationRows}</ul></section>`
      : ""
  }
  ${
    managerWarningRows
      ? `<section class="section"><h2>${escapeHtml(text.warnings)}</h2><ul>${managerWarningRows}</ul></section>`
      : ""
  }
  ${
    technicalWarningCount > 0
      ? `<section class="section technical-note"><h2>${escapeHtml(
          text.technicalDetails
        )}</h2><p>${escapeHtml(text.technicalHidden)}</p></section>`
      : ""
  }
  <section class="section">
    <h2>${escapeHtml(text.notesTitle)}</h2>
    <ul>
      <li>${escapeHtml(
        language === "en"
          ? "Assignment score logs are intentionally excluded from this report."
          : "Οι τεχνικές σημειώσεις βαθμολόγησης αναθέσεων δεν εμφανίζονται στην κανονική αναφορά."
      )}</li>
      <li>${escapeHtml(
        language === "en"
          ? "The team PDF remains a clean employee schedule without constraints, preferences, explanations or contact details."
          : "Το PDF ομάδας κρατά μόνο το καθαρό πρόγραμμα και δεν περιλαμβάνει περιορισμούς, προτιμήσεις, εξηγήσεις ή στοιχεία επικοινωνίας."
      )}</li>
    </ul>
  </section>
</body>
</html>`;
}

function getEmployeeScheduleHours(employeeRow: EmployeeScheduleRow): number {
  return [...employeeRow.assignmentsByDate.values()]
    .flat()
    .reduce((total, item) => total + getSlotDurationHours(item.slot), 0);
}

function getEmployeeWeekendShiftCount(employeeRow: EmployeeScheduleRow): number {
  return [...employeeRow.assignmentsByDate.values()]
    .flat()
    .filter((item) => {
      const day = getDayOfWeek(item.slot.date);
      return day === 0 || day === 6;
    }).length;
}

function getEmployeeDifficultShiftCount(employeeRow: EmployeeScheduleRow): number {
  return [...employeeRow.assignmentsByDate.values()]
    .flat()
    .filter((item) => isDifficultScheduleSlot(item.slot)).length;
}

function isDifficultScheduleSlot(slot: ScheduleSlot): boolean {
  const startMinutes = timeStringToMinutes(slot.start_time);
  const endMinutes = timeStringToMinutes(slot.end_time);

  return endMinutes <= startMinutes || endMinutes > 22 * 60 || startMinutes < 6 * 60;
}

function timeStringToMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function formatHours(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatOptionalHours(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : formatHours(value);
}

function safeFileNamePart(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9]+/g, "");
  return cleaned || "JProgrammer";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function localizedDayLabels(language: UiLanguage): Array<{
  dayOfWeek: DayOfWeek;
  label: string;
  shortLabel: string;
}> {
  if (language === "en") {
    return [
      { dayOfWeek: 1, label: "Monday", shortLabel: "Mon" },
      { dayOfWeek: 2, label: "Tuesday", shortLabel: "Tue" },
      { dayOfWeek: 3, label: "Wednesday", shortLabel: "Wed" },
      { dayOfWeek: 4, label: "Thursday", shortLabel: "Thu" },
      { dayOfWeek: 5, label: "Friday", shortLabel: "Fri" },
      { dayOfWeek: 6, label: "Saturday", shortLabel: "Sat" },
      { dayOfWeek: 0, label: "Sunday", shortLabel: "Sun" }
    ];
  }

  return [
    { dayOfWeek: 1, label: "Δευτέρα", shortLabel: "Δευ" },
    { dayOfWeek: 2, label: "Τρίτη", shortLabel: "Τρι" },
    { dayOfWeek: 3, label: "Τετάρτη", shortLabel: "Τετ" },
    { dayOfWeek: 4, label: "Πέμπτη", shortLabel: "Πεμ" },
    { dayOfWeek: 5, label: "Παρασκευή", shortLabel: "Παρ" },
    { dayOfWeek: 6, label: "Σάββατο", shortLabel: "Σαβ" },
    { dayOfWeek: 0, label: "Κυριακή", shortLabel: "Κυρ" }
  ];
}

function dayLabel(dayOfWeek: number): string {
  return (
    dayLabels.find((day) => day.dayOfWeek === dayOfWeek)?.label ??
    "Day " + dayOfWeek
  );
}

function localizedDayName(dayOfWeek: DayOfWeek, language: UiLanguage): string {
  return (
    localizedDayLabels(language).find((day) => day.dayOfWeek === dayOfWeek)
      ?.label ?? String(dayOfWeek)
  );
}

function employeeName(
  employeeId: string,
  employees: Employee[],
  language: UiLanguage = "en"
): string {
  const employee = employees.find((item) => item.id === employeeId);

  if (!employee) {
    return language === "en" ? "Unknown employee" : "Άγνωστος εργαζόμενος";
  }

  return `${employee.first_name} ${employee.last_name}`;
}

export {
  RolePill,
  WarningBadge,
  buildEmployeeScheduleRows,
  buildManagerCoverageIssues,
  buildManagerReportPdfHtml,
  buildScheduleRows,
  buildShortageSummaryLines,
  buildTeamSchedulePdfHtml,
  dayLabel,
  employeeName,
  escapeHtml,
  formatCompactDateRange,
  formatDateEu,
  formatDateRangeEu,
  formatHours,
  formatSlotTime,
  formatOptionalHours,
  formatWeekRangeWithDays,
  getEmployeeDifficultShiftCount,
  getEmployeeScheduleHours,
  getEmployeeWeekendShiftCount,
  groupUnfilledSlotsByDate,
  groupWarningsBySlot,
  humanizeSchedulerWarningText,
  localizedDayLabels,
  localizedDayName,
  managerFriendlyWarningMessage,
  programStatusLabel,
  roleCoverageSummary,
  roleLabel,
  safeFileNamePart,
  scheduleRowKey,
  scheduleRunTypeLabel,
  shiftNameForSlot,
  shortEmployeeName,
  todayInputValue
};

export type { EmployeeScheduleItem, EmployeeScheduleRow, ManagerCoverageIssue, ScheduleRow };
