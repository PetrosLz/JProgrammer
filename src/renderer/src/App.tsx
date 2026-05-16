import { format } from "date-fns";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { databaseApi } from "../services/databaseApi";
import { loadDemoData } from "../services/demoData";
import { pdfExportApi, PdfExportError } from "../services/pdfExportApi";
import {
  experienceLevelOptions,
  experienceLevelToLegacySkillLevel,
  normalizeExperienceLevel,
  skillLevelToExperienceLevel
} from "../types";
import type {
  BusinessSettings,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  OpeningHours,
  Role,
  ScheduleAssignment,
  ScheduleRun,
  ScheduleSlot,
  ScheduleWarning,
  ShiftTemplate,
  SpecialDay,
  StaffingRequirement,
  TimeOff,
  DayOfWeek,
  EmploymentType,
  ExperienceLevel
} from "../types";
import {
  createBlankRole,
  createBlankShiftTemplate,
  createInitialSetupDraft,
  dayLabels,
  hasAnyRoleValue,
  hasAnyShiftTemplateValue,
  optionalText,
  roleColors,
  setupSteps,
  validateBusinessInfo,
  validateSetupStep,
  type BusinessInfoDraft,
  type OpeningHoursDraft,
  type RoleDraft,
  type SetupDraft,
  type ShiftTemplateDraft
} from "./setupData";
import {
  addDays,
  assignEmployeesToRun,
  buildScheduleGenerationPlan,
  getDayOfWeek,
  getSlotDurationHours,
  getWeekRangeForDate,
  isDateInputValue,
  saveManualAssignmentChange,
  validateManualAssignmentChange,
  type AssignmentResult,
  type GenerationPlan,
  type ManualAssignmentValidation
} from "../services/scheduler";

const setupCompletedKey = "setup.completedAt";

type PageId =
  | "dashboard"
  | "business-settings"
  | "opening-hours"
  | "roles"
  | "shift-templates"
  | "staffing-requirements"
  | "employees"
  | "employee-constraints"
  | "time-off"
  | "generate-schedule"
  | "schedule-view"
  | "reports"
  | "backup-restore";

type Page = {
  id: PageId;
  title: string;
  description: string;
};

type DashboardSummary = {
  businessSettings: BusinessSettings | null;
  openingHours: OpeningHours[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  specialDays: SpecialDay[];
  staffingRequirements: StaffingRequirement[];
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
  setupCompletedAt: string | null;
};

const pages: Page[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    description: "Σύνοψη της τοπικής ρύθμισης επιχείρησης."
  },
  {
    id: "business-settings",
    title: "Business Settings",
    description: "Βασικά στοιχεία επιχείρησης και εβδομάδας."
  },
  {
    id: "opening-hours",
    title: "Opening Hours",
    description: "Αποθηκευμένες ώρες λειτουργίας ανά ημέρα."
  },
  {
    id: "roles",
    title: "Roles",
    description: "Προσαρμοσμένοι ρόλοι που δημιουργήθηκαν στην αρχική ρύθμιση."
  },
  {
    id: "shift-templates",
    title: "Shift Templates",
    description: "Πρότυπα βαρδιών για μελλοντικό προγραμματισμό."
  },
  {
    id: "staffing-requirements",
    title: "Staffing Requirements",
    description: "Θα υλοποιηθεί σε επόμενη φάση."
  },
  {
    id: "employees",
    title: "Εργαζόμενοι",
    description: "Θα υλοποιηθεί σε επόμενη φάση."
  },
  {
    id: "employee-constraints",
    title: "Employee Constraints",
    description: "Θα υλοποιηθεί σε επόμενη φάση."
  },
  {
    id: "time-off",
    title: "Time Off",
    description: "Θα υλοποιηθεί σε επόμενη φάση."
  },
  {
    id: "generate-schedule",
    title: "Generate Program",
    description: "Δημιουργία slots και ανάθεση εργαζομένων με βασικούς κανόνες."
  },
  {
    id: "schedule-view",
    title: "Schedule View",
    description: "Proposed Program review and editing."
  },
  {
    id: "reports",
    title: "Reports",
    description: "Θα υλοποιηθεί σε επόμενη φάση."
  },
  {
    id: "backup-restore",
    title: "Backup / Restore",
    description: "Θα υλοποιηθεί σε επόμενη φάση."
  }
];

const emptySummary: DashboardSummary = {
  businessSettings: null,
  openingHours: [],
  roles: [],
  shiftTemplates: [],
  specialDays: [],
  staffingRequirements: [],
  scheduleRuns: [],
  scheduleSlots: [],
  scheduleAssignments: [],
  scheduleWarnings: [],
  employees: [],
  employeeRoles: [],
  employeeWorkRules: [],
  employeeDayConstraints: [],
  employeeShiftAvailability: [],
  timeOff: [],
  setupCompletedAt: null
};

