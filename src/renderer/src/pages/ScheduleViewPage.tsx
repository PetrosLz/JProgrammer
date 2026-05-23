import { useEffect, useMemo, useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import { pdfExportApi, PdfExportError } from "../../services/pdfExportApi";
import {
  addDays,
  getDayOfWeek,
  getSlotDurationHours,
  saveManualAssignmentChange,
  splitManualAssignmentViolations,
  validateManualAssignmentChange,
  type AssignmentResult,
  type ManualAssignmentValidation
} from "../../services/scheduler";
import type {
  BusinessSettings,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ScheduleWarning,
  ShiftTemplate,
  StaffingRequirement,
  TimeOff
} from "../../types";
import { DeleteProgramConfirmModal } from "../components/ConfirmActionModal";
import { ErrorList } from "../components/ErrorList";
import { Field } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { SummaryTile } from "../components/SummaryTile";
import { inputClassName, secondaryButtonClassName } from "../components/styles";
import { deleteGeneratedProgram } from "../utils/scheduleRuns";
import { getErrorMessage } from "../utils/errors";
import { appLanguage, type UiLanguage } from "../utils/localization";
import {
  WarningBadge,
  buildEmployeeScheduleRows,
  buildManagerCoverageIssues,
  buildManagerReportPdfHtml,
  buildScheduleRows,
  buildShortageSummaryLines,
  buildTeamSchedulePdfHtml,
  employeeName,
  formatCompactDateRange,
  formatDateEu,
  formatHours,
  groupUnfilledSlotsByDate,
  groupWarningsBySlot,
  localizedDayName,
  managerFriendlyWarningMessage,
  roleLabel,
  safeFileNamePart,
  scheduleRowKey,
  shiftNameForSlot,
  shortEmployeeName
} from "../utils/scheduleDisplay";

type AssignmentEditorState = {
  slot: ScheduleSlot;
  assignment: ScheduleAssignment | null;
  employeeId: string;
  confirmed: boolean;
  error: string | null;
};

export function ScheduleViewPage({
  businessSettings,
  selectedRunId,
  scheduleRuns,
  scheduleSlots,
  scheduleAssignments,
  scheduleWarnings,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  timeOff,
  roles,
  shiftTemplates,
  staffingRequirements,
  onSelectRun,
  onDeleted,
  onChanged
}: {
  businessSettings: BusinessSettings | null;
  selectedRunId: string | null;
  scheduleRuns: ScheduleRun[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  scheduleWarnings: ScheduleWarning[];
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  timeOff: TimeOff[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  onSelectRun: (runId: string) => void;
  onDeleted: (message: string) => Promise<void>;
  onChanged: (message: string) => Promise<void>;
}) {
  const [editor, setEditor] = useState<AssignmentEditorState | null>(null);
  const [viewMode, setViewMode] = useState<"employee" | "shift">("employee");
  const [isSaving, setIsSaving] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [exportingPdfType, setExportingPdfType] = useState<
    "team" | "manager" | null
  >(null);
  const [isDeletingProgram, setIsDeletingProgram] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const language = appLanguage(businessSettings);
  const selectedRun =
    scheduleRuns.find((run) => run.id === selectedRunId) ??
    [...scheduleRuns].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null;

  if (!selectedRun) {
    return (
      <div className="max-w-4xl">
        <SectionHeading
          title={language === "en" ? "Proposed Program" : "Προτεινόμενο πρόγραμμα"}
          description={
            language === "en"
              ? "Generate a program first, then review and edit it here."
              : "Δημιουργήστε πρώτα πρόγραμμα και μετά επεξεργαστείτε το εδώ."
          }
        />
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          {language === "en"
            ? "No proposed program exists yet."
            : "Δεν υπάρχει ακόμα προτεινόμενο πρόγραμμα."}
        </div>
      </div>
    );
  }

  const runSlots = scheduleSlots.filter(
    (slot) => slot.schedule_run_id === selectedRun.id
  );
  const runAssignments = scheduleAssignments.filter(
    (assignment) =>
      assignment.schedule_run_id === selectedRun.id &&
      assignment.status !== "cancelled" &&
      assignment.status !== "removed"
  );
  const assignmentBySlotId = new Map(
    runAssignments.map((assignment) => [assignment.schedule_slot_id, assignment])
  );
  const warningsBySlotId = groupWarningsBySlot(scheduleWarnings, selectedRun.id);
  const dates = Array.from({ length: 7 }, (_, index) =>
    addDays(selectedRun.start_date, index)
  );
  const shiftRows = buildScheduleRows(
    runSlots,
    staffingRequirements,
    shiftTemplates
  );
  const managerCoverageIssues = buildManagerCoverageIssues({
    runSlots,
    runAssignments,
    roles,
    shiftTemplates,
    staffingRequirements,
    language
  });
  const employeeRows = buildEmployeeScheduleRows({
    employees,
    runSlots,
    runAssignments,
    roles,
    shiftTemplates,
    staffingRequirements,
    warningsBySlotId,
    coverageIssues: managerCoverageIssues,
    language
  });
  const unfilledSlotsByDate = groupUnfilledSlotsByDate({
    runSlots,
    assignmentBySlotId
  });
  const assignedSlotIds = new Set(
    runAssignments.map((assignment) => assignment.schedule_slot_id)
  );
  const unfilledSlotCount = runSlots.filter(
    (slot) => slot.status !== "filled" && !assignedSlotIds.has(slot.id)
  ).length;
  const runWarnings = scheduleWarnings.filter(
    (warning) => warning.schedule_run_id === selectedRun.id
  );
  const businessName = businessSettings?.business_name?.trim() || "JProgrammer";
  const modalValidation = editor
    ? validateManualAssignmentChange({
        slot: editor.slot,
        employeeId: editor.employeeId || null,
        currentAssignment: editor.assignment,
        employees,
        employeeRoles,
        employeeWorkRules,
        employeeDayConstraints,
        employeeShiftAvailability,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments
      })
    : null;

  async function saveEditor() {
    if (!editor) {
      return;
    }

    const validation = validateManualAssignmentChange({
      slot: editor.slot,
      employeeId: editor.employeeId || null,
      currentAssignment: editor.assignment,
      employees,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      staffingRequirements,
      roles,
      timeOff,
      scheduleSlots,
      scheduleAssignments
    });

    const splitViolations = splitManualAssignmentViolations(
      validation.violations
    );

    if (splitViolations.hard.length > 0) {
      setEditor({
        ...editor,
        error:
          language === "en"
            ? "This change violates hard rules and cannot be saved automatically."
            : "Αυτή η αλλαγή παραβιάζει σκληρούς κανόνες και δεν μπορεί να αποθηκευτεί αυτόματα."
      });
      return;
    }

    setIsSaving(true);

    try {
      await saveManualAssignmentChange({
        slot: editor.slot,
        employeeId: editor.employeeId || null,
        currentAssignment: editor.assignment,
        employees,
        employeeRoles,
        employeeWorkRules,
        employeeDayConstraints,
        employeeShiftAvailability,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments
      });
      setEditor(null);
      await onChanged(
        language === "en" ? "Proposed program updated." : "Το πρόγραμμα ενημερώθηκε."
      );
    } catch (error) {
      setEditor({ ...editor, error: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }

  async function removeAssignment() {
    if (!editor?.assignment) {
      return;
    }

    setIsSaving(true);

    try {
      await saveManualAssignmentChange({
        slot: editor.slot,
        employeeId: null,
        currentAssignment: editor.assignment,
        employees,
        employeeRoles,
        employeeWorkRules,
        employeeDayConstraints,
        employeeShiftAvailability,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments
      });
      setEditor(null);
      await onChanged(
        language === "en" ? "Assignment removed." : "Η ανάθεση αφαιρέθηκε."
      );
    } catch (error) {
      setEditor({ ...editor, error: getErrorMessage(error) });
    } finally {
      setIsSaving(false);
    }
  }

  async function exportSchedulePdf(exportType: "team" | "manager") {
    setExportError("");
    setExportNotice("");

    if (!selectedRun) {
      setExportError("Δεν έχει επιλεγεί πρόγραμμα για εξαγωγή.");
      return;
    }

    if (!selectedRun.start_date || !selectedRun.end_date) {
      setExportError("Το επιλεγμένο πρόγραμμα δεν έχει έγκυρη εβδομάδα.");
      return;
    }

    if (runAssignments.length === 0) {
      setExportError(
        "Δεν υπάρχουν αναθέσεις εργαζομένων για εξαγωγή PDF."
      );
      return;
    }

    setExportingPdfType(exportType);

    try {
      const unfilledSlots = runSlots.filter(
        (slot) => slot.status !== "filled" && !assignmentBySlotId.has(slot.id)
      );
      const html =
        exportType === "team"
          ? buildTeamSchedulePdfHtml({
              businessName,
              run: selectedRun,
              dates,
              employeeRows
            })
          : buildManagerReportPdfHtml({
              businessName,
              run: selectedRun,
              dates,
              employeeRows,
              runSlots,
              roles,
              shiftTemplates,
              staffingRequirements,
              warnings: runWarnings,
              unfilledSlots,
              employeeWorkRules,
              coverageIssues: managerCoverageIssues,
              language
            });
      const filePrefix =
        exportType === "team" ? "Programma_Omadas" : "Manager_Report";
      const filePath = await pdfExportApi.exportPdf({
        html,
        defaultFileName: `${safeFileNamePart(
          businessName
        )}_${filePrefix}_${selectedRun.start_date}_to_${selectedRun.end_date}.pdf`
      });

      setExportNotice(`Το PDF αποθηκεύτηκε: ${filePath}`);
    } catch (error) {
      if (error instanceof PdfExportError && error.cancelled) {
        setExportNotice("Η εξαγωγή PDF ακυρώθηκε.");
      } else {
        setExportError(getErrorMessage(error));
      }
    } finally {
      setExportingPdfType(null);
    }
  }

  async function deleteCurrentProgram() {
    setExportError("");
    setExportNotice("");
    setIsDeletingProgram(true);

    try {
      await deleteGeneratedProgram({
        runId: selectedRun.id,
        scheduleSlots,
        scheduleAssignments,
        scheduleWarnings
      });
      setIsDeleteConfirmOpen(false);
      await onDeleted(
        language === "en" ? "Program deleted." : "Το πρόγραμμα διαγράφηκε."
      );
    } catch (error) {
      setExportError(getErrorMessage(error));
    } finally {
      setIsDeletingProgram(false);
    }
  }

  return (
    <div className="max-w-[1600px]">
      <div className="flex items-start justify-between gap-4">
        <SectionHeading
          title={language === "en" ? "Proposed Program" : "Προτεινόμενο πρόγραμμα"}
          description={
            language === "en"
              ? "Review assigned employees, unfilled needs and warnings before export."
              : "Ελέγξτε αναθέσεις, κενές βάρδιες και προειδοποιήσεις πριν την εξαγωγή."
          }
        />
        <div className="flex flex-wrap items-start justify-end gap-3">
          <Field label={language === "en" ? "View program" : "Προβολή προγράμματος"}>
            <select
              value={selectedRun.id}
              onChange={(event) => onSelectRun(event.target.value)}
              className={inputClassName}
            >
              {[...scheduleRuns]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((run) => (
                  <option key={run.id} value={run.id}>
                    {formatCompactDateRange(run.start_date, run.end_date, language)}
                  </option>
                ))}
            </select>
          </Field>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => void exportSchedulePdf("team")}
              disabled={exportingPdfType !== null}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {exportingPdfType === "team"
                ? "Εξαγωγή..."
                : "Εξαγωγή για ομάδα"}
            </button>
            <span className="text-xs text-slate-500">
              Καθαρό πρόγραμμα για αποστολή στους εργαζόμενους.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => void exportSchedulePdf("manager")}
              disabled={exportingPdfType !== null}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {exportingPdfType === "manager"
                ? "Εξαγωγή..."
                : "Αναφορά manager"}
            </button>
            <span className="text-xs text-slate-500">
              Περιέχει ώρες, κενές βάρδιες και προειδοποιήσεις.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsDeleteConfirmOpen(true)}
            disabled={isDeletingProgram}
            className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {isDeletingProgram
              ? language === "en"
                ? "Deleting..."
                : "Διαγραφή..."
              : language === "en"
                ? "Delete"
                : "Διαγραφή"}
          </button>
        </div>
      </div>

      {exportError ? <ErrorList errors={[exportError]} /> : null}
      {exportNotice ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {exportNotice}
        </div>
      ) : null}

      {unfilledSlotCount > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            {language === "en"
              ? "The schedule was generated, but it is not fully covered."
              : "Το πρόγραμμα δημιουργήθηκε, αλλά δεν καλύπτεται πλήρως."}
          </p>
          <div className="mt-1 space-y-1">
            {buildShortageSummaryLines({
              issues: managerCoverageIssues,
              unfilledSlotCount,
              language
            })
              .slice(1, 4)
              .map((line) => (
                <p key={line}>{line}</p>
              ))}
          </div>
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-6 gap-4">
        <SummaryTile label={language === "en" ? "Business" : "Επιχείρηση"} value={businessName} />
        <SummaryTile
          label={language === "en" ? "Period" : "Περίοδος"}
          value={formatCompactDateRange(selectedRun.start_date, selectedRun.end_date, language)}
        />
        <SummaryTile label={language === "en" ? "Slots" : "Θέσεις"} value={runSlots.length} />
        <SummaryTile label={language === "en" ? "Assigned" : "Ανατέθηκαν"} value={runAssignments.length} />
        <SummaryTile label={language === "en" ? "Unfilled" : "Κενές"} value={unfilledSlotCount} />
        <SummaryTile label={language === "en" ? "Warnings" : "Προειδοποιήσεις"} value={runWarnings.length} />
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-normal text-slate-900">
              {language === "en" ? "Weekly schedule" : "Εβδομαδιαίο πρόγραμμα"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {language === "en"
                ? "Review the proposed weekly schedule and make manual changes where needed."
                : "Ελέγξτε το προτεινόμενο εβδομαδιαίο πρόγραμμα και κάντε αλλαγές όπου χρειάζεται."}
            </p>
          </div>
          <div className="inline-flex rounded-md border border-slate-300 bg-white p-1">
            <button
              type="button"
              onClick={() => setViewMode("employee")}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                viewMode === "employee"
                  ? "bg-emerald-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {language === "en" ? "By employee" : "Ανά εργαζόμενο"}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("shift")}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                viewMode === "shift"
                  ? "bg-emerald-700 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {language === "en" ? "By shift" : "Ανά βάρδια"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {viewMode === "employee" ? (
            <div className="min-w-[1180px]">
              <div className="grid grid-cols-[220px_repeat(7,minmax(130px,1fr))] bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <div className="px-4 py-3">
                  {language === "en" ? "Employee" : "Εργαζόμενος"}
                </div>
                {dates.map((date) => (
                  <div key={date} className="px-3 py-3">
                    <p className="whitespace-nowrap">
                      {localizedDayName(getDayOfWeek(date), language)}
                    </p>
                    <p className="whitespace-nowrap font-medium normal-case tracking-normal text-slate-700">
                      {formatDateEu(date)}
                    </p>
                  </div>
                ))}
              </div>
              {employeeRows.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  {language === "en"
                    ? "No employees are available for this proposed program."
                    : "Δεν υπάρχουν εργαζόμενοι για αυτό το πρόγραμμα."}
                </div>
              ) : (
                employeeRows.map((employeeRow) => (
                  <div
                    key={employeeRow.employee.id}
                    className="grid grid-cols-[220px_repeat(7,minmax(130px,1fr))] border-t border-slate-200"
                  >
                    <div className="border-r border-slate-200 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {employeeName(employeeRow.employee.id, employees, language)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {employeeRow.assignmentCount}{" "}
                        {language === "en"
                          ? `shift${employeeRow.assignmentCount === 1 ? "" : "s"}`
                          : employeeRow.assignmentCount === 1
                            ? "βάρδια"
                            : "βάρδιες"}
                      </p>
                    </div>
                    {dates.map((date) => {
                      const items = employeeRow.assignmentsByDate.get(date) ?? [];
                      const openSlot = unfilledSlotsByDate.get(date)?.[0] ?? null;

                      if (items.length === 0) {
                        return (
                          <button
                            key={`${employeeRow.employee.id}-${date}`}
                            type="button"
                            disabled={!openSlot}
                            onClick={() => {
                              if (!openSlot) {
                                return;
                              }

                              setEditor({
                                slot: openSlot,
                                assignment: null,
                                employeeId: employeeRow.employee.id,
                                confirmed: false,
                                error: null
                              });
                            }}
                            className="min-h-20 border-r border-slate-100 px-3 py-3 text-left text-sm text-slate-400 hover:bg-emerald-50 disabled:hover:bg-transparent"
                          >
                            {language === "en" ? "Off" : "Ρεπό"}
                          </button>
                        );
                      }

                      return (
                        <div
                          key={`${employeeRow.employee.id}-${date}`}
                          className="min-h-20 border-r border-slate-100 px-2 py-2"
                        >
                          <div className="space-y-1.5">
                            {items.map((item) => (
                              <button
                                key={item.assignment.id}
                                type="button"
                                onClick={() =>
                                  setEditor({
                                    slot: item.slot,
                                    assignment: item.assignment,
                                    employeeId: item.employee.id,
                                    confirmed: false,
                                    error: null
                                  })
                                }
                                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-left hover:border-emerald-300 hover:bg-emerald-50"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                                    style={{
                                      backgroundColor: item.role?.color ?? "#64748b"
                                    }}
                                  />
                                  {item.warningCount > 0 ? (
                                    <WarningBadge messages={item.warningMessages} />
                                  ) : null}
                                </div>
                                <p className="mt-1 truncate text-xs font-semibold text-slate-900">
                                  {item.shiftName}
                                </p>
                                <p className="whitespace-nowrap text-xs text-slate-600">
                                  {item.slot.start_time}–{item.slot.end_time}
                                </p>
                                <p className="truncate text-xs text-slate-500">
                                  {item.role?.name ?? (language === "en" ? "Role" : "Ρόλος")}
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="min-w-[1180px]">
              <div className="grid grid-cols-[180px_repeat(7,minmax(130px,1fr))] bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <div className="px-4 py-3">
                  {language === "en" ? "Shift" : "Βάρδια"}
                </div>
                {dates.map((date) => (
                  <div key={date} className="px-3 py-3">
                    <p className="whitespace-nowrap">
                      {localizedDayName(getDayOfWeek(date), language)}
                    </p>
                    <p className="whitespace-nowrap font-medium normal-case tracking-normal text-slate-700">
                      {formatDateEu(date)}
                    </p>
                  </div>
                ))}
              </div>
              {shiftRows.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  {language === "en"
                    ? "This proposed program has no slots."
                    : "Αυτό το πρόγραμμα δεν έχει θέσεις."}
                </div>
              ) : (
                shiftRows.map((row) => (
                  <div
                    key={row.key}
                    className="grid grid-cols-[180px_repeat(7,minmax(130px,1fr))] border-t border-slate-200"
                  >
                    <div className="border-r border-slate-200 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {row.label}
                      </p>
                      <p className="mt-1 whitespace-nowrap text-xs text-slate-500">
                        {row.startTime} - {row.endTime}
                      </p>
                    </div>
                    {dates.map((date) => {
                      const cellSlots = runSlots
                        .filter(
                          (slot) =>
                            slot.date === date &&
                            scheduleRowKey(slot, staffingRequirements) === row.key
                        )
                        .sort((a, b) => a.role_id.localeCompare(b.role_id));

                      return (
                        <div
                          key={`${row.key}-${date}`}
                          className="min-h-20 border-r border-slate-100 px-3 py-3"
                        >
                          {cellSlots.length === 0 ? (
                            <p className="text-xs text-slate-300">-</p>
                          ) : (
                            <div className="space-y-1">
                              {cellSlots.map((slot) => {
                                const assignment = assignmentBySlotId.get(slot.id) ?? null;
                                const assignedEmployee = assignment
                                  ? employees.find(
                                      (employee) =>
                                        employee.id === assignment.employee_id
                                    ) ?? null
                                  : null;
                                const role = roles.find((item) => item.id === slot.role_id) ?? null;
                                const warningMessages = (
                                  warningsBySlotId.get(slot.id) ?? []
                                ).map((warning) =>
                                  managerFriendlyWarningMessage({
                                    warning,
                                    slot,
                                    coverageIssues: managerCoverageIssues,
                                    staffingRequirements,
                                    language
                                  })
                                );

                                return (
                                  <button
                                    key={slot.id}
                                    type="button"
                                    onClick={() =>
                                      setEditor({
                                        slot,
                                        assignment,
                                        employeeId: assignment?.employee_id ?? "",
                                        confirmed: false,
                                        error: null
                                      })
                                    }
                                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-emerald-50"
                                  >
                                    <span
                                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                                      style={{
                                        backgroundColor: role?.color ?? "#64748b"
                                      }}
                                    />
                                    <span className="truncate text-slate-700">
                                      {assignedEmployee
                                        ? shortEmployeeName(assignedEmployee)
                                        : language === "en"
                                          ? "Unfilled"
                                          : "Κενή"}
                                    </span>
                                    {warningMessages.length > 0 ? (
                                      <span className="ml-auto">
                                        <WarningBadge messages={warningMessages} />
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {editor ? (
        <AssignmentEditorModal
          editor={editor}
          employees={employees}
          employeeRoles={employeeRoles}
          employeeWorkRules={employeeWorkRules}
          employeeDayConstraints={employeeDayConstraints}
          employeeShiftAvailability={employeeShiftAvailability}
          timeOff={timeOff}
          roles={roles}
          shiftTemplates={shiftTemplates}
          staffingRequirements={staffingRequirements}
          scheduleSlots={scheduleSlots}
          scheduleAssignments={scheduleAssignments}
          language={language}
          validation={modalValidation}
          isSaving={isSaving}
          onChange={(next) => setEditor(next)}
          onClose={() => setEditor(null)}
          onRemove={() => void removeAssignment()}
          onSave={() => void saveEditor()}
        />
      ) : null}
      {isDeleteConfirmOpen ? (
        <DeleteProgramConfirmModal
          language={language}
          dateRange={formatCompactDateRange(
            selectedRun.start_date,
            selectedRun.end_date,
            language
          )}
          isDeleting={isDeletingProgram}
          onCancel={() => setIsDeleteConfirmOpen(false)}
          onConfirm={() => void deleteCurrentProgram()}
        />
      ) : null}
    </div>
  );
}

type ManualCandidateRow = {
  employee: Employee;
  validation: ManualAssignmentValidation;
  hardViolations: string[];
  softWarnings: string[];
  status: "recommended" | "warning" | "blocked";
  roleSummary: string;
  hoursSummary: string;
  reasonSummary: string;
};

function AssignmentEditorModal({
  editor,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  timeOff,
  roles,
  shiftTemplates,
  staffingRequirements,
  scheduleSlots,
  scheduleAssignments,
  language,
  validation,
  isSaving,
  onChange,
  onClose,
  onRemove,
  onSave
}: {
  editor: AssignmentEditorState;
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  timeOff: TimeOff[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  language: UiLanguage;
  validation: ManualAssignmentValidation | null;
  isSaving: boolean;
  onChange: (editor: AssignmentEditorState) => void;
  onClose: () => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const role = roles.find((item) => item.id === editor.slot.role_id) ?? null;
  const roleName = role?.name ?? (language === "en" ? "Role" : "Ρόλος");
  const shiftName = shiftNameForSlot(editor.slot, staffingRequirements, shiftTemplates);
  const currentEmployee = editor.assignment
    ? employees.find((employee) => employee.id === editor.assignment?.employee_id) ??
      null
    : null;
  const selectedSplit = splitManualAssignmentViolations(
    validation?.violations ?? []
  );
  const selectedHardViolations = selectedSplit.hard.map((violation) =>
    translateManualAssignmentViolation(violation, roleName, language)
  );
  const selectedSoftWarnings = selectedSplit.soft.map((violation) =>
    translateManualAssignmentViolation(violation, roleName, language)
  );
  const selectedEmployeeName = validation?.employee
    ? employeeName(validation.employee.id, [validation.employee], language)
    : "";
  const title = editor.assignment
    ? language === "en"
      ? "Edit assignment"
      : "Επεξεργασία ανάθεσης"
    : language === "en"
      ? "Fill unfilled position"
      : "Κάλυψη κενής θέσης";
  const candidates = useMemo(
    () =>
      buildManualCandidateRows({
        editor,
        employees,
        employeeRoles,
        employeeWorkRules,
        employeeDayConstraints,
        employeeShiftAvailability,
        timeOff,
        roles,
        staffingRequirements,
        scheduleSlots,
        scheduleAssignments,
        language
      }),
    [
      editor,
      employees,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      timeOff,
      roles,
      staffingRequirements,
      scheduleSlots,
      scheduleAssignments,
      language
    ]
  );
  const saveDisabled =
    isSaving || !editor.employeeId || selectedHardViolations.length > 0;
  const saveLabel = isSaving
    ? language === "en"
      ? "Saving..."
      : "Αποθήκευση..."
    : !editor.assignment
      ? language === "en"
        ? "Assign employee"
        : "Ανάθεση εργαζομένου"
      : selectedSoftWarnings.length > 0
        ? language === "en"
          ? "Save with warning"
          : "Αποθήκευση με προειδοποίηση"
        : language === "en"
          ? "Save change"
          : "Αποθήκευση αλλαγής";

  useEffect(() => {
    setConfirmRemove(false);
  }, [editor.assignment?.id, editor.slot.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h3 className="text-lg font-semibold tracking-normal text-slate-950">
              {title}
            </h3>
            <div className="mt-2 space-y-1 text-sm text-slate-600">
              <p className="font-semibold text-slate-800">
                {localizedDayName(getDayOfWeek(editor.slot.date), language)}{" "}
                {formatDateEu(editor.slot.date)}
              </p>
              <p>
                {shiftName} · {editor.slot.start_time}–{editor.slot.end_time}
              </p>
              <p>
                {language === "en" ? "Role" : "Ρόλος"}:{" "}
                <span className="font-semibold text-slate-900">{roleName}</span>
              </p>
              <p>
                {language === "en" ? "Current assignment" : "Τρέχουσα ανάθεση"}:{" "}
                <span className="font-semibold text-slate-900">
                  {currentEmployee
                    ? employeeName(currentEmployee.id, [currentEmployee], language)
                    : language === "en"
                      ? "Unfilled"
                      : "Κενή θέση"}
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClassName}
          >
            {language === "en" ? "Close" : "Κλείσιμο"}
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {editor.error ? <ErrorList errors={[editor.error]} /> : null}

          <div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-950">
                  {language === "en"
                    ? "Choose employee"
                    : "Επιλογή εργαζομένου"}
                </h4>
                <p className="mt-1 text-sm text-slate-500">
                  {language === "en"
                    ? "Recommended candidates appear first. Blocked candidates explain the rule that prevents assignment."
                    : "Οι προτεινόμενοι εργαζόμενοι εμφανίζονται πρώτοι. Οι μη διαθέσιμοι δείχνουν τον λόγο."}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-2">
              {candidates.map((candidate) => {
                const isSelected = editor.employeeId === candidate.employee.id;
                const statusClass =
                  candidate.status === "recommended"
                    ? "border-emerald-200 bg-emerald-50"
                    : candidate.status === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-white";
                const statusLabel =
                  candidate.status === "recommended"
                    ? language === "en"
                      ? "Recommended"
                      : "Προτεινόμενος"
                    : candidate.status === "warning"
                      ? language === "en"
                        ? "Available with warning"
                        : "Διαθέσιμος με προειδοποίηση"
                      : language === "en"
                        ? "Cannot assign"
                        : "Δεν μπορεί";

                return (
                  <button
                    key={candidate.employee.id}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...editor,
                        employeeId: candidate.employee.id,
                        confirmed: false,
                        error: null
                      })
                    }
                    className={[
                      "rounded-lg border px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50",
                      statusClass,
                      isSelected ? "ring-2 ring-emerald-600" : ""
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {employeeName(
                            candidate.employee.id,
                            [candidate.employee],
                            language
                          )}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          {candidate.roleSummary} · {candidate.hoursSummary}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {candidate.reasonSummary}
                        </p>
                      </div>
                      <span
                        className={[
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          candidate.status === "recommended"
                            ? "bg-emerald-100 text-emerald-800"
                            : candidate.status === "warning"
                              ? "bg-amber-100 text-amber-900"
                              : "bg-slate-100 text-slate-600"
                        ].join(" ")}
                      >
                        {statusLabel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-950">
              {language === "en" ? "Validation" : "Έλεγχος ανάθεσης"}
            </p>
            {!editor.employeeId ? (
              <p className="mt-2 text-sm text-slate-600">
                {language === "en"
                  ? "Choose an employee to check whether the assignment is allowed."
                  : "Επιλέξτε εργαζόμενο για να γίνει έλεγχος κανόνων."}
              </p>
            ) : selectedHardViolations.length > 0 ? (
              <div className="mt-2">
                <p className="text-sm font-semibold text-red-800">
                  {language === "en"
                    ? "Cannot be assigned:"
                    : "Δεν μπορεί να ανατεθεί:"}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-800">
                  {selectedHardViolations.map((violation) => (
                    <li key={violation}>{violation}</li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-red-700">
                  {language === "en"
                    ? "This change violates hard rules and cannot be saved automatically."
                    : "Αυτή η αλλαγή παραβιάζει σκληρούς κανόνες και δεν μπορεί να αποθηκευτεί αυτόματα."}
                </p>
              </div>
            ) : selectedSoftWarnings.length > 0 ? (
              <div className="mt-2">
                <p className="text-sm font-semibold text-amber-900">
                  {language === "en"
                    ? "This assignment can be saved with warning:"
                    : "Η ανάθεση μπορεί να αποθηκευτεί με προειδοποίηση:"}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                  {selectedSoftWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-sm font-semibold text-emerald-800">
                {language === "en"
                  ? `${selectedEmployeeName} can be assigned to this slot.`
                  : `Η ανάθεση είναι έγκυρη για ${selectedEmployeeName}.`}
              </p>
            )}
          </div>

          {confirmRemove ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="text-sm font-semibold text-red-900">
                {language === "en"
                  ? "Remove employee from this slot?"
                  : "Αφαίρεση εργαζομένου από αυτή τη θέση;"}
              </p>
              <p className="mt-1 text-sm leading-6 text-red-800">
                {language === "en"
                  ? "This slot will become unfilled and will appear as a schedule warning."
                  : "Η θέση θα μείνει κενή και θα εμφανιστεί ως προειδοποίηση στο πρόγραμμα."}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmRemove(false)}
                  disabled={isSaving}
                  className={secondaryButtonClassName}
                >
                  {language === "en" ? "Cancel" : "Ακύρωση"}
                </button>
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={isSaving}
                  className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {language === "en"
                    ? "Remove employee"
                    : "Αφαίρεση εργαζομένου"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={() => setConfirmRemove(true)}
            disabled={!editor.assignment || isSaving}
            className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {language === "en"
              ? "Remove employee from this slot"
              : "Αφαίρεση εργαζομένου"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className={secondaryButtonClassName}
            >
              {language === "en" ? "Cancel" : "Ακύρωση"}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saveDisabled}
              className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildManualCandidateRows({
  editor,
  employees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  timeOff,
  roles,
  staffingRequirements,
  scheduleSlots,
  scheduleAssignments,
  language
}: {
  editor: AssignmentEditorState;
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  timeOff: TimeOff[];
  roles: Role[];
  staffingRequirements: StaffingRequirement[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  language: UiLanguage;
}): ManualCandidateRow[] {
  const roleName =
    roles.find((role) => role.id === editor.slot.role_id)?.name ??
    (language === "en" ? "Role" : "Ρόλος");

  return [...employees]
    .map((employee) => {
      const validation = validateManualAssignmentChange({
        slot: editor.slot,
        employeeId: employee.id,
        currentAssignment: editor.assignment,
        employees,
        employeeRoles,
        employeeWorkRules,
        employeeDayConstraints,
        employeeShiftAvailability,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments
      });
      const split = splitManualAssignmentViolations(validation.violations);
      const status: ManualCandidateRow["status"] =
        split.hard.length > 0
          ? "blocked"
          : split.soft.length > 0
            ? "warning"
            : "recommended";
      const reasonSource = split.hard[0] ?? split.soft[0] ?? null;
      const reasonSummary = reasonSource
        ? translateManualAssignmentViolation(reasonSource, roleName, language)
        : language === "en"
          ? "Available for this shift."
          : "Διαθέσιμος για αυτή τη βάρδια.";

      return {
        employee,
        validation,
        hardViolations: split.hard,
        softWarnings: split.soft,
        status,
        roleSummary: getEmployeeRoleSummary(employee.id, employeeRoles, roles, language),
        hoursSummary: getManualCandidateHoursSummary({
          employeeId: employee.id,
          slot: editor.slot,
          currentAssignment: editor.assignment,
          scheduleSlots,
          scheduleAssignments,
          employeeWorkRules,
          language
        }),
        reasonSummary
      };
    })
    .sort((left, right) => {
      const statusRank: Record<ManualCandidateRow["status"], number> = {
        recommended: 0,
        warning: 1,
        blocked: 2
      };

      return (
        statusRank[left.status] - statusRank[right.status] ||
        left.employee.last_name.localeCompare(right.employee.last_name) ||
        left.employee.first_name.localeCompare(right.employee.first_name) ||
        left.employee.id.localeCompare(right.employee.id)
      );
    });
}

function translateManualAssignmentViolation(
  violation: string,
  roleName: string,
  language: UiLanguage
): string {
  if (language === "en") {
    return violation;
  }

  if (/inactive/i.test(violation)) {
    return "Ο εργαζόμενος είναι ανενεργός.";
  }

  if (/does not have the required role/i.test(violation)) {
    return `Δεν έχει τον ρόλο ${roleName}.`;
  }

  if (/does not meet the required experience/i.test(violation)) {
    return "Δεν καλύπτει την απαιτούμενη προϋπηρεσία για αυτόν τον ρόλο.";
  }

  if (/time off/i.test(violation)) {
    return "Έχει άδεια ή ρεπό αυτή την ημερομηνία.";
  }

  if (/cannot work on this day/i.test(violation)) {
    return "Δεν μπορεί να δουλέψει αυτή την ημέρα.";
  }

  if (/not available for this shift/i.test(violation)) {
    return "Δεν είναι διαθέσιμος για αυτή τη βάρδια.";
  }

  if (/already has a shift on this date/i.test(violation)) {
    return "Έχει ήδη βάρδια την ίδια ημέρα.";
  }

  if (/overlapping shift/i.test(violation)) {
    return "Έχει ήδη βάρδια που επικαλύπτεται χρονικά.";
  }

  if (/cannot work weekends/i.test(violation)) {
    return "Δεν μπορεί να δουλεύει Σαββατοκύριακο.";
  }

  const maxHoursMatch = violation.match(/max weekly hours \(([^)]+)\)/i);
  if (maxHoursMatch) {
    return `Θα ξεπεράσει το εβδομαδιαίο όριο ωρών (${maxHoursMatch[1]}).`;
  }

  const maxDaysMatch = violation.match(/max weekly days \(([^)]+)\)/i);
  if (maxDaysMatch) {
    return `Θα ξεπεράσει το εβδομαδιαίο όριο ημερών (${maxDaysMatch[1]}).`;
  }

  if (/needs .*prior experience/i.test(violation)) {
    return `Η βάρδια χρειάζεται τουλάχιστον έναν εργαζόμενο με προϋπηρεσία για τον ρόλο ${roleName}.`;
  }

  if (/has no .*prior experience/i.test(violation)) {
    return `Η βάρδια δεν έχει εργαζόμενο με προϋπηρεσία για τον ρόλο ${roleName}.`;
  }

  if (/Two no-experience/i.test(violation)) {
    return `Δύο εργαζόμενοι χωρίς προϋπηρεσία μπαίνουν μαζί στον ρόλο ${roleName}.`;
  }

  if (/No lead employee/i.test(violation)) {
    return `Δεν έχει οριστεί υπεύθυνος εργαζόμενος για τον ρόλο ${roleName}.`;
  }

  if (/could not be found/i.test(violation)) {
    return "Ο επιλεγμένος εργαζόμενος δεν βρέθηκε.";
  }

  return "Υπάρχει προειδοποίηση για αυτή την ανάθεση.";
}

function getEmployeeRoleSummary(
  employeeId: string,
  employeeRoles: EmployeeRole[],
  roles: Role[],
  language: UiLanguage
): string {
  const names = employeeRoles
    .filter((employeeRole) => employeeRole.employee_id === employeeId)
    .map(
      (employeeRole) =>
        roles.find((role) => role.id === employeeRole.role_id)?.name ?? null
    )
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) {
    return language === "en" ? "No roles" : "Χωρίς ρόλους";
  }

  return names.join(", ");
}

function getManualCandidateHoursSummary({
  employeeId,
  slot,
  currentAssignment,
  scheduleSlots,
  scheduleAssignments,
  employeeWorkRules,
  language
}: {
  employeeId: string;
  slot: ScheduleSlot;
  currentAssignment: ScheduleAssignment | null;
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  employeeWorkRules: EmployeeWorkRules[];
  language: UiLanguage;
}): string {
  const slotById = new Map(scheduleSlots.map((item) => [item.id, item]));
  const currentHours = scheduleAssignments
    .filter(
      (assignment) =>
        assignment.schedule_run_id === slot.schedule_run_id &&
        assignment.employee_id === employeeId &&
        assignment.status !== "cancelled" &&
        assignment.status !== "removed" &&
        assignment.id !== currentAssignment?.id &&
        assignment.schedule_slot_id !== slot.id
    )
    .reduce((total, assignment) => {
      const assignedSlot = slotById.get(assignment.schedule_slot_id);
      return assignedSlot ? total + getSlotDurationHours(assignedSlot) : total;
    }, 0);
  const projectedHours = currentHours + getSlotDurationHours(slot);
  const workRules = employeeWorkRules.find(
    (rules) => rules.employee_id === employeeId
  );
  const contractHours =
    workRules?.contract_hours_per_week ??
    workRules?.target_hours_per_week ??
    workRules?.preferred_hours_per_week ??
    workRules?.max_hours_per_week ??
    null;
  const hoursLabel = language === "en" ? "h" : " ώρες";

  if (contractHours === null || contractHours === undefined) {
    return `${formatHours(projectedHours)}${hoursLabel}`;
  }

  return `${formatHours(projectedHours)}/${formatHours(contractHours)}${hoursLabel}`;
}
