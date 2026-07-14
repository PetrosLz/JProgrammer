import { useEffect, useMemo, useState } from "react";

import { databaseApi } from "../../../services/databaseApi";
import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  Role,
  ShiftTemplate,
  TimeOff
} from "../../../types";
import { ConfirmActionModal } from "../../components/ConfirmActionModal";
import { ErrorList } from "../../components/ErrorList";
import { SectionHeading } from "../../components/SectionHeading";
import { optionalText } from "../../setupData";
import { getErrorMessage } from "../../utils/errors";
import type { UiLanguage } from "../../utils/localization";
import {
  type DayConstraintValue,
  type EmployeeForm,
  type ShiftAvailabilityValue,
  type TimeOffForm
} from "./employeeTypes";
import { employeePageText } from "./employeeText";
import {
  createEmployeeForm,
  createTimeOffForm,
  employeeToForm
} from "./employeeForms";
import {
  syncEmployeeRoleAssignments,
  upsertEmployeeWorkRules
} from "./employeePersistence";
import {
  validateEmployeeFormForLanguage,
  validateTimeOffFormForLanguage
} from "./employeeValidation";
import { EmployeeDetailPanel } from "./EmployeeDetailPanel";
import { EmployeeList } from "./EmployeeList";
import { employeeRoleLabelsLocalized } from "./employeeFormatters";

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
    let createdEmployeeId: string | null = null;

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

      if (detailMode !== "edit") {
        createdEmployeeId = employee.id;
      }

      await syncEmployeeRoleAssignments(employee.id, form, employeeRoles);
      await upsertEmployeeWorkRules(employee.id, form.workRules, employeeWorkRules);
      setDetailMode("edit");
      setEditingEmployeeId(employee.id);
      await onChanged(detailMode === "edit" ? text.employeeUpdated : text.employeeAdded);
    } catch (error) {
      if (createdEmployeeId) {
        try {
          await databaseApi.deleteRecord("employees", createdEmployeeId);
        } catch {
          // Keep the original validation/database error visible to the manager.
        }
      }
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
        <EmployeeList
          language={language}
          employees={employees}
          filteredEmployees={filteredEmployees}
          employeeRoles={employeeRoles}
          employeeWorkRules={employeeWorkRules}
          employeeDayConstraints={employeeDayConstraints}
          employeeShiftAvailability={employeeShiftAvailability}
          roles={roles}
          searchTerm={searchTerm}
          selectedEmployeeId={editingEmployeeId}
          onSearchTermChange={setSearchTerm}
          onAddEmployee={startAddingEmployee}
          onSelectEmployee={startEditingEmployee}
        />

        <EmployeeDetailPanel
          language={language}
          isDetailOpen={isDetailOpen}
          detailMode={detailMode}
          selectedEmployee={selectedEmployee}
          form={form}
          roles={roles}
          activeShiftTemplates={activeShiftTemplates}
          employeeDayConstraints={employeeDayConstraints}
          employeeShiftAvailability={employeeShiftAvailability}
          timeOffForm={timeOffForm}
          selectedTimeOff={selectedTimeOff}
          isSaving={isSaving}
          onClose={closeDetail}
          onFormChange={setForm}
          onToggleRole={toggleRole}
          onUpdateRoleDetail={updateRoleDetail}
          onSaveEmployee={saveEmployee}
          onToggleEmployeeActive={(employee) => void toggleEmployeeActive(employee)}
          onSaveDayConstraint={saveDayConstraint}
          onSaveShiftAvailability={saveShiftAvailability}
          onTimeOffFormChange={setTimeOffForm}
          onSaveTimeOff={() => void saveTimeOff()}
          onRequestDeleteTimeOff={setTimeOffPendingDelete}
        />
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
