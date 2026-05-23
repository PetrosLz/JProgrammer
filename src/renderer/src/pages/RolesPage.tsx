import { useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import type { Role } from "../../types";
import { ColorSelect } from "../components/ColorSelect";
import { ErrorList } from "../components/ErrorList";
import { Field } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { StatusBadge } from "../components/StatusBadge";
import { inputClassName, secondaryButtonClassName } from "../components/styles";
import { optionalText, roleColors } from "../setupData";
import { getErrorMessage } from "../utils/errors";
import type { UiLanguage } from "../utils/localization";

type RoleCrudForm = {
  name: string;
  color: string;
  description: string;
  isActive: boolean;
};

export function RolesCrudPage({
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

function createRoleCrudForm(): RoleCrudForm {
  return {
    name: "",
    color: roleColors[0],
    description: "",
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
