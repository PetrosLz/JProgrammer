import { useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import type { ShiftTemplate } from "../../types";
import { ColorSelect } from "../components/ColorSelect";
import { ErrorList } from "../components/ErrorList";
import { Field } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { StatusBadge } from "../components/StatusBadge";
import { inputClassName, secondaryButtonClassName } from "../components/styles";
import { optionalText, roleColors } from "../setupData";
import { getErrorMessage } from "../utils/errors";
import type { UiLanguage } from "../utils/localization";
import {
  formatDurationMinutes,
  formatTimeRange,
  getShiftDurationMinutes,
  isNextDayTimeRange
} from "../../services/scheduler/model/workingTime";

type ShiftTemplateCrudForm = {
  name: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  color: string;
  notes: string;
  isActive: boolean;
};

export function ShiftTemplatesCrudPage({
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
          duration: "Duration",
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
          duration: "Διάρκεια",
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

  const invalidLegacyTimeRange =
    language === "en" ? "Invalid legacy time range" : "Μη έγκυρη παλιά ώρα";
  const invalidDurationLabel = language === "en" ? "Invalid" : "Μη έγκυρη";

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
        is_overnight: isNextDayTimeRange(form.startTime, form.endTime),
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
    const nextIsActive = !template.is_active;
    if (nextIsActive && isInvalidShiftTimeRange(template.start_time, template.end_time)) {
      setErrors([
        language === "en"
          ? "Fix the start/end time before reactivating this shift."
          : "Διορθώστε την ώρα έναρξης/λήξης πριν ενεργοποιήσετε ξανά τη βάρδια."
      ]);
      return;
    }

    setIsSaving(true);

    try {
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
      isOvernight: isNextDayTimeRange(template.start_time, template.end_time),
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
          <Field label={text.duration}>
            <p className="flex h-10 items-center text-sm text-slate-600">
              {form.startTime && form.endTime && form.startTime !== form.endTime
                ? formatDurationMinutes(
                    getShiftDurationMinutes({
                      date: "2026-01-05",
                      startTime: form.startTime,
                      endTime: form.endTime
                    })
                  )
                : "-"}
            </p>
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
        <div className="grid grid-cols-[1.1fr_190px_90px_1.3fr_120px_210px] bg-slate-100 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>{text.template}</span>
          <span>{text.time}</span>
          <span>{text.duration}</span>
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
              className="grid grid-cols-[1.1fr_190px_90px_1.3fr_120px_210px] items-center gap-4 border-t border-slate-200 px-5 py-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: template.color ?? roleColors[1] }}
                />
                <div>
                  <span className="text-sm font-semibold text-slate-900">
                    {template.name}
                  </span>
                  {isInvalidShiftTimeRange(template.start_time, template.end_time) ? (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      {invalidLegacyTimeRange}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="text-sm text-slate-600">
                {safeShiftTimeLabel({
                  startTime: template.start_time,
                  endTime: template.end_time,
                  language,
                  invalidLabel: invalidDurationLabel
                })}
              </p>
              <p className="text-sm text-slate-600">
                {safeShiftDurationLabel({
                  startTime: template.start_time,
                  endTime: template.end_time,
                  invalidLabel: invalidDurationLabel
                })}
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

  if (form.isActive && form.startTime && form.endTime && form.endTime === form.startTime) {
    errors.push(
      language === "en"
        ? "Start and end time cannot be the same for an active shift."
        : "Η έναρξη και η λήξη δεν μπορούν να είναι ίδιες για μια βάρδια."
    );
  }
  if (!form.color) {
    errors.push(
      language === "en" ? "Choose a shift color." : "Επιλέξτε χρώμα βάρδιας."
    );
  }

  return errors;
}

function isInvalidShiftTimeRange(startTime: string, endTime: string): boolean {
  return startTime === endTime;
}

function safeShiftTimeLabel({
  startTime,
  endTime,
  language,
  invalidLabel
}: {
  startTime: string;
  endTime: string;
  language: "en" | "el";
  invalidLabel: string;
}): string {
  if (isInvalidShiftTimeRange(startTime, endTime)) {
    return invalidLabel;
  }

  return formatTimeRange({ startTime, endTime, language });
}

function safeShiftDurationLabel({
  startTime,
  endTime,
  invalidLabel
}: {
  startTime: string;
  endTime: string;
  invalidLabel: string;
}): string {
  if (isInvalidShiftTimeRange(startTime, endTime)) {
    return invalidLabel;
  }

  return formatDurationMinutes(
    getShiftDurationMinutes({
      date: "2026-01-05",
      startTime,
      endTime
    })
  );
}

