import { useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import {
  buildAutomaticScheduleCandidate,
  buildScheduleGenerationPlan,
  getWeekRangeForDate,
  isDateInputValue,
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
import { DeleteProgramConfirmModal } from "../components/ConfirmActionModal";
import { ErrorList } from "../components/ErrorList";
import { Field } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { inputClassName, secondaryButtonClassName } from "../components/styles";
import { getErrorMessage } from "../utils/errors";
import { appLanguage } from "../utils/localization";
import {
  formatCompactDateRange,
  formatDateEu,
  formatDateRangeEu,
  localizedDayName,
  programStatusLabel,
  roleCoverageSummary,
  scheduleRunTypeLabel,
  todayInputValue
} from "../utils/scheduleDisplay";
import { deleteGeneratedProgram } from "../utils/scheduleRuns";

export function GenerateSchedulePage({
  businessSettings,
  openingHours,
  staffingRequirements,
  specialDays,
  specialDayStaffingRequirements,
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
  onProgramGenerated,
  onProgramDeleted,
  onViewProgram
}: {
  businessSettings: BusinessSettings | null;
  openingHours: OpeningHours[];
  staffingRequirements: StaffingRequirement[];
  specialDays: SpecialDay[];
  specialDayStaffingRequirements: SpecialDayStaffingRequirement[];
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
  onProgramGenerated: (runId: string, message: string) => Promise<void>;
  onProgramDeleted: (message: string) => Promise<void>;
  onViewProgram: (runId: string) => void;
}) {
  const [weekStartDate, setWeekStartDate] = useState(() => todayInputValue());
  const [errors, setErrors] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [programPendingDelete, setProgramPendingDelete] =
    useState<ScheduleRun | null>(null);
  const language = appLanguage(businessSettings);
  const weekStartsOn: DayOfWeek = businessSettings?.week_starts_on ?? 1;
  const selectedWeekRange = isDateInputValue(weekStartDate)
    ? getWeekRangeForDate({
        selectedDate: weekStartDate,
        weekStartsOn
      })
    : null;

  async function generateProgram() {
    if (!isDateInputValue(weekStartDate)) {
      setErrors(["Choose a valid date."]);
      return;
    }

    setErrors([]);
    setIsGenerating(true);

    try {
      const weekRange = getWeekRangeForDate({
        selectedDate: weekStartDate,
        weekStartsOn
      });
      const plan = buildScheduleGenerationPlan({
        weekStartDate: weekRange.weekStartDate,
        openingHours,
        staffingRequirements,
        specialDayStaffingRequirements,
        shiftTemplates,
        specialDays
      });
      const generatedAt = new Date().toISOString();
      const initialParameters = {
        stage: "slot_generation",
        type: "weekly",
        selectedDate: weekRange.selectedDate,
        weekStartsOn: weekRange.weekStartsOn,
        weekStartDate: plan.weekStartDate,
        weekEndDate: plan.weekEndDate
      };
      const run: ScheduleRun = {
        id: createClientId("schedule-run"),
        name: `Weekly schedule ${formatDateRangeEu(plan.weekStartDate, plan.weekEndDate)}`,
        start_date: plan.weekStartDate,
        end_date: plan.weekEndDate,
        status: "generating",
        parameters_json: JSON.stringify(initialParameters),
        completed_at: null,
        created_at: generatedAt,
        updated_at: generatedAt
      };
      const createdSlots: ScheduleSlot[] = plan.slots.map((slot) => ({
        id: createClientId("schedule-slot"),
        schedule_run_id: run.id,
        date: slot.date,
        role_id: slot.roleId,
        start_time: slot.startTime,
        end_time: slot.endTime,
        required_count: 1,
        requirement_group_id: slot.requirementGroupId,
        minimum_experience_level: slot.minimumExperienceLevel,
        experienced_required_count: slot.experiencedRequiredCount,
        status: "unfilled",
        source_type: slot.sourceType,
        source_id: slot.sourceId,
        slot_number: slot.slotNumber,
        notes: `Slot ${slot.slotNumber} of ${slot.requiredCount}`,
        created_at: generatedAt,
        updated_at: generatedAt
      }));

      const assignmentResult = await buildAutomaticScheduleCandidate({
        run,
        slots: [...scheduleSlots, ...createdSlots],
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
        weekStartsOn,
        assignments: scheduleAssignments
      });

      if (!assignmentResult.validation.valid) {
        throw new Error(
          `Automatic schedule validation failed. Nothing was saved. ${assignmentResult.validation.violations
            .map((violation) => violation.message)
            .join(" ")}`
        );
      }

      const slotStatusById = new Map(
        assignmentResult.slotUpdates.map((update) => [update.slotId, update.status])
      );

      await databaseApi.persistCompleteGeneratedSchedule({
        run: {
          id: run.id,
          name: run.name,
          startDate: run.start_date,
          endDate: run.end_date,
          status: run.status,
          parametersJson: run.parameters_json,
          completedAt: run.completed_at
        },
        slots: createdSlots.map((slot) => ({
          id: slot.id,
          date: slot.date,
          roleId: slot.role_id,
          startTime: slot.start_time,
          endTime: slot.end_time,
          requiredCount: slot.required_count,
          requirementGroupId: slot.requirement_group_id,
          minimumExperienceLevel: slot.minimum_experience_level,
          experiencedRequiredCount: slot.experienced_required_count,
          status: slotStatusById.get(slot.id) ?? slot.status,
          sourceType: slot.source_type,
          sourceId: slot.source_id,
          slotNumber: slot.slot_number,
          notes: slot.notes
        })),
        assignments: assignmentResult.finalAssignmentInputs,
        warnings: [
          ...plan.warnings.map((warning) => ({
            id: createClientId("schedule-warning"),
            scheduleSlotId: null,
            scheduleAssignmentId: null,
            severity: warning.severity,
            warningType: warning.warningType,
            message: warning.message
          })),
          ...assignmentResult.warningInputs
        ],
        runUpdate: assignmentResult.runUpdate
      });

      await onProgramGenerated(
        run.id,
        language === "en"
          ? `Proposed program generated. Quality: ${assignmentResult.evaluation.grade}, ${Math.round(
              assignmentResult.evaluation.metrics.coverageRate * 100
            )}% covered.`
          : `Το πρόγραμμα δημιουργήθηκε. Ποιότητα: ${qualityGradeLabel(
              assignmentResult.evaluation.grade,
              language
            )}, ${Math.round(
              assignmentResult.evaluation.metrics.coverageRate * 100
            )}% κάλυψη.`
      );
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsGenerating(false);
    }
  }

  async function deleteProgram(run: ScheduleRun) {
    setErrors([]);
    setDeletingRunId(run.id);

    try {
      await deleteGeneratedProgram({
        runId: run.id
      });
      setProgramPendingDelete(null);
      await onProgramDeleted(
        language === "en" ? "Program deleted." : "Το πρόγραμμα διαγράφηκε."
      );
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setDeletingRunId(null);
    }
  }

  const recentRuns = [...scheduleRuns]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 5);

  return (
    <div className="max-w-6xl">
      <SectionHeading
        title={language === "en" ? "Generate Program" : "Δημιουργία προγράμματος"}
        description={
          language === "en"
            ? "Generate a proposed weekly schedule based on roles, availability and work rules."
            : "Δημιουργήστε ένα προτεινόμενο εβδομαδιαίο πρόγραμμα με βάση ρόλους, διαθεσιμότητες και κανόνες."
        }
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px_230px] lg:items-center">
          <div>
            <h3 className="text-lg font-semibold tracking-normal text-slate-950">
              {language === "en" ? "New program" : "Νέο πρόγραμμα"}
            </h3>
            <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
              {language === "en"
                ? "Choose a date. The app will calculate the matching week."
                : "Επιλέξτε μία ημερομηνία. Η εφαρμογή θα υπολογίσει την αντίστοιχη εβδομάδα."}
            </p>
          </div>

          <div className="space-y-3">
            <Field label={language === "en" ? "Week selection" : "Επιλογή εβδομάδας"} required>
              <input
                type="date"
                value={weekStartDate}
                onChange={(event) => setWeekStartDate(event.target.value)}
                className={inputClassName}
              />
            </Field>
            <div className="rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {language === "en" ? "Week" : "Εβδομάδα"}
              </p>
              <p className="mt-1 text-sm font-semibold leading-5 text-slate-950">
                {selectedWeekRange
                  ? formatCompactDateRange(
                      selectedWeekRange.weekStartDate,
                      selectedWeekRange.weekEndDate,
                      language
                    )
                  : language === "en"
                    ? "Choose a valid date"
                    : "Επιλέξτε έγκυρη ημερομηνία"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {selectedWeekRange && selectedWeekRange.weekStartDate !== weekStartDate
                  ? language === "en"
                    ? `Adjusted to ${formatDateEu(selectedWeekRange.weekStartDate)} because weeks start on ${localizedDayName(weekStartsOn, language)}.`
                    : `Προσαρμόζεται σε ${formatDateEu(selectedWeekRange.weekStartDate)}, επειδή η εβδομάδα ξεκινά ${localizedDayName(weekStartsOn, language)}.`
                  : language === "en"
                    ? `Weeks start on ${localizedDayName(weekStartsOn, language)}.`
                    : `Η εβδομάδα ξεκινά ${localizedDayName(weekStartsOn, language)}.`}
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-emerald-50 p-4 ring-1 ring-emerald-100">
            <button
              type="button"
              onClick={generateProgram}
              disabled={isGenerating}
              className="w-full rounded-md bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60"
            >
              {isGenerating
                ? language === "en"
                  ? "Generating..."
                  : "Δημιουργία..."
                : language === "en"
                  ? "Generate Program"
                  : "Δημιουργία προγράμματος"}
            </button>
            <p className="mt-3 text-xs leading-5 text-emerald-900">
              {language === "en"
                ? "Creates a proposed schedule and opens it for review."
                : "Δημιουργεί προτεινόμενο πρόγραμμα και το ανοίγει για έλεγχο."}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold tracking-normal text-slate-950">
              {language === "en" ? "Recent programs" : "Πρόσφατα προγράμματα"}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {language === "en"
                ? "Review, open or delete recently generated schedules."
                : "Δείτε, ανοίξτε ή διαγράψτε πρόσφατα προγράμματα."}
            </p>
          </div>
        </div>

        {recentRuns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
            <h4 className="text-base font-semibold tracking-normal text-slate-950">
              {language === "en"
                ? "No programs yet"
                : "Δεν υπάρχουν προγράμματα ακόμα"}
            </h4>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
              {language === "en"
                ? "Generate the first weekly program to see it here."
                : "Δημιουργήστε το πρώτο εβδομαδιαίο πρόγραμμα για να εμφανιστεί εδώ."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {recentRuns.map((run) => {
              const runSlots = scheduleSlots.filter(
                (slot) => slot.schedule_run_id === run.id
              );
              const runWarnings = scheduleWarnings.filter(
                (warning) => warning.schedule_run_id === run.id
              );
              const runAssignments = scheduleAssignments.filter(
                (assignment) =>
                  assignment.schedule_run_id === run.id &&
                  assignment.status !== "cancelled"
              );
              const assignedSlotIds = new Set(
                runAssignments.map((assignment) => assignment.schedule_slot_id)
              );
              const unfilledSlotCount = runSlots.filter(
                (slot) => slot.status !== "filled" && !assignedSlotIds.has(slot.id)
              ).length;

              const metrics = [
                {
                  label: language === "en" ? "Slots" : "Θέσεις",
                  value: runSlots.length,
                  className: "bg-slate-50 text-slate-700 ring-slate-200"
                },
                {
                  label: language === "en" ? "Assigned" : "Ανατέθηκαν",
                  value: assignedSlotIds.size,
                  className: "bg-emerald-50 text-emerald-700 ring-emerald-200"
                },
                {
                  label: language === "en" ? "Unfilled" : "Κενές",
                  value: unfilledSlotCount,
                  className:
                    unfilledSlotCount > 0
                      ? "bg-amber-50 text-amber-800 ring-amber-200"
                      : "bg-slate-50 text-slate-600 ring-slate-200"
                },
                {
                  label: language === "en" ? "Warnings" : "Προειδοποιήσεις",
                  value: runWarnings.length,
                  className:
                    runWarnings.length > 0
                      ? "bg-red-50 text-red-700 ring-red-200"
                      : "bg-slate-50 text-slate-600 ring-slate-200"
                }
              ];

              return (
                <div
                  key={run.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                        {scheduleRunTypeLabel(run)}
                      </span>
                      <h4 className="mt-3 text-base font-semibold tracking-normal text-slate-950">
                        {formatCompactDateRange(run.start_date, run.end_date, language)}
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        {programStatusLabel(run.status)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onViewProgram(run.id)}
                        className={secondaryButtonClassName}
                      >
                        {language === "en" ? "View" : "Προβολή"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setProgramPendingDelete(run)}
                        disabled={deletingRunId === run.id}
                        className="rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        {deletingRunId === run.id
                          ? language === "en"
                            ? "Deleting..."
                            : "Διαγραφή..."
                          : language === "en"
                            ? "Delete"
                            : "Διαγραφή"}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {metrics.map((metric) => (
                      <div
                        key={metric.label}
                        className={`flex min-h-[74px] flex-col justify-between rounded-lg px-3 py-2 ring-1 ${metric.className}`}
                      >
                        <p className="text-[10px] font-semibold uppercase leading-4 tracking-wide [overflow-wrap:anywhere]">
                          {metric.label}
                        </p>
                        <p className="mt-1 text-lg font-semibold">{metric.value}</p>
                      </div>
                    ))}
                  </div>

                  {runSlots.length > 0 ? (
                    <p className="mt-4 text-xs leading-5 text-slate-500">
                      {language === "en" ? "Role coverage:" : "Κάλυψη ρόλων:"}{" "}
                      {roleCoverageSummary(runSlots, roles)}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {programPendingDelete ? (
        <DeleteProgramConfirmModal
          language={language}
          dateRange={formatCompactDateRange(
            programPendingDelete.start_date,
            programPendingDelete.end_date,
            language
          )}
          isDeleting={deletingRunId === programPendingDelete.id}
          onCancel={() => setProgramPendingDelete(null)}
          onConfirm={() => void deleteProgram(programPendingDelete)}
        />
      ) : null}
    </div>
  );
}

function qualityGradeLabel(
  grade: ScheduleEvaluationGrade,
  language: "el" | "en"
): string {
  if (language === "en") {
    return grade.replace("_", " ");
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

function createClientId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
