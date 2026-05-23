import { useEffect, useMemo, useState } from "react";

import { databaseApi } from "../../services/databaseApi";
import {
  experienceLevelToLegacySkillLevel,
  normalizeExperienceLevel,
  skillLevelToExperienceLevel
} from "../../types";
import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  EmploymentType,
  ExperienceLevel,
  Role,
  ShiftTemplate,
  TimeOff
} from "../../types";
import { ConfirmActionModal } from "../components/ConfirmActionModal";
import { ErrorList } from "../components/ErrorList";
import { Field, NumberField } from "../components/Field";
import { SectionHeading } from "../components/SectionHeading";
import { LocalizedStatusBadge, StatusBadge } from "../components/StatusBadge";
import { inputClassName, secondaryButtonClassName } from "../components/styles";
import { dayLabels, optionalText, roleColors } from "../setupData";
import { getErrorMessage } from "../utils/errors";
import type { UiLanguage } from "../utils/localization";
import { localizedDayLabels, roleLabel } from "../utils/scheduleDisplay";

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

export function UnifiedEmployeesPage({
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
