import { useEffect, useMemo, useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import { pdfExportApi, PdfExportError } from "../../services/pdfExportApi";
import {
  addDays,
  buildCanonicalScheduleSnapshot,
  buildRerunSchedulePlan,
  getDayOfWeek,
  getSlotDurationHours,
  saveManualAssignmentChange,
  setManualAssignmentLock,
  splitManualAssignmentViolations,
  validateManualAssignmentChange,
  type AssignmentResult,
  type CanonicalScheduleSnapshot,
  type ManualAssignmentValidation,
  type ScheduleEvaluationBreakdown,
  type ScheduleEvaluationGrade
} from "../../services/scheduler";
import type {
  BusinessSettings,
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeTimeConstraint,
  EmployeeWorkRules,
  OpeningHours,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ScheduleWarning,
  ShiftTemplate,
  SpecialDay,
  SpecialDayStaffingRequirement,
  StaffingRequirement,
  TimeOff
} from "../../types";
import {
  ConfirmActionModal,
  DeleteProgramConfirmModal
} from "../components/ConfirmActionModal";
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
  formatSlotTime,
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
  openingHours,
  specialDays,
  specialDayStaffingRequirements,
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
  employeeTimeConstraints,
  timeOff,
  roles,
  shiftTemplates,
  staffingRequirements,
  onSelectRun,
  onDeleted,
  onChanged
}: {
  businessSettings: BusinessSettings | null;
  openingHours: OpeningHours[];
  specialDays: SpecialDay[];
  specialDayStaffingRequirements: SpecialDayStaffingRequirement[];
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
  employeeTimeConstraints: EmployeeTimeConstraint[];
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
  const [isRerunConfirmOpen, setIsRerunConfirmOpen] = useState(false);
  const [isRerunningProgram, setIsRerunningProgram] = useState(false);
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

  const scheduleSnapshot = buildCanonicalScheduleSnapshot({
    run: selectedRun,
    scheduleSlots,
    scheduleAssignments,
    scheduleWarnings,
    employees,
    roles,
    employeeRoles,
    employeeWorkRules,
    employeeDayConstraints,
    employeeShiftAvailability,
    employeeTimeConstraints,
    timeOff,
    shiftTemplates,
    staffingRequirements,
    weekStartsOn: businessSettings?.week_starts_on ?? 1
  });
  const runSlots = scheduleSnapshot.runSlots;
  const activeRunAssignments = scheduleSnapshot.activeAssignments;
  const runAssignments = scheduleSnapshot.uniqueActiveAssignments;
  const assignmentBySlotId = scheduleSnapshot.assignmentBySlotId;
  const warningsBySlotId = scheduleSnapshot.warningsBySlotId;
  const dates = Array.from({ length: 7 }, (_, index) =>
    addDays(selectedRun.start_date, index)
  );
  const shiftRows = buildScheduleRows(
    runSlots,
    staffingRequirements,
    shiftTemplates,
    language
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
  const unfilledSlotsByDate = groupSlotsByDate(scheduleSnapshot.unfilledSlots);
  const unfilledSlotCount = scheduleSnapshot.unfilledSlotCount;
  const runWarnings = scheduleSnapshot.runWarnings;
  const scheduleEvaluation = scheduleSnapshot.evaluation;
  const snapshotCoveragePercent = Math.round(scheduleSnapshot.coverageRate * 100);
  const cpSatAttempt = scheduleSnapshot.solver.cpSatAttempt;
  const snapshotSummaryItems = [
    {
      label: language === "en" ? "Status" : "Κατάσταση",
      value: managerStatusLabel(scheduleSnapshot.managerStatus, language)
    },
    {
      label: language === "en" ? "Engine" : "Μηχανή",
      value: optimizerEngineLabelForUi(scheduleSnapshot.solver.engine, language)
    },
    {
      label: language === "en" ? "Solver result" : "Αποτέλεσμα solver",
      value: scheduleSnapshot.solver.solverStatus
    },
    {
      label: language === "en" ? "Validation" : "Έλεγχος",
      value: validationStatusLabelForUi(scheduleSnapshot.validationStatus, language)
    },
    {
      label: language === "en" ? "Coverage" : "Κάλυψη",
      value: `${scheduleSnapshot.uniqueAssignedSlotCount}/${scheduleSnapshot.totalSlots} (${snapshotCoveragePercent}%)`
    },
    {
      label: language === "en" ? "Proof" : "Απόδειξη",
      value: coverageProofLabelForUi(scheduleSnapshot, language)
    },
    {
      label: language === "en" ? "Locked" : "Κλειδωμένες",
      value: String(scheduleSnapshot.lockedAssignmentCount)
    },
    {
      label: language === "en" ? "Manual" : "Χειροκίνητες",
      value: String(scheduleSnapshot.manualAssignmentCount)
    },
    {
      label: language === "en" ? "Unfilled" : "Κενές",
      value: String(scheduleSnapshot.unfilledSlotCount)
    },
    {
      label: language === "en" ? "Hard issues" : "Σκληρά θέματα",
      value: String(scheduleSnapshot.hardIssueCount)
    }
  ];
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
        employeeTimeConstraints,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments,
        weekStartsOn: businessSettings?.week_starts_on ?? 1
      })
    : null;
  const lockedAssignmentCount = scheduleSnapshot.lockedAssignmentCount;
  const unlockedAssignmentCount =
    scheduleSnapshot.activeAssignmentCount - lockedAssignmentCount;
  const rerunConfirmTitle =
    language === "en" ? "Rerun scheduling" : "Επανεκτέλεση προγράμματος";
  const rerunConfirmBody =
    language === "en"
      ? `This will create a new schedule. ${lockedAssignmentCount} locked assignment(s) will be preserved, and ${unlockedAssignmentCount} unlocked assignment(s) may change. The old schedule will remain available.`
      : `Θα δημιουργηθεί νέο πρόγραμμα. ${lockedAssignmentCount} κλειδωμένες αναθέσεις θα διατηρηθούν, και ${unlockedAssignmentCount} ξεκλείδωτες αναθέσεις μπορεί να αλλάξουν. Το παλιό πρόγραμμα θα παραμείνει διαθέσιμο.`;
  const rerunConfirmLabel = language === "en" ? "Rerun" : "Επανεκτέλεση";
  const cancelLabel = language === "en" ? "Cancel" : "Ακύρωση";

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
      employeeTimeConstraints,
      staffingRequirements,
      roles,
      timeOff,
      scheduleSlots,
      scheduleAssignments,
      weekStartsOn: businessSettings?.week_starts_on ?? 1
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
        employeeTimeConstraints,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments,
        weekStartsOn: businessSettings?.week_starts_on ?? 1
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
        employeeTimeConstraints,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments,
        weekStartsOn: businessSettings?.week_starts_on ?? 1
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

  async function toggleAssignmentLock(assignment: ScheduleAssignment) {
    setIsSaving(true);

    try {
      await setManualAssignmentLock({
        assignment,
        locked: assignment.is_locked !== 1
      });
      setEditor((current) =>
        current?.assignment?.id === assignment.id
          ? {
              ...current,
              assignment: {
                ...assignment,
                is_locked: assignment.is_locked === 1 ? 0 : 1
              }
            }
          : current
      );
      await onChanged(assignment.is_locked === 1 ? (language === "en" ? "Assignment unlocked." : "Η ανάθεση ξεκλειδώθηκε.") : (language === "en" ? "Assignment locked." : "Η ανάθεση κλειδώθηκε."));
    } catch (error) {
      setEditor((current) =>
        current ? { ...current, error: getErrorMessage(error) } : current
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function rerunCurrentProgram() {
    setExportError("");
    setExportNotice("");
    setIsRerunningProgram(true);

    try {
      const rerunPlan = await buildRerunSchedulePlan({
        sourceRun: selectedRun,
        sourceRunSlots: runSlots,
        sourceRunAssignments: activeRunAssignments,
        allScheduleSlots: scheduleSlots,
        allScheduleAssignments: scheduleAssignments,
        openingHours,
        staffingRequirements,
        specialDays,
        specialDayStaffingRequirements,
        shiftTemplates,
        employees,
        employeeRoles,
        employeeWorkRules,
        employeeDayConstraints,
        employeeShiftAvailability,
        employeeTimeConstraints,
        timeOff,
        roles,
        weekStartsOn: businessSettings?.week_starts_on ?? 1
      });

      if (!rerunPlan.ok) {
        throw new Error(rerunPlan.message);
      }

      if (!rerunPlan.candidate.validation.valid || !rerunPlan.persistenceRequest) {
        throw new Error(
          `Automatic schedule validation failed. Nothing was saved. ${rerunPlan.candidate.validation.violations
            .map((violation) => violation.message)
            .join(" ")}`
        );
      }

      await databaseApi.persistCompleteGeneratedSchedule(
        rerunPlan.persistenceRequest
      );

      setIsRerunConfirmOpen(false);
      onSelectRun(rerunPlan.run.id);
      await onChanged(
        language === "en"
          ? "Rerun complete. The previous schedule remains available."
          : "Η επανεκτέλεση ολοκληρώθηκε. Το προηγούμενο πρόγραμμα παραμένει διαθέσιμο."
      );
    } catch (error) {
      setExportError(getErrorMessage(error));
    } finally {
      setIsRerunningProgram(false);
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

    if (exportType === "team" && scheduleSnapshot.managerStatus === "Invalid") {
      setExportError(
        language === "en"
          ? "The team PDF cannot be exported because the schedule has validation issues. Export the manager report to review the problem."
          : "Δεν μπορεί να εξαχθεί το PDF ομάδας γιατί το πρόγραμμα έχει θέματα ελέγχου. Εξαγάγετε την αναφορά manager για να δείτε το πρόβλημα."
      );
      return;
    }

    if (exportType === "team" && runAssignments.length === 0) {
      setExportError(
        "Δεν υπάρχουν αναθέσεις εργαζομένων για εξαγωγή PDF."
      );
      return;
    }

    setExportingPdfType(exportType);

    try {
      const unfilledSlots = scheduleSnapshot.unfilledSlots;
      const html =
        exportType === "team"
          ? buildTeamSchedulePdfHtml({
              businessName,
              run: selectedRun,
              dates,
              employeeRows,
              snapshot: scheduleSnapshot,
              language
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
              language,
              snapshot: scheduleSnapshot
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
        runId: selectedRun.id
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
            onClick={() => setIsRerunConfirmOpen(true)}
            disabled={isRerunningProgram}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {isRerunningProgram ? (language === "en" ? "Rerunning..." : "Γίνεται επανεκτέλεση...") : rerunConfirmLabel}
          </button>
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

      <div
        className={`mt-4 rounded-lg border bg-white p-4 shadow-sm ${managerStatusClassName(
          scheduleSnapshot.managerStatus
        )}`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {language === "en" ? "Schedule readiness" : "Έλεγχος προγράμματος"}
            </p>
            <h3 className="mt-1 text-base font-semibold tracking-normal text-slate-950">
              {managerStatusLabel(scheduleSnapshot.managerStatus, language)}
            </h3>
          </div>
          {cpSatAttempt ? (
            <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
              <span className="font-semibold text-slate-700">
                {language === "en" ? "CP-SAT attempt" : "CP-SAT προσπάθεια"}:
              </span>{" "}
              {cpSatAttemptLabelForUi(cpSatAttempt, language)}
            </div>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {snapshotSummaryItems.map((item) => (
            <div
              key={item.label}
              className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
            >
              <p className="text-[11px] font-semibold uppercase leading-4 tracking-wide text-slate-500 [overflow-wrap:anywhere]">
                {item.label}
              </p>
              <p className="mt-1 text-sm font-semibold leading-tight text-slate-950">
                {item.value}
              </p>
            </div>
          ))}
        </div>
        {scheduleSnapshot.invalidReasons.length > 0 ? (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <p className="font-semibold">
              {language === "en"
                ? "Validation issues"
                : "Θέματα ελέγχου"}
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {scheduleSnapshot.invalidReasons.slice(0, 5).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {language === "en" ? "Schedule quality" : "Ποιότητα προγράμματος"}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${qualityGradeClassName(
                  scheduleEvaluation.grade
                )}`}
              >
                {qualityGradeLabel(scheduleEvaluation.grade, language)}
              </span>
              <span className="text-sm text-slate-600">
                Reward{" "}
                <span className="font-semibold text-slate-950">
                  {Math.round(scheduleEvaluation.reward)}
                </span>
              </span>
            </div>
          </div>
          <div className="grid min-w-[260px] grid-cols-3 gap-2 text-center">
            <QualityMetric
              label={language === "en" ? "Coverage" : "Κάλυψη"}
              value={`${snapshotCoveragePercent}%`}
            />
            <QualityMetric
              label={language === "en" ? "Unfilled" : "Κενές"}
              value={scheduleSnapshot.unfilledSlotCount}
            />
            <QualityMetric
              label={language === "en" ? "Hard issues" : "Σκληρά θέματα"}
              value={scheduleSnapshot.hardIssueCount}
            />
          </div>
        </div>
        <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
          <div className="space-y-1 text-sm leading-6 text-slate-600">
            {scheduleEvaluation.explanations.slice(0, 3).map((explanation) => (
              <p key={explanation}>{explanation}</p>
            ))}
            {scheduleEvaluation.hardViolations.slice(0, 2).map((violation) => (
              <p
                key={`${violation.type}-${violation.slotId ?? ""}-${violation.employeeId ?? ""}`}
                className="text-red-700"
              >
                {violation.message}
              </p>
            ))}
            {scheduleEvaluation.softWarnings.slice(0, 2).map((warning) => (
              <p
                key={`${warning.type}-${warning.slotId ?? ""}-${warning.employeeId ?? ""}`}
                className="text-amber-700"
              >
                {warning.message}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {qualityBreakdownItems(scheduleEvaluation.breakdown, language)
              .slice(0, 8)
              .map((item) => (
                <div
                  key={item.label}
                  className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200"
                >
                  <p className="font-semibold text-slate-500">{item.label}</p>
                  <p className="mt-1 font-semibold text-slate-950">
                    {formatSignedQualityValue(item.value)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </div>

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
                                  {item.assignment.is_locked === 1 ? (
                                    <span className="ml-auto rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                      L
                                    </span>
                                  ) : null}
                                </div>
                                <p className="mt-1 truncate text-xs font-semibold text-slate-900">
                                  {item.shiftName}
                                </p>
                                <p className="whitespace-nowrap text-xs text-slate-600">
                                  {formatSlotTime(item.slot, language)}
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
                        {row.startTime === row.endTime
                          ? `${row.startTime} - ${row.endTime}`
                          : formatSlotTime(
                              {
                                id: row.key,
                                schedule_run_id: selectedRun.id,
                                date: selectedRun.start_date,
                                role_id: "",
                                start_time: row.startTime,
                                end_time: row.endTime,
                                required_count: 1,
                                requirement_group_id: null,
                                minimum_experience_level: "no_experience",
                                experienced_required_count: 0,
                                status: "unfilled",
                                source_type: "weekly_requirement",
                                source_id: null,
                                slot_number: null,
                                notes: null,
                                created_at: selectedRun.created_at,
                                updated_at: selectedRun.updated_at
                              },
                              language
                            )}
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
                                const slotAssignments =
                                  scheduleSnapshot.assignmentsBySlotId.get(slot.id) ?? [];
                                const isDuplicateAssignmentSlot =
                                  slotAssignments.length > 1;
                                const assignment = isDuplicateAssignmentSlot
                                  ? null
                                  : assignmentBySlotId.get(slot.id) ?? null;
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
                                      {isDuplicateAssignmentSlot
                                        ? language === "en"
                                          ? "Invalid duplicate"
                                          : "Μη έγκυρο διπλό"
                                        : assignedEmployee
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
                                    {assignment?.is_locked === 1 ? (
                                      <span className="ml-auto rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                        L
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
          employeeTimeConstraints={employeeTimeConstraints}
          timeOff={timeOff}
          roles={roles}
          shiftTemplates={shiftTemplates}
          staffingRequirements={staffingRequirements}
          scheduleSlots={scheduleSlots}
          scheduleAssignments={scheduleAssignments}
          weekStartsOn={businessSettings?.week_starts_on ?? 1}
          language={language}
          validation={modalValidation}
          isSaving={isSaving}
          onChange={(next) => setEditor(next)}
          onClose={() => setEditor(null)}
          onRemove={() => void removeAssignment()}
          onToggleLock={(assignment) => void toggleAssignmentLock(assignment)}
          onSave={() => void saveEditor()}
        />
      ) : null}
      {isRerunConfirmOpen ? (
        <ConfirmActionModal
          language={language}
          title={rerunConfirmTitle}
          body={rerunConfirmBody}
          confirmLabel={rerunConfirmLabel}
          cancelLabel={cancelLabel}
          variant="warning"
          isWorking={isRerunningProgram}
          onCancel={() => setIsRerunConfirmOpen(false)}
          onConfirm={() => void rerunCurrentProgram()}
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

function QualityMetric({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
      <p className="text-[10px] font-semibold uppercase leading-4 tracking-wide text-slate-500 [overflow-wrap:anywhere]">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function groupSlotsByDate(slots: ScheduleSlot[]): Map<string, ScheduleSlot[]> {
  const grouped = new Map<string, ScheduleSlot[]>();

  for (const slot of slots) {
    grouped.set(slot.date, [...(grouped.get(slot.date) ?? []), slot]);
  }

  for (const [date, dateSlots] of grouped.entries()) {
    grouped.set(
      date,
      [...dateSlots].sort(
        (left, right) =>
          left.start_time.localeCompare(right.start_time) ||
          left.end_time.localeCompare(right.end_time) ||
          left.role_id.localeCompare(right.role_id)
      )
    );
  }

  return grouped;
}

function managerStatusClassName(
  status: CanonicalScheduleSnapshot["managerStatus"]
): string {
  if (status === "Invalid") {
    return "border-red-200";
  }

  if (status === "Understaffed") {
    return "border-amber-200";
  }

  return "border-emerald-200";
}

function managerStatusLabel(
  status: CanonicalScheduleSnapshot["managerStatus"],
  language: UiLanguage
): string {
  if (language === "en") {
    return status;
  }

  if (status === "Excellent") {
    return "Άριστο";
  }

  if (status === "Understaffed") {
    return "Υποστελεχωμένο";
  }

  return "Μη έγκυρο";
}

function optimizerEngineLabelForUi(
  engine: CanonicalScheduleSnapshot["solver"]["engine"],
  language: UiLanguage
): string {
  if (engine === "cp_sat") {
    return "CP-SAT";
  }

  if (engine === "heuristic_fallback") {
    return language === "en" ? "Heuristic fallback" : "Heuristic fallback";
  }

  return language === "en" ? "Unknown" : "Άγνωστο";
}

function validationStatusLabelForUi(
  status: CanonicalScheduleSnapshot["validationStatus"],
  language: UiLanguage
): string {
  if (language === "en") {
    return status === "passed" ? "Passed" : "Failed";
  }

  return status === "passed" ? "Πέρασε" : "Απέτυχε";
}

function coverageProofLabelForUi(
  snapshot: CanonicalScheduleSnapshot,
  language: UiLanguage
): string {
  if (snapshot.solver.engine !== "cp_sat") {
    return language === "en"
      ? "Not applicable for heuristic fallback"
      : "Δεν εφαρμόζεται για heuristic fallback";
  }

  if (snapshot.solver.coverageProvenOptimal === true) {
    return language === "en"
      ? "Coverage proven optimal"
      : "Η κάλυψη αποδείχθηκε βέλτιστη";
  }

  return language === "en"
    ? "Coverage not proven optimal"
    : "Η κάλυψη δεν αποδείχθηκε βέλτιστη";
}

function cpSatAttemptLabelForUi(
  attempt: NonNullable<CanonicalScheduleSnapshot["solver"]["cpSatAttempt"]>,
  language: UiLanguage
): string {
  if (!attempt.attempted) {
    return language === "en" ? "Unavailable before fallback" : "Μη διαθέσιμο πριν το fallback";
  }

  const status = attempt.status ?? "UNKNOWN";
  if (!attempt.failureOrFallbackReason) {
    return status;
  }

  return `${status} · ${attempt.failureOrFallbackReason}`;
}

function qualityGradeLabel(
  grade: ScheduleEvaluationGrade,
  language: UiLanguage
): string {
  if (language === "en") {
    const labels: Record<ScheduleEvaluationGrade, string> = {
      excellent: "Excellent",
      good: "Good",
      needs_review: "Needs review",
      bad: "Bad",
      invalid: "Invalid"
    };

    return labels[grade];
  }

  const labels: Record<ScheduleEvaluationGrade, string> = {
    excellent: "Άριστη",
    good: "Καλή",
    needs_review: "Θέλει έλεγχο",
    bad: "Προβληματική",
    invalid: "Μη έγκυρη"
  };

  return labels[grade];
}

function qualityGradeClassName(grade: ScheduleEvaluationGrade): string {
  if (grade === "excellent" || grade === "good") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }

  if (grade === "needs_review") {
    return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }

  return "bg-red-50 text-red-700 ring-1 ring-red-200";
}

function qualityBreakdownItems(
  breakdown: ScheduleEvaluationBreakdown,
  language: UiLanguage
): Array<{ label: string; value: number }> {
  const labels: Record<keyof ScheduleEvaluationBreakdown, string> =
    language === "en"
      ? {
          coverage: "Coverage",
          hardConstraints: "Hard rules",
          fairness: "Fairness",
          contractFit: "Contracts",
          preferences: "Preferences",
          experienceBalance: "Experience",
          roleCoverage: "Roles",
          weekendBalance: "Weekends",
          difficultShiftBalance: "Difficult shifts",
          stability: "Stability",
          penalties: "Penalties",
          total: "Total"
        }
      : {
          coverage: "Κάλυψη",
          hardConstraints: "Σκληροί κανόνες",
          fairness: "Δικαιοσύνη",
          contractFit: "Συμβάσεις",
          preferences: "Προτιμήσεις",
          experienceBalance: "Προϋπηρεσία",
          roleCoverage: "Ρόλοι",
          weekendBalance: "Σαβ/κα",
          difficultShiftBalance: "Δύσκολες βάρδιες",
          stability: "Σταθερότητα",
          penalties: "Ποινές",
          total: "Σύνολο"
        };

  return (Object.keys(breakdown) as Array<keyof ScheduleEvaluationBreakdown>)
    .filter((key) => key !== "total" && breakdown[key] !== 0)
    .map((key) => ({
      label: labels[key],
      value: breakdown[key]
    }));
}

function formatSignedQualityValue(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : String(rounded);
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
  employeeTimeConstraints,
  timeOff,
  roles,
  shiftTemplates,
  staffingRequirements,
  scheduleSlots,
  scheduleAssignments,
  weekStartsOn,
  language,
  validation,
  isSaving,
  onChange,
  onClose,
  onRemove,
  onToggleLock,
  onSave
}: {
  editor: AssignmentEditorState;
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  employeeTimeConstraints: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  weekStartsOn: DayOfWeek;
  language: UiLanguage;
  validation: ManualAssignmentValidation | null;
  isSaving: boolean;
  onChange: (editor: AssignmentEditorState) => void;
  onClose: () => void;
  onRemove: () => void;
  onToggleLock: (assignment: ScheduleAssignment) => void;
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
        employeeTimeConstraints,
        timeOff,
        roles,
        staffingRequirements,
        scheduleSlots,
        scheduleAssignments,
        weekStartsOn,
        language
      }),
    [
      editor,
      employees,
      employeeRoles,
      employeeWorkRules,
      employeeDayConstraints,
      employeeShiftAvailability,
      employeeTimeConstraints,
      timeOff,
      roles,
      staffingRequirements,
      scheduleSlots,
      scheduleAssignments,
      weekStartsOn,
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
                {shiftName} · {formatSlotTime(editor.slot, language)}
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
              {editor.assignment ? (
                <p>
                  {language === "en" ? "Lock status" : "Κατάσταση κλειδώματος"}:{" "}
                  <span
                    className={
                      editor.assignment.is_locked === 1
                        ? "font-semibold text-amber-700"
                        : "font-semibold text-slate-700"
                    }
                  >
                    {editor.assignment.is_locked === 1 ? (language === "en" ? "Locked" : "Κλειδωμένη") : (language === "en" ? "Unlocked" : "Ξεκλείδωτη")}
                  </span>
                </p>
              ) : null}
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
          <div className="flex flex-wrap gap-2">
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
            {editor.assignment ? (
              <button
                type="button"
                onClick={() => onToggleLock(editor.assignment as ScheduleAssignment)}
                disabled={isSaving}
                className="rounded-md border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-60"
              >
                {editor.assignment.is_locked === 1 ? (language === "en" ? "Unlock assignment" : "Ξεκλείδωμα ανάθεσης") : (language === "en" ? "Lock assignment" : "Κλείδωμα ανάθεσης")}
              </button>
            ) : null}
          </div>
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
  employeeTimeConstraints,
  timeOff,
  roles,
  staffingRequirements,
  scheduleSlots,
  scheduleAssignments,
  weekStartsOn,
  language
}: {
  editor: AssignmentEditorState;
  employees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  employeeTimeConstraints: EmployeeTimeConstraint[];
  timeOff: TimeOff[];
  roles: Role[];
  staffingRequirements: StaffingRequirement[];
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  weekStartsOn: DayOfWeek;
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
        employeeTimeConstraints,
        staffingRequirements,
        roles,
        timeOff,
        scheduleSlots,
        scheduleAssignments,
        weekStartsOn
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

  if (/legacy one shift per day/i.test(violation)) {
    return "Έχει ήδη βάρδια την ίδια ημέρα.";
  }

  if (/overlapping shift/i.test(violation)) {
    return "Έχει ήδη βάρδια που επικαλύπτεται χρονικά.";
  }

  if (/cannot work weekends/i.test(violation)) {
    return "Δεν μπορεί να δουλεύει Σαββατοκύριακο.";
  }

  const maxHoursMatch = violation.match(/max daily hours \(([^)]+)\)/i);
  if (maxHoursMatch) {
    return `Θα ξεπεράσει το εβδομαδιαίο όριο ωρών (${maxHoursMatch[1]}).`;
  }

  const maxDaysMatch = violation.match(/max weekly shifts \(([^)]+)\)/i);
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
  const targetHours =
    workRules?.target_hours_per_day !== null &&
    workRules?.target_hours_per_day !== undefined
      ? workRules.target_hours_per_day * workRules.max_shifts_per_week
      : null;
  const hoursLabel = language === "en" ? "h" : " ώρες";

  if (targetHours === null || targetHours === undefined) {
    return `${formatHours(projectedHours)}${hoursLabel}`;
  }

  return `${formatHours(projectedHours)}/${formatHours(targetHours)}${hoursLabel}`;
}
