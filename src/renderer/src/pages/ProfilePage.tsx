import { useEffect, useMemo, useState } from "react";

import type {
  BusinessSettings,
  DayOfWeek,
  OpeningHours,
  ShiftTemplate,
  StaffingRequirement
} from "../../types";
import {
  validateBusinessInfo,
  type BusinessInfoDraft,
  type OpeningHoursDraft
} from "../setupData";
import { BusinessInfoForm } from "./SetupWizard";
import { ErrorList } from "../components/ErrorList";
import { Field } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { SummaryTile } from "../components/SummaryTile";
import { inputClassName, secondaryButtonClassName } from "../components/styles";
import type { DashboardSummary } from "../types/dashboard";
import {
  businessSettingsToForm,
  openDayCount,
  type OpeningHoursFormRow,
  openingHoursToDraft,
  saveOpeningHours,
  upsertBusinessSettings,
  validateOpeningHoursForm
} from "../utils/businessSetup";
import { getErrorMessage } from "../utils/errors";
import type { UiLanguage } from "../utils/localization";
import { formatCompactDateRange } from "../utils/scheduleDisplay";
import { formatTimeRange } from "../../services/scheduler/model/workingTime";

export function BusinessSettingsEditor({
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

export function ProfilePage({
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

export function OpeningHoursPage({
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

  function updateOpeningMode(
    dayOfWeek: DayOfWeek,
    mode: "closed" | "custom" | "24_hours"
  ) {
    updateDay(dayOfWeek, {
      isOpen: mode !== "closed",
      is24Hours: mode === "24_hours",
      isOvernight: false
    });
  }

  function modeForDay(day: OpeningHoursFormRow): "closed" | "custom" | "24_hours" {
    if (!day.isOpen) {
      return "closed";
    }

    return day.is24Hours ? "24_hours" : "custom";
  }

  function summaryForDay(day: OpeningHoursFormRow): string {
    if (!day.isOpen) {
      return language === "en" ? "Closed" : "Κλειστά";
    }

    if (day.is24Hours) {
      return language === "en" ? "Open 24 hours" : "Ανοιχτά 24 ώρες";
    }

    if (!day.openTime || !day.closeTime) {
      return "-";
    }

    return formatTimeRange({
      startTime: day.openTime,
      endTime: day.closeTime,
      language
    });
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
        <div className="grid grid-cols-[1.1fr_1.2fr_1fr_1fr_1.3fr_1.4fr] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>{language === "en" ? "Day" : "Ημέρα"}</span>
          <span>{language === "en" ? "Mode" : "Λειτουργία"}</span>
          <span>{language === "en" ? "Opens" : "Άνοιγμα"}</span>
          <span>{language === "en" ? "Closes" : "Κλείσιμο"}</span>
          <span>{language === "en" ? "Summary" : "Σύνοψη"}</span>
          <span>{language === "en" ? "Notes" : "Σημειώσεις"}</span>
        </div>

        {form.map((day) => {
          const isCustom = day.isOpen && !day.is24Hours;

          return (
            <div
              key={day.dayOfWeek}
              className="grid grid-cols-[1.1fr_1.2fr_1fr_1fr_1.3fr_1.4fr] items-center gap-4 border-t border-slate-200 px-5 py-4"
            >
              <p className="text-sm font-semibold text-slate-900">{day.label}</p>
              <select
                value={modeForDay(day)}
                onChange={(event) =>
                  updateOpeningMode(
                    day.dayOfWeek,
                    event.target.value as "closed" | "custom" | "24_hours"
                  )
                }
                className={inputClassName}
              >
                <option value="closed">
                  {language === "en" ? "Closed" : "Κλειστά"}
                </option>
                <option value="custom">
                  {language === "en" ? "Custom hours" : "Ωράριο"}
                </option>
                <option value="24_hours">
                  {language === "en" ? "Open 24 hours" : "24 ώρες"}
                </option>
              </select>
              <input
                type="time"
                value={day.openTime}
                disabled={!isCustom}
                onChange={(event) =>
                  updateDay(day.dayOfWeek, { openTime: event.target.value })
                }
                className={inputClassName}
              />
              <input
                type="time"
                value={day.closeTime}
                disabled={!isCustom}
                onChange={(event) =>
                  updateDay(day.dayOfWeek, { closeTime: event.target.value })
                }
                className={inputClassName}
              />
              <p className="text-sm font-medium text-slate-700">
                {summaryForDay(day)}
              </p>
              <input
                value={day.notes}
                onChange={(event) =>
                  updateDay(day.dayOfWeek, { notes: event.target.value })
                }
                className={inputClassName}
                placeholder={language === "en" ? "Optional" : "Προαιρετικά"}
              />
            </div>
          );
        })}
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
