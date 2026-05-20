import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { databaseApi } from "../services/databaseApi";
import { loadDemoData } from "../services/demoData";
import { pdfExportApi, PdfExportError } from "../services/pdfExportApi";
import {
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
  ConfirmActionModal,
  DeleteProgramConfirmModal
} from "./components/ConfirmActionModal";
import { ErrorList } from "./components/ErrorList";
import { Field, NumberField } from "./components/Field";
import { ColorSelect } from "./components/ColorSelect";
import { LoadingScreen } from "./components/LoadingScreen";
import { SectionHeading } from "./components/SectionHeading";
import { SummaryTile } from "./components/SummaryTile";
import { LocalizedStatusBadge, StatusBadge } from "./components/StatusBadge";
import {
  inputClassName,
  secondaryButtonClassName
} from "./components/styles";
import { getErrorMessage } from "./utils/errors";
import { appLanguage, type UiLanguage } from "./utils/localization";
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
  localizedDayLabels,
  localizedDayName,
  managerFriendlyWarningMessage,
  roleLabel,
  safeFileNamePart,
  scheduleRowKey,
  shiftNameForSlot,
  shortEmployeeName
} from "./utils/scheduleDisplay";
import { BusinessInfoForm, SetupWizard } from "./pages/SetupWizard";
import { BackupRestorePage, SimpleInfoPage } from "./pages/BackupRestorePage";
import { GenerateSchedulePage } from "./pages/GenerateSchedulePage";
import { deleteGeneratedProgram } from "./utils/scheduleRuns";
import {
  addDays,
  getDayOfWeek,
  getSlotDurationHours,
  saveManualAssignmentChange,
  splitManualAssignmentViolations,
  validateManualAssignmentChange,
  type AssignmentResult,
  type GenerationPlan,
  type ManualAssignmentValidation
} from "../services/scheduler";

const setupCompletedKey = "setup.completedAt";

type PageId =
  | "profile"
  | "opening-hours"
  | "roles"
  | "shift-templates"
  | "staffing-requirements"
  | "employees"
  | "generate-schedule"
  | "schedule-view"
  | "reports"
  | "backup-restore";

type LegacyPageId =
  | "dashboard"
  | "business-settings"
  | "employee-constraints"
  | "time-off";

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

type AppConfirmAction = "load-demo" | "reset-local-data";

type NavigationGroup = {
  title: string;
  items: Array<{
    id: PageId;
    title: string;
  }>;
};

function navigationGroups(language: UiLanguage): NavigationGroup[] {
  if (language === "en") {
    return [
      {
        title: "Setup",
        items: [
          { id: "profile", title: "Profile" },
          { id: "opening-hours", title: "Opening Hours" },
          { id: "roles", title: "Roles" },
          { id: "shift-templates", title: "Shift Templates" },
          { id: "staffing-requirements", title: "Staffing Requirements" }
        ]
      },
      { title: "Team", items: [{ id: "employees", title: "Employees" }] },
      {
        title: "Schedule",
        items: [
          { id: "generate-schedule", title: "Generate Program" },
          { id: "schedule-view", title: "Schedule View" }
        ]
      },
      { title: "Output", items: [{ id: "reports", title: "Reports" }] },
      {
        title: "Advanced",
        items: [{ id: "backup-restore", title: "Backup / Restore" }]
      }
    ];
  }

  return [
    {
      title: "Ρυθμίσεις",
      items: [
        { id: "profile", title: "Προφίλ" },
        { id: "opening-hours", title: "Ώρες λειτουργίας" },
        { id: "roles", title: "Ρόλοι" },
        { id: "shift-templates", title: "Βάρδιες" },
        { id: "staffing-requirements", title: "Ανάγκες προσωπικού" }
      ]
    },
    { title: "Ομάδα", items: [{ id: "employees", title: "Εργαζόμενοι" }] },
    {
      title: "Πρόγραμμα",
      items: [
        { id: "generate-schedule", title: "Δημιουργία προγράμματος" },
        { id: "schedule-view", title: "Προβολή προγράμματος" }
      ]
    },
    { title: "Έξοδοι", items: [{ id: "reports", title: "Αναφορές" }] },
    {
      title: "Για προχωρημένους",
      items: [{ id: "backup-restore", title: "Backup / Restore" }]
    }
  ];
}

function normalizePageId(pageId: PageId | LegacyPageId | string): PageId {
  if (pageId === "dashboard" || pageId === "business-settings") {
    return "profile";
  }

  if (pageId === "employee-constraints" || pageId === "time-off") {
    return "employees";
  }

  const validPageIds: PageId[] = [
    "profile",
    "opening-hours",
    "roles",
    "shift-templates",
    "staffing-requirements",
    "employees",
    "generate-schedule",
    "schedule-view",
    "reports",
    "backup-restore"
  ];

  return validPageIds.includes(pageId as PageId)
    ? (pageId as PageId)
    : "profile";
}

