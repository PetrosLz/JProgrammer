import { format } from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { databaseApi } from "../services/databaseApi";
import { loadDemoData } from "../services/demoData";
import {
  createInitialSetupDraft,
  hasAnyRoleValue,
  hasAnyShiftTemplateValue,
  optionalText,
  setupSteps,
  validateSetupStep,
  type SetupDraft,
} from "./setupData";
import { ConfirmActionModal } from "./components/ConfirmActionModal";
import { LoadingScreen } from "./components/LoadingScreen";
import { getErrorMessage } from "./utils/errors";
import { appLanguage, type UiLanguage } from "./utils/localization";
import { navigationGroups } from "./navigation/navigationGroups";
import {
  normalizePageId,
  type LegacyPageId,
  type PageId
} from "./navigation/pageIds";
import type { DashboardSummary } from "./types/dashboard";
import { useAppBoot } from "./state/useAppBoot";
import { useDashboardSummary } from "./state/useDashboardSummary";
import { setupCompletedKey } from "./state/setupConstants";
import { SetupWizard } from "./pages/SetupWizard";
import { BackupRestorePage, SimpleInfoPage } from "./pages/BackupRestorePage";
import { GenerateSchedulePage } from "./pages/GenerateSchedulePage";
import {
  OpeningHoursPage,
  ProfilePage
} from "./pages/ProfilePage";
import { RolesCrudPage } from "./pages/RolesPage";
import { ShiftTemplatesCrudPage } from "./pages/ShiftTemplatesPage";
import { StaffingRequirementsPage } from "./pages/StaffingRequirementsPage";
import { ScheduleViewPage } from "./pages/ScheduleViewPage";
import { UnifiedEmployeesPage } from "./pages/EmployeesPage";
import {
  saveOpeningHours,
  upsertBusinessSettings
} from "./utils/businessSetup";
import { AppShell } from "./layout/AppShell";

type AppConfirmAction = "load-demo" | "reset-local-data";

export function App() {
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
  const [selectedScheduleRunId, setSelectedScheduleRunId] = useState<
    string | null
  >(null);
  const { summary, refreshSummary, resetSummary } = useDashboardSummary();
  const { appState, setAppState } = useAppBoot({
    refreshSummary,
    setErrors
  });

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
      resetSummary();
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
    <>
      <AppShell
        language={language}
        activePageTitle={activePageTitle}
        today={today}
        sidebarGroups={sidebarGroups}
        activePageId={activeNavItem.id}
        notice={notice}
        onNavigate={(pageId) => {
          setNotice("");
          setActivePageId(pageId);
        }}
      >
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
      </AppShell>
      {pendingAppConfirmModal}
    </>
  );
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