export function App() {
  const [appState, setAppState] = useState<"loading" | "setup" | "ready">(
    "loading"
  );
  const [activePageId, setActivePageId] = useState<PageId>("dashboard");
  const [activeStep, setActiveStep] = useState(0);
  const [setupDraft, setSetupDraft] = useState<SetupDraft>(() =>
    createInitialSetupDraft()
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDemoData, setIsLoadingDemoData] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [selectedScheduleRunId, setSelectedScheduleRunId] = useState<
    string | null
  >(null);

  const activePage =
    pages.find((page) => page.id === activePageId) ?? pages[0];
  const today = useMemo(() => format(new Date(), "EEEE, MMMM d, yyyy"), []);

  const refreshSummary = useCallback(async () => {
    const [
      businessSettings,
      openingHours,
      roles,
      shiftTemplates,
      specialDays,
      staffingRequirements,
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
      setupCompletedAt
    ] = await Promise.all([
      databaseApi.listRecords("business_settings", { limit: 1 }),
      databaseApi.listRecords("opening_hours", { limit: 20 }),
      databaseApi.listRecords("roles", { limit: 200 }),
      databaseApi.listRecords("shift_templates", { limit: 200 }),
      databaseApi.listRecords("special_days", { limit: 500 }),
      databaseApi.listRecords("staffing_requirements", { limit: 500 }),
      databaseApi.listRecords("schedule_runs", { limit: 100 }),
      databaseApi.listRecords("schedule_slots", { limit: 5000 }),
      databaseApi.listRecords("schedule_assignments", { limit: 5000 }),
      databaseApi.listRecords("schedule_warnings", { limit: 1000 }),
      databaseApi.listRecords("employees", { limit: 500 }),
      databaseApi.listRecords("employee_roles", { limit: 1000 }),
      databaseApi.listRecords("employee_work_rules", { limit: 500 }),
      databaseApi.listRecords("employee_day_constraints", { limit: 4000 }),
      databaseApi.listRecords("employee_shift_availability", { limit: 4000 }),
      databaseApi.listRecords("time_off", { limit: 1000 }),
      databaseApi.getSetting(setupCompletedKey)
    ]);

    setSummary({
      businessSettings: businessSettings[0] ?? null,
      openingHours,
      roles,
      shiftTemplates,
      specialDays,
      staffingRequirements,
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
      setupCompletedAt: setupCompletedAt?.value ?? null
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function detectFirstRun() {
      try {
        const setupCompleted = await databaseApi.getSetting(setupCompletedKey);

        if (!isMounted) {
          return;
        }

        if (setupCompleted) {
          await refreshSummary();
          setAppState("ready");
        } else {
          setAppState("setup");
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        setErrors([getErrorMessage(error)]);
        setAppState("setup");
      }
    }

    void detectFirstRun();

    return () => {
      isMounted = false;
    };
  }, [refreshSummary]);

  async function handleWizardNext() {
    const stepErrors = validateSetupStep(activeStep, setupDraft);

    if (stepErrors.length > 0) {
      setErrors(stepErrors);
      return;
    }

    setErrors([]);

    if (activeStep < setupSteps.length - 1) {
      setActiveStep((step) => step + 1);
      return;
    }

    setIsSaving(true);

    try {
      await saveSetupDraft(setupDraft);
      await refreshSummary();
      setNotice("Η αρχική ρύθμιση αποθηκεύτηκε.");
      setActivePageId("dashboard");
      setAppState("ready");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLoadDemoData() {
    const confirmed = window.confirm(
      "Η φόρτωση demo δεδομένων θα αντικαταστήσει τα τρέχοντα τοπικά δεδομένα με το Demo Cafe. Συνέχεια;"
    );

    if (!confirmed) {
      return;
    }

    setErrors([]);
    setNotice("");
    setIsLoadingDemoData(true);

    try {
      const result = await loadDemoData();
      await refreshSummary();
      setSelectedScheduleRunId(null);
      setActiveStep(0);
      setActivePageId("dashboard");
      setAppState("ready");
      setNotice(
        `Το Demo Cafe φορτώθηκε: ${result.employeeCount} εργαζόμενοι, ${result.roleCount} ρόλοι, ${result.staffingRequirementCount} ανάγκες προσωπικού.`
      );
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsLoadingDemoData(false);
    }
  }

  if (appState === "loading") {
    return <LoadingScreen />;
  }

  if (appState === "setup") {
    return (
      <SetupWizard
        activeStep={activeStep}
        draft={setupDraft}
        errors={errors}
        isSaving={isSaving}
        isLoadingDemoData={isLoadingDemoData}
        onBack={() => {
          setErrors([]);
          setActiveStep((step) => Math.max(0, step - 1));
        }}
        onChange={setSetupDraft}
        onLoadDemoData={() => void handleLoadDemoData()}
        onNext={handleWizardNext}
      />
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-950">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-5">
          <h1 className="text-xl font-semibold tracking-normal">JProgrammer</h1>
          <p className="mt-1 text-sm text-slate-500">Τοπικός προγραμματισμός</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {pages.map((page) => {
            const isActive = page.id === activePage.id;

            return (
              <button
                key={page.id}
                type="button"
                onClick={() => {
                  setNotice("");
                  setActivePageId(page.id);
                }}
                className={[
                  "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition",
                  isActive
                    ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                ].join(" ")}
              >
                {page.title}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
          <div>
            <p className="text-sm font-medium text-slate-500">{today}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal">
              {activePage.title}
            </h2>
          </div>
          <span className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Offline SQLite
          </span>
        </header>

        <section className="flex-1 px-8 py-8">
          {notice ? (
            <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {notice}
            </div>
          ) : null}

          {renderPage(activePage.id, summary, {
            selectedScheduleRunId,
            isLoadingDemoData,
            onDataChanged: async (message) => {
              await refreshSummary();
              setNotice(message);
            },
            onLoadDemoData: () => void handleLoadDemoData(),
            onProgramGenerated: async (runId, message) => {
              await refreshSummary();
              setSelectedScheduleRunId(runId);
              setActivePageId("schedule-view");
              setNotice(message);
            },
            onProgramDeleted: async (message) => {
              await refreshSummary();
              setSelectedScheduleRunId(null);
              setActivePageId("generate-schedule");
              setNotice(message);
            },
            onViewProgram: (runId) => {
              setNotice("");
              setSelectedScheduleRunId(runId);
              setActivePageId("schedule-view");
            }
          })}
        </section>
      </main>
    </div>
  );
}

function SetupWizard({
  activeStep,
  draft,
  errors,
  isSaving,
  isLoadingDemoData,
  onBack,
  onChange,
  onLoadDemoData,
  onNext
}: {
  activeStep: number;
  draft: SetupDraft;
  errors: string[];
  isSaving: boolean;
  isLoadingDemoData: boolean;
  onBack: () => void;
  onChange: (draft: SetupDraft) => void;
  onLoadDemoData: () => void;
  onNext: () => void;
}) {
  return (
    <div className="min-h-screen bg-slate-50 px-8 py-8 text-slate-950">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">
            Πρώτη ρύθμιση
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Ρύθμιση επιχείρησης
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Συμπληρώστε τα βασικά στοιχεία για να ξεκινήσει η τοπική βάση
            δεδομένων. Μπορείτε να αλλάξετε τις επιχειρησιακές ρυθμίσεις
            αργότερα.
          </p>
        </div>

        <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold tracking-normal text-emerald-950">
                Δοκιμαστικά δεδομένα
              </h2>
              <p className="mt-1 text-sm text-emerald-800">
                Φορτώστε το Demo Cafe με ρόλους, εργαζομένους, λίγους καθαρούς
                περιορισμούς και ανάγκες προσωπικού.
              </p>
            </div>
            <button
              type="button"
              onClick={onLoadDemoData}
              disabled={isLoadingDemoData}
              className={secondaryButtonClassName}
            >
              {isLoadingDemoData ? "Φόρτωση demo..." : "Φόρτωση demo δεδομένων"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[260px_1fr] gap-6">
          <aside className="rounded-lg border border-slate-200 bg-white p-3">
            {setupSteps.map((step, index) => (
              <div
                key={step}
                className={[
                  "rounded-md px-3 py-3 text-sm",
                  index === activeStep
                    ? "bg-emerald-50 text-emerald-800"
                    : "text-slate-600"
                ].join(" ")}
              >
                <span className="font-semibold">{index + 1}.</span> {step}
              </div>
            ))}
          </aside>

          <section className="rounded-lg border border-slate-200 bg-white p-6">
            {errors.length > 0 ? <ErrorList errors={errors} /> : null}

            {activeStep === 0 ? (
              <BusinessInfoForm
                value={draft.businessInfo}
                onChange={(businessInfo) => onChange({ ...draft, businessInfo })}
              />
            ) : null}

            {activeStep === 1 ? (
              <OpeningHoursGrid
                value={draft.openingHours}
                onChange={(openingHours) => onChange({ ...draft, openingHours })}
              />
            ) : null}

            {activeStep === 2 ? (
              <RolesEditor
                value={draft.roles}
                onChange={(roles) => onChange({ ...draft, roles })}
              />
            ) : null}

            {activeStep === 3 ? (
              <ShiftTemplatesEditor
                value={draft.shiftTemplates}
                onChange={(shiftTemplates) =>
                  onChange({ ...draft, shiftTemplates })
                }
              />
            ) : null}

            <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={onBack}
                disabled={activeStep === 0 || isSaving}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Πίσω
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={isSaving}
                className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving
                  ? "Αποθήκευση..."
                  : activeStep === setupSteps.length - 1
                    ? "Ολοκλήρωση"
                    : "Συνέχεια"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function BusinessInfoForm({
  value,
  onChange
}: {
  value: BusinessInfoDraft;
  onChange: (value: BusinessInfoDraft) => void;
}) {
  return (
    <div>
      <SectionHeading
        title="Στοιχεία επιχείρησης"
        description="Τα στοιχεία αυτά αποθηκεύονται τοπικά και χρησιμοποιούνται ως βάση για τις επόμενες φάσεις."
      />

      <div className="mt-6 grid grid-cols-2 gap-4">
        <Field label="Όνομα επιχείρησης" required>
          <input
            value={value.businessName}
            onChange={(event) =>
              onChange({ ...value, businessName: event.target.value })
            }
            className={inputClassName}
            placeholder="π.χ. My Cafe"
          />
        </Field>

        <Field label="Τύπος επιχείρησης">
          <input
            value={value.businessType}
            onChange={(event) =>
              onChange({ ...value, businessType: event.target.value })
            }
            className={inputClassName}
            placeholder="π.χ. Cafe, Restaurant, Retail"
          />
        </Field>

        <Field label="Τοποθεσία">
          <input
            value={value.location}
            onChange={(event) =>
              onChange({ ...value, location: event.target.value })
            }
            className={inputClassName}
            placeholder="π.χ. Αθήνα"
          />
        </Field>

        <Field label="Πρώτη ημέρα εβδομάδας">
          <select
            value={value.weekStartsOn}
            onChange={(event) =>
              onChange({
                ...value,
                weekStartsOn: Number(event.target.value) as 0 | 1
              })
            }
            className={inputClassName}
          >
            <option value={1}>Δευτέρα</option>
            <option value={0}>Κυριακή</option>
          </select>
        </Field>

        <Field label="Γλώσσα">
          <select
            value={value.language}
            onChange={(event) =>
              onChange({
                ...value,
                language: event.target.value as BusinessInfoDraft["language"]
              })
            }
            className={inputClassName}
          >
            <option value="el">Ελληνικά</option>
            <option value="en">English</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

function OpeningHoursGrid({
  value,
  onChange
}: {
  value: OpeningHoursDraft[];
  onChange: (value: OpeningHoursDraft[]) => void;
}) {
  function updateDay(dayOfWeek: number, nextValue: Partial<OpeningHoursDraft>) {
    onChange(
      value.map((day) =>
        day.dayOfWeek === dayOfWeek ? { ...day, ...nextValue } : day
      )
    );
  }

  return (
    <div>
      <SectionHeading
        title="Ώρες λειτουργίας"
        description="Ορίστε το εβδομαδιαίο ωράριο. Οι κλειστές ημέρες δεν χρειάζονται ώρες."
      />

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-[1.2fr_0.7fr_1fr_1fr_0.8fr] bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Ημέρα</span>
          <span>Ανοικτά</span>
          <span>Άνοιγμα</span>
          <span>Κλείσιμο</span>
          <span>Overnight</span>
        </div>

        {value.map((day) => (
          <div
            key={day.dayOfWeek}
            className="grid grid-cols-[1.2fr_0.7fr_1fr_1fr_0.8fr] items-center gap-3 border-t border-slate-200 px-4 py-3"
          >
            <span className="text-sm font-medium text-slate-800">
              {day.label}
            </span>
            <input
              type="checkbox"
              checked={day.isOpen}
              onChange={(event) =>
                updateDay(day.dayOfWeek, { isOpen: event.target.checked })
              }
              className="h-4 w-4"
            />
            <input
              type="time"
              value={day.openTime}
              disabled={!day.isOpen}
              onChange={(event) =>
                updateDay(day.dayOfWeek, { openTime: event.target.value })
              }
              className={inputClassName}
            />
            <input
              type="time"
              value={day.closeTime}
              disabled={!day.isOpen}
              onChange={(event) =>
                updateDay(day.dayOfWeek, { closeTime: event.target.value })
              }
              className={inputClassName}
            />
            <input
              type="checkbox"
              checked={day.isOvernight}
              disabled={!day.isOpen}
              onChange={(event) =>
                updateDay(day.dayOfWeek, {
                  isOvernight: event.target.checked
                })
              }
              className="h-4 w-4"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function RolesEditor({
  value,
  onChange
}: {
  value: RoleDraft[];
  onChange: (value: RoleDraft[]) => void;
}) {
  function updateRole(index: number, nextValue: Partial<RoleDraft>) {
    onChange(
      value.map((role, roleIndex) =>
        roleIndex === index ? { ...role, ...nextValue } : role
      )
    );
  }

  return (
    <div>
      <SectionHeading
        title="Προσαρμοσμένοι ρόλοι"
        description="Προσθέστε όσους ρόλους χρειάζεται η επιχείρηση. Δεν υπάρχουν υποχρεωτικοί προεπιλεγμένοι ρόλοι."
      />

      <div className="mt-6 space-y-4">
        {value.map((role, index) => (
          <div
            key={index}
            className="grid grid-cols-[1fr_140px_1.4fr_auto] gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <Field label="Όνομα ρόλου">
              <input
                value={role.name}
                onChange={(event) =>
                  updateRole(index, { name: event.target.value })
                }
                className={inputClassName}
                placeholder="π.χ. Barista"
              />
            </Field>
            <Field label="Χρώμα">
              <ColorSelect
                value={role.color}
                onChange={(color) => updateRole(index, { color })}
              />
            </Field>
            <Field label="Περιγραφή">
              <input
                value={role.description}
                onChange={(event) =>
                  updateRole(index, { description: event.target.value })
                }
                className={inputClassName}
                placeholder="Προαιρετικά"
              />
            </Field>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
              className="self-end rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600"
            >
              Διαγραφή
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...value, createBlankRole()])}
        className="mt-5 rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-800"
      >
        Προσθήκη ρόλου
      </button>
    </div>
  );
}

function ShiftTemplatesEditor({
  value,
  onChange
}: {
  value: ShiftTemplateDraft[];
  onChange: (value: ShiftTemplateDraft[]) => void;
}) {
  function updateTemplate(index: number, nextValue: Partial<ShiftTemplateDraft>) {
    onChange(
      value.map((template, templateIndex) =>
        templateIndex === index ? { ...template, ...nextValue } : template
      )
    );
  }

  return (
    <div>
      <SectionHeading
        title="Πρότυπα βαρδιών"
        description="Δημιουργήστε απλά πρότυπα για μελλοντική χρήση. Δεν συνδέονται ακόμα με απαιτήσεις προσωπικού."
      />

      <div className="mt-6 space-y-4">
        {value.map((template, index) => (
          <div
            key={index}
            className="grid grid-cols-[1fr_130px_130px_110px_130px_auto] gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <Field label="Όνομα">
              <input
                value={template.name}
                onChange={(event) =>
                  updateTemplate(index, { name: event.target.value })
                }
                className={inputClassName}
                placeholder="π.χ. Morning"
              />
            </Field>
            <Field label="Έναρξη">
              <input
                type="time"
                value={template.startTime}
                onChange={(event) =>
                  updateTemplate(index, { startTime: event.target.value })
                }
                className={inputClassName}
              />
            </Field>
            <Field label="Λήξη">
              <input
                type="time"
                value={template.endTime}
                onChange={(event) =>
                  updateTemplate(index, { endTime: event.target.value })
                }
                className={inputClassName}
              />
            </Field>
            <Field label="Overnight">
              <input
                type="checkbox"
                checked={template.isOvernight}
                onChange={(event) =>
                  updateTemplate(index, {
                    isOvernight: event.target.checked
                  })
                }
                className="mt-3 h-4 w-4"
              />
            </Field>
            <Field label="Χρώμα">
              <ColorSelect
                value={template.color}
                onChange={(color) => updateTemplate(index, { color })}
              />
            </Field>
            <button
              type="button"
              onClick={() =>
                onChange(value.filter((_, itemIndex) => itemIndex !== index))
              }
              className="self-end rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600"
            >
              Διαγραφή
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange([...value, createBlankShiftTemplate()])}
        className="mt-5 rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-800"
      >
        Προσθήκη βάρδιας
      </button>
    </div>
  );
}

function BusinessSettingsEditor({
  settings,
  onSaved
}: {
  settings: BusinessSettings | null;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<BusinessInfoDraft>(() =>
    businessSettingsToForm(settings)
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(businessSettingsToForm(settings));
  }, [settings]);

  async function saveBusinessSettings() {
    const nextErrors = validateBusinessInfo(form);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      await upsertBusinessSettings(form, settings?.id);
      await onSaved();
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-4xl">
      {errors.length > 0 ? <ErrorList errors={errors} /> : null}
      <BusinessInfoForm value={form} onChange={setForm} />

      <button
        type="button"
        onClick={saveBusinessSettings}
        disabled={isSaving}
        className="mt-6 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {isSaving ? "Αποθήκευση..." : "Αποθήκευση ρυθμίσεων"}
      </button>
    </div>
  );
}

type RoleCrudForm = {
  name: string;
  color: string;
  description: string;
  isActive: boolean;
};

type ShiftTemplateCrudForm = {
  name: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  color: string;
  notes: string;
  isActive: boolean;
};

type StaffingRequirementForm = {
  dayOfWeek: DayOfWeek;
  shiftTemplateId: string;
  roleCounts: Record<string, string>;
};

type StaffingRequirementGroup = {
  key: string;
  dayOfWeek: DayOfWeek;
  shiftTemplateId: string;
  label: string;
  startTime: string;
  endTime: string;
  requirements: StaffingRequirement[];
  totalCount: number;
};

type EmployeeWorkRulesForm = {
  employmentType: EmploymentType;
  contractDaysPerWeek: string;
  preferredHoursPerDay: string;
  contractHoursPerWeek: string;
  maxConsecutiveDays: string;
  canWorkWeekends: boolean;
};

type EmployeeForm = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  isActive: boolean;
  notes: string;
  roleIds: string[];
  roleDetails: Record<
    string,
    {
      experienceLevel: ExperienceLevel;
      canLeadRole: boolean;
      isPreferredRole: boolean;
    }
  >;
  workRules: EmployeeWorkRulesForm;
};

type DayConstraintValue =
  | "neutral"
  | "cannot_work"
  | "prefers_not_to_work"
  | "prefers_to_work";

type ShiftAvailabilityValue =
  | "available"
  | "cannot_work"
  | "prefers_not_to_work"
  | "prefers_to_work";

type TimeOffForm = {
  employeeId: string;
  dateFrom: string;
  dateTo: string;
  type: string;
  reason: string;
};

function GenerateSchedulePage({
  businessSettings,
  openingHours,
  staffingRequirements,
  specialDays,
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
  onProgramGenerated,
  onProgramDeleted,
  onViewProgram
}: {
  businessSettings: BusinessSettings | null;
  openingHours: OpeningHours[];
  staffingRequirements: StaffingRequirement[];
  specialDays: SpecialDay[];
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
  onProgramGenerated: (runId: string, message: string) => Promise<void>;
  onProgramDeleted: (message: string) => Promise<void>;
  onViewProgram: (runId: string) => void;
}) {
  const [weekStartDate, setWeekStartDate] = useState(() => todayInputValue());
  const [errors, setErrors] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
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
        shiftTemplates,
        specialDays
      });
      const run = await databaseApi.createRecord("schedule_runs", {
        name: `Weekly schedule ${formatDateRangeEu(plan.weekStartDate, plan.weekEndDate)}`,
        start_date: plan.weekStartDate,
        end_date: plan.weekEndDate,
        status: "generated",
        parameters_json: JSON.stringify({
          stage: "slot_generation",
          type: "weekly",
          selectedDate: weekRange.selectedDate,
          weekStartsOn: weekRange.weekStartsOn,
          weekStartDate: plan.weekStartDate,
          weekEndDate: plan.weekEndDate
        }),
        completed_at: new Date().toISOString()
      });

      const createdSlots: ScheduleSlot[] = [];

      for (const slot of plan.slots) {
        const createdSlot = await databaseApi.createRecord("schedule_slots", {
          schedule_run_id: run.id,
          date: slot.date,
          role_id: slot.roleId,
          start_time: slot.startTime,
          end_time: slot.endTime,
          required_count: 1,
          status: "unfilled",
          source_type: "staffing_requirement",
          source_id: slot.sourceId,
          notes: `Slot ${slot.slotNumber} of ${slot.requiredCount}`
        });
        createdSlots.push(createdSlot);
      }

      for (const warning of plan.warnings) {
        await databaseApi.createRecord("schedule_warnings", {
          schedule_run_id: run.id,
          schedule_slot_id: null,
          schedule_assignment_id: null,
          severity: warning.severity,
          warning_type: warning.warningType,
          message: warning.message
        });
      }

      await assignEmployeesToRun({
        run,
        slots: [...scheduleSlots, ...createdSlots],
        employees,
        employeeRoles,
        employeeWorkRules,
        employeeDayConstraints,
        employeeShiftAvailability,
        timeOff,
        roles,
        shiftTemplates,
        staffingRequirements,
        assignments: scheduleAssignments
      });

      await onProgramGenerated(
        run.id,
        "Proposed program generated. Review it in Schedule View."
      );
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsGenerating(false);
    }
  }

  async function deleteProgram(run: ScheduleRun) {
    const shouldDelete = window.confirm(
      "Είστε σίγουρος ότι θέλετε να διαγράψετε αυτό το πρόγραμμα; Η διαγραφή δεν μπορεί να αναιρεθεί."
    );

    if (!shouldDelete) {
      return;
    }

    setErrors([]);
    setDeletingRunId(run.id);

    try {
      await deleteGeneratedProgram({
        runId: run.id,
        scheduleSlots,
        scheduleAssignments,
        scheduleWarnings
      });
      await onProgramDeleted("Program deleted.");
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
    <div className="max-w-7xl">
      <SectionHeading
        title="Generate Program"
        description="Choose a week, generate a proposed program, then review and edit it in Schedule View."
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid gap-4 lg:grid-cols-[240px_1fr_auto] lg:items-end">
          <Field label="Select date" required>
            <input
              type="date"
              value={weekStartDate}
              onChange={(event) => setWeekStartDate(event.target.value)}
              className={inputClassName}
            />
          </Field>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              Selected week:{" "}
              {selectedWeekRange
                ? formatWeekRangeWithDays(selectedWeekRange.weekStartDate, selectedWeekRange.weekEndDate)
                : "Choose a valid date"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Week starts on {dayLabel(weekStartsOn)}.{" "}
              {selectedWeekRange && selectedWeekRange.weekStartDate !== weekStartDate
                ? `The selected date is adjusted to ${formatDateEu(selectedWeekRange.weekStartDate)}.`
                : "The selected date matches the configured week start."}
            </p>
          </div>
          <button
            type="button"
            onClick={generateProgram}
            disabled={isGenerating}
            className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {isGenerating ? "Generating Program..." : "Generate Program"}
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          The app creates demand, assigns employees, records warnings and opens
          the proposed program for review.
        </p>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-base font-semibold tracking-normal text-slate-900">
            Recent programs
          </h3>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1180px]">
            <div className="grid grid-cols-[120px_220px_150px_80px_90px_90px_100px_220px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="whitespace-nowrap">Type</span>
              <span className="whitespace-nowrap">Period</span>
              <span className="whitespace-nowrap">Status</span>
              <span className="whitespace-nowrap">Slots</span>
              <span className="whitespace-nowrap">Assigned</span>
              <span className="whitespace-nowrap">Unfilled</span>
              <span className="whitespace-nowrap">Warnings</span>
              <span className="whitespace-nowrap">Action</span>
            </div>
            {recentRuns.length === 0 ? (
              <p className="px-5 py-5 text-sm text-slate-500">
                No programs generated yet.
              </p>
            ) : (
              recentRuns.map((run) => {
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
                  (slot) =>
                    slot.status !== "filled" && !assignedSlotIds.has(slot.id)
                ).length;
                return (
                  <div key={run.id} className="border-t border-slate-200">
                    <div className="grid grid-cols-[120px_220px_150px_80px_90px_90px_100px_220px] items-center gap-0 px-5 py-4">
                      <p className="whitespace-nowrap text-sm font-medium text-slate-900">
                        {scheduleRunTypeLabel(run)}
                      </p>
                      <p className="whitespace-nowrap text-sm text-slate-600">
                        {formatDateRangeEu(run.start_date, run.end_date)}
                      </p>
                      <p className="whitespace-nowrap text-sm text-slate-600">
                        {programStatusLabel(run.status)}
                      </p>
                      <p className="whitespace-nowrap text-sm text-slate-600">
                        {runSlots.length}
                      </p>
                      <p className="whitespace-nowrap text-sm text-slate-600">
                        {assignedSlotIds.size}
                      </p>
                      <p className="whitespace-nowrap text-sm text-slate-600">
                        {unfilledSlotCount}
                      </p>
                      <p className="whitespace-nowrap text-sm text-slate-600">
                        {runWarnings.length}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onViewProgram(run.id)}
                          className={`${secondaryButtonClassName} whitespace-nowrap`}
                        >
                          View Program
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteProgram(run)}
                          disabled={deletingRunId === run.id}
                          className="whitespace-nowrap rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          {deletingRunId === run.id ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                    {runSlots.length > 0 ? (
                      <div className="px-5 pb-4 text-xs text-slate-500">
                        Role coverage: {roleCoverageSummary(runSlots, roles)}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

async function deleteGeneratedProgram({
  runId,
  scheduleSlots,
  scheduleAssignments,
  scheduleWarnings
}: {
  runId: string;
  scheduleSlots: ScheduleSlot[];
  scheduleAssignments: ScheduleAssignment[];
  scheduleWarnings: ScheduleWarning[];
}): Promise<void> {
  for (const warning of scheduleWarnings.filter(
    (item) => item.schedule_run_id === runId
  )) {
    await databaseApi.deleteRecord("schedule_warnings", warning.id);
  }

  for (const assignment of scheduleAssignments.filter(
    (item) => item.schedule_run_id === runId
  )) {
    await databaseApi.deleteRecord("schedule_assignments", assignment.id);
  }

  for (const slot of scheduleSlots.filter(
    (item) => item.schedule_run_id === runId
  )) {
    await databaseApi.deleteRecord("schedule_slots", slot.id);
  }

  await databaseApi.deleteRecord("schedule_runs", runId);
}

type AssignmentEditorState = {
  slot: ScheduleSlot;
  assignment: ScheduleAssignment | null;
  employeeId: string;
  confirmed: boolean;
  error: string | null;
};

function ScheduleViewPage({
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
  const selectedRun =
    scheduleRuns.find((run) => run.id === selectedRunId) ??
    [...scheduleRuns].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ??
    null;

  if (!selectedRun) {
    return (
      <div className="max-w-4xl">
        <SectionHeading
          title="Proposed Program"
          description="Generate a program first, then review and edit it here."
        />
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
          No proposed program exists yet.
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
  const employeeRows = buildEmployeeScheduleRows({
    employees,
    runSlots,
    runAssignments,
    roles,
    shiftTemplates,
    staffingRequirements,
    warningsBySlotId
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

    if (validation.violations.length > 0 && !editor.confirmed) {
      setEditor({
        ...editor,
        error: "Confirm the warnings before saving this manual override."
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
      await onChanged("Proposed program updated.");
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
      await onChanged("Assignment removed.");
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
              employeeWorkRules
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
    const shouldDelete = window.confirm(
      "Είστε σίγουρος ότι θέλετε να διαγράψετε αυτό το πρόγραμμα; Η διαγραφή δεν μπορεί να αναιρεθεί."
    );

    if (!shouldDelete) {
      return;
    }

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
      await onDeleted("Program deleted.");
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
          title="Proposed Program"
          description="Review assigned employees, unfilled needs, warnings and explanations before export."
        />
        <div className="flex items-end gap-3">
          <Field label="View program">
            <select
              value={selectedRun.id}
              onChange={(event) => onSelectRun(event.target.value)}
              className={inputClassName}
            >
              {[...scheduleRuns]
                .sort((a, b) => b.created_at.localeCompare(a.created_at))
                .map((run) => (
                  <option key={run.id} value={run.id}>
                    {formatDateRangeEu(run.start_date, run.end_date)}
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
            onClick={() => void deleteCurrentProgram()}
            disabled={isDeletingProgram}
            className="rounded-md border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {isDeletingProgram ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {exportError ? <ErrorList errors={[exportError]} /> : null}
      {exportNotice ? (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {exportNotice}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-6 gap-4">
        <SummaryTile label="Business" value={businessName} />
        <SummaryTile
          label="Period"
          value={formatDateRangeEu(selectedRun.start_date, selectedRun.end_date)}
        />
        <SummaryTile label="Slots" value={runSlots.length} />
        <SummaryTile label="Assigned" value={runAssignments.length} />
        <SummaryTile label="Unfilled" value={unfilledSlotCount} />
        <SummaryTile label="Warnings" value={runWarnings.length} />
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold tracking-normal text-slate-900">
              Weekly program
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              TODO: drag and drop can reuse the same click-to-edit validation
              path later.
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
              Ανά εργαζόμενο
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
              Ανά βάρδια
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {viewMode === "employee" ? (
            <div className="min-w-[1180px]">
              <div className="grid grid-cols-[220px_repeat(7,minmax(130px,1fr))] bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <div className="px-4 py-3">Εργαζόμενος</div>
                {dates.map((date) => (
                  <div key={date} className="px-3 py-3">
                    <p className="whitespace-nowrap">{dayLabel(getDayOfWeek(date))}</p>
                    <p className="whitespace-nowrap font-medium normal-case tracking-normal text-slate-700">
                      {formatDateEu(date)}
                    </p>
                  </div>
                ))}
              </div>
              {employeeRows.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  No employees are available for this proposed program.
                </div>
              ) : (
                employeeRows.map((employeeRow) => (
                  <div
                    key={employeeRow.employee.id}
                    className="grid grid-cols-[220px_repeat(7,minmax(130px,1fr))] border-t border-slate-200"
                  >
                    <div className="border-r border-slate-200 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {employeeName(employeeRow.employee.id, employees)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {employeeRow.assignmentCount} shift
                        {employeeRow.assignmentCount === 1 ? "" : "s"}
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
                            Ρεπό
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
                                  {item.role?.name ?? "Role"}
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
                <div className="px-4 py-3">Βάρδια</div>
                {dates.map((date) => (
                  <div key={date} className="px-3 py-3">
                    <p className="whitespace-nowrap">{dayLabel(getDayOfWeek(date))}</p>
                    <p className="whitespace-nowrap font-medium normal-case tracking-normal text-slate-700">
                      {formatDateEu(date)}
                    </p>
                  </div>
                ))}
              </div>
              {shiftRows.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500">
                  This proposed program has no slots.
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
                                ).map((warning) => warning.message);

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
                                        : "Unfilled"}
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
          validation={modalValidation}
          isSaving={isSaving}
          onChange={(next) => setEditor(next)}
          onClose={() => setEditor(null)}
          onRemove={() => void removeAssignment()}
          onSave={() => void saveEditor()}
        />
      ) : null}
    </div>
  );
}

function AssignmentEditorModal({
  editor,
  employees,
  validation,
  isSaving,
  onChange,
  onClose,
  onRemove,
  onSave
}: {
  editor: AssignmentEditorState;
  employees: Employee[];
  validation: ManualAssignmentValidation | null;
  isSaving: boolean;
  onChange: (editor: AssignmentEditorState) => void;
  onClose: () => void;
  onRemove: () => void;
  onSave: () => void;
}) {
  const hasViolations = Boolean(validation && validation.violations.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold tracking-normal text-slate-950">
              Edit assignment
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {formatDateEu(editor.slot.date)} · {editor.slot.start_time} -{" "}
              {editor.slot.end_time}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={secondaryButtonClassName}
          >
            Close
          </button>
        </div>

        {editor.error ? <ErrorList errors={[editor.error]} /> : null}

        <div className="mt-5">
          <Field label="Employee">
            <select
              value={editor.employeeId}
              onChange={(event) =>
                onChange({
                  ...editor,
                  employeeId: event.target.value,
                  confirmed: false,
                  error: null
                })
              }
              className={inputClassName}
            >
              <option value="">Unfilled</option>
              {[...employees]
                .sort(
                  (a, b) =>
                    a.last_name.localeCompare(b.last_name) ||
                    a.first_name.localeCompare(b.first_name)
                )
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.first_name} {employee.last_name}
                  </option>
                ))}
            </select>
          </Field>
        </div>

        {validation?.explanation ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {validation.explanation}
          </div>
        ) : null}

        {hasViolations ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm font-semibold text-amber-950">Warnings</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
              {validation?.violations.map((violation) => (
                <li key={violation}>{violation}</li>
              ))}
            </ul>
            <label className="mt-3 flex items-center gap-2 text-sm text-amber-950">
              <input
                type="checkbox"
                checked={editor.confirmed}
                onChange={(event) =>
                  onChange({ ...editor, confirmed: event.target.checked })
                }
              />
              Save as manual override despite these warnings
            </label>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onRemove}
            disabled={!editor.assignment || isSaving}
            className={secondaryButtonClassName}
          >
            Remove assignment
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || (hasViolations && !editor.confirmed)}
            className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save manual override"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeConstraintsPage({
  employees,
  constraints,
  shiftTemplates,
  shiftAvailability,
  onChanged
}: {
  employees: Employee[];
  constraints: EmployeeDayConstraint[];
  shiftTemplates: ShiftTemplate[];
  shiftAvailability: EmployeeShiftAvailability[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    employees[0]?.id ?? ""
  );
  const selectedEmployee =
    employees.find((employee) => employee.id === selectedEmployeeId) ??
    employees[0] ??
    null;
  const activeShiftTemplates = shiftTemplates.filter(
    (shiftTemplate) => shiftTemplate.is_active === 1
  );

  useEffect(() => {
    setSelectedEmployeeId((current) =>
      current && employees.some((employee) => employee.id === current)
        ? current
        : employees[0]?.id ?? ""
    );
  }, [employees]);

  async function saveConstraint(
    employee: Employee,
    dayOfWeek: DayOfWeek,
    constraintType: DayConstraintValue
  ) {
    setErrors([]);
    setIsSaving(true);

    try {
      const existingConstraints = constraints.filter(
        (constraint) =>
          constraint.employee_id === employee.id &&
          constraint.day_of_week === dayOfWeek
      );

      if (constraintType === "neutral") {
        for (const constraint of existingConstraints) {
          await databaseApi.deleteRecord(
            "employee_day_constraints",
            constraint.id
          );
        }
        await onChanged("Availability constraint cleared.");
        return;
      }

      const [existingConstraint, ...duplicates] = existingConstraints;

      if (existingConstraint) {
        await databaseApi.updateRecord(
          "employee_day_constraints",
          existingConstraint.id,
          {
            employee_id: employee.id,
            day_of_week: dayOfWeek,
            constraint_type: constraintType,
            notes: null
          }
        );

        for (const duplicate of duplicates) {
          await databaseApi.deleteRecord(
            "employee_day_constraints",
            duplicate.id
          );
        }
      } else {
        await databaseApi.createRecord("employee_day_constraints", {
          employee_id: employee.id,
          day_of_week: dayOfWeek,
          constraint_type: constraintType,
          notes: null
        });
      }

      await onChanged("Availability constraint saved.");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveShiftAvailability(
    employee: Employee,
    dayOfWeek: DayOfWeek,
    shiftTemplateId: string,
    availabilityType: ShiftAvailabilityValue
  ) {
    setErrors([]);
    setIsSaving(true);

    try {
      const existingRows = shiftAvailability.filter(
        (item) =>
          item.employee_id === employee.id &&
          item.day_of_week === dayOfWeek &&
          item.shift_template_id === shiftTemplateId
      );

      if (availabilityType === "available") {
        for (const row of existingRows) {
          await databaseApi.deleteRecord("employee_shift_availability", row.id);
        }
        await onChanged("Shift availability cleared.");
        return;
      }

      const [existingRow, ...duplicates] = existingRows;

      if (existingRow) {
        await databaseApi.updateRecord(
          "employee_shift_availability",
          existingRow.id,
          {
            employee_id: employee.id,
            day_of_week: dayOfWeek,
            shift_template_id: shiftTemplateId,
            availability_type: availabilityType,
            notes: null
          }
        );

        for (const duplicate of duplicates) {
          await databaseApi.deleteRecord(
            "employee_shift_availability",
            duplicate.id
          );
        }
      } else {
        await databaseApi.createRecord("employee_shift_availability", {
          employee_id: employee.id,
          day_of_week: dayOfWeek,
          shift_template_id: shiftTemplateId,
          availability_type: availabilityType,
          notes: null
        });
      }

      await onChanged("Shift availability saved.");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-7xl">
      <SectionHeading
        title="Employee Availability"
        description="Set day-level constraints and specific shift availability for each employee."
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
        <div className="grid gap-4 text-sm text-slate-600 md:grid-cols-4">
          <p>
            <span className="font-semibold text-slate-900">cannot_work</span> is
            a hard constraint.
          </p>
          <p>
            <span className="font-semibold text-slate-900">
              prefers_not_to_work
            </span>{" "}
            is a soft negative preference.
          </p>
          <p>
            <span className="font-semibold text-slate-900">prefers_to_work</span>{" "}
            is a soft positive preference.
          </p>
          <Field label="Employee">
            <select
              value={selectedEmployee?.id ?? ""}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              className={inputClassName}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {employees.length === 0 ? (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white px-5 py-5 text-sm text-slate-500">
            Add employees before setting availability constraints.
        </div>
      ) : selectedEmployee ? (
        <>
          <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold tracking-normal text-slate-900">
                Day-level availability
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                A day-level cannot_work blocks every shift on that day.
              </p>
            </div>
            <div className="grid grid-cols-[1.2fr_repeat(7,1fr)] items-center gap-3 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {selectedEmployee.first_name} {selectedEmployee.last_name}
                </p>
                <StatusBadge isActive={Boolean(selectedEmployee.is_active)} />
              </div>
              {dayLabels.map((day) => (
                <select
                  key={day.dayOfWeek}
                  value={dayConstraintValue(
                    selectedEmployee.id,
                    day.dayOfWeek,
                    constraints
                  )}
                  onChange={(event) =>
                    void saveConstraint(
                      selectedEmployee,
                      day.dayOfWeek,
                      event.target.value as DayConstraintValue
                    )
                  }
                  disabled={isSaving}
                  className={inputClassName}
                >
                  {dayConstraintOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          </div>

          <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <div
              className="grid min-w-[980px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
              style={{
                gridTemplateColumns: `150px repeat(${Math.max(
                  1,
                  activeShiftTemplates.length
                )}, minmax(150px, 1fr))`
              }}
            >
              <span>Day</span>
              {activeShiftTemplates.length === 0 ? (
                <span>Shift templates</span>
              ) : (
                activeShiftTemplates.map((shiftTemplate) => (
                  <span key={shiftTemplate.id} className="whitespace-nowrap">
                    {shiftTemplate.name}
                  </span>
                ))
              )}
            </div>

            {activeShiftTemplates.length === 0 ? (
              <p className="px-5 py-5 text-sm text-slate-500">
                Add active shift templates before setting shift availability.
              </p>
            ) : (
              dayLabels.map((day) => (
                <div
                  key={day.dayOfWeek}
                  className="grid min-w-[980px] items-center gap-3 border-t border-slate-200 px-5 py-4"
                  style={{
                    gridTemplateColumns: `150px repeat(${activeShiftTemplates.length}, minmax(150px, 1fr))`
                  }}
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {day.label}
                  </p>
                  {activeShiftTemplates.map((shiftTemplate) => {
                    const value = shiftAvailabilityValue(
                      selectedEmployee.id,
                      day.dayOfWeek,
                      shiftTemplate.id,
                      shiftAvailability
                    );

                    return (
                      <select
                        key={shiftTemplate.id}
                        value={value}
                        onChange={(event) =>
                          void saveShiftAvailability(
                            selectedEmployee,
                            day.dayOfWeek,
                            shiftTemplate.id,
                            event.target.value as ShiftAvailabilityValue
                          )
                        }
                        disabled={isSaving}
                        className={`${inputClassName} ${shiftAvailabilityClassName(
                          value
                        )}`}
                      >
                        {shiftAvailabilityOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TimeOffPage({
  employees,
  timeOff,
  onChanged
}: {
  employees: Employee[];
  timeOff: TimeOff[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<TimeOffForm>(() =>
    createTimeOffForm(employees)
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      employeeId:
        current.employeeId &&
        employees.some((employee) => employee.id === current.employeeId)
          ? current.employeeId
          : employees[0]?.id ?? ""
    }));
  }, [employees]);

  async function saveTimeOff() {
    const nextErrors = validateTimeOffForm(form, employees);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      await databaseApi.createRecord("time_off", {
        employee_id: form.employeeId,
        type: form.type,
        start_date: form.dateFrom,
        end_date: form.dateTo,
        reason: optionalText(form.reason),
        status: "recorded",
        notes: null
      });
      await onChanged("Time off saved.");
      setForm(createTimeOffForm(employees));
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteTimeOff(entry: TimeOff) {
    const shouldDelete = window.confirm("Delete this time off entry?");

    if (!shouldDelete) {
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      await databaseApi.deleteRecord("time_off", entry.id);
      await onChanged("Time off deleted.");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="max-w-6xl">
      <SectionHeading
        title="Time Off"
        description="Record employee days off, vacation, sick leave, personal time, and other absence periods."
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {employees.length === 0 ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Add employees before recording time off.
        </div>
      ) : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-base font-semibold tracking-normal">Add time off</h3>

        <div className="mt-4 grid grid-cols-[1.2fr_150px_150px_150px_1.5fr] gap-4">
          <Field label="Employee" required>
            <select
              value={form.employeeId}
              onChange={(event) =>
                setForm({ ...form, employeeId: event.target.value })
              }
              className={inputClassName}
            >
              <option value="">Choose employee</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date from" required>
            <input
              type="date"
              value={form.dateFrom}
              onChange={(event) =>
                setForm({ ...form, dateFrom: event.target.value })
              }
              className={inputClassName}
            />
          </Field>
          <Field label="Date to" required>
            <input
              type="date"
              value={form.dateTo}
              onChange={(event) =>
                setForm({ ...form, dateTo: event.target.value })
              }
              className={inputClassName}
            />
          </Field>
          <Field label="Type" required>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
              className={inputClassName}
            >
              {timeOffTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason">
            <input
              value={form.reason}
              onChange={(event) =>
                setForm({ ...form, reason: event.target.value })
              }
              className={inputClassName}
              placeholder="Optional"
            />
          </Field>
        </div>

        <button
          type="button"
          onClick={saveTimeOff}
          disabled={isSaving || employees.length === 0}
          className="mt-5 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isSaving ? "Saving..." : "Add time off"}
        </button>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.2fr_160px_160px_160px_1.4fr_120px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Employee</span>
          <span>From</span>
          <span>To</span>
          <span>Type</span>
          <span>Reason</span>
          <span>Actions</span>
        </div>

        {timeOff.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-500">
            No time off has been recorded yet.
          </p>
        ) : (
          [...timeOff]
            .sort((a, b) => a.start_date.localeCompare(b.start_date))
            .map((entry) => (
              <div
                key={entry.id}
                className="grid grid-cols-[1.2fr_160px_160px_160px_1.4fr_120px] items-center gap-4 border-t border-slate-200 px-5 py-4"
              >
                <p className="text-sm font-semibold text-slate-900">
                  {employeeName(entry.employee_id, employees)}
                </p>
                <p className="text-sm text-slate-600">{entry.start_date}</p>
                <p className="text-sm text-slate-600">{entry.end_date}</p>
                <p className="text-sm text-slate-600">
                  {timeOffTypeLabel(entry.type)}
                </p>
                <p className="text-sm text-slate-600">
                  {entry.reason || "No reason"}
                </p>
                <button
                  type="button"
                  onClick={() => void deleteTimeOff(entry)}
                  className={secondaryButtonClassName}
                >
                  Delete
                </button>
              </div>
            ))
        )}
      </div>
    </div>
  );
}

function EmployeesPage({
  employees,
  roles,
  employeeRoles,
  employeeWorkRules,
  onChanged
}: {
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<EmployeeForm>(() => createEmployeeForm());
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const filteredEmployees = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();

    if (!query) {
      return employees;
    }

    return employees.filter((employee) => {
      const haystack = [
        employee.first_name,
        employee.last_name,
        employee.email ?? "",
        employee.phone ?? "",
        employee.notes ?? ""
      ]
        .join(" ")
        .toLocaleLowerCase();

      return haystack.includes(query);
    });
  }, [employees, searchTerm]);

  async function saveEmployee() {
    const nextErrors = validateEmployeeForm(form);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      const payload = {
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        email: optionalText(form.email),
        phone: optionalText(form.phone),
        is_active: form.isActive,
        notes: optionalText(form.notes)
      };
      const employee = editingEmployeeId
        ? await databaseApi.updateRecord("employees", editingEmployeeId, payload)
        : await databaseApi.createRecord("employees", payload);

      if (!employee) {
        throw new Error("Δεν ήταν δυνατή η αποθήκευση εργαζομένου.");
      }

      await syncEmployeeRoleAssignments(
        employee.id,
        form,
        employeeRoles
      );
      await upsertEmployeeWorkRules(
        employee.id,
        form.workRules,
        employeeWorkRules
      );
      await onChanged(
        editingEmployeeId
          ? "Ο εργαζόμενος ενημερώθηκε."
          : "Ο εργαζόμενος προστέθηκε."
      );

      setEditingEmployeeId(null);
      setForm(createEmployeeForm());
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleEmployeeActive(employee: Employee) {
    setErrors([]);
    setIsSaving(true);

    try {
      const nextIsActive = !employee.is_active;
      await databaseApi.updateRecord("employees", employee.id, {
        is_active: nextIsActive
      });

      if (editingEmployeeId === employee.id) {
        setForm((current) => ({ ...current, isActive: nextIsActive }));
      }

      await onChanged(
        nextIsActive
          ? "Ο εργαζόμενος ενεργοποιήθηκε."
          : "Ο εργαζόμενος απενεργοποιήθηκε."
      );
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  function startEditing(employee: Employee) {
    const assignedRoles = employeeRoles.filter(
      (employeeRole) => employeeRole.employee_id === employee.id
    );
    const workRules =
      employeeWorkRules.find((rules) => rules.employee_id === employee.id) ??
      null;

    setErrors([]);
    setEditingEmployeeId(employee.id);
    setForm(employeeToForm(employee, assignedRoles, workRules));
  }

  function resetForm() {
    setErrors([]);
    setEditingEmployeeId(null);
    setForm(createEmployeeForm());
  }

  function toggleRole(roleId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      roleIds: checked
        ? [...new Set([...current.roleIds, roleId])]
        : current.roleIds.filter((id) => id !== roleId),
      roleDetails: {
        ...current.roleDetails,
        [roleId]: current.roleDetails[roleId] ?? {
          experienceLevel: "some_experience",
          canLeadRole: false,
          isPreferredRole: false
        }
      }
    }));
  }

  function updateRoleDetail(
    roleId: string,
    detail: Partial<EmployeeForm["roleDetails"][string]>
  ) {
    setForm((current) => {
      const existing = current.roleDetails[roleId];
      const nextDetail = {
        experienceLevel: existing?.experienceLevel ?? "some_experience",
        canLeadRole: existing?.canLeadRole ?? false,
        isPreferredRole: existing?.isPreferredRole ?? false,
        ...detail
      };

      return {
        ...current,
        roleDetails: {
          ...current.roleDetails,
          [roleId]: nextDetail
        }
      };
    });
  }

  return (
    <div className="max-w-7xl">
      <SectionHeading
        title="Εργαζόμενοι"
        description="Διαχείριση στοιχείων εργαζομένων, ρόλων και κανόνων εργασίας."
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {roles.length === 0 ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Προσθέστε ρόλους πριν τους αναθέσετε σε εργαζομένους.
        </div>
      ) : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-normal">
            {editingEmployeeId ? "Επεξεργασία εργαζομένου" : "Προσθήκη εργαζομένου"}
          </h3>
          {editingEmployeeId ? (
            <button
              type="button"
              onClick={resetForm}
              className={secondaryButtonClassName}
            >
              Ακύρωση
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-4">
          <Field label="Όνομα" required>
            <input
              value={form.firstName}
              onChange={(event) =>
                setForm({ ...form, firstName: event.target.value })
              }
              className={inputClassName}
              placeholder="Alex"
            />
          </Field>
          <Field label="Επώνυμο" required>
            <input
              value={form.lastName}
              onChange={(event) =>
                setForm({ ...form, lastName: event.target.value })
              }
              className={inputClassName}
              placeholder="Papadopoulos"
            />
          </Field>
          <Field label="Κατάσταση">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm({ ...form, isActive: event.target.checked })
                }
                className="h-4 w-4"
              />
              Ενεργός
            </label>
          </Field>
          <Field label="Τηλέφωνο">
            <input
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
              className={inputClassName}
              placeholder="+30..."
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
              className={inputClassName}
              placeholder="name@example.com"
            />
          </Field>
          <Field label="Σημειώσεις">
            <input
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              className={inputClassName}
              placeholder="Optional"
            />
          </Field>
        </div>

        <div className="mt-6 grid grid-cols-[1fr_1.4fr] gap-5">
          <div>
            <h4 className="text-sm font-semibold text-slate-800">
              Ρόλοι εργαζομένου
            </h4>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {roles.length === 0 ? (
                <p className="text-sm text-slate-500">Δεν υπάρχουν διαθέσιμοι ρόλοι.</p>
              ) : (
                roles.map((role) => {
                  const isSelected = form.roleIds.includes(role.id);
                  const details = form.roleDetails[role.id] ?? {
                    experienceLevel: "some_experience",
                    canLeadRole: false,
                    isPreferredRole: false
                  };

                  return (
                    <div
                      key={role.id}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"
                    >
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) =>
                            toggleRole(role.id, event.target.checked)
                          }
                          className="h-4 w-4"
                        />
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: role.color ?? roleColors[0] }}
                        />
                        <span>{role.name}</span>
                        {!role.is_active ? (
                          <span className="text-xs text-slate-400">ανενεργός</span>
                        ) : null}
                      </label>

                      {isSelected ? (
                        <div className="mt-3 space-y-2">
                          <Field label="Προϋπηρεσία">
                            <select
                              value={details.experienceLevel}
                              onChange={(event) =>
                                updateRoleDetail(role.id, {
                                  experienceLevel: event.target
                                    .value as ExperienceLevel
                                })
                              }
                              className={inputClassName}
                            >
                              {experienceLevelOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <label className="flex items-center gap-2 text-xs text-slate-600">
                            <input
                              type="checkbox"
                              checked={details.canLeadRole}
                              onChange={(event) =>
                                updateRoleDetail(role.id, {
                                  canLeadRole: event.target.checked
                                })
                              }
                            />
                            Μπορεί να είναι υπεύθυνος ρόλου
                          </label>
                          <label className="flex items-center gap-2 text-xs text-slate-600">
                            <input
                              type="checkbox"
                              checked={details.isPreferredRole}
                              onChange={(event) =>
                                updateRoleDetail(role.id, {
                                  isPreferredRole: event.target.checked
                                })
                              }
                            />
                            Προτιμώμενος ρόλος
                          </label>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-slate-800">
                Σύμβαση / Κανόνες εργασίας
              </h4>
              <div className="flex flex-wrap gap-2">
                {employmentPatternPresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        workRules: applyEmploymentPatternPreset(
                          form.workRules,
                          preset.id
                        )
                      })
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-3">
              <Field label="Τύπος απασχόλησης">
                <select
                  value={form.workRules.employmentType}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      workRules: applyEmploymentTypeDefaults(
                        form.workRules,
                        event.target.value as EmploymentType
                      )
                    })
                  }
                  className={inputClassName}
                >
                  {employmentTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <NumberField
                label="Ημέρες / εβδομάδα"
                value={form.workRules.contractDaysPerWeek}
                onChange={(value) =>
                  setForm({
                    ...form,
                    workRules: {
                      ...form.workRules,
                      contractDaysPerWeek: value
                    }
                  })
                }
              />
              <NumberField
                label="Ώρες / ημέρα"
                value={form.workRules.preferredHoursPerDay}
                onChange={(value) =>
                  setForm({
                    ...form,
                    workRules: {
                      ...form.workRules,
                      preferredHoursPerDay: value
                    }
                  })
                }
              />
              <NumberField
                label="Ώρες / εβδομάδα"
                value={form.workRules.contractHoursPerWeek}
                onChange={(value) =>
                  setForm({
                    ...form,
                    workRules: {
                      ...form.workRules,
                      contractHoursPerWeek: value
                    }
                  })
                }
              />
              <NumberField
                label="Μέγιστες συνεχόμενες ημέρες"
                value={form.workRules.maxConsecutiveDays}
                onChange={(value) =>
                  setForm({
                    ...form,
                    workRules: { ...form.workRules, maxConsecutiveDays: value }
                  })
                }
              />
              <label className="flex items-center gap-2 pt-7 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.workRules.canWorkWeekends}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      workRules: {
                        ...form.workRules,
                        canWorkWeekends: event.target.checked
                      }
                    })
                  }
                  className="h-4 w-4"
                />
                Μπορεί να δουλεύει Σαββατοκύριακο
              </label>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={saveEmployee}
          disabled={isSaving}
          className="mt-6 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isSaving
            ? "Αποθήκευση..."
            : editingEmployeeId
              ? "Αποθήκευση εργαζομένου"
              : "Προσθήκη εργαζομένου"}
        </button>
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <Field label="Αναζήτηση εργαζομένων">
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className={`${inputClassName} w-96`}
            placeholder="Αναζήτηση με όνομα, τηλέφωνο, email ή σημειώσεις"
          />
        </Field>
        <p className="pb-2 text-sm text-slate-500">
          Εμφάνιση {filteredEmployees.length} από {employees.length}
        </p>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.1fr_1.1fr_1.4fr_1.4fr_110px_190px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Εργαζόμενος</span>
          <span>Επικοινωνία</span>
          <span>Ρόλοι</span>
          <span>Σύμβαση</span>
          <span>Κατάσταση</span>
          <span>Ενέργειες</span>
        </div>

        {filteredEmployees.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-500">
            Δεν βρέθηκαν εργαζόμενοι με αυτό το φίλτρο.
          </p>
        ) : (
          filteredEmployees.map((employee) => {
            const assignedRoleIds = employeeRoles
              .filter((employeeRole) => employeeRole.employee_id === employee.id)
              .map((employeeRole) => employeeRole.role_id);
            const rules =
              employeeWorkRules.find(
                (workRules) => workRules.employee_id === employee.id
              ) ?? null;

            return (
              <div
                key={employee.id}
                className="grid grid-cols-[1.1fr_1.1fr_1.4fr_1.4fr_110px_190px] items-center gap-4 border-t border-slate-200 px-5 py-4"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {employee.first_name} {employee.last_name}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {employee.notes || "Χωρίς σημειώσεις"}
                  </p>
                </div>
                <div className="text-sm text-slate-600">
                  <p>{employee.phone || "Χωρίς τηλέφωνο"}</p>
                  <p className="mt-1">{employee.email || "Χωρίς email"}</p>
                </div>
                <p className="text-sm text-slate-600">
                  {employeeRoleLabels(assignedRoleIds, roles)}
                </p>
                <p className="text-sm text-slate-600">
                  {workRulesSummary(rules)}
                </p>
                <StatusBadge isActive={Boolean(employee.is_active)} />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEditing(employee)}
                    className={secondaryButtonClassName}
                  >
                    Επεξεργασία
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleEmployeeActive(employee)}
                    className={secondaryButtonClassName}
                  >
                    {employee.is_active ? "Απενεργοποίηση" : "Ενεργοποίηση"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StaffingRequirementsPage({
  roles,
  shiftTemplates,
  requirements,
  onChanged
}: {
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  requirements: StaffingRequirement[];
  onChanged: (message: string) => Promise<void>;
}) {
  const activeRoles = useMemo(
    () => roles.filter((role) => role.is_active),
    [roles]
  );
  const activeShiftTemplates = useMemo(
    () => shiftTemplates.filter((template) => template.is_active),
    [shiftTemplates]
  );
  const [form, setForm] = useState<StaffingRequirementForm>(() =>
    createStaffingRequirementForm(roles, shiftTemplates)
  );
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [copySourceDay, setCopySourceDay] = useState<DayOfWeek>(1);
  const [copyTargetDay, setCopyTargetDay] = useState<DayOfWeek>(2);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const groupedRequirements = useMemo(
    () => groupStaffingRequirements(requirements, shiftTemplates),
    [requirements, shiftTemplates]
  );
  const selectedShiftTemplate = shiftTemplates.find(
    (template) => template.id === form.shiftTemplateId
  );

  useEffect(() => {
    if (editingGroupKey) {
      return;
    }

    setForm((current) => ({
      ...current,
      shiftTemplateId:
        current.shiftTemplateId &&
        shiftTemplates.some((template) => template.id === current.shiftTemplateId)
          ? current.shiftTemplateId
          : activeShiftTemplates[0]?.id ?? "",
      roleCounts: ensureRoleCountKeys(current.roleCounts, activeRoles)
    }));
  }, [roles, shiftTemplates, activeRoles, activeShiftTemplates, editingGroupKey]);

  async function saveRequirementGroup() {
    const nextErrors = validateStaffingRequirementForm(
      form,
      selectedShiftTemplate,
      activeRoles
    );

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (!selectedShiftTemplate) {
      setErrors(["Choose a shift template."]);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      const groupRequirements = getRequirementsForShiftGroup({
        requirements,
        dayOfWeek: form.dayOfWeek,
        shiftTemplateId: selectedShiftTemplate.id
      });

      for (const role of activeRoles) {
        const count = parseStaffingRoleCount(form.roleCounts[role.id]) ?? 0;
        const roleRequirements = groupRequirements.filter(
          (requirement) => requirement.role_id === role.id
        );
        const [existingRequirement, ...duplicates] = roleRequirements;

        if (count > 0) {
          const payload = {
            day_of_week: form.dayOfWeek,
            shift_template_id: selectedShiftTemplate.id,
            role_id: role.id,
            start_time: selectedShiftTemplate.start_time,
            end_time: selectedShiftTemplate.end_time,
            required_count: count,
            minimum_experience_level:
              existingRequirement?.minimum_experience_level ?? "no_experience",
            experienced_required_count:
              existingRequirement?.experienced_required_count ?? 0,
            priority: existingRequirement?.priority ?? "normal",
            is_active: true,
            notes: existingRequirement?.notes ?? null
          };

          if (existingRequirement) {
            await databaseApi.updateRecord(
              "staffing_requirements",
              existingRequirement.id,
              payload
            );
          } else {
            await databaseApi.createRecord("staffing_requirements", payload);
          }

          for (const duplicate of duplicates) {
            await databaseApi.deleteRecord("staffing_requirements", duplicate.id);
          }
          continue;
        }

        for (const requirement of roleRequirements) {
          await databaseApi.deleteRecord("staffing_requirements", requirement.id);
        }
      }

      await onChanged(
        editingGroupKey
          ? "Οι ανάγκες βάρδιας ενημερώθηκαν."
          : "Οι ανάγκες βάρδιας αποθηκεύτηκαν."
      );
      setEditingGroupKey(null);
      setForm(createStaffingRequirementForm(roles, shiftTemplates));
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRequirementGroup(group: StaffingRequirementGroup) {
    const shouldDelete = window.confirm(
      "Να διαγραφούν όλες οι ανάγκες προσωπικού για αυτή τη βάρδια; Αυτή η ενέργεια δεν αναιρείται."
    );

    if (!shouldDelete) {
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      const groupRequirements = getRequirementsForShiftGroup({
        requirements,
        dayOfWeek: group.dayOfWeek,
        shiftTemplateId: group.shiftTemplateId
      });

      for (const requirement of groupRequirements) {
        await databaseApi.deleteRecord("staffing_requirements", requirement.id);
      }

      if (editingGroupKey === group.key) {
        resetForm();
      }
      await onChanged("Οι ανάγκες βάρδιας διαγράφηκαν.");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function copyDay(sourceDay: DayOfWeek, targetDays: DayOfWeek[]) {
    const sourceRequirements = requirements.filter(
      (requirement) =>
        requirement.day_of_week === sourceDay && Boolean(requirement.is_active)
    );

    if (sourceRequirements.length === 0) {
      setErrors(["The source day has no active requirements to copy."]);
      return;
    }

    if (targetDays.includes(sourceDay)) {
      setErrors(["Source and target days must be different."]);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      for (const targetDay of targetDays) {
        const targetRequirements = requirements.filter(
          (requirement) => requirement.day_of_week === targetDay
        );

        for (const requirement of targetRequirements) {
          await databaseApi.deleteRecord("staffing_requirements", requirement.id);
        }

        for (const requirement of sourceRequirements) {
          const shiftSnapshot = staffingRequirementShiftSnapshot(
            requirement,
            shiftTemplates
          );

          await databaseApi.createRecord("staffing_requirements", {
            day_of_week: targetDay,
            shift_template_id: requirement.shift_template_id,
            role_id: requirement.role_id,
            start_time: shiftSnapshot.startTime,
            end_time: shiftSnapshot.endTime,
            required_count: requirement.required_count,
            minimum_experience_level: requirement.minimum_experience_level,
            experienced_required_count: requirement.experienced_required_count,
            priority: requirement.priority || "normal",
            is_active: true,
            notes: requirement.notes
          });
        }
      }

      await onChanged("Staffing requirements copied.");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  function startEditingGroup(group: StaffingRequirementGroup) {
    setErrors([]);
    setEditingGroupKey(group.key);
    setForm({
      dayOfWeek: group.dayOfWeek,
      shiftTemplateId: group.shiftTemplateId,
      roleCounts: createRoleCountValues(activeRoles, group.requirements)
    });
  }

  function resetForm() {
    setErrors([]);
    setEditingGroupKey(null);
    setForm(createStaffingRequirementForm(roles, shiftTemplates));
  }

  function updateRoleCount(roleId: string, value: string) {
    setForm((current) => ({
      ...current,
      roleCounts: {
        ...current.roleCounts,
        [roleId]: value
      }
    }));
  }

  return (
    <div className="max-w-7xl">
      <SectionHeading
        title="Ανάγκες Προσωπικού"
        description="Ορίστε πόσα άτομα χρειάζονται ανά ημέρα, βάρδια και ρόλο."
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {activeRoles.length === 0 || activeShiftTemplates.length === 0 ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Προσθέστε τουλάχιστον έναν ενεργό ρόλο και μία ενεργή βάρδια πριν
          ορίσετε ανάγκες προσωπικού.
        </div>
      ) : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-normal">
            {editingGroupKey
              ? "Επεξεργασία αναγκών βάρδιας"
              : "Προσθήκη αναγκών βάρδιας"}
          </h3>
          {editingGroupKey ? (
            <button
              type="button"
              onClick={resetForm}
              className={secondaryButtonClassName}
            >
              Ακύρωση
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr]">
          <Field label="Ημέρα" required>
            <select
              value={form.dayOfWeek}
              onChange={(event) =>
                setForm({
                  ...form,
                  dayOfWeek: Number(event.target.value) as DayOfWeek
                })
              }
              className={inputClassName}
            >
              {dayLabels.map((day) => (
                <option key={day.dayOfWeek} value={day.dayOfWeek}>
                  {day.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Βάρδια" required>
            <select
              value={form.shiftTemplateId}
              onChange={(event) =>
                setForm({ ...form, shiftTemplateId: event.target.value })
              }
              className={inputClassName}
            >
              <option value="">Επιλέξτε βάρδια</option>
              {activeShiftTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} ({template.start_time}-{template.end_time})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-5 rounded-md border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">
              Άτομα που χρειάζονται
              {selectedShiftTemplate
                ? ` για ${selectedShiftTemplate.name} ${selectedShiftTemplate.start_time}-${selectedShiftTemplate.end_time}`
                : ""}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Βάλτε 0 όταν δεν χρειάζεται άτομο για έναν ρόλο.
            </p>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {activeRoles.map((role) => (
              <label
                key={role.id}
                className="flex items-center justify-between gap-3 rounded border border-slate-200 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-800">
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color ?? roleColors[0] }}
                  />
                  <span className="truncate">{role.name}</span>
                </span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.roleCounts[role.id] ?? "0"}
                  onChange={(event) => updateRoleCount(role.id, event.target.value)}
                  className="h-9 w-20 rounded-md border border-slate-300 px-2 text-right text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                  aria-label={`Άτομα για ${role.name}`}
                />
              </label>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={saveRequirementGroup}
          disabled={
            isSaving || activeRoles.length === 0 || activeShiftTemplates.length === 0
          }
          className="mt-5 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isSaving
            ? "Αποθήκευση..."
            : editingGroupKey
              ? "Αποθήκευση"
              : "Αποθήκευση αναγκών"}
        </button>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <h3 className="text-base font-semibold tracking-normal">
          Αντιγραφή ημέρας
        </h3>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <Field label="Από">
            <select
              value={copySourceDay}
              onChange={(event) =>
                setCopySourceDay(Number(event.target.value) as DayOfWeek)
              }
              className={inputClassName}
            >
              {dayLabels.map((day) => (
                <option key={day.dayOfWeek} value={day.dayOfWeek}>
                  {day.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Προς">
            <select
              value={copyTargetDay}
              onChange={(event) =>
                setCopyTargetDay(Number(event.target.value) as DayOfWeek)
              }
              className={inputClassName}
            >
              {dayLabels.map((day) => (
                <option key={day.dayOfWeek} value={day.dayOfWeek}>
                  {day.label}
                </option>
              ))}
            </select>
          </Field>

          <button
            type="button"
            onClick={() => void copyDay(copySourceDay, [copyTargetDay])}
            disabled={isSaving}
            className={secondaryButtonClassName}
          >
            Αντιγραφή
          </button>

          <button
            type="button"
            onClick={() => void copyDay(1, [2, 3, 4, 5])}
            disabled={isSaving}
            className={secondaryButtonClassName}
          >
            Αντιγραφή Δευτέρας σε Τρίτη-Παρασκευή
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Η αντιγραφή αντικαθιστά τις ανάγκες της ημέρας προορισμού με τις
          ενεργές ανάγκες της ημέρας προέλευσης.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {dayLabels.map((day) => {
          const dayGroups = groupedRequirements.filter(
            (group) => group.dayOfWeek === day.dayOfWeek
          );

          return (
            <div
              key={day.dayOfWeek}
              className="rounded-lg border border-slate-200 bg-white"
            >
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-base font-semibold tracking-normal">
                  {day.label}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {dayGroups.length} βάρδια
                  {dayGroups.length === 1 ? "" : "ες"}
                </p>
              </div>

              <div className="divide-y divide-slate-200">
                {dayGroups.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-500">
                    Δεν έχουν οριστεί ανάγκες για αυτή την ημέρα.
                  </p>
                ) : (
                  dayGroups.map((group) => (
                    <div key={group.key} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-950">
                              {group.label}
                            </span>
                            <span className="text-sm text-slate-500">
                              {group.startTime} - {group.endTime}
                            </span>
                            <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                              Σύνολο {group.totalCount}
                            </span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {group.requirements.map((requirement) => (
                              <span
                                key={requirement.id}
                                className="inline-flex items-center gap-1 rounded bg-slate-50 px-2 py-1 text-sm text-slate-700 ring-1 ring-slate-200"
                              >
                                <span className="font-semibold text-slate-900">
                                  {roleLabel(requirement.role_id, roles)}
                                </span>
                                <span>{requirement.required_count}</span>
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEditingGroup(group)}
                            className={secondaryButtonClassName}
                          >
                            Επεξεργασία
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteRequirementGroup(group)}
                            className={secondaryButtonClassName}
                          >
                            Διαγραφή
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RolesCrudPage({
  roles,
  onChanged
}: {
  roles: Role[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<RoleCrudForm>(() => createRoleCrudForm());
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  async function saveRole() {
    const nextErrors = validateRoleCrudForm(form, roles, editingRoleId);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      const payload = {
        name: form.name.trim(),
        color: form.color,
        description: optionalText(form.description),
        is_active: form.isActive
      };

      if (editingRoleId) {
        await databaseApi.updateRecord("roles", editingRoleId, payload);
        await onChanged("Role updated.");
      } else {
        await databaseApi.createRecord("roles", payload);
        await onChanged("Role added.");
      }

      setForm(createRoleCrudForm());
      setEditingRoleId(null);
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleRoleActive(role: Role) {
    setErrors([]);
    setIsSaving(true);

    try {
      const nextIsActive = !role.is_active;
      await databaseApi.updateRecord("roles", role.id, {
        is_active: nextIsActive
      });
      await onChanged(nextIsActive ? "Role reactivated." : "Role deactivated.");

      if (editingRoleId === role.id) {
        setForm((current) => ({ ...current, isActive: nextIsActive }));
      }
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  function startEditing(role: Role) {
    setErrors([]);
    setEditingRoleId(role.id);
    setForm({
      name: role.name,
      color: role.color ?? roleColors[0],
      description: role.description ?? "",
      isActive: Boolean(role.is_active)
    });
  }

  function resetForm() {
    setErrors([]);
    setEditingRoleId(null);
    setForm(createRoleCrudForm());
  }

  return (
    <div className="max-w-6xl">
      <SectionHeading
        title="Roles"
        description="Create and maintain custom roles. There are no mandatory fixed roles."
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-normal">
            {editingRoleId ? "Edit role" : "Add role"}
          </h3>
          {editingRoleId ? (
            <button
              type="button"
              onClick={resetForm}
              className={secondaryButtonClassName}
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_180px_1.5fr_120px] gap-4">
          <Field label="Role name" required>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              className={inputClassName}
              placeholder="Barista"
            />
          </Field>
          <Field label="Color">
            <ColorSelect
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
          </Field>
          <Field label="Description">
            <input
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              className={inputClassName}
              placeholder="Optional"
            />
          </Field>
          <Field label="Status">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm({ ...form, isActive: event.target.checked })
                }
                className="h-4 w-4"
              />
              Active
            </label>
          </Field>
        </div>

        <button
          type="button"
          onClick={saveRole}
          disabled={isSaving}
          className="mt-5 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isSaving ? "Saving..." : editingRoleId ? "Save role" : "Add role"}
        </button>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.2fr_1.6fr_120px_190px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Role</span>
          <span>Description</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {roles.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-500">
            No roles have been created yet.
          </p>
        ) : (
          roles.map((role) => (
            <div
              key={role.id}
              className="grid grid-cols-[1.2fr_1.6fr_120px_190px] items-center gap-4 border-t border-slate-200 px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: role.color ?? roleColors[0] }}
                />
                <span className="text-sm font-semibold text-slate-900">
                  {role.name}
                </span>
              </div>
              <p className="text-sm text-slate-600">
                {role.description || "No description"}
              </p>
              <StatusBadge isActive={Boolean(role.is_active)} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEditing(role)}
                  className={secondaryButtonClassName}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRoleActive(role)}
                  className={secondaryButtonClassName}
                >
                  {role.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ShiftTemplatesCrudPage({
  shiftTemplates,
  onChanged
}: {
  shiftTemplates: ShiftTemplate[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<ShiftTemplateCrudForm>(() =>
    createShiftTemplateCrudForm()
  );
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  async function saveShiftTemplate() {
    const nextErrors = validateShiftTemplateCrudForm(form);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      const payload = {
        name: form.name.trim(),
        role_id: null,
        start_time: form.startTime,
        end_time: form.endTime,
        is_overnight: form.isOvernight,
        break_minutes: 0,
        color: form.color,
        notes: optionalText(form.notes),
        is_active: form.isActive
      };

      if (editingShiftId) {
        await databaseApi.updateRecord(
          "shift_templates",
          editingShiftId,
          payload
        );
        await onChanged(
          "Shift template updated. Future generated programs will use the new template values; existing programs stay unchanged."
        );
      } else {
        await databaseApi.createRecord("shift_templates", payload);
        await onChanged("Shift template added.");
      }

      setForm(createShiftTemplateCrudForm());
      setEditingShiftId(null);
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleShiftTemplateActive(template: ShiftTemplate) {
    setErrors([]);
    setIsSaving(true);

    try {
      const nextIsActive = !template.is_active;
      await databaseApi.updateRecord("shift_templates", template.id, {
        is_active: nextIsActive
      });
      await onChanged(
        nextIsActive
          ? "Shift template reactivated."
          : "Shift template deactivated."
      );

      if (editingShiftId === template.id) {
        setForm((current) => ({ ...current, isActive: nextIsActive }));
      }
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  function startEditing(template: ShiftTemplate) {
    setErrors([]);
    setEditingShiftId(template.id);
    setForm({
      name: template.name,
      startTime: template.start_time,
      endTime: template.end_time,
      isOvernight: Boolean(template.is_overnight),
      color: template.color ?? roleColors[1],
      notes: template.notes ?? "",
      isActive: Boolean(template.is_active)
    });
  }

  function resetForm() {
    setErrors([]);
    setEditingShiftId(null);
    setForm(createShiftTemplateCrudForm());
  }

  return (
    <div className="max-w-6xl">
      <SectionHeading
        title="Shift Templates"
        description="Create reusable shifts for later scheduling phases. Staffing requirements and employees are not part of this phase."
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-normal">
            {editingShiftId ? "Edit shift template" : "Add shift template"}
          </h3>
          {editingShiftId ? (
            <button
              type="button"
              onClick={resetForm}
              className={secondaryButtonClassName}
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-[1fr_130px_130px_120px_180px_120px] gap-4">
          <Field label="Name" required>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              className={inputClassName}
              placeholder="Morning"
            />
          </Field>
          <Field label="Start" required>
            <input
              type="time"
              value={form.startTime}
              onChange={(event) =>
                setForm({ ...form, startTime: event.target.value })
              }
              className={inputClassName}
            />
          </Field>
          <Field label="End" required>
            <input
              type="time"
              value={form.endTime}
              onChange={(event) =>
                setForm({ ...form, endTime: event.target.value })
              }
              className={inputClassName}
            />
          </Field>
          <Field label="Overnight">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isOvernight}
                onChange={(event) =>
                  setForm({ ...form, isOvernight: event.target.checked })
                }
                className="h-4 w-4"
              />
              Yes
            </label>
          </Field>
          <Field label="Color">
            <ColorSelect
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
          </Field>
          <Field label="Status">
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm({ ...form, isActive: event.target.checked })
                }
                className="h-4 w-4"
              />
              Active
            </label>
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            className={`${inputClassName} mt-4 min-h-20 resize-y`}
            placeholder="Optional notes"
          />
        </Field>

        <button
          type="button"
          onClick={saveShiftTemplate}
          disabled={isSaving}
          className="mt-5 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isSaving
            ? "Saving..."
            : editingShiftId
              ? "Save shift template"
              : "Add shift template"}
        </button>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.1fr_140px_110px_1.3fr_120px_210px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Template</span>
          <span>Time</span>
          <span>Overnight</span>
          <span>Notes</span>
          <span>Status</span>
          <span>Actions</span>
        </div>

        {shiftTemplates.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-500">
            No shift templates have been created yet.
          </p>
        ) : (
          shiftTemplates.map((template) => (
            <div
              key={template.id}
              className="grid grid-cols-[1.1fr_140px_110px_1.3fr_120px_210px] items-center gap-4 border-t border-slate-200 px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: template.color ?? roleColors[1] }}
                />
                <span className="text-sm font-semibold text-slate-900">
                  {template.name}
                </span>
              </div>
              <p className="text-sm text-slate-600">
                {template.start_time} - {template.end_time}
              </p>
              <p className="text-sm text-slate-600">
                {template.is_overnight ? "Yes" : "No"}
              </p>
              <p className="text-sm text-slate-600">
                {template.notes || "No notes"}
              </p>
              <StatusBadge isActive={Boolean(template.is_active)} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEditing(template)}
                  className={secondaryButtonClassName}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void toggleShiftTemplateActive(template)}
                  className={secondaryButtonClassName}
                >
                  {template.is_active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={[
        "inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold",
        isActive
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
      ].join(" ")}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function createRoleCrudForm(): RoleCrudForm {
  return {
    name: "",
    color: roleColors[0],
    description: "",
    isActive: true
  };
}

function createShiftTemplateCrudForm(): ShiftTemplateCrudForm {
  return {
    name: "",
    startTime: "09:00",
    endTime: "17:00",
    isOvernight: false,
    color: roleColors[1],
    notes: "",
    isActive: true
  };
}

function validateRoleCrudForm(
  form: RoleCrudForm,
  existingRoles: Role[],
  editingRoleId: string | null
): string[] {
  const errors: string[] = [];
  const trimmedName = form.name.trim();

  if (!trimmedName) {
    errors.push("Role name is required.");
  }

  if (!form.color) {
    errors.push("Choose a role color.");
  }

  const duplicate = existingRoles.find(
    (role) =>
      role.id !== editingRoleId &&
      role.name.trim().toLocaleLowerCase() ===
        trimmedName.toLocaleLowerCase()
  );

  if (duplicate) {
    errors.push(`A role named "${trimmedName}" already exists.`);
  }

  return errors;
}

function validateShiftTemplateCrudForm(
  form: ShiftTemplateCrudForm
): string[] {
  const errors: string[] = [];

  if (!form.name.trim()) {
    errors.push("Shift template name is required.");
  }

  if (!form.startTime) {
    errors.push("Start time is required.");
  }

  if (!form.endTime) {
    errors.push("End time is required.");
  }

  if (form.startTime && form.endTime && !form.isOvernight) {
    if (form.endTime <= form.startTime) {
      errors.push("End time must be after start time unless overnight is enabled.");
    }
  }

  if (!form.color) {
    errors.push("Choose a shift color.");
  }

  return errors;
}

function createStaffingRequirementForm(
  roles: Role[],
  shiftTemplates: ShiftTemplate[]
): StaffingRequirementForm {
  return {
    dayOfWeek: 1,
    shiftTemplateId:
      shiftTemplates.find((template) => template.is_active)?.id ?? "",
    roleCounts: createRoleCountValues(roles.filter((role) => role.is_active))
  };
}

function validateStaffingRequirementForm(
  form: StaffingRequirementForm,
  selectedShiftTemplate: ShiftTemplate | undefined,
  roles: Role[]
): string[] {
  const errors: string[] = [];

  if (!selectedShiftTemplate) {
    errors.push("Επιλέξτε βάρδια.");
  }

  if (!roles.length) {
    errors.push("Προσθέστε τουλάχιστον έναν ενεργό ρόλο.");
  }

  let positiveCountTotal = 0;

  for (const role of roles) {
    const parsedCount = parseStaffingRoleCount(form.roleCounts[role.id]);

    if (parsedCount === null) {
      errors.push(`Ο ρόλος ${role.name} πρέπει να έχει ακέραιο αριθμό 0 ή μεγαλύτερο.`);
      continue;
    }

    positiveCountTotal += parsedCount;
  }

  if (positiveCountTotal === 0) {
    errors.push("Ορίστε τουλάχιστον έναν ρόλο με ανάγκη μεγαλύτερη από 0.");
  }

  return errors;
}

function createRoleCountValues(
  roles: Role[],
  groupRequirements: StaffingRequirement[] = []
): Record<string, string> {
  return Object.fromEntries(
    roles.map((role) => {
      const count = groupRequirements
        .filter(
          (requirement) =>
            requirement.role_id === role.id && Boolean(requirement.is_active)
        )
        .reduce((total, requirement) => total + requirement.required_count, 0);

      return [role.id, String(count)];
    })
  );
}

function ensureRoleCountKeys(
  values: Record<string, string>,
  roles: Role[]
): Record<string, string> {
  return {
    ...Object.fromEntries(roles.map((role) => [role.id, "0"])),
    ...values
  };
}

function parseStaffingRoleCount(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return 0;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function groupStaffingRequirements(
  requirements: StaffingRequirement[],
  shiftTemplates: ShiftTemplate[]
): StaffingRequirementGroup[] {
  const groups = new Map<string, StaffingRequirementGroup>();

  for (const requirement of requirements) {
    if (!requirement.is_active || requirement.required_count <= 0) {
      continue;
    }

    const shiftTemplate = requirement.shift_template_id
      ? shiftTemplates.find((template) => template.id === requirement.shift_template_id)
      : null;
    const shiftTemplateId =
      requirement.shift_template_id ??
      `custom:${requirement.start_time}-${requirement.end_time}`;
    const key = staffingRequirementGroupKey(requirement.day_of_week, shiftTemplateId);
    const existingGroup = groups.get(key);

    if (existingGroup) {
      existingGroup.requirements.push(requirement);
      existingGroup.totalCount += requirement.required_count;
      continue;
    }

    groups.set(key, {
      key,
      dayOfWeek: requirement.day_of_week,
      shiftTemplateId,
      label: shiftTemplate?.name ?? "Custom shift",
      startTime: shiftTemplate?.start_time ?? requirement.start_time,
      endTime: shiftTemplate?.end_time ?? requirement.end_time,
      requirements: [requirement],
      totalCount: requirement.required_count
    });
  }

  for (const group of groups.values()) {
    group.requirements.sort((left, right) => left.role_id.localeCompare(right.role_id));
  }

  return [...groups.values()].sort(
    (left, right) =>
      left.dayOfWeek - right.dayOfWeek ||
      left.startTime.localeCompare(right.startTime) ||
      left.endTime.localeCompare(right.endTime) ||
      left.label.localeCompare(right.label)
  );
}

function staffingRequirementGroupKey(
  dayOfWeek: DayOfWeek,
  shiftTemplateId: string
): string {
  return `${dayOfWeek}|${shiftTemplateId}`;
}

function getRequirementsForShiftGroup({
  requirements,
  dayOfWeek,
  shiftTemplateId
}: {
  requirements: StaffingRequirement[];
  dayOfWeek: DayOfWeek;
  shiftTemplateId: string;
}): StaffingRequirement[] {
  return requirements.filter(
    (requirement) =>
      requirement.day_of_week === dayOfWeek &&
      (requirement.shift_template_id ?? "") === shiftTemplateId
  );
}

function shiftTemplateLabel(
  shiftTemplateId: string | null,
  shiftTemplates: ShiftTemplate[]
): string {
  if (!shiftTemplateId) {
    return "Custom shift";
  }

  return (
    shiftTemplates.find((template) => template.id === shiftTemplateId)?.name ??
    "Unknown shift"
  );
}

function staffingRequirementShiftSnapshot(
  requirement: StaffingRequirement,
  shiftTemplates: ShiftTemplate[]
): { startTime: string; endTime: string } {
  const shiftTemplate = requirement.shift_template_id
    ? shiftTemplates.find((template) => template.id === requirement.shift_template_id)
    : null;

  return {
    startTime: shiftTemplate?.start_time ?? requirement.start_time,
    endTime: shiftTemplate?.end_time ?? requirement.end_time
  };
}

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

function buildEmployeeScheduleRows({
  employees,
  runSlots,
  runAssignments,
  roles,
  shiftTemplates,
  staffingRequirements,
  warningsBySlotId
}: {
  employees: Employee[];
  runSlots: ScheduleSlot[];
  runAssignments: ScheduleAssignment[];
  roles: Role[];
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  warningsBySlotId: Map<string, ScheduleWarning[]>;
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
            (warning) => warning.message
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
  shiftTemplates: ShiftTemplate[]
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
      label: shiftTemplate?.name ?? `${slot.start_time} - ${slot.end_time}`,
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

  return shiftTemplate?.name ?? `${slot.start_time}-${slot.end_time}`;
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
              employeeName(employeeRow.employee.id, [employeeRow.employee])
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
                          item.slot.start_time
                        )}-${escapeHtml(item.slot.end_time)}</div>
                        <div class="shift-role">${escapeHtml(
                          item.role?.name ?? "Role"
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
  employeeWorkRules
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
}): string {
  const warningRows = warnings
    .map((warning) => {
      const slot = warning.schedule_slot_id
        ? runSlots.find((item) => item.id === warning.schedule_slot_id)
        : null;
      const context = slot
        ? `${formatDateEu(slot.date)} ${slot.start_time}-${slot.end_time}`
        : "Γενική προειδοποίηση";

      return `<li><strong>${escapeHtml(context)}:</strong> ${escapeHtml(
        warning.message
      )}</li>`;
    })
    .join("");
  const unfilledRows = unfilledSlots
    .map((slot) => {
      const role = roles.find((item) => item.id === slot.role_id);
      return `<li>${escapeHtml(formatDateEu(slot.date))} · ${escapeHtml(
        shiftNameForSlot(slot, staffingRequirements, shiftTemplates)
      )} · ${escapeHtml(slot.start_time)}-${escapeHtml(slot.end_time)} · ${escapeHtml(
        role?.name ?? "Role"
      )}</li>`;
    })
    .join("");
  const employeeSummaryRows = employeeRows
    .map((employeeRow) => {
      const totalHours = getEmployeeScheduleHours(employeeRow);
      const weekendShifts = getEmployeeWeekendShiftCount(employeeRow);
      const difficultShifts = getEmployeeDifficultShiftCount(employeeRow);
      const workRules = employeeWorkRules.find(
        (rules) => rules.employee_id === employeeRow.employee.id
      );
      const targetHours =
        workRules?.target_hours_per_week ?? workRules?.preferred_hours_per_week ?? null;
      const maxHours = workRules?.max_hours_per_week ?? null;

      return `<tr>
        <td>${escapeHtml(employeeName(employeeRow.employee.id, [employeeRow.employee]))}</td>
        <td>${employeeRow.assignmentCount}</td>
        <td>${escapeHtml(formatHours(totalHours))}</td>
        <td>${weekendShifts}</td>
        <td>${difficultShifts}</td>
        <td>${escapeHtml(formatOptionalHours(targetHours))}</td>
        <td>${escapeHtml(formatOptionalHours(maxHours))}</td>
      </tr>`;
    })
    .join("");
  const attentionRows = employeeRows
    .flatMap((employeeRow) => {
      const totalHours = getEmployeeScheduleHours(employeeRow);
      const workRules = employeeWorkRules.find(
        (rules) => rules.employee_id === employeeRow.employee.id
      );
      const rows: string[] = [];

      if (
        workRules?.max_hours_per_week !== null &&
        workRules?.max_hours_per_week !== undefined &&
        totalHours >= workRules.max_hours_per_week * 0.85
      ) {
        rows.push(
          `${employeeName(employeeRow.employee.id, [employeeRow.employee])}: close to max hours (${formatHours(
            totalHours
          )}/${formatHours(workRules.max_hours_per_week)}).`
        );
      }

      const targetHours =
        workRules?.target_hours_per_week ?? workRules?.preferred_hours_per_week;
      if (
        targetHours !== null &&
        targetHours !== undefined &&
        totalHours > targetHours
      ) {
        rows.push(
          `${employeeName(employeeRow.employee.id, [employeeRow.employee])}: above target hours (${formatHours(
            totalHours
          )}/${formatHours(targetHours)}).`
        );
      }

      return rows;
    })
    .map((row) => `<li>${escapeHtml(row)}</li>`)
    .join("");
  const assignmentNotes = employeeRows
    .flatMap((employeeRow) =>
      [...employeeRow.assignmentsByDate.values()].flat().flatMap((item) =>
        item.assignment.notes
          ? [
              `<li>${escapeHtml(formatDateEu(item.slot.date))} ${escapeHtml(
                item.slot.start_time
              )}-${escapeHtml(item.slot.end_time)} ${escapeHtml(
                employeeName(item.employee.id, [item.employee])
              )}: ${escapeHtml(item.assignment.notes)}</li>`
            ]
          : []
      )
    )
    .slice(0, 30)
    .join("");

  return `<!doctype html>
<html lang="el">
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
    <div class="meta">Εξαγωγή PDF · ${escapeHtml(formatDateEu(todayInputValue()))}</div>
  </header>

  <section class="summary">
    <div class="summary-item"><div class="summary-label">Εργαζόμενοι</div><div class="summary-value">${employeeRows.length}</div></div>
    <div class="summary-item"><div class="summary-label">Κενές βάρδιες</div><div class="summary-value">${unfilledSlots.length}</div></div>
    <div class="summary-item"><div class="summary-label">Προειδοποιήσεις</div><div class="summary-value">${warnings.length}</div></div>
    <div class="summary-item"><div class="summary-label">Περίοδος</div><div class="summary-value">${escapeHtml(formatDateRangeEu(run.start_date, run.end_date))}</div></div>
  </section>

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
        .map((employeeRow) => {
          const totalHours = getEmployeeScheduleHours(employeeRow);

          return `<tr>
            <td class="employee">${escapeHtml(
              employeeName(employeeRow.employee.id, [employeeRow.employee])
            )}<div class="hours">Σύνολο ωρών: ${escapeHtml(formatHours(totalHours))}</div></td>
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
                        <div class="shift-name">${escapeHtml(item.shiftName)}${
                          item.warningCount > 0
                            ? `<span class="warning-mark">!</span>`
                            : ""
                        }</div>
                        <div class="shift-time">${escapeHtml(
                          item.slot.start_time
                        )}-${escapeHtml(item.slot.end_time)}</div>
                        <div class="shift-role">${escapeHtml(
                          item.role?.name ?? "Role"
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

  <section class="section">
    <h2>Σύνοψη εργαζομένων</h2>
    <table>
      <thead>
        <tr>
          <th>Εργαζόμενος</th>
          <th class="numeric">Βάρδιες</th>
          <th class="numeric">Ώρες</th>
          <th class="numeric">Weekend</th>
          <th class="numeric">Δύσκολες</th>
          <th class="numeric">Στόχος</th>
          <th class="numeric">Μέγιστο</th>
        </tr>
      </thead>
      <tbody>${employeeSummaryRows}</tbody>
    </table>
  </section>

  ${
    attentionRows
      ? `<section class="section"><h2>Εργαζόμενοι που θέλουν προσοχή</h2><ul>${attentionRows}</ul></section>`
      : ""
  }

  ${
    unfilledRows
      ? `<section class="section"><h2>Κενές βάρδιες</h2><ul>${unfilledRows}</ul></section>`
      : ""
  }
  ${
    warningRows
      ? `<section class="section"><h2>Προειδοποιήσεις</h2><ul>${warningRows}</ul></section>`
      : ""
  }
  ${
    assignmentNotes
      ? `<section class="section"><h2>Σημειώσεις ανάθεσης</h2><ul>${assignmentNotes}</ul></section>`
      : ""
  }
  <section class="section">
    <h2>Σημειώσεις / περιορισμοί</h2>
    <ul>
      <li>Η αναφορά manager περιέχει εσωτερικές προειδοποιήσεις και σημειώσεις ανάθεσης.</li>
      <li>Το PDF ομάδας κρατά μόνο το καθαρό πρόγραμμα και δεν περιλαμβάνει constraints, προτιμήσεις, εξηγήσεις ή στοιχεία επικοινωνίας.</li>
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

const dayConstraintOptions: Array<{
  value: DayConstraintValue;
  label: string;
}> = [
  { value: "neutral", label: "Neutral / available" },
  { value: "cannot_work", label: "Cannot work" },
  { value: "prefers_not_to_work", label: "Prefers not" },
  { value: "prefers_to_work", label: "Prefers to work" }
];

const shiftAvailabilityOptions: Array<{
  value: ShiftAvailabilityValue;
  label: string;
}> = [
  { value: "available", label: "Διαθέσιμος" },
  { value: "cannot_work", label: "Δεν μπορεί" },
  { value: "prefers_not_to_work", label: "Προτιμά να μη δουλέψει" },
  { value: "prefers_to_work", label: "Προτιμά να δουλέψει" }
];

const employmentTypeOptions: Array<{
  value: EmploymentType;
  label: string;
}> = [
  { value: "full_time", label: "Πλήρης απασχόληση" },
  { value: "part_time", label: "Μερική απασχόληση" },
  {
    value: "weekly_hours",
    label: "Συμφωνημένες εβδομαδιαίες ώρες"
  },
  { value: "custom", label: "Custom" }
];

type EmploymentPatternPresetId = "full_time_8h" | "part_time_6h" | "part_time_4h";

const employmentPatternPresets: Array<{
  id: EmploymentPatternPresetId;
  label: string;
}> = [
  { id: "full_time_8h", label: "5x8" },
  { id: "part_time_6h", label: "5x6" },
  { id: "part_time_4h", label: "5x4" }
];

const timeOffTypes = [
  { value: "day_off", label: "Day off" },
  { value: "vacation", label: "Vacation" },
  { value: "sick_leave", label: "Sick leave" },
  { value: "personal", label: "Personal" },
  { value: "other", label: "Other" }
];

function dayConstraintValue(
  employeeId: string,
  dayOfWeek: DayOfWeek,
  constraints: EmployeeDayConstraint[]
): DayConstraintValue {
  const constraint = constraints.find(
    (item) => item.employee_id === employeeId && item.day_of_week === dayOfWeek
  );

  if (
    constraint?.constraint_type === "cannot_work" ||
    constraint?.constraint_type === "prefers_not_to_work" ||
    constraint?.constraint_type === "prefers_to_work"
  ) {
    return constraint.constraint_type;
  }

  return "neutral";
}

function shiftAvailabilityValue(
  employeeId: string,
  dayOfWeek: DayOfWeek,
  shiftTemplateId: string,
  shiftAvailability: EmployeeShiftAvailability[]
): ShiftAvailabilityValue {
  const row = shiftAvailability.find(
    (item) =>
      item.employee_id === employeeId &&
      item.day_of_week === dayOfWeek &&
      item.shift_template_id === shiftTemplateId
  );

  if (
    row?.availability_type === "cannot_work" ||
    row?.availability_type === "prefers_not_to_work" ||
    row?.availability_type === "prefers_to_work"
  ) {
    return row.availability_type;
  }

  return "available";
}

function shiftAvailabilityClassName(value: ShiftAvailabilityValue): string {
  if (value === "cannot_work") {
    return "border-red-200 bg-red-50 text-red-900";
  }

  if (value === "prefers_not_to_work") {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  if (value === "prefers_to_work") {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  return "border-slate-200 bg-white text-slate-700";
}

function createTimeOffForm(employees: Employee[]): TimeOffForm {
  const todayIso = new Date().toISOString().slice(0, 10);

  return {
    employeeId: employees[0]?.id ?? "",
    dateFrom: todayIso,
    dateTo: todayIso,
    type: "day_off",
    reason: ""
  };
}

function validateTimeOffForm(
  form: TimeOffForm,
  employees: Employee[]
): string[] {
  const errors: string[] = [];

  if (!form.employeeId || !employees.some((employee) => employee.id === form.employeeId)) {
    errors.push("Choose an employee.");
  }

  if (!form.dateFrom) {
    errors.push("Date from is required.");
  }

  if (!form.dateTo) {
    errors.push("Date to is required.");
  }

  if (form.dateFrom && form.dateTo && form.dateTo < form.dateFrom) {
    errors.push("Date to cannot be before date from.");
  }

  if (!timeOffTypes.some((type) => type.value === form.type)) {
    errors.push("Choose a valid time off type.");
  }

  return errors;
}

function employeeName(employeeId: string, employees: Employee[]): string {
  const employee = employees.find((item) => item.id === employeeId);

  if (!employee) {
    return "Unknown employee";
  }

  return `${employee.first_name} ${employee.last_name}`;
}

function timeOffTypeLabel(value: string): string {
  return timeOffTypes.find((type) => type.value === value)?.label ?? value;
}

function createEmployeeForm(): EmployeeForm {
  return {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    isActive: true,
    notes: "",
    roleIds: [],
    roleDetails: {},
    workRules: createDefaultWorkRulesForm()
  };
}

function createDefaultWorkRulesForm(): EmployeeWorkRulesForm {
  return {
    employmentType: "full_time",
    contractDaysPerWeek: "5",
    preferredHoursPerDay: "8",
    contractHoursPerWeek: "40",
    maxConsecutiveDays: "5",
    canWorkWeekends: true
  };
}

function applyEmploymentTypeDefaults(
  current: EmployeeWorkRulesForm,
  employmentType: EmploymentType
): EmployeeWorkRulesForm {
  if (employmentType === "full_time") {
    return {
      ...current,
      employmentType,
      contractDaysPerWeek: "5",
      preferredHoursPerDay: "8",
      contractHoursPerWeek: "40",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  if (employmentType === "part_time") {
    return {
      ...current,
      employmentType,
      contractDaysPerWeek: "5",
      preferredHoursPerDay: "6",
      contractHoursPerWeek: "30",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  if (employmentType === "weekly_hours") {
    return {
      ...current,
      employmentType,
      contractDaysPerWeek: current.contractDaysPerWeek || "5",
      preferredHoursPerDay: current.preferredHoursPerDay || "",
      contractHoursPerWeek: current.contractHoursPerWeek || "32",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  return {
    ...current,
    employmentType
  };
}

function applyEmploymentPatternPreset(
  current: EmployeeWorkRulesForm,
  presetId: EmploymentPatternPresetId
): EmployeeWorkRulesForm {
  if (presetId === "full_time_8h") {
    return applyEmploymentTypeDefaults(current, "full_time");
  }

  if (presetId === "part_time_4h") {
    return {
      ...current,
      employmentType: "part_time",
      contractDaysPerWeek: "5",
      preferredHoursPerDay: "4",
      contractHoursPerWeek: "20",
      maxConsecutiveDays: current.maxConsecutiveDays || "5"
    };
  }

  return applyEmploymentTypeDefaults(current, "part_time");
}

function employeeToForm(
  employee: Employee,
  assignedRoles: EmployeeRole[],
  workRules: EmployeeWorkRules | null
): EmployeeForm {
  const roleDetails = Object.fromEntries(
    assignedRoles.map((employeeRole) => [
      employeeRole.role_id,
      {
        experienceLevel: normalizeExperienceLevel(
          employeeRole.experience_level ??
            skillLevelToExperienceLevel(employeeRole.skill_level)
        ),
        canLeadRole: employeeRole.can_lead_role === 1,
        isPreferredRole: employeeRole.is_preferred_role === 1
      }
    ])
  );

  return {
    firstName: employee.first_name,
    lastName: employee.last_name,
    phone: employee.phone ?? "",
    email: employee.email ?? "",
    isActive: Boolean(employee.is_active),
    notes: employee.notes ?? "",
    roleIds: assignedRoles.map((employeeRole) => employeeRole.role_id),
    roleDetails,
    workRules: workRulesToForm(workRules)
  };
}

function workRulesToForm(
  workRules: EmployeeWorkRules | null
): EmployeeWorkRulesForm {
  const defaultForm = createDefaultWorkRulesForm();

  if (!workRules) {
    return defaultForm;
  }

  const contractDays =
    workRules.contract_days_per_week ??
    workRules.target_days_per_week ??
    workRules.max_days_per_week ??
    5;
  const contractHours =
    workRules.contract_hours_per_week ??
    workRules.target_hours_per_week ??
    workRules.preferred_hours_per_week ??
    workRules.max_hours_per_week ??
    40;
  const preferredHoursPerDay =
    workRules.preferred_hours_per_day ??
    (contractDays > 0 ? contractHours / contractDays : null);

  return {
    employmentType: normalizeEmploymentType(workRules.employment_type),
    contractDaysPerWeek: optionalNumberToString(contractDays),
    preferredHoursPerDay: optionalNumberToString(preferredHoursPerDay),
    contractHoursPerWeek: optionalNumberToString(contractHours),
    maxConsecutiveDays: optionalNumberToString(
      workRules.max_consecutive_days ?? Math.min(5, contractDays)
    ),
    canWorkWeekends: workRules.can_work_weekends !== 0
  };
}

function normalizeEmploymentType(value: unknown): EmploymentType {
  return value === "full_time" ||
    value === "part_time" ||
    value === "weekly_hours" ||
    value === "custom"
    ? value
    : "custom";
}

function validateEmployeeForm(form: EmployeeForm): string[] {
  const errors: string[] = [];

  if (!form.firstName.trim()) {
    errors.push("Το όνομα είναι υποχρεωτικό.");
  }

  if (!form.lastName.trim()) {
    errors.push("Το επώνυμο είναι υποχρεωτικό.");
  }

  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.push("Συμπληρώστε έγκυρο email.");
  }

  const contractDays = parseOptionalNumber(form.workRules.contractDaysPerWeek);
  const preferredHoursPerDay = parseOptionalNumber(
    form.workRules.preferredHoursPerDay
  );
  const contractHours = parseOptionalNumber(form.workRules.contractHoursPerWeek);
  const maxConsecutiveDays = parseOptionalNumber(
    form.workRules.maxConsecutiveDays
  );

  if (contractDays === null || contractDays < 1 || contractDays > 7) {
    errors.push("Οι ημέρες / εβδομάδα πρέπει να είναι από 1 έως 7.");
  }

  if (preferredHoursPerDay === null || preferredHoursPerDay <= 0) {
    errors.push("Οι ώρες / ημέρα πρέπει να είναι θετικός αριθμός.");
  }

  if (contractHours === null || contractHours <= 0) {
    errors.push("Οι ώρες / εβδομάδα πρέπει να είναι θετικός αριθμός.");
  }

  if (
    maxConsecutiveDays === null ||
    maxConsecutiveDays < 1 ||
    maxConsecutiveDays > 7
  ) {
    errors.push("Οι μέγιστες συνεχόμενες ημέρες πρέπει να είναι από 1 έως 7.");
  }

  return errors;
}

async function syncEmployeeRoleAssignments(
  employeeId: string,
  form: EmployeeForm,
  allEmployeeRoles: EmployeeRole[]
): Promise<void> {
  const existingAssignments = allEmployeeRoles.filter(
    (employeeRole) => employeeRole.employee_id === employeeId
  );
  const selectedRoleIds = form.roleIds;
  const selectedRoleIdSet = new Set(selectedRoleIds);

  for (const assignment of existingAssignments) {
    if (!selectedRoleIdSet.has(assignment.role_id)) {
      await databaseApi.deleteRecord("employee_roles", assignment.id);
    }
  }

  for (const [index, roleId] of selectedRoleIds.entries()) {
    const existingAssignment = existingAssignments.find(
      (assignment) => assignment.role_id === roleId
    );
    const isPrimary = index === 0;
    const details = form.roleDetails[roleId] ?? {
      experienceLevel: "some_experience",
      canLeadRole: false,
      isPreferredRole: false
    };
    const experienceLevel = normalizeExperienceLevel(details.experienceLevel);
    const payload = {
      employee_id: employeeId,
      role_id: roleId,
      is_primary: isPrimary,
      experience_level: experienceLevel,
      skill_level: experienceLevelToLegacySkillLevel(experienceLevel),
      can_lead_role: details.canLeadRole,
      is_preferred_role: details.isPreferredRole
    };

    if (existingAssignment) {
      await databaseApi.updateRecord(
        "employee_roles",
        existingAssignment.id,
        payload
      );
      continue;
    }

    await databaseApi.createRecord("employee_roles", payload);
  }
}

async function upsertEmployeeWorkRules(
  employeeId: string,
  form: EmployeeWorkRulesForm,
  allWorkRules: EmployeeWorkRules[]
): Promise<void> {
  const existingWorkRules = allWorkRules.find(
    (workRules) => workRules.employee_id === employeeId
  );
  const contractDays = parseOptionalNumber(form.contractDaysPerWeek) ?? 5;
  const contractHours = parseOptionalNumber(form.contractHoursPerWeek) ?? 40;
  const preferredHoursPerDay =
    parseOptionalNumber(form.preferredHoursPerDay) ??
    (contractDays > 0 ? contractHours / contractDays : 8);
  const maxConsecutiveDays = parseOptionalNumber(form.maxConsecutiveDays) ?? 5;
  const derivedMaxDays = Math.min(7, contractDays + 1);
  const derivedMaxHours = contractHours + 4;
  const payload = {
    employee_id: employeeId,
    employment_type: form.employmentType,
    contract_days_per_week: contractDays,
    contract_hours_per_week: contractHours,
    preferred_hours_per_day: preferredHoursPerDay,
    min_days_per_week: null,
    max_days_per_week: derivedMaxDays,
    target_days_per_week: contractDays,
    min_hours_per_week: null,
    max_hours_per_week: derivedMaxHours,
    target_hours_per_week: contractHours,
    max_consecutive_days: maxConsecutiveDays,
    can_work_weekends: form.canWorkWeekends,
    max_shifts_per_week: derivedMaxDays,
    min_hours_between_shifts: null,
    preferred_hours_per_week: contractHours,
    notes: null
  };

  if (existingWorkRules) {
    await databaseApi.updateRecord(
      "employee_work_rules",
      existingWorkRules.id,
      payload
    );
    return;
  }

  await databaseApi.createRecord("employee_work_rules", payload);
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalNumberToString(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function employeeRoleLabels(roleIds: string[], roles: Role[]): string {
  if (roleIds.length === 0) {
    return "No roles";
  }

  return roleIds.map((roleId) => roleLabel(roleId, roles)).join(", ");
}

function workRulesSummary(workRules: EmployeeWorkRules | null): string {
  if (!workRules) {
    return "Δεν έχουν οριστεί κανόνες εργασίας";
  }

  const employmentType = employmentTypeOptions.find(
    (option) => option.value === normalizeEmploymentType(workRules.employment_type)
  )?.label;
  const days =
    workRules.contract_days_per_week ??
    workRules.target_days_per_week ??
    workRules.max_days_per_week ??
    "-";
  const hours =
    workRules.contract_hours_per_week ??
    workRules.target_hours_per_week ??
    workRules.preferred_hours_per_week ??
    "-";
  const hoursPerDay = workRules.preferred_hours_per_day ?? "-";
  const weekends =
    workRules.can_work_weekends === 0
      ? "όχι Σαββατοκύριακα"
      : "Σαββατοκύριακα οκ";

  return `${employmentType ?? "Custom"}: ${days} ημέρες, ${hoursPerDay} ώρες/ημέρα, ${hours} ώρες/εβδομάδα, ${weekends}`;
}

function renderPage(
  pageId: PageId,
  summary: DashboardSummary,
  actions: {
    selectedScheduleRunId: string | null;
    isLoadingDemoData: boolean;
    onDataChanged: (message: string) => Promise<void>;
    onLoadDemoData: () => void;
    onProgramGenerated: (runId: string, message: string) => Promise<void>;
    onProgramDeleted: (message: string) => Promise<void>;
    onViewProgram: (runId: string) => void;
  }
) {
  const { onDataChanged } = actions;

  if (pageId === "dashboard") {
    return (
      <Dashboard
        summary={summary}
        isLoadingDemoData={actions.isLoadingDemoData}
        onLoadDemoData={actions.onLoadDemoData}
      />
    );
  }

  if (pageId === "business-settings") {
    return (
      <BusinessSettingsEditor
        settings={summary.businessSettings}
        onSaved={() => onDataChanged("Business settings saved.")}
      />
    );
  }

  if (pageId === "opening-hours") {
    return (
      <RecordListPage
        title="Ώρες λειτουργίας"
        description="Οι εγγραφές δημιουργούνται από τον οδηγό πρώτης ρύθμισης."
        emptyLabel="Δεν υπάρχουν ώρες λειτουργίας."
        rows={summary.openingHours.map((row) => ({
          id: row.id,
          title: dayLabel(row.day_of_week),
          detail: row.is_open
            ? `${row.open_time} - ${row.close_time}${row.is_overnight ? " (overnight)" : ""}`
            : "Κλειστά"
        }))}
      />
    );
  }

  if (pageId === "staffing-requirements") {
    return (
      <StaffingRequirementsPage
        roles={summary.roles}
        shiftTemplates={summary.shiftTemplates}
        requirements={summary.staffingRequirements}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "employees") {
    return (
      <EmployeesPage
        employees={summary.employees}
        roles={summary.roles}
        employeeRoles={summary.employeeRoles}
        employeeWorkRules={summary.employeeWorkRules}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "employee-constraints") {
    return (
      <EmployeeConstraintsPage
        employees={summary.employees}
        constraints={summary.employeeDayConstraints}
        shiftTemplates={summary.shiftTemplates}
        shiftAvailability={summary.employeeShiftAvailability}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "time-off") {
    return (
      <TimeOffPage
        employees={summary.employees}
        timeOff={summary.timeOff}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "generate-schedule") {
    return (
      <GenerateSchedulePage
        businessSettings={summary.businessSettings}
        openingHours={summary.openingHours}
        staffingRequirements={summary.staffingRequirements}
        specialDays={summary.specialDays}
        scheduleRuns={summary.scheduleRuns}
        scheduleSlots={summary.scheduleSlots}
        scheduleAssignments={summary.scheduleAssignments}
        scheduleWarnings={summary.scheduleWarnings}
        employees={summary.employees}
        employeeRoles={summary.employeeRoles}
        employeeWorkRules={summary.employeeWorkRules}
        employeeDayConstraints={summary.employeeDayConstraints}
        employeeShiftAvailability={summary.employeeShiftAvailability}
        timeOff={summary.timeOff}
        roles={summary.roles}
        shiftTemplates={summary.shiftTemplates}
        onProgramGenerated={actions.onProgramGenerated}
        onProgramDeleted={actions.onProgramDeleted}
        onViewProgram={actions.onViewProgram}
      />
    );
  }

  if (pageId === "schedule-view") {
    return (
      <ScheduleViewPage
        businessSettings={summary.businessSettings}
        selectedRunId={actions.selectedScheduleRunId}
        scheduleRuns={summary.scheduleRuns}
        scheduleSlots={summary.scheduleSlots}
        scheduleAssignments={summary.scheduleAssignments}
        scheduleWarnings={summary.scheduleWarnings}
        employees={summary.employees}
        employeeRoles={summary.employeeRoles}
        employeeWorkRules={summary.employeeWorkRules}
        employeeDayConstraints={summary.employeeDayConstraints}
        employeeShiftAvailability={summary.employeeShiftAvailability}
        timeOff={summary.timeOff}
        roles={summary.roles}
        shiftTemplates={summary.shiftTemplates}
        staffingRequirements={summary.staffingRequirements}
        onSelectRun={actions.onViewProgram}
        onDeleted={actions.onProgramDeleted}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "roles") {
    return (
      <RolesCrudPage
        roles={summary.roles}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "shift-templates") {
    return (
      <ShiftTemplatesCrudPage
        shiftTemplates={summary.shiftTemplates}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  const page = pages.find((item) => item.id === pageId);

  return (
    <div className="max-w-3xl">
      <p className="text-base leading-7 text-slate-600">{page?.description}</p>
      <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-6">
        <h3 className="text-base font-semibold tracking-normal">
          Δεν έχει υλοποιηθεί ακόμα
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Αυτή η λειτουργία ανήκει σε επόμενη φάση. Δεν προστέθηκαν απαιτήσεις
          προσωπικού, εργαζόμενοι ή αλγόριθμος προγράμματος.
        </p>
      </div>
    </div>
  );
}

function Dashboard({
  summary,
  isLoadingDemoData,
  onLoadDemoData
}: {
  summary: DashboardSummary;
  isLoadingDemoData: boolean;
  onLoadDemoData: () => void;
}) {
  const businessName = summary.businessSettings?.business_name ?? "JProgrammer";

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-6">
        <p className="text-base leading-7 text-slate-600">
          Η αρχική ρύθμιση ολοκληρώθηκε για{" "}
          <span className="font-semibold text-slate-900">{businessName}</span>.
        </p>
        <button
          type="button"
          onClick={onLoadDemoData}
          disabled={isLoadingDemoData}
          className={secondaryButtonClassName}
        >
          {isLoadingDemoData ? "Loading demo..." : "Load Demo Data"}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-4 gap-4">
        <SummaryTile label="Opening days" value={openDayCount(summary.openingHours)} />
        <SummaryTile label="Roles" value={summary.roles.length} />
        <SummaryTile label="Shift templates" value={summary.shiftTemplates.length} />
        <SummaryTile
          label="Week starts"
          value={
            summary.businessSettings?.week_starts_on === 0 ? "Sunday" : "Monday"
          }
        />
      </div>

      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="text-base font-semibold tracking-normal">
          Επόμενα βήματα
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Η βάση δεδομένων έχει τα βασικά στοιχεία. Οι απαιτήσεις προσωπικού,
          οι εργαζόμενοι και η δημιουργία προγράμματος παραμένουν εκτός Phase 3.
        </p>
      </div>
    </div>
  );
}

function RecordListPage({
  title,
  description,
  emptyLabel,
  rows
}: {
  title: string;
  description: string;
  emptyLabel: string;
  rows: Array<{ id: string; title: string; detail: string; color?: string | null }>;
}) {
  return (
    <div className="max-w-4xl">
      <SectionHeading title={title} description={description} />

      <div className="mt-6 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-500">{emptyLabel}</p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="flex items-center gap-3 px-5 py-4">
              {row.color ? (
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: row.color }}
                />
              ) : null}
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {row.title}
                </p>
                <p className="mt-1 text-sm text-slate-500">{row.detail}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  required,
  children
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      />
    </Field>
  );
}

function ColorSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      >
        {roleColors.map((color) => (
          <option key={color} value={color}>
            {color}
          </option>
        ))}
      </select>
      <span
        className="h-8 w-8 rounded-md border border-slate-200"
        style={{ backgroundColor: value }}
      />
    </div>
  );
}

function SectionHeading({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h3 className="text-lg font-semibold tracking-normal">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

function ErrorList({ errors }: { errors: string[] }) {
  return (
    <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-semibold">Ελέγξτε τα παρακάτω:</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
      Φόρτωση τοπικής βάσης...
    </div>
  );
}

async function saveSetupDraft(draft: SetupDraft): Promise<void> {
  await upsertBusinessSettings(draft.businessInfo);
  await saveOpeningHours(draft.openingHours);

  const roles = draft.roles.filter(hasAnyRoleValue);
  for (const role of roles) {
    await databaseApi.createRecord("roles", {
      name: role.name.trim(),
      color: role.color,
      description: optionalText(role.description),
      is_active: true
    });
  }

  const templates = draft.shiftTemplates.filter(hasAnyShiftTemplateValue);
  for (const template of templates) {
    await databaseApi.createRecord("shift_templates", {
      name: template.name.trim(),
      role_id: null,
      start_time: template.startTime,
      end_time: template.endTime,
      is_overnight: template.isOvernight,
      break_minutes: 0,
      color: template.color,
      notes: optionalText(template.notes),
      is_active: true
    });
  }

  await databaseApi.setSetting(setupCompletedKey, new Date().toISOString());
}

async function upsertBusinessSettings(
  form: BusinessInfoDraft,
  existingId?: string
): Promise<void> {
  const existing =
    existingId ??
    (await databaseApi.listRecords("business_settings", { limit: 1 }))[0]?.id;

  const payload = {
    business_name: form.businessName.trim(),
    business_type: optionalText(form.businessType),
    location: optionalText(form.location),
    timezone: "Europe/Athens",
    week_starts_on: form.weekStartsOn,
    language: form.language,
    locale: form.language,
    currency: "EUR"
  };

  if (existing) {
    await databaseApi.updateRecord("business_settings", existing, payload);
    return;
  }

  await databaseApi.createRecord("business_settings", payload);
}

async function saveOpeningHours(openingHours: OpeningHoursDraft[]): Promise<void> {
  const existingRows = await databaseApi.listRecords("opening_hours", {
    limit: 20
  });

  for (const day of openingHours) {
    const existing = existingRows.find(
      (row) => row.day_of_week === day.dayOfWeek
    );
    const payload = {
      day_of_week: day.dayOfWeek,
      is_open: day.isOpen,
      open_time: day.isOpen ? day.openTime : null,
      close_time: day.isOpen ? day.closeTime : null,
      is_overnight: day.isOpen ? day.isOvernight : false,
      notes: null
    };

    if (existing) {
      await databaseApi.updateRecord("opening_hours", existing.id, payload);
    } else {
      await databaseApi.createRecord("opening_hours", payload);
    }
  }
}

function businessSettingsToForm(
  settings: BusinessSettings | null
): BusinessInfoDraft {
  return {
    businessName: settings?.business_name ?? "",
    businessType: settings?.business_type ?? "",
    location: settings?.location ?? "",
    weekStartsOn: settings?.week_starts_on === 0 ? 0 : 1,
    language: settings?.language === "en" ? "en" : "el"
  };
}

function dayLabel(dayOfWeek: number): string {
  return (
    dayLabels.find((day) => day.dayOfWeek === dayOfWeek)?.label ??
    `Day ${dayOfWeek}`
  );
}

function openDayCount(openingHours: OpeningHours[]): number {
  return openingHours.filter((day) => day.is_open).length;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Παρουσιάστηκε άγνωστο σφάλμα.";
}

const inputClassName =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-100 disabled:text-slate-400";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";
