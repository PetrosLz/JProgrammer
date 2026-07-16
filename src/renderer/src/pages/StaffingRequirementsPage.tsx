import { useEffect, useMemo, useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import type { DayOfWeek, Role, ShiftTemplate, StaffingRequirement } from "../../types";
import { ConfirmActionModal } from "../components/ConfirmActionModal";
import { ErrorList } from "../components/ErrorList";
import { Field } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { inputClassName, secondaryButtonClassName } from "../components/styles";
import { dayLabels, roleColors } from "../setupData";
import { getErrorMessage } from "../utils/errors";
import type { UiLanguage } from "../utils/localization";
import { roleLabel } from "../utils/scheduleDisplay";

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

export function StaffingRequirementsPage({
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
