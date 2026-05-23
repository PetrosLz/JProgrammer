import type { ExperienceLevel, Role } from "../../../types";
import { Field } from "../../components/Field";
import { inputClassName } from "../../components/styles";
import { roleColors } from "../../setupData";
import type { UiLanguage } from "../../utils/localization";
import { experienceOptions } from "./employeeFormatters";
import type { EmployeeForm } from "./employeeTypes";
import { employeePageText } from "./employeeText";

export function EmployeeRolesEditor({
  language,
  roles,
  form,
  onToggleRole,
  onUpdateRoleDetail
}: {
  language: UiLanguage;
  roles: Role[];
  form: EmployeeForm;
  onToggleRole: (roleId: string, checked: boolean) => void;
  onUpdateRoleDetail: (
    roleId: string,
    detail: Partial<EmployeeForm["roleDetails"][string]>
  ) => void;
}) {
  const text = employeePageText(language);

  return (
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
                      onToggleRole(role.id, event.target.checked)
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
                          onUpdateRoleDetail(role.id, {
                            experienceLevel: event.target.value as ExperienceLevel
                          })
                        }
                        className={inputClassName}
                      >
                        {experienceOptions(language).map((option) => (
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
                          onUpdateRoleDetail(role.id, {
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
                          onUpdateRoleDetail(role.id, {
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
  );
}