export function App() {
  const [appState, setAppState] = useState<"loading" | "setup" | "ready">(
    "loading"
  );
  const [activePageId, setActivePageId] = useState<PageId | LegacyPageId>(
    "profile"
  );
  const [activeStep, setActiveStep] = useState(0);
  const [setupDraft, setSetupDraft] = useState<SetupDraft>(() =>
    createInitialSetupDraft()
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDemoData, setIsLoadingDemoData] = useState(false);
  const [isResettingApp, setIsResettingApp] = useState(false);
  const [pendingAppConfirmAction, setPendingAppConfirmAction] =
    useState<AppConfirmAction | null>(null);
  const [summary, setSummary] = useState<DashboardSummary>(emptySummary);
  const [selectedScheduleRunId, setSelectedScheduleRunId] = useState<
    string | null
  >(null);

  const language = appLanguage(summary.businessSettings);
  const setupLanguage: UiLanguage =
    setupDraft.businessInfo.language === "en" ? "en" : "el";
  const confirmationLanguage =
    appState === "setup" ? setupLanguage : language;
  const sidebarGroups = useMemo(() => navigationGroups(language), [language]);
  const sidebarItems = useMemo(
    () => sidebarGroups.flatMap((group) => group.items),
    [sidebarGroups]
  );
  const normalizedActivePageId = normalizePageId(activePageId);
  const activeNavItem =
    sidebarItems.find((item) => item.id === normalizedActivePageId) ??
    sidebarItems[0];
  const activePageTitle = activeNavItem.title;
  const today = useMemo(() => format(new Date(), "EEEE, MMMM d, yyyy"), []);

  useEffect(() => {
    if (activePageId !== normalizedActivePageId) {
      setActivePageId(normalizedActivePageId);
    }
  }, [activePageId, normalizedActivePageId]);

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
      setActivePageId("profile");
      setAppState("ready");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLoadDemoData() {
    setErrors([]);
    setNotice("");
    setIsLoadingDemoData(true);

    try {
      const result = await loadDemoData();
      await refreshSummary();
      setSelectedScheduleRunId(null);
      setActiveStep(0);
      setActivePageId("profile");
      setAppState("ready");
      setNotice(
        `Το Demo Cafe φορτώθηκε: ${result.employeeCount} εργαζόμενοι, ${result.roleCount} ρόλοι, ${result.staffingRequirementCount} ανάγκες προσωπικού.`
      );
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsLoadingDemoData(false);
      setPendingAppConfirmAction(null);
    }
  }

  async function handleResetLocalData() {
    setErrors([]);
    setNotice("");
    setIsResettingApp(true);

    try {
      await databaseApi.resetLocalData();
      setSummary(emptySummary);
      setSetupDraft(createInitialSetupDraft());
      setSelectedScheduleRunId(null);
      setActiveStep(0);
      setActivePageId("profile");
      setAppState("setup");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsResettingApp(false);
      setPendingAppConfirmAction(null);
    }
  }

  const pendingAppConfirmModal = pendingAppConfirmAction ? (
    <ConfirmActionModal
      language={confirmationLanguage}
      title={
        pendingAppConfirmAction === "load-demo"
          ? confirmationLanguage === "en"
            ? "Load demo data"
            : "Φόρτωση demo δεδομένων"
          : confirmationLanguage === "en"
            ? "Delete all local data"
            : "Διαγραφή όλων των τοπικών δεδομένων"
      }
      body={
        pendingAppConfirmAction === "load-demo"
          ? confirmationLanguage === "en"
            ? "Loading demo data will replace the current local data with Demo Cafe. This action cannot be undone. Do you want to continue?"
            : "Η φόρτωση demo δεδομένων θα αντικαταστήσει τα τρέχοντα τοπικά δεδομένα με το Demo Cafe. Η ενέργεια δεν μπορεί να αναιρεθεί. Θέλετε να συνεχίσετε;"
          : confirmationLanguage === "en"
            ? "This will permanently delete employees, roles, shifts, schedules, warnings and settings. This action cannot be undone."
            : "Αυτό θα διαγράψει οριστικά εργαζόμενους, ρόλους, βάρδιες, προγράμματα, προειδοποιήσεις και ρυθμίσεις. Η ενέργεια δεν μπορεί να αναιρεθεί."
      }
      confirmLabel={
        pendingAppConfirmAction === "load-demo"
          ? confirmationLanguage === "en"
            ? "Load demo"
            : "Φόρτωση demo"
          : confirmationLanguage === "en"
            ? "Delete all"
            : "Διαγραφή όλων"
      }
      cancelLabel={confirmationLanguage === "en" ? "Cancel" : "Ακύρωση"}
      variant={pendingAppConfirmAction === "load-demo" ? "warning" : "danger"}
      isWorking={
        pendingAppConfirmAction === "load-demo"
          ? isLoadingDemoData
          : isResettingApp
      }
      onCancel={() => setPendingAppConfirmAction(null)}
      onConfirm={() => {
        if (pendingAppConfirmAction === "load-demo") {
          void handleLoadDemoData();
          return;
        }

        void handleResetLocalData();
      }}
    />
  ) : null;

  if (appState === "loading") {
    return <LoadingScreen />;
  }

  if (appState === "setup") {
    return (
      <>
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
          language={setupLanguage}
          onLoadDemoData={() => setPendingAppConfirmAction("load-demo")}
          onNext={handleWizardNext}
        />
        {pendingAppConfirmModal}
      </>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-950">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-5">
          <h1 className="text-xl font-semibold tracking-normal">JProgrammer</h1>
          <p className="mt-1 text-sm text-slate-500">Τοπικός προγραμματισμός</p>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sidebarGroups.map((group) => (
            <div key={group.title}>
              <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {group.title}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = item.id === activeNavItem.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setNotice("");
                        setActivePageId(item.id);
                      }}
                      className={[
                        "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition",
                        isActive
                          ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                      ].join(" ")}
                    >
                      {item.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
          <div>
            <p className="text-sm font-medium text-slate-500">{today}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal">
              {activePageTitle}
            </h2>
          </div>
          <span className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            {language === "en" ? "Offline SQLite" : "Τοπική SQLite"}
          </span>
        </header>

        <section className="flex-1 px-8 py-8">
          {notice ? (
            <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {notice}
            </div>
          ) : null}

          {renderPage(activeNavItem.id, summary, {
            selectedScheduleRunId,
            isLoadingDemoData,
            isResettingApp,
            onDataChanged: async (message) => {
              await refreshSummary();
              setNotice(message);
            },
            onLoadDemoData: () => setPendingAppConfirmAction("load-demo"),
            onResetLocalData: () => setPendingAppConfirmAction("reset-local-data"),
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
      {pendingAppConfirmModal}
    </div>
  );
}

function BusinessSettingsEditor({
  settings,
  language,
  onSaved
}: {
  settings: BusinessSettings | null;
  language: UiLanguage;
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
      <SectionHeading
        title={language === "en" ? "Settings" : "Ρυθμίσεις"}
        description={
          language === "en"
            ? "Edit business profile settings used across the app."
            : "Επεξεργαστείτε τις βασικές ρυθμίσεις της επιχείρησης."
        }
      />
      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <BusinessInfoForm
          value={form}
          onChange={setForm}
          language={language}
          showWeekStartsOnField
        />
      </div>

      <button
        type="button"
        onClick={saveBusinessSettings}
        disabled={isSaving}
        className="mt-6 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {isSaving
          ? language === "en"
            ? "Saving..."
            : "Αποθήκευση..."
          : language === "en"
            ? "Save settings"
            : "Αποθήκευση ρυθμίσεων"}
      </button>
    </div>
  );
}

function ProfilePage({
  summary,
  language,
  isLoadingDemoData,
  onLoadDemoData,
  onSettingsSaved
}: {
  summary: DashboardSummary;
  language: UiLanguage;
  isLoadingDemoData: boolean;
  onLoadDemoData: () => void;
  onSettingsSaved: () => Promise<void>;
}) {
  const settings = summary.businessSettings;
  const latestRun = [...summary.scheduleRuns].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )[0];

  return (
    <div className="max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          title={language === "en" ? "Profile" : "Προφίλ"}
          description={
            language === "en"
              ? "Current business setup and quick summary."
              : "Τρέχουσα εικόνα επιχείρησης και γρήγορη σύνοψη."
          }
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold tracking-normal text-slate-950">
            {language === "en" ? "Business profile" : "Στοιχεία επιχείρησης"}
          </h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ProfileInfoItem
              label={language === "en" ? "Business name" : "Όνομα επιχείρησης"}
              value={settings?.business_name ?? "-"}
            />
            <ProfileInfoItem
              label={language === "en" ? "Business type" : "Τύπος επιχείρησης"}
              value={settings?.business_type ?? "-"}
            />
            <ProfileInfoItem
              label={language === "en" ? "Language" : "Γλώσσα"}
              value={settings?.language === "en" ? "English" : "Ελληνικά"}
            />
            <ProfileInfoItem
              label={language === "en" ? "Week starts on" : "Η εβδομάδα ξεκινά"}
              value={
                settings?.week_starts_on === 0
                  ? language === "en"
                    ? "Sunday"
                    : "Κυριακή"
                  : language === "en"
                    ? "Monday"
                    : "Δευτέρα"
              }
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={onLoadDemoData}
              disabled={isLoadingDemoData}
              className={secondaryButtonClassName}
            >
              {isLoadingDemoData
                ? language === "en"
                  ? "Loading demo..."
                  : "Φόρτωση demo..."
                : language === "en"
                  ? "Load Demo Data"
                  : "Φόρτωση Demo Data"}
            </button>
          </div>
        </div>

        <div className="grid gap-4">
          <SummaryTile
            label={language === "en" ? "Opening days" : "Ημέρες λειτουργίας"}
            value={openDayCount(summary.openingHours)}
          />
          <SummaryTile
            label={language === "en" ? "Roles" : "Ρόλοι"}
            value={summary.roles.length}
          />
          <SummaryTile
            label={language === "en" ? "Shifts" : "Βάρδιες"}
            value={summary.shiftTemplates.length}
          />
          <SummaryTile
            label={language === "en" ? "Employees" : "Εργαζόμενοι"}
            value={summary.employees.length}
          />
          <SummaryTile
            label={language === "en" ? "Latest program" : "Τελευταίο πρόγραμμα"}
            value={
              latestRun
                ? formatCompactDateRange(
                    latestRun.start_date,
                    latestRun.end_date,
                    language
                  )
                : language === "en"
                  ? "None yet"
                  : "Δεν υπάρχει ακόμα"
            }
          />
        </div>
      </div>

      <div className="mt-6">
        <BusinessSettingsEditor
          settings={summary.businessSettings}
          language={language}
          onSaved={onSettingsSaved}
        />
      </div>
    </div>
  );
}

function ProfileInfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function OpeningHoursPage({
  openingHours,
  language,
  shiftTemplates,
  staffingRequirements,
  onChanged
}: {
  openingHours: OpeningHours[];
  language: UiLanguage;
  shiftTemplates: ShiftTemplate[];
  staffingRequirements: StaffingRequirement[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<OpeningHoursFormRow[]>(() =>
    openingHoursToDraft(openingHours, language)
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setForm(openingHoursToDraft(openingHours, language));
  }, [openingHours, language]);

  function updateDay(dayOfWeek: DayOfWeek, value: Partial<OpeningHoursFormRow>) {
    setForm((current) =>
      current.map((day) =>
        day.dayOfWeek === dayOfWeek ? { ...day, ...value } : day
      )
    );
  }

  async function saveHours() {
    const nextErrors = validateOpeningHoursForm(form, language);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      await saveOpeningHours(form);
      await onChanged(
        language === "en"
          ? "Opening hours saved."
          : "Το ωράριο λειτουργίας αποθηκεύτηκε."
      );
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  const mayHavePlanningOutsideHours =
    shiftTemplates.length > 0 || staffingRequirements.length > 0;

  return (
    <div className="max-w-6xl">
      <SectionHeading
        title={language === "en" ? "Opening Hours" : "Ώρες λειτουργίας"}
        description={
          language === "en"
            ? "Edit the weekly operating hours used by future schedule generation."
            : "Επεξεργαστείτε το εβδομαδιαίο ωράριο που χρησιμοποιείται σε μελλοντικά προγράμματα."
        }
      />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {mayHavePlanningOutsideHours ? (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {language === "en"
            ? "Some shifts or staffing requirements may be outside opening hours."
            : "Υπάρχουν βάρδιες ή ανάγκες προσωπικού που μπορεί να είναι εκτός ωραρίου."}
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.2fr_0.8fr_1fr_1fr_0.9fr_1.4fr] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>{language === "en" ? "Day" : "Ημέρα"}</span>
          <span>{language === "en" ? "Open" : "Ανοιχτά"}</span>
          <span>{language === "en" ? "Opens" : "Άνοιγμα"}</span>
          <span>{language === "en" ? "Closes" : "Κλείσιμο"}</span>
          <span>{language === "en" ? "Overnight" : "Μεσάνυχτα"}</span>
          <span>{language === "en" ? "Notes" : "Σημειώσεις"}</span>
        </div>

        {form.map((day) => (
          <div
            key={day.dayOfWeek}
            className="grid grid-cols-[1.2fr_0.8fr_1fr_1fr_0.9fr_1.4fr] items-center gap-4 border-t border-slate-200 px-5 py-4"
          >
            <p className="text-sm font-semibold text-slate-900">{day.label}</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={day.isOpen}
                onChange={(event) =>
                  updateDay(day.dayOfWeek, { isOpen: event.target.checked })
                }
              />
              {day.isOpen
                ? language === "en"
                  ? "Open"
                  : "Ανοιχτά"
                : language === "en"
                  ? "Closed"
                  : "Κλειστά"}
            </label>
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
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={day.isOvernight}
                disabled={!day.isOpen}
                onChange={(event) =>
                  updateDay(day.dayOfWeek, {
                    isOvernight: event.target.checked
                  })
                }
              />
              {language === "en" ? "Overnight" : "Περνάει"}
            </label>
            <input
              value={day.notes}
              onChange={(event) =>
                updateDay(day.dayOfWeek, { notes: event.target.value })
              }
              className={inputClassName}
              placeholder={language === "en" ? "Optional" : "Προαιρετικά"}
            />
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={saveHours}
        disabled={isSaving}
        className="mt-5 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
      >
        {isSaving
          ? language === "en"
            ? "Saving..."
            : "Αποθήκευση..."
          : language === "en"
            ? "Save opening hours"
            : "Αποθήκευση ωραρίου"}
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

type OpeningHoursFormRow = OpeningHoursDraft & {
  notes: string;
};

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

function UnifiedEmployeesPage({
  language,
  employees,
  roles,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  shiftTemplates,
  timeOff,
  onChanged
}: {
  language: UiLanguage;
  employees: Employee[];
  roles: Role[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  shiftTemplates: ShiftTemplate[];
  timeOff: TimeOff[];
  onChanged: (message: string) => Promise<void>;
}) {
  const text = employeePageText(language);
  const dayOptions = localizedDayLabels(language);
  const activeShiftTemplates = shiftTemplates.filter(
    (shiftTemplate) => shiftTemplate.is_active === 1
  );
  const [form, setForm] = useState<EmployeeForm>(() => createEmployeeForm());
  const [detailMode, setDetailMode] = useState<"list" | "add" | "edit">("list");
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [timeOffForm, setTimeOffForm] = useState<TimeOffForm>(() =>
    createTimeOffForm(employees)
  );
  const [timeOffPendingDelete, setTimeOffPendingDelete] =
    useState<TimeOff | null>(null);

  const selectedEmployee =
    editingEmployeeId && detailMode === "edit"
      ? employees.find((employee) => employee.id === editingEmployeeId) ?? null
      : null;
  const isDetailOpen = detailMode !== "list";

  const filteredEmployees = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();

    if (!query) {
      return employees;
    }

    return employees.filter((employee) => {
      const assignedRoleIds = employeeRoles
        .filter((employeeRole) => employeeRole.employee_id === employee.id)
        .map((employeeRole) => employeeRole.role_id);
      const haystack = [
        employee.first_name,
        employee.last_name,
        employee.email ?? "",
        employee.phone ?? "",
        employee.notes ?? "",
        employeeRoleLabelsLocalized(assignedRoleIds, roles, language)
      ]
        .join(" ")
        .toLocaleLowerCase();

      return haystack.includes(query);
    });
  }, [employees, employeeRoles, roles, searchTerm, language]);

  useEffect(() => {
    if (detailMode !== "edit" || !editingEmployeeId) {
      return;
    }

    if (!employees.some((employee) => employee.id === editingEmployeeId)) {
      closeDetail();
    }
  }, [detailMode, editingEmployeeId, employees]);

  useEffect(() => {
    const employeeId = selectedEmployee?.id ?? "";
    setTimeOffForm((current) => ({
      ...current,
      employeeId
    }));
  }, [selectedEmployee?.id]);

  function startAddingEmployee() {
    setErrors([]);
    setEditingEmployeeId(null);
    setDetailMode("add");
    setForm(createEmployeeForm());
  }

  function startEditingEmployee(employee: Employee) {
    const assignedRoles = employeeRoles.filter(
      (employeeRole) => employeeRole.employee_id === employee.id
    );
    const workRules =
      employeeWorkRules.find((rules) => rules.employee_id === employee.id) ??
      null;

    setErrors([]);
    setDetailMode("edit");
    setEditingEmployeeId(employee.id);
    setForm(employeeToForm(employee, assignedRoles, workRules));
  }

  function closeDetail() {
    setErrors([]);
    setDetailMode("list");
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

  async function saveEmployee() {
    const nextErrors = validateEmployeeFormForLanguage(form, language);

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
      const employee =
        detailMode === "edit" && editingEmployeeId
          ? await databaseApi.updateRecord("employees", editingEmployeeId, payload)
          : await databaseApi.createRecord("employees", payload);

      if (!employee) {
        throw new Error(text.saveFailed);
      }

      await syncEmployeeRoleAssignments(employee.id, form, employeeRoles);
      await upsertEmployeeWorkRules(employee.id, form.workRules, employeeWorkRules);
      setDetailMode("edit");
      setEditingEmployeeId(employee.id);
      await onChanged(detailMode === "edit" ? text.employeeUpdated : text.employeeAdded);
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

      await onChanged(nextIsActive ? text.employeeActivated : text.employeeDeactivated);
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveDayConstraint(
    employee: Employee,
    dayOfWeek: DayOfWeek,
    constraintType: DayConstraintValue
  ) {
    setErrors([]);
    setIsSaving(true);

    try {
      const existingConstraints = employeeDayConstraints.filter(
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
        await onChanged(text.availabilitySaved);
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

      await onChanged(text.availabilitySaved);
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
      const existingRows = employeeShiftAvailability.filter(
        (item) =>
          item.employee_id === employee.id &&
          item.day_of_week === dayOfWeek &&
          item.shift_template_id === shiftTemplateId
      );

      if (availabilityType === "available") {
        for (const row of existingRows) {
          await databaseApi.deleteRecord("employee_shift_availability", row.id);
        }
        await onChanged(text.availabilitySaved);
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

      await onChanged(text.availabilitySaved);
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveTimeOff() {
    if (!selectedEmployee) {
      setErrors([text.chooseEmployeeFirst]);
      return;
    }

    const nextErrors = validateTimeOffFormForLanguage(timeOffForm, employees, language);

    if (nextErrors.length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors([]);
    setIsSaving(true);

    try {
      await databaseApi.createRecord("time_off", {
        employee_id: selectedEmployee.id,
        type: timeOffForm.type,
        start_date: timeOffForm.dateFrom,
        end_date: timeOffForm.dateTo,
        reason: optionalText(timeOffForm.reason),
        status: "recorded",
        notes: null
      });
      await onChanged(text.timeOffSaved);
      setTimeOffForm({
        ...createTimeOffForm(employees),
        employeeId: selectedEmployee.id
      });
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteTimeOff(entry: TimeOff) {
    setErrors([]);
    setIsSaving(true);

    try {
      await databaseApi.deleteRecord("time_off", entry.id);
      await onChanged(text.timeOffDeleted);
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
      setTimeOffPendingDelete(null);
    }
  }

  const selectedTimeOff = selectedEmployee
    ? timeOff.filter((entry) => entry.employee_id === selectedEmployee.id)
    : [];

  return (
    <div className="max-w-7xl">
      <SectionHeading title={text.title} description={text.description} />

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {roles.length === 0 ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          {text.addRolesFirst}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <div className="min-w-0">
          <div className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <Field label={text.search}>
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className={`${inputClassName} w-full min-w-[260px]`}
                  placeholder={text.searchPlaceholder}
                />
              </Field>
              <button
                type="button"
                onClick={startAddingEmployee}
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                {text.addEmployee}
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              {text.showing(filteredEmployees.length, employees.length)}
            </p>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
            {filteredEmployees.length === 0 ? (
              <p className="px-5 py-5 text-sm text-slate-500">
                {text.noEmployeesFound}
              </p>
            ) : (
              filteredEmployees.map((employee) => {
                const assignedRoleIds = employeeRoles
                  .filter(
                    (employeeRole) => employeeRole.employee_id === employee.id
                  )
                  .map((employeeRole) => employeeRole.role_id);
                const rules =
                  employeeWorkRules.find(
                    (workRules) => workRules.employee_id === employee.id
                  ) ?? null;
                const isSelected = employee.id === editingEmployeeId;

                return (
                  <button
                    key={employee.id}
                    type="button"
                    onClick={() => startEditingEmployee(employee)}
                    className={[
                      "block w-full border-t border-slate-200 px-5 py-4 text-left first:border-t-0 hover:bg-slate-50",
                      isSelected ? "bg-emerald-50/60" : ""
                    ].join(" ")}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-950">
                            {employee.first_name} {employee.last_name}
                          </p>
                          <LocalizedStatusBadge
                            isActive={Boolean(employee.is_active)}
                            language={language}
                          />
                        </div>
                        <p className="mt-1 text-sm text-slate-600">
                          {text.roles}:{" "}
                          {employeeRoleLabelsLocalized(
                            assignedRoleIds,
                            roles,
                            language
                          )}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {workRulesSummaryLocalized(rules, language)}
                        </p>
                      </div>
                      <div className="text-right text-sm text-slate-500">
                        <p>{employee.phone || text.noPhone}</p>
                        <p className="mt-1">{employee.email || text.noEmail}</p>
                        <p className="mt-2 text-xs font-medium text-slate-500">
                          {employeeAvailabilitySummary(
                            employee.id,
                            employeeDayConstraints,
                            employeeShiftAvailability,
                            language
                          )}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="min-w-0">
          {!isDetailOpen ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-5 py-8 text-sm text-slate-500">
              {text.selectEmployeePrompt}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">
                    {detailMode === "add"
                      ? text.addEmployee
                      : text.editEmployee(selectedEmployee)}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {detailMode === "add"
                      ? text.addEmployeeHint
                      : text.editEmployeeHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeDetail}
                  className={secondaryButtonClassName}
                >
                  {text.close}
                </button>
              </div>

              <div className="space-y-6 px-5 py-5">
                <section>
                  <h4 className="text-sm font-semibold text-slate-800">
                    {text.details}
                  </h4>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <Field label={text.firstName} required>
                      <input
                        value={form.firstName}
                        onChange={(event) =>
                          setForm({ ...form, firstName: event.target.value })
                        }
                        className={inputClassName}
                      />
                    </Field>
                    <Field label={text.lastName} required>
                      <input
                        value={form.lastName}
                        onChange={(event) =>
                          setForm({ ...form, lastName: event.target.value })
                        }
                        className={inputClassName}
                      />
                    </Field>
                    <Field label={text.phone}>
                      <input
                        value={form.phone}
                        onChange={(event) =>
                          setForm({ ...form, phone: event.target.value })
                        }
                        className={inputClassName}
                      />
                    </Field>
                    <Field label={text.email}>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(event) =>
                          setForm({ ...form, email: event.target.value })
                        }
                        className={inputClassName}
                      />
                    </Field>
                    <Field label={text.notes}>
                      <input
                        value={form.notes}
                        onChange={(event) =>
                          setForm({ ...form, notes: event.target.value })
                        }
                        className={inputClassName}
                      />
                    </Field>
                    <Field label={text.status}>
                      <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={form.isActive}
                          onChange={(event) =>
                            setForm({ ...form, isActive: event.target.checked })
                          }
                          className="h-4 w-4"
                        />
                        {form.isActive ? text.active : text.inactive}
                      </label>
                    </Field>
                  </div>
                </section>

                <section>
                  <h4 className="text-sm font-semibold text-slate-800">
                    {text.roleAssignments}
                  </h4>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {roles.length === 0 ? (
                      <p className="text-sm text-slate-500">{text.noRoles}</p>
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
                            className="rounded-md border border-slate-200 px-3 py-3 text-sm text-slate-700"
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
                                style={{
                                  backgroundColor: role.color ?? roleColors[0]
                                }}
                              />
                              <span>{role.name}</span>
                              {!role.is_active ? (
                                <span className="text-xs text-slate-400">
                                  {text.inactive}
                                </span>
                              ) : null}
                            </label>

                            {isSelected ? (
                              <div className="mt-3 space-y-2">
                                <Field label={text.experience}>
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
                                    {experienceOptions(language).map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
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
                                  {text.canLeadRole}
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
                                  {text.preferredRole}
                                </label>
                              </div>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>

                <section>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-800">
                      {text.workRules}
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
                  <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <Field label={text.employmentType}>
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
                        {employmentTypeSelectOptions(language).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <NumberField
                      label={text.daysPerWeek}
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
                      label={text.hoursPerDay}
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
                      label={text.hoursPerWeek}
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
                      label={text.maxConsecutiveDays}
                      value={form.workRules.maxConsecutiveDays}
                      onChange={(value) =>
                        setForm({
                          ...form,
                          workRules: {
                            ...form.workRules,
                            maxConsecutiveDays: value
                          }
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
                      {text.canWorkWeekends}
                    </label>
                  </div>
                </section>

                <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
                  <button
                    type="button"
                    onClick={saveEmployee}
                    disabled={isSaving}
                    className="rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {isSaving
                      ? text.saving
                      : detailMode === "add"
                        ? text.saveNewEmployee
                        : text.saveEmployee}
                  </button>
                  {selectedEmployee ? (
                    <button
                      type="button"
                      onClick={() => void toggleEmployeeActive(selectedEmployee)}
                      disabled={isSaving}
                      className={secondaryButtonClassName}
                    >
                      {selectedEmployee.is_active
                        ? text.deactivate
                        : text.activate}
                    </button>
                  ) : null}
                </div>

                {selectedEmployee ? (
                  <>
                    <section className="border-t border-slate-200 pt-5">
                      <h4 className="text-sm font-semibold text-slate-800">
                        {text.availability}
                      </h4>
                      <p className="mt-1 text-sm text-slate-500">
                        {text.availabilityHelp}
                      </p>

                      <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
                        <div className="grid min-w-[820px] grid-cols-[150px_repeat(7,1fr)] items-center gap-3 bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <span>{text.dayLevel}</span>
                          {dayOptions.map((day) => (
                            <span key={day.dayOfWeek}>{day.shortLabel}</span>
                          ))}
                        </div>
                        <div className="grid min-w-[820px] grid-cols-[150px_repeat(7,1fr)] items-center gap-3 px-4 py-4">
                          <span className="text-sm font-semibold text-slate-900">
                            {text.wholeDay}
                          </span>
                          {dayOptions.map((day) => {
                            const value = dayConstraintValue(
                              selectedEmployee.id,
                              day.dayOfWeek,
                              employeeDayConstraints
                            );

                            return (
                              <select
                                key={day.dayOfWeek}
                                value={value}
                                onChange={(event) =>
                                  void saveDayConstraint(
                                    selectedEmployee,
                                    day.dayOfWeek,
                                    event.target.value as DayConstraintValue
                                  )
                                }
                                disabled={isSaving}
                                className={`${inputClassName} ${shiftAvailabilityClassName(value === "neutral" ? "available" : value)}`}
                              >
                                {dayConstraintSelectOptions(language).map(
                                  (option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  )
                                )}
                              </select>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
                        <div
                          className="grid min-w-[920px] bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
                          style={{
                            gridTemplateColumns: `150px repeat(${Math.max(
                              1,
                              activeShiftTemplates.length
                            )}, minmax(150px, 1fr))`
                          }}
                        >
                          <span>{text.day}</span>
                          {activeShiftTemplates.length === 0 ? (
                            <span>{text.shift}</span>
                          ) : (
                            activeShiftTemplates.map((shiftTemplate) => (
                              <span
                                key={shiftTemplate.id}
                                className="whitespace-nowrap"
                              >
                                {shiftTemplate.name}
                              </span>
                            ))
                          )}
                        </div>

                        {activeShiftTemplates.length === 0 ? (
                          <p className="px-4 py-5 text-sm text-slate-500">
                            {text.noShiftTemplates}
                          </p>
                        ) : (
                          dayOptions.map((day) => (
                            <div
                              key={day.dayOfWeek}
                              className="grid min-w-[920px] items-center gap-3 border-t border-slate-200 px-4 py-3"
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
                                  employeeShiftAvailability
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
                                        event.target
                                          .value as ShiftAvailabilityValue
                                      )
                                    }
                                    disabled={isSaving}
                                    className={`${inputClassName} ${shiftAvailabilityClassName(
                                      value
                                    )}`}
                                  >
                                    {shiftAvailabilitySelectOptions(
                                      language
                                    ).map((option) => (
                                      <option
                                        key={option.value}
                                        value={option.value}
                                      >
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
                    </section>

                    <section className="border-t border-slate-200 pt-5">
                      <h4 className="text-sm font-semibold text-slate-800">
                        {text.timeOff}
                      </h4>
                      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1.4fr]">
                        <Field label={text.dateFrom} required>
                          <input
                            type="date"
                            value={timeOffForm.dateFrom}
                            onChange={(event) =>
                              setTimeOffForm({
                                ...timeOffForm,
                                dateFrom: event.target.value
                              })
                            }
                            className={inputClassName}
                          />
                        </Field>
                        <Field label={text.dateTo} required>
                          <input
                            type="date"
                            value={timeOffForm.dateTo}
                            onChange={(event) =>
                              setTimeOffForm({
                                ...timeOffForm,
                                dateTo: event.target.value
                              })
                            }
                            className={inputClassName}
                          />
                        </Field>
                        <Field label={text.type} required>
                          <select
                            value={timeOffForm.type}
                            onChange={(event) =>
                              setTimeOffForm({
                                ...timeOffForm,
                                type: event.target.value
                              })
                            }
                            className={inputClassName}
                          >
                            {timeOffTypeOptions(language).map((type) => (
                              <option key={type.value} value={type.value}>
                                {type.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={text.reason}>
                          <input
                            value={timeOffForm.reason}
                            onChange={(event) =>
                              setTimeOffForm({
                                ...timeOffForm,
                                reason: event.target.value
                              })
                            }
                            className={inputClassName}
                          />
                        </Field>
                      </div>
                      <button
                        type="button"
                        onClick={saveTimeOff}
                        disabled={isSaving}
                        className="mt-3 rounded-md border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                      >
                        {text.addTimeOff}
                      </button>

                      <div className="mt-4 overflow-hidden rounded-md border border-slate-200">
                        {selectedTimeOff.length === 0 ? (
                          <p className="px-4 py-4 text-sm text-slate-500">
                            {text.noTimeOff}
                          </p>
                        ) : (
                          [...selectedTimeOff]
                            .sort((a, b) =>
                              a.start_date.localeCompare(b.start_date)
                            )
                            .map((entry) => (
                              <div
                                key={entry.id}
                                className="grid gap-3 border-t border-slate-200 px-4 py-3 text-sm first:border-t-0 md:grid-cols-[1fr_1fr_1fr_1.2fr_auto]"
                              >
                                <span>{entry.start_date}</span>
                                <span>{entry.end_date}</span>
                                <span>
                                  {timeOffTypeLabelLocalized(
                                    entry.type,
                                    language
                                  )}
                                </span>
                                <span className="text-slate-600">
                                  {entry.reason || text.noReason}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setTimeOffPendingDelete(entry)}
                                  className={secondaryButtonClassName}
                                >
                                  {text.delete}
                                </button>
                              </div>
                            ))
                        )}
                      </div>
                    </section>
                  </>
                ) : (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                    {text.saveBeforeAvailability}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {timeOffPendingDelete ? (
        <ConfirmActionModal
          language={language}
          title={language === "en" ? "Delete time off" : "Διαγραφή άδειας"}
          body={
            language === "en"
              ? "This time off entry will be deleted. This action cannot be undone."
              : "Αυτή η άδεια θα διαγραφεί. Η ενέργεια δεν μπορεί να αναιρεθεί."
          }
          confirmLabel={language === "en" ? "Delete" : "Διαγραφή"}
          cancelLabel={language === "en" ? "Cancel" : "Ακύρωση"}
          variant="danger"
          isWorking={isSaving}
          onCancel={() => setTimeOffPendingDelete(null)}
          onConfirm={() => {
            if (timeOffPendingDelete) {
              void deleteTimeOff(timeOffPendingDelete);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function StaffingRequirementsPage({
  language,
  roles,
  shiftTemplates,
  requirements,
  onChanged
}: {
  language: UiLanguage;
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
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingGroupKey, setEditingGroupKey] = useState<string | null>(null);
  const [requirementGroupPendingDelete, setRequirementGroupPendingDelete] =
    useState<StaffingRequirementGroup | null>(null);
  const [copySourceDay, setCopySourceDay] = useState<DayOfWeek>(1);
  const [copyTargetDay, setCopyTargetDay] = useState<DayOfWeek>(2);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const groupedRequirements = useMemo(
    () => groupStaffingRequirements(requirements, shiftTemplates, language),
    [requirements, shiftTemplates, language]
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
      closeForm();
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRequirementGroup(group: StaffingRequirementGroup) {
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
        closeForm();
      }
      await onChanged("Οι ανάγκες βάρδιας διαγράφηκαν.");
    } catch (error) {
      setErrors([getErrorMessage(error)]);
    } finally {
      setIsSaving(false);
      setRequirementGroupPendingDelete(null);
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
    setIsFormOpen(true);
    setEditingGroupKey(group.key);
    setForm({
      dayOfWeek: group.dayOfWeek,
      shiftTemplateId: group.shiftTemplateId,
      roleCounts: createRoleCountValues(activeRoles, group.requirements)
    });
  }

  function openAddForm() {
    setErrors([]);
    setEditingGroupKey(null);
    setForm(createStaffingRequirementForm(roles, shiftTemplates));
    setIsFormOpen(true);
  }

  function closeForm() {
    setErrors([]);
    setEditingGroupKey(null);
    setForm(createStaffingRequirementForm(roles, shiftTemplates));
    setIsFormOpen(false);
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          title="Ανάγκες Προσωπικού"
          description="Δείτε και επεξεργαστείτε τους κανόνες στελέχωσης ανά βάρδια."
        />
        <button
          type="button"
          onClick={openAddForm}
          disabled={activeRoles.length === 0 || activeShiftTemplates.length === 0}
          className={secondaryButtonClassName}
        >
          Προσθήκη ανάγκης
        </button>
      </div>

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {activeRoles.length === 0 || activeShiftTemplates.length === 0 ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          Προσθέστε τουλάχιστον έναν ενεργό ρόλο και μία ενεργή βάρδια πριν
          ορίσετε ανάγκες προσωπικού.
        </div>
      ) : null}

      {isFormOpen ? (
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-normal">
            {editingGroupKey
              ? "Επεξεργασία αναγκών βάρδιας"
              : "Προσθήκη αναγκών βάρδιας"}
          </h3>
          <button
            type="button"
            onClick={closeForm}
            className={secondaryButtonClassName}
          >
            Ακύρωση
          </button>
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
      ) : null}

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
                            onClick={() => setRequirementGroupPendingDelete(group)}
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
      {requirementGroupPendingDelete ? (
        <ConfirmActionModal
          language={language}
          title={
            language === "en"
              ? "Delete shift requirements"
              : "Διαγραφή αναγκών βάρδιας"
          }
          body={
            language === "en"
              ? "All staffing requirements for this shift will be deleted. This action cannot be undone."
              : "Να διαγραφούν όλες οι ανάγκες προσωπικού για αυτή τη βάρδια; Η ενέργεια δεν μπορεί να αναιρεθεί."
          }
          confirmLabel={language === "en" ? "Delete" : "Διαγραφή"}
          cancelLabel={language === "en" ? "Cancel" : "Ακύρωση"}
          variant="danger"
          isWorking={isSaving}
          onCancel={() => setRequirementGroupPendingDelete(null)}
          onConfirm={() => {
            if (requirementGroupPendingDelete) {
              void deleteRequirementGroup(requirementGroupPendingDelete);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function RolesCrudPage({
  language,
  roles,
  onChanged
}: {
  language: UiLanguage;
  roles: Role[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<RoleCrudForm>(() => createRoleCrudForm());
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const text =
    language === "en"
      ? {
          title: "Roles",
          description: "Manage the roles used in schedules.",
          addRole: "Add role",
          editRole: "Edit role",
          cancel: "Cancel",
          roleName: "Role name",
          color: "Color",
          descriptionLabel: "Description",
          status: "Status",
          actions: "Actions",
          active: "Active",
          saving: "Saving...",
          saveRole: "Save role",
          role: "Role",
          noRoles: "No roles have been created yet.",
          noNotes: "No notes",
          edit: "Edit",
          deactivate: "Deactivate",
          reactivate: "Reactivate",
          roleUpdated: "Role updated.",
          roleAdded: "Role added.",
          roleReactivated: "Role reactivated.",
          roleDeactivated: "Role deactivated.",
          placeholder: "Optional"
        }
      : {
          title: "Ρόλοι",
          description: "Διαχειριστείτε τους ρόλους που χρησιμοποιούνται στα προγράμματα.",
          addRole: "Προσθήκη ρόλου",
          editRole: "Επεξεργασία ρόλου",
          cancel: "Ακύρωση",
          roleName: "Όνομα ρόλου",
          color: "Χρώμα",
          descriptionLabel: "Περιγραφή",
          status: "Κατάσταση",
          actions: "Ενέργειες",
          active: "Ενεργός",
          saving: "Αποθήκευση...",
          saveRole: "Αποθήκευση ρόλου",
          role: "Ρόλος",
          noRoles: "Δεν έχουν δημιουργηθεί ρόλοι ακόμα.",
          noNotes: "Δεν υπάρχουν σημειώσεις",
          edit: "Επεξεργασία",
          deactivate: "Απενεργοποίηση",
          reactivate: "Ενεργοποίηση",
          roleUpdated: "Ο ρόλος ενημερώθηκε.",
          roleAdded: "Ο ρόλος προστέθηκε.",
          roleReactivated: "Ο ρόλος ενεργοποιήθηκε.",
          roleDeactivated: "Ο ρόλος απενεργοποιήθηκε.",
          placeholder: "Προαιρετικό"
        };

  async function saveRole() {
    const nextErrors = validateRoleCrudForm(form, roles, editingRoleId, language);

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
        await onChanged(text.roleUpdated);
      } else {
        await databaseApi.createRecord("roles", payload);
        await onChanged(text.roleAdded);
      }

      closeForm();
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
      await onChanged(nextIsActive ? text.roleReactivated : text.roleDeactivated);

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
    setIsFormOpen(true);
    setEditingRoleId(role.id);
    setForm({
      name: role.name,
      color: role.color ?? roleColors[0],
      description: role.description ?? "",
      isActive: Boolean(role.is_active)
    });
  }

  function openAddForm() {
    setErrors([]);
    setEditingRoleId(null);
    setForm(createRoleCrudForm());
    setIsFormOpen(true);
  }

  function closeForm() {
    setErrors([]);
    setEditingRoleId(null);
    setForm(createRoleCrudForm());
    setIsFormOpen(false);
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          title={text.title}
          description={text.description}
        />
        <button
          type="button"
          onClick={openAddForm}
          className={secondaryButtonClassName}
        >
          {text.addRole}
        </button>
      </div>

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {isFormOpen ? (
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-normal">
            {editingRoleId ? text.editRole : text.addRole}
          </h3>
          <button
            type="button"
            onClick={closeForm}
            className={secondaryButtonClassName}
          >
            {text.cancel}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_180px_1.5fr_120px] gap-4">
          <Field label={text.roleName} required>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              className={inputClassName}
              placeholder="Barista"
            />
          </Field>
          <Field label={text.color}>
            <ColorSelect
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
          </Field>
          <Field label={text.descriptionLabel}>
            <input
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
              className={inputClassName}
              placeholder={text.placeholder}
            />
          </Field>
          <Field label={text.status}>
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm({ ...form, isActive: event.target.checked })
                }
                className="h-4 w-4"
              />
              {text.active}
            </label>
          </Field>
        </div>

        <button
          type="button"
          onClick={saveRole}
          disabled={isSaving}
          className="mt-5 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isSaving ? text.saving : editingRoleId ? text.saveRole : text.addRole}
        </button>
      </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.2fr_1.6fr_120px_190px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>{text.role}</span>
          <span>{text.descriptionLabel}</span>
          <span>{text.status}</span>
          <span>{text.actions}</span>
        </div>

        {roles.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-500">
            {text.noRoles}
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
                {role.description || text.noNotes}
              </p>
              <StatusBadge isActive={Boolean(role.is_active)} language={language} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEditing(role)}
                  className={secondaryButtonClassName}
                >
                  {text.edit}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRoleActive(role)}
                  className={secondaryButtonClassName}
                >
                  {role.is_active ? text.deactivate : text.reactivate}
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
  language,
  shiftTemplates,
  onChanged
}: {
  language: UiLanguage;
  shiftTemplates: ShiftTemplate[];
  onChanged: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<ShiftTemplateCrudForm>(() =>
    createShiftTemplateCrudForm()
  );
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const text =
    language === "en"
      ? {
          title: "Shift Templates",
          description: "Manage reusable shifts for future programs.",
          addShift: "Add shift",
          editShift: "Edit shift",
          cancel: "Cancel",
          name: "Name",
          start: "Start",
          end: "End",
          overnight: "Overnight",
          color: "Color",
          status: "Status",
          notes: "Notes",
          template: "Template",
          time: "Time",
          actions: "Actions",
          active: "Active",
          yes: "Yes",
          no: "No",
          saving: "Saving...",
          saveShift: "Save shift",
          noShifts: "No shift templates have been created yet.",
          noNotes: "No notes",
          edit: "Edit",
          deactivate: "Deactivate",
          reactivate: "Reactivate",
          shiftUpdated:
            "Shift template updated. Future generated programs will use the new template values; existing programs stay unchanged.",
          shiftAdded: "Shift template added.",
          shiftReactivated: "Shift template reactivated.",
          shiftDeactivated: "Shift template deactivated.",
          optionalNotes: "Optional notes"
        }
      : {
          title: "Βάρδιες",
          description: "Διαχειριστείτε τις επαναχρησιμοποιούμενες βάρδιες για μελλοντικά προγράμματα.",
          addShift: "Προσθήκη βάρδιας",
          editShift: "Επεξεργασία βάρδιας",
          cancel: "Ακύρωση",
          name: "Όνομα",
          start: "Έναρξη",
          end: "Λήξη",
          overnight: "Περνάει τα μεσάνυχτα",
          color: "Χρώμα",
          status: "Κατάσταση",
          notes: "Σημειώσεις",
          template: "Βάρδια",
          time: "Ώρες",
          actions: "Ενέργειες",
          active: "Ενεργή",
          yes: "Ναι",
          no: "Όχι",
          saving: "Αποθήκευση...",
          saveShift: "Αποθήκευση βάρδιας",
          noShifts: "Δεν έχουν δημιουργηθεί βάρδιες ακόμα.",
          noNotes: "Δεν υπάρχουν σημειώσεις",
          edit: "Επεξεργασία",
          deactivate: "Απενεργοποίηση",
          reactivate: "Ενεργοποίηση",
          shiftUpdated: "Η βάρδια ενημερώθηκε.",
          shiftAdded: "Η βάρδια προστέθηκε.",
          shiftReactivated: "Η βάρδια ενεργοποιήθηκε.",
          shiftDeactivated: "Η βάρδια απενεργοποιήθηκε.",
          optionalNotes: "Προαιρετικές σημειώσεις"
        };

  async function saveShiftTemplate() {
    const nextErrors = validateShiftTemplateCrudForm(form, language);

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
        await onChanged(text.shiftUpdated);
      } else {
        await databaseApi.createRecord("shift_templates", payload);
        await onChanged(text.shiftAdded);
      }

      closeForm();
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
      await onChanged(nextIsActive ? text.shiftReactivated : text.shiftDeactivated);

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
    setIsFormOpen(true);
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

  function openAddForm() {
    setErrors([]);
    setEditingShiftId(null);
    setForm(createShiftTemplateCrudForm());
    setIsFormOpen(true);
  }

  function closeForm() {
    setErrors([]);
    setEditingShiftId(null);
    setForm(createShiftTemplateCrudForm());
    setIsFormOpen(false);
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <SectionHeading
          title={text.title}
          description={text.description}
        />
        <button
          type="button"
          onClick={openAddForm}
          className={secondaryButtonClassName}
        >
          {text.addShift}
        </button>
      </div>

      {errors.length > 0 ? <ErrorList errors={errors} /> : null}

      {isFormOpen ? (
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold tracking-normal">
            {editingShiftId ? text.editShift : text.addShift}
          </h3>
          <button
            type="button"
            onClick={closeForm}
            className={secondaryButtonClassName}
          >
            {text.cancel}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_130px_130px_120px_180px_120px] gap-4">
          <Field label={text.name} required>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
              className={inputClassName}
              placeholder="Morning"
            />
          </Field>
          <Field label={text.start} required>
            <input
              type="time"
              value={form.startTime}
              onChange={(event) =>
                setForm({ ...form, startTime: event.target.value })
              }
              className={inputClassName}
            />
          </Field>
          <Field label={text.end} required>
            <input
              type="time"
              value={form.endTime}
              onChange={(event) =>
                setForm({ ...form, endTime: event.target.value })
              }
              className={inputClassName}
            />
          </Field>
          <Field label={text.overnight}>
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isOvernight}
                onChange={(event) =>
                  setForm({ ...form, isOvernight: event.target.checked })
                }
                className="h-4 w-4"
              />
              {text.yes}
            </label>
          </Field>
          <Field label={text.color}>
            <ColorSelect
              value={form.color}
              onChange={(color) => setForm({ ...form, color })}
            />
          </Field>
          <Field label={text.status}>
            <label className="flex h-10 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) =>
                  setForm({ ...form, isActive: event.target.checked })
                }
                className="h-4 w-4"
              />
              {text.active}
            </label>
          </Field>
        </div>

        <Field label={text.notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            className={`${inputClassName} mt-4 min-h-20 resize-y`}
            placeholder={text.optionalNotes}
          />
        </Field>

        <button
          type="button"
          onClick={saveShiftTemplate}
          disabled={isSaving}
          className="mt-5 rounded-md bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
        >
          {isSaving
            ? text.saving
            : editingShiftId
              ? text.saveShift
              : text.addShift}
        </button>
      </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-[1.1fr_140px_110px_1.3fr_120px_210px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>{text.template}</span>
          <span>{text.time}</span>
          <span>{text.overnight}</span>
          <span>{text.notes}</span>
          <span>{text.status}</span>
          <span>{text.actions}</span>
        </div>

        {shiftTemplates.length === 0 ? (
          <p className="px-5 py-5 text-sm text-slate-500">
            {text.noShifts}
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
                {template.is_overnight ? text.yes : text.no}
              </p>
              <p className="text-sm text-slate-600">
                {template.notes || text.noNotes}
              </p>
              <StatusBadge
                isActive={Boolean(template.is_active)}
                language={language}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => startEditing(template)}
                  className={secondaryButtonClassName}
                >
                  {text.edit}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleShiftTemplateActive(template)}
                  className={secondaryButtonClassName}
                >
                  {template.is_active ? text.deactivate : text.reactivate}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
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
  editingRoleId: string | null,
  language: UiLanguage
): string[] {
  const errors: string[] = [];
  const trimmedName = form.name.trim();

  if (!trimmedName) {
    errors.push(
      language === "en"
        ? "Role name is required."
        : "Το όνομα ρόλου είναι υποχρεωτικό."
    );
  }

  if (!form.color) {
    errors.push(
      language === "en" ? "Choose a role color." : "Επιλέξτε χρώμα ρόλου."
    );
  }

  const duplicate = existingRoles.find(
    (role) =>
      role.id !== editingRoleId &&
      role.name.trim().toLocaleLowerCase() ===
        trimmedName.toLocaleLowerCase()
  );

  if (duplicate) {
    errors.push(
      language === "en"
        ? "A role with this name already exists."
        : "Υπάρχει ήδη ρόλος με αυτό το όνομα."
    );
  }

  return errors;
}

function validateShiftTemplateCrudForm(
  form: ShiftTemplateCrudForm,
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (!form.name.trim()) {
    errors.push(
      language === "en"
        ? "Shift template name is required."
        : "Το όνομα βάρδιας είναι υποχρεωτικό."
    );
  }

  if (!form.startTime) {
    errors.push(
      language === "en"
        ? "Start time is required."
        : "Η ώρα έναρξης είναι υποχρεωτική."
    );
  }

  if (!form.endTime) {
    errors.push(
      language === "en"
        ? "End time is required."
        : "Η ώρα λήξης είναι υποχρεωτική."
    );
  }

  if (form.startTime && form.endTime && !form.isOvernight) {
    if (form.endTime <= form.startTime) {
      errors.push(
        language === "en"
          ? "End time must be after start time unless overnight is enabled."
          : "Η λήξη πρέπει να είναι μετά την έναρξη, εκτός αν η βάρδια περνάει τα μεσάνυχτα."
      );
    }
  }

  if (!form.color) {
    errors.push(
      language === "en" ? "Choose a shift color." : "Επιλέξτε χρώμα βάρδιας."
    );
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
  shiftTemplates: ShiftTemplate[],
  language: UiLanguage = "en"
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
      label:
        shiftTemplate?.name ??
        (language === "en" ? "Custom shift" : "Προσαρμοσμένη βάρδια"),
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

function employeePageText(language: UiLanguage) {
  if (language === "en") {
    return {
      title: "Employees",
      description: "Manage employees, roles, contracts and availability.",
      addEmployee: "Add employee",
      addEmployeeHint: "Create the employee first, then set availability and time off.",
      addRolesFirst: "Add roles before assigning them to employees.",
      addTimeOff: "Add time off",
      activate: "Activate",
      active: "Active",
      availability: "Availability",
      availabilityHelp: "Cannot work blocks automatic scheduling. Preferences guide the scheduler when possible.",
      availabilitySaved: "Availability saved.",
      canLeadRole: "Can lead this role",
      canWorkWeekends: "Can work weekends",
      chooseEmployeeFirst: "Choose an employee first.",
      close: "Close",
      dateFrom: "Date from",
      dateTo: "Date to",
      day: "Day",
      dayLevel: "Day-level",
      daysPerWeek: "Days / week",
      deactivate: "Deactivate",
      delete: "Delete",
      descriptionShort: "Employees",
      details: "Details",
      editEmployee: (employee: Employee | null) =>
        employee
          ? `Edit ${employee.first_name} ${employee.last_name}`
          : "Edit employee",
      editEmployeeHint: "Edit details, roles, work rules, availability and time off in one place.",
      email: "Email",
      employeeActivated: "Employee activated.",
      employeeAdded: "Employee added.",
      employeeDeactivated: "Employee deactivated.",
      employeeUpdated: "Employee updated.",
      employmentType: "Employment type",
      experience: "Experience",
      firstName: "First name",
      hoursPerDay: "Hours / day",
      hoursPerWeek: "Hours / week",
      inactive: "Inactive",
      lastName: "Last name",
      maxConsecutiveDays: "Max consecutive days",
      noEmail: "No email",
      noEmployeesFound: "No employees found.",
      noPhone: "No phone",
      noReason: "No reason",
      noRoles: "No roles are available.",
      noRolesAssigned: "No roles",
      noShiftTemplates: "Add active shift templates before setting shift availability.",
      noTimeOff: "No time off has been recorded for this employee.",
      notes: "Notes",
      phone: "Phone",
      preferredRole: "Preferred role",
      reason: "Reason",
      roleAssignments: "Role assignments",
      roles: "Roles",
      saveBeforeAvailability: "Save the employee before editing availability or time off.",
      saveEmployee: "Save employee",
      saveFailed: "Employee could not be saved.",
      saveNewEmployee: "Save new employee",
      saving: "Saving...",
      search: "Search employees",
      searchPlaceholder: "Search by name, phone, email, role or notes",
      selectEmployeePrompt: "Select an employee or add a new one to edit details, roles, contract rules and availability.",
      shift: "Shift",
      showing: (visible: number, total: number) => `Showing ${visible} of ${total}`,
      status: "Status",
      timeOff: "Time off",
      timeOffDeleted: "Time off deleted.",
      timeOffSaved: "Time off saved.",
      type: "Type",
      wholeDay: "Whole day",
      workRules: "Work rules"
    };
  }

  return {
    title: "Εργαζόμενοι",
    description: "Διαχείριση εργαζομένων, ρόλων, σύμβασης και διαθεσιμότητας.",
    addEmployee: "Προσθήκη εργαζομένου",
    addEmployeeHint: "Δημιουργήστε πρώτα τον εργαζόμενο και μετά ορίστε διαθεσιμότητα και άδειες.",
    addRolesFirst: "Προσθέστε ρόλους πριν τους αναθέσετε σε εργαζομένους.",
    addTimeOff: "Προσθήκη άδειας",
    activate: "Ενεργοποίηση",
    active: "Ενεργός",
    availability: "Διαθεσιμότητα",
    availabilityHelp: "Το Δεν μπορεί μπλοκάρει τον αυτόματο προγραμματισμό. Οι προτιμήσεις βοηθούν το πρόγραμμα όπου γίνεται.",
    availabilitySaved: "Η διαθεσιμότητα αποθηκεύτηκε.",
    canLeadRole: "Μπορεί να είναι υπεύθυνος ρόλου",
    canWorkWeekends: "Μπορεί να δουλεύει Σαββατοκύριακο",
    chooseEmployeeFirst: "Επιλέξτε πρώτα εργαζόμενο.",
    close: "Κλείσιμο",
    dateFrom: "Από",
    dateTo: "Έως",
    day: "Ημέρα",
    dayLevel: "Ημέρα",
    daysPerWeek: "Ημέρες / εβδομάδα",
    deactivate: "Απενεργοποίηση",
    delete: "Διαγραφή",
    descriptionShort: "Εργαζόμενοι",
    details: "Στοιχεία",
    editEmployee: (employee: Employee | null) =>
      employee
        ? `Επεξεργασία ${employee.first_name} ${employee.last_name}`
        : "Επεξεργασία εργαζομένου",
    editEmployeeHint: "Επεξεργαστείτε στοιχεία, ρόλους, σύμβαση, διαθεσιμότητα και άδειες σε ένα σημείο.",
    email: "Email",
    employeeActivated: "Ο εργαζόμενος ενεργοποιήθηκε.",
    employeeAdded: "Ο εργαζόμενος προστέθηκε.",
    employeeDeactivated: "Ο εργαζόμενος απενεργοποιήθηκε.",
    employeeUpdated: "Ο εργαζόμενος ενημερώθηκε.",
    employmentType: "Τύπος απασχόλησης",
    experience: "Προϋπηρεσία",
    firstName: "Όνομα",
    hoursPerDay: "Ώρες / ημέρα",
    hoursPerWeek: "Ώρες / εβδομάδα",
    inactive: "Ανενεργός",
    lastName: "Επώνυμο",
    maxConsecutiveDays: "Μέγιστες συνεχόμενες ημέρες",
    noEmail: "Χωρίς email",
    noEmployeesFound: "Δεν βρέθηκαν εργαζόμενοι.",
    noPhone: "Χωρίς τηλέφωνο",
    noReason: "Χωρίς αιτιολογία",
    noRoles: "Δεν υπάρχουν διαθέσιμοι ρόλοι.",
    noRolesAssigned: "Χωρίς ρόλους",
    noShiftTemplates: "Προσθέστε ενεργές βάρδιες πριν ορίσετε διαθεσιμότητα βάρδιας.",
    noTimeOff: "Δεν έχει καταχωρηθεί άδεια για αυτόν τον εργαζόμενο.",
    notes: "Σημειώσεις",
    phone: "Τηλέφωνο",
    preferredRole: "Προτιμώμενος ρόλος",
    reason: "Αιτιολογία",
    roleAssignments: "Ρόλοι εργαζομένου",
    roles: "Ρόλοι",
    saveBeforeAvailability: "Αποθηκεύστε τον εργαζόμενο πριν επεξεργαστείτε διαθεσιμότητα ή άδειες.",
    saveEmployee: "Αποθήκευση εργαζομένου",
    saveFailed: "Δεν ήταν δυνατή η αποθήκευση εργαζομένου.",
    saveNewEmployee: "Αποθήκευση νέου εργαζομένου",
    saving: "Αποθήκευση...",
    search: "Αναζήτηση εργαζομένων",
    searchPlaceholder: "Αναζήτηση με όνομα, τηλέφωνο, email, ρόλο ή σημειώσεις",
    selectEmployeePrompt: "Επιλέξτε εργαζόμενο ή προσθέστε νέο για να επεξεργαστείτε στοιχεία, ρόλους, σύμβαση και διαθεσιμότητα.",
    shift: "Βάρδια",
    showing: (visible: number, total: number) => `Εμφάνιση ${visible} από ${total}`,
    status: "Κατάσταση",
    timeOff: "Άδειες / Ρεπό",
    timeOffDeleted: "Η άδεια διαγράφηκε.",
    timeOffSaved: "Η άδεια αποθηκεύτηκε.",
    type: "Τύπος",
    wholeDay: "Ολόκληρη ημέρα",
    workRules: "Σύμβαση / Κανόνες εργασίας"
  };
}

function experienceOptions(language: UiLanguage): Array<{
  value: ExperienceLevel;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "no_experience", label: "No experience" },
      { value: "some_experience", label: "Experienced" }
    ];
  }

  return [
    { value: "no_experience", label: "Χωρίς προϋπηρεσία" },
    { value: "some_experience", label: "Με προϋπηρεσία" }
  ];
}

function employmentTypeSelectOptions(language: UiLanguage): Array<{
  value: EmploymentType;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "full_time", label: "Full-time" },
      { value: "part_time", label: "Part-time" },
      { value: "weekly_hours", label: "Agreed weekly hours" },
      { value: "custom", label: "Custom" }
    ];
  }

  return [
    { value: "full_time", label: "Πλήρης απασχόληση" },
    { value: "part_time", label: "Μερική απασχόληση" },
    { value: "weekly_hours", label: "Συμφωνημένες εβδομαδιαίες ώρες" },
    { value: "custom", label: "Προσαρμοσμένο" }
  ];
}

function dayConstraintSelectOptions(language: UiLanguage): Array<{
  value: DayConstraintValue;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "neutral", label: "Neutral" },
      { value: "cannot_work", label: "Cannot work" },
      { value: "prefers_not_to_work", label: "Prefers not to work" },
      { value: "prefers_to_work", label: "Prefers to work" }
    ];
  }

  return [
    { value: "neutral", label: "Ουδέτερο" },
    { value: "cannot_work", label: "Δεν μπορεί" },
    { value: "prefers_not_to_work", label: "Προτιμά να μη δουλέψει" },
    { value: "prefers_to_work", label: "Προτιμά να δουλέψει" }
  ];
}

function shiftAvailabilitySelectOptions(language: UiLanguage): Array<{
  value: ShiftAvailabilityValue;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "available", label: "Available" },
      { value: "cannot_work", label: "Cannot work" },
      { value: "prefers_not_to_work", label: "Prefers not to work" },
      { value: "prefers_to_work", label: "Prefers to work" }
    ];
  }

  return [
    { value: "available", label: "Διαθέσιμος" },
    { value: "cannot_work", label: "Δεν μπορεί" },
    { value: "prefers_not_to_work", label: "Προτιμά να μη δουλέψει" },
    { value: "prefers_to_work", label: "Προτιμά να δουλέψει" }
  ];
}

function timeOffTypeOptions(language: UiLanguage): Array<{
  value: string;
  label: string;
}> {
  if (language === "en") {
    return [
      { value: "day_off", label: "Day off" },
      { value: "vacation", label: "Vacation" },
      { value: "sick_leave", label: "Sick leave" },
      { value: "personal", label: "Personal" },
      { value: "other", label: "Other" }
    ];
  }

  return [
    { value: "day_off", label: "Ρεπό" },
    { value: "vacation", label: "Άδεια" },
    { value: "sick_leave", label: "Ασθένεια" },
    { value: "personal", label: "Προσωπικό" },
    { value: "other", label: "Άλλο" }
  ];
}

function timeOffTypeLabelLocalized(value: string, language: UiLanguage): string {
  return timeOffTypeOptions(language).find((type) => type.value === value)?.label ?? value;
}

function employeeRoleLabelsLocalized(
  roleIds: string[],
  roles: Role[],
  language: UiLanguage
): string {
  if (roleIds.length === 0) {
    return language === "en" ? "No roles" : "Χωρίς ρόλους";
  }

  return roleIds.map((roleId) => roleLabel(roleId, roles)).join(", ");
}

function workRulesSummaryLocalized(
  workRules: EmployeeWorkRules | null,
  language: UiLanguage
): string {
  if (!workRules) {
    return language === "en"
      ? "No work rules configured"
      : "Δεν έχουν οριστεί κανόνες εργασίας";
  }

  const employmentType =
    employmentTypeSelectOptions(language).find(
      (option) => option.value === normalizeEmploymentType(workRules.employment_type)
    )?.label ?? (language === "en" ? "Custom" : "Προσαρμοσμένο");
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
      ? language === "en"
        ? "no weekends"
        : "όχι Σαββατοκύριακα"
      : language === "en"
        ? "weekends ok"
        : "Σαββατοκύριακα ok";

  if (language === "en") {
    return `${employmentType}: ${days} days, ${hoursPerDay} h/day, ${hours} h/week, ${weekends}`;
  }

  return `${employmentType}: ${days} ημέρες, ${hoursPerDay} ώρες/ημέρα, ${hours} ώρες/εβδομάδα, ${weekends}`;
}

function employeeAvailabilitySummary(
  employeeId: string,
  dayConstraints: EmployeeDayConstraint[],
  shiftAvailability: EmployeeShiftAvailability[],
  language: UiLanguage
): string {
  const blockedDays = dayConstraints.filter(
    (constraint) =>
      constraint.employee_id === employeeId &&
      constraint.constraint_type === "cannot_work"
  ).length;
  const blockedShifts = shiftAvailability.filter(
    (availability) =>
      availability.employee_id === employeeId &&
      availability.availability_type === "cannot_work"
  ).length;
  const totalBlocks = blockedDays + blockedShifts;

  if (totalBlocks === 0) {
    return language === "en" ? "No hard availability blocks" : "Χωρίς σκληρούς περιορισμούς";
  }

  return language === "en"
    ? `${totalBlocks} availability block${totalBlocks === 1 ? "" : "s"}`
    : `${totalBlocks} περιορισμοί διαθεσιμότητας`;
}

function validateEmployeeFormForLanguage(
  form: EmployeeForm,
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (!form.firstName.trim()) {
    errors.push(language === "en" ? "First name is required." : "Το όνομα είναι υποχρεωτικό.");
  }

  if (!form.lastName.trim()) {
    errors.push(language === "en" ? "Last name is required." : "Το επώνυμο είναι υποχρεωτικό.");
  }

  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.push(language === "en" ? "Enter a valid email." : "Συμπληρώστε έγκυρο email.");
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
    errors.push(
      language === "en"
        ? "Days / week must be from 1 to 7."
        : "Οι ημέρες / εβδομάδα πρέπει να είναι από 1 έως 7."
    );
  }

  if (preferredHoursPerDay === null || preferredHoursPerDay <= 0) {
    errors.push(
      language === "en"
        ? "Hours / day must be a positive number."
        : "Οι ώρες / ημέρα πρέπει να είναι θετικός αριθμός."
    );
  }

  if (contractHours === null || contractHours <= 0) {
    errors.push(
      language === "en"
        ? "Hours / week must be a positive number."
        : "Οι ώρες / εβδομάδα πρέπει να είναι θετικός αριθμός."
    );
  }

  if (
    maxConsecutiveDays === null ||
    maxConsecutiveDays < 1 ||
    maxConsecutiveDays > 7
  ) {
    errors.push(
      language === "en"
        ? "Max consecutive days must be from 1 to 7."
        : "Οι μέγιστες συνεχόμενες ημέρες πρέπει να είναι από 1 έως 7."
    );
  }

  return errors;
}

function validateTimeOffFormForLanguage(
  form: TimeOffForm,
  employees: Employee[],
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (!form.employeeId || !employees.some((employee) => employee.id === form.employeeId)) {
    errors.push(language === "en" ? "Choose an employee." : "Επιλέξτε εργαζόμενο.");
  }

  if (!form.dateFrom) {
    errors.push(
      language === "en"
        ? "Date from is required."
        : "Η ημερομηνία έναρξης είναι υποχρεωτική."
    );
  }

  if (!form.dateTo) {
    errors.push(
      language === "en"
        ? "Date to is required."
        : "Η ημερομηνία λήξης είναι υποχρεωτική."
    );
  }

  if (form.dateFrom && form.dateTo && form.dateTo < form.dateFrom) {
    errors.push(
      language === "en"
        ? "Date to cannot be before date from."
        : "Η ημερομηνία λήξης δεν μπορεί να είναι πριν την ημερομηνία έναρξης."
    );
  }

  if (!timeOffTypeOptions(language).some((type) => type.value === form.type)) {
    errors.push(language === "en" ? "Choose a valid time off type." : "Επιλέξτε έγκυρο τύπο άδειας.");
  }

  return errors;
}

type EmploymentPatternPresetId = "full_time_8h" | "part_time_6h" | "part_time_4h";

const employmentPatternPresets: Array<{
  id: EmploymentPatternPresetId;
  label: string;
}> = [
  { id: "full_time_8h", label: "5x8" },
  { id: "part_time_6h", label: "5x6" },
  { id: "part_time_4h", label: "5x4" }
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

function renderPage(
  pageId: PageId,
  summary: DashboardSummary,
  actions: {
    selectedScheduleRunId: string | null;
    isLoadingDemoData: boolean;
    isResettingApp: boolean;
    onDataChanged: (message: string) => Promise<void>;
    onLoadDemoData: () => void;
    onResetLocalData: () => void;
    onProgramGenerated: (runId: string, message: string) => Promise<void>;
    onProgramDeleted: (message: string) => Promise<void>;
    onViewProgram: (runId: string) => void;
  }
) {
  const { onDataChanged } = actions;

  if (pageId === "profile") {
    return (
      <ProfilePage
        summary={summary}
        language={appLanguage(summary.businessSettings)}
        isLoadingDemoData={actions.isLoadingDemoData}
        onLoadDemoData={actions.onLoadDemoData}
        onSettingsSaved={() =>
          onDataChanged(
            appLanguage(summary.businessSettings) === "en"
              ? "Settings saved."
              : "Οι ρυθμίσεις αποθηκεύτηκαν."
          )
        }
      />
    );
  }

  if (pageId === "opening-hours") {
    return (
      <OpeningHoursPage
        openingHours={summary.openingHours}
        language={appLanguage(summary.businessSettings)}
        shiftTemplates={summary.shiftTemplates}
        staffingRequirements={summary.staffingRequirements}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "staffing-requirements") {
    return (
      <StaffingRequirementsPage
        language={appLanguage(summary.businessSettings)}
        roles={summary.roles}
        shiftTemplates={summary.shiftTemplates}
        requirements={summary.staffingRequirements}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "employees") {
    return (
      <UnifiedEmployeesPage
        language={appLanguage(summary.businessSettings)}
        employees={summary.employees}
        roles={summary.roles}
        employeeRoles={summary.employeeRoles}
        employeeWorkRules={summary.employeeWorkRules}
        employeeDayConstraints={summary.employeeDayConstraints}
        employeeShiftAvailability={summary.employeeShiftAvailability}
        shiftTemplates={summary.shiftTemplates}
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
        language={appLanguage(summary.businessSettings)}
        roles={summary.roles}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "shift-templates") {
    return (
      <ShiftTemplatesCrudPage
        language={appLanguage(summary.businessSettings)}
        shiftTemplates={summary.shiftTemplates}
        onChanged={(message) => onDataChanged(message)}
      />
    );
  }

  if (pageId === "reports") {
    const language = appLanguage(summary.businessSettings);

    return (
      <SimpleInfoPage
        title={language === "en" ? "Reports" : "Αναφορές"}
        description={
          language === "en"
            ? "Schedule PDF exports are available from Schedule View."
            : "Οι εξαγωγές PDF του προγράμματος είναι διαθέσιμες από την Προβολή προγράμματος."
        }
      />
    );
  }

  if (pageId === "backup-restore") {
    const language = appLanguage(summary.businessSettings);

    return (
      <BackupRestorePage
        language={language}
        isResetting={actions.isResettingApp}
        onResetLocalData={actions.onResetLocalData}
      />
    );
  }

  return null;
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

async function saveOpeningHours(
  openingHours: Array<OpeningHoursDraft & { notes?: string }>
): Promise<void> {
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
      notes: optionalText(day.notes ?? "")
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

function validateBusinessProfileForm(
  form: BusinessInfoDraft,
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (!form.businessName.trim()) {
    errors.push(
      language === "en"
        ? "Business name is required."
        : "Το όνομα επιχείρησης είναι υποχρεωτικό."
    );
  }

  if (form.weekStartsOn !== 0 && form.weekStartsOn !== 1) {
    errors.push(
      language === "en"
        ? "Choose a valid week start day."
        : "Επιλέξτε έγκυρη ημέρα έναρξης εβδομάδας."
    );
  }

  return errors;
}

function openingHoursToDraft(
  openingHours: OpeningHours[],
  language: UiLanguage
): OpeningHoursFormRow[] {
  const labels = localizedDayLabels(language);

  return labels.map((day) => {
    const row = openingHours.find(
      (openingHour) => openingHour.day_of_week === day.dayOfWeek
    );

    return {
      dayOfWeek: day.dayOfWeek,
      label: day.label,
      isOpen: row ? Boolean(row.is_open) : false,
      openTime: row?.open_time ?? "08:00",
      closeTime: row?.close_time ?? "17:00",
      isOvernight: Boolean(row?.is_overnight),
      notes: row?.notes ?? ""
    };
  });
}

function validateOpeningHoursForm(
  openingHours: OpeningHoursDraft[],
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  for (const day of openingHours) {
    if (!day.isOpen) {
      continue;
    }

    if (!day.openTime || !day.closeTime) {
      errors.push(
        language === "en"
          ? `${day.label}: opening and closing times are required.`
          : `${day.label}: χρειάζεται ώρα ανοίγματος και κλεισίματος.`
      );
    }
  }

  return errors;
}

function openDayCount(openingHours: OpeningHours[]): number {
  return openingHours.filter((day) => day.is_open).length;
}

