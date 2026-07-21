import { useState } from "react";

import {
  businessTypePresets,
  createRoleDraftsFromBusinessTypePreset,
  getBusinessTypePresetById,
  getBusinessTypePresetIdForValue,
  isRoleDraftListEffectivelyEmpty,
  type BusinessTypePresetId
} from "../businessTypePresets";
import { ColorSelect } from "../components/ColorSelect";
import { ConfirmActionModal } from "../components/ConfirmActionModal";
import { ErrorList } from "../components/ErrorList";
import { Field } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { inputClassName } from "../components/styles";
import {
  createBlankRole,
  createBlankShiftTemplate,
  roleColors,
  setupSteps,
  type BusinessInfoDraft,
  type OpeningHoursDraft,
  type RoleDraft,
  type SetupDraft,
  type ShiftTemplateDraft
} from "../setupData";
import type { UiLanguage } from "../utils/localization";
import {
  formatDurationMinutes,
  formatTimeRange,
  getShiftDurationMinutes
} from "../../services/scheduler/model/workingTime";

export function SetupWizard({
  activeStep,
  draft,
  errors,
  isSaving,
  isLoadingDemoData,
  language,
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
  language: UiLanguage;
  onBack: () => void;
  onChange: (draft: SetupDraft) => void;
  onLoadDemoData: () => void;
  onNext: () => void;
}) {
  const [pendingBusinessTypePresetId, setPendingBusinessTypePresetId] =
    useState<BusinessTypePresetId | null>(null);
  const setupStepLabels = [
    { title: "Στοιχεία", detail: "Επιχείρηση" },
    { title: "Ωράριο", detail: "Λειτουργία" },
    { title: "Ρόλοι", detail: "Ομάδα" },
    { title: "Βάρδιες", detail: "Πρότυπα" }
  ];
  const currentStep = setupStepLabels[activeStep] ?? setupStepLabels[0];

  function applyBusinessTypePresetChange(presetId: BusinessTypePresetId) {
    const preset = getBusinessTypePresetById(presetId);
    const nextBusinessInfo = {
      ...draft.businessInfo,
      businessType: preset.businessTypeValue
    };
    const nextRoles =
      preset.id === "custom"
        ? [createBlankRole()]
        : createRoleDraftsFromBusinessTypePreset(preset);

    onChange({
      ...draft,
      businessInfo: nextBusinessInfo,
      roles: nextRoles
    });
  }

  function handleBusinessTypePresetChange(presetId: BusinessTypePresetId) {
    const rolesAreEmpty = isRoleDraftListEffectivelyEmpty(draft.roles);

    if (rolesAreEmpty) {
      applyBusinessTypePresetChange(presetId);
      return;
    }

    setPendingBusinessTypePresetId(presetId);
  }

  const pendingBusinessTypePreset = pendingBusinessTypePresetId
    ? getBusinessTypePresetById(pendingBusinessTypePresetId)
    : null;

  return (
    <div className="min-h-screen bg-slate-100 px-6 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
              Πρώτη ρύθμιση
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">
              Ρύθμιση επιχείρησης
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              Λίγα βασικά στοιχεία για να ξεκινήσει το πρόγραμμα.
            </p>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-white px-4 py-3 shadow-sm lg:w-[340px]">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold tracking-normal text-slate-950">
                  Demo Cafe
                </h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Γρήγορη φόρτωση δοκιμαστικών δεδομένων.
                </p>
              </div>
              <button
                type="button"
                onClick={onLoadDemoData}
                disabled={isLoadingDemoData}
                className="whitespace-nowrap rounded-md border border-emerald-300 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingDemoData ? "Φόρτωση..." : "Φόρτωση"}
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex items-center gap-3">
              {setupSteps.map((step, index) => {
                const isActive = index === activeStep;
                const isComplete = index < activeStep;

                return (
                  <div key={step} className="flex items-center gap-3">
                    <div
                      className={[
                        "flex h-9 min-w-9 items-center justify-center rounded-full border text-sm font-semibold transition",
                        isActive
                          ? "border-emerald-700 bg-emerald-700 text-white"
                          : isComplete
                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                            : "border-slate-200 bg-white text-slate-400"
                      ].join(" ")}
                    >
                      {isComplete ? "✓" : index + 1}
                    </div>
                    {isActive ? (
                      <div className="mr-2 hidden sm:block">
                        <p className="text-sm font-semibold text-slate-950">
                          {setupStepLabels[index]?.title}
                        </p>
                        <p className="text-xs text-slate-500">
                          {setupStepLabels[index]?.detail}
                        </p>
                      </div>
                    ) : null}
                    {index < setupSteps.length - 1 ? (
                      <div className="h-px w-8 bg-slate-200 sm:w-12" />
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Βήμα {activeStep + 1} από {setupSteps.length}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-normal text-slate-950">
                  {currentStep.title}
                </h2>
              </div>
              <span className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
                Τοπική SQLite
              </span>
            </div>
          </div>

          <section className="px-6 py-6">
            {errors.length > 0 ? <ErrorList errors={errors} /> : null}

            {activeStep === 0 ? (
              <BusinessInfoForm
                value={draft.businessInfo}
                onChange={(businessInfo) => onChange({ ...draft, businessInfo })}
                onBusinessTypePresetChange={handleBusinessTypePresetChange}
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
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
      {pendingBusinessTypePreset ? (
        <ConfirmActionModal
          language={language}
          title={
            language === "en"
              ? "Change business type"
              : "Αλλαγή τύπου επιχείρησης"
          }
          body={
            language === "en"
              ? "Changing the business type may replace the suggested roles. Do you want to apply the new preset?"
              : "Η αλλαγή τύπου επιχείρησης μπορεί να αντικαταστήσει τους προτεινόμενους ρόλους. Θέλετε να εφαρμοστεί το νέο preset;"
          }
          confirmLabel={language === "en" ? "Apply" : "Εφαρμογή"}
          cancelLabel={language === "en" ? "Cancel" : "Ακύρωση"}
          variant="warning"
          isWorking={false}
          onCancel={() => setPendingBusinessTypePresetId(null)}
          onConfirm={() => {
            applyBusinessTypePresetChange(pendingBusinessTypePreset.id);
            setPendingBusinessTypePresetId(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function BusinessInfoForm({
  value,
  onChange,
  onBusinessTypePresetChange,
  language = "el",
  showLocationField = false,
  showWeekStartsOnField = false
}: {
  value: BusinessInfoDraft;
  onChange: (value: BusinessInfoDraft) => void;
  onBusinessTypePresetChange?: (presetId: BusinessTypePresetId) => void;
  language?: UiLanguage;
  showLocationField?: boolean;
  showWeekStartsOnField?: boolean;
}) {
  const selectedPresetId = getBusinessTypePresetIdForValue(value.businessType);

  return (
    <div>
      <SectionHeading
        title={language === "en" ? "Business details" : "Στοιχεία επιχείρησης"}
        description={
          language === "en"
            ? "Business name, type and app language."
            : "Όνομα, τύπος επιχείρησης και γλώσσα εφαρμογής."
        }
      />

      <div className="mt-6 grid max-w-3xl gap-4 md:grid-cols-2">
        <Field label={language === "en" ? "Business name" : "Όνομα επιχείρησης"} required>
          <input
            value={value.businessName}
            onChange={(event) =>
              onChange({ ...value, businessName: event.target.value })
            }
            className={inputClassName}
            placeholder="π.χ. My Cafe"
          />
        </Field>

        <Field label={language === "en" ? "Business type" : "Τύπος επιχείρησης"}>
          <select
            value={selectedPresetId}
            onChange={(event) => {
              const presetId = event.target.value as BusinessTypePresetId;

              if (onBusinessTypePresetChange) {
                onBusinessTypePresetChange(presetId);
                return;
              }

              onChange({
                ...value,
                businessType: getBusinessTypePresetById(presetId)
                  .businessTypeValue
              });
            }}
            className={inputClassName}
          >
            {businessTypePresets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {language === "en"
              ? "Suggests roles you can edit in the next step."
              : "Προτείνει ρόλους που μπορείτε να αλλάξετε στο επόμενο βήμα."}
          </p>
        </Field>

        {selectedPresetId === "custom" ? (
          <Field label={language === "en" ? "Custom type" : "Προσαρμοσμένος τύπος"}>
            <input
              value={value.businessType}
              onChange={(event) =>
                onChange({ ...value, businessType: event.target.value })
              }
              className={inputClassName}
              placeholder="π.χ. Bakery, Pharmacy, Salon"
            />
          </Field>
        ) : null}

        {showLocationField ? (
          <Field label={language === "en" ? "Location" : "Τοποθεσία"}>
            <input
              value={value.location}
              onChange={(event) =>
                onChange({ ...value, location: event.target.value })
              }
              className={inputClassName}
              placeholder="π.χ. Αθήνα"
            />
          </Field>
        ) : null}

        {showWeekStartsOnField ? (
          <Field label={language === "en" ? "Week starts on" : "Πρώτη ημέρα εβδομάδας"}>
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
              <option value={1}>{language === "en" ? "Monday" : "Δευτέρα"}</option>
              <option value={0}>{language === "en" ? "Sunday" : "Κυριακή"}</option>
            </select>
          </Field>
        ) : null}

        <Field label={language === "en" ? "Language" : "Γλώσσα"}>
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

  function updateMode(
    dayOfWeek: number,
    mode: "closed" | "custom" | "24_hours"
  ) {
    updateDay(dayOfWeek, {
      isOpen: mode !== "closed",
      is24Hours: mode === "24_hours",
      isOvernight: false
    });
  }

  function modeForDay(day: OpeningHoursDraft): "closed" | "custom" | "24_hours" {
    if (!day.isOpen) {
      return "closed";
    }

    return day.is24Hours ? "24_hours" : "custom";
  }

  function summaryForDay(day: OpeningHoursDraft): string {
    if (!day.isOpen) {
      return "Κλειστά";
    }

    if (day.is24Hours) {
      return "24 ώρες";
    }

    if (!day.openTime || !day.closeTime) {
      return "-";
    }

    return formatTimeRange({
      startTime: day.openTime,
      endTime: day.closeTime,
      language: "el"
    });
  }

  return (
    <div>
      <SectionHeading
        title="Ώρες λειτουργίας"
        description="Ορίστε το βασικό εβδομαδιαίο ωράριο."
      />

      <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
        <div className="grid grid-cols-[1.1fr_1.2fr_1fr_1fr_1.3fr] bg-slate-100 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Ημέρα</span>
          <span>Λειτουργία</span>
          <span>Άνοιγμα</span>
          <span>Κλείσιμο</span>
          <span>Σύνοψη</span>
        </div>

        {value.map((day) => {
          const isCustom = day.isOpen && !day.is24Hours;

          return (
            <div
              key={day.dayOfWeek}
              className="grid grid-cols-[1.1fr_1.2fr_1fr_1fr_1.3fr] items-center gap-3 border-t border-slate-200 px-4 py-3"
            >
              <span className="text-sm font-medium text-slate-800">
                {day.label}
              </span>
              <select
                value={modeForDay(day)}
                onChange={(event) =>
                  updateMode(
                    day.dayOfWeek,
                    event.target.value as "closed" | "custom" | "24_hours"
                  )
                }
                className={inputClassName}
              >
                <option value="closed">Κλειστά</option>
                <option value="custom">Ωράριο</option>
                <option value="24_hours">24 ώρες</option>
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
              <span className="text-sm font-medium text-slate-700">
                {summaryForDay(day)}
              </span>
            </div>
          );
        })}
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
        description="Επεξεργαστείτε τους προτεινόμενους ρόλους ή προσθέστε δικούς σας."
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
        description="Δημιουργήστε τις βασικές βάρδιες που χρησιμοποιείτε συχνά."
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
            <Field label="Διάρκεια">
              <p className="flex h-10 items-center text-sm text-slate-600">
                {template.startTime &&
                template.endTime &&
                template.startTime !== template.endTime
                  ? formatDurationMinutes(
                      getShiftDurationMinutes({
                        date: "2026-01-05",
                        startTime: template.startTime,
                        endTime: template.endTime
                      })
                    )
                  : "-"}
              </p>
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

