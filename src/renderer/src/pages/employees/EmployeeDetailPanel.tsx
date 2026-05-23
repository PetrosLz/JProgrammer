import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeShiftAvailability,
  Role,
  ShiftTemplate,
  TimeOff
} from "../../../types";
import { secondaryButtonClassName } from "../../components/styles";
import type { UiLanguage } from "../../utils/localization";
import { EmployeeAvailabilityEditor } from "./EmployeeAvailabilityEditor";
import { EmployeeForm } from "./EmployeeForm";
import { EmployeeRolesEditor } from "./EmployeeRolesEditor";
import { EmployeeTimeOffEditor } from "./EmployeeTimeOffEditor";
import { EmployeeWorkRulesEditor } from "./EmployeeWorkRulesEditor";
import type {
  DayConstraintValue,
  EmployeeForm as EmployeeFormState,
  ShiftAvailabilityValue,
  TimeOffForm
} from "./employeeTypes";
import { employeePageText } from "./employeeText";

export function EmployeeDetailPanel({
  language,
  isDetailOpen,
  detailMode,
  selectedEmployee,
  form,
  roles,
  activeShiftTemplates,
  employeeDayConstraints,
  employeeShiftAvailability,
  timeOffForm,
  selectedTimeOff,
  isSaving,
  onClose,
  onFormChange,
  onToggleRole,
  onUpdateRoleDetail,
  onSaveEmployee,
  onToggleEmployeeActive,
  onSaveDayConstraint,
  onSaveShiftAvailability,
  onTimeOffFormChange,
  onSaveTimeOff,
  onRequestDeleteTimeOff
}: {
  language: UiLanguage;
  isDetailOpen: boolean;
  detailMode: "list" | "add" | "edit";
  selectedEmployee: Employee | null;
  form: EmployeeFormState;
  roles: Role[];
  activeShiftTemplates: ShiftTemplate[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  timeOffForm: TimeOffForm;
  selectedTimeOff: TimeOff[];
  isSaving: boolean;
  onClose: () => void;
  onFormChange: (form: EmployeeFormState) => void;
  onToggleRole: (roleId: string, checked: boolean) => void;
  onUpdateRoleDetail: (
    roleId: string,
    detail: Partial<EmployeeFormState["roleDetails"][string]>
  ) => void;
  onSaveEmployee: () => void;
  onToggleEmployeeActive: (employee: Employee) => void;
  onSaveDayConstraint: (
    employee: Employee,
    dayOfWeek: DayOfWeek,
    constraintType: DayConstraintValue
  ) => Promise<void>;
  onSaveShiftAvailability: (
    employee: Employee,
    dayOfWeek: DayOfWeek,
    shiftTemplateId: string,
    availabilityType: ShiftAvailabilityValue
  ) => Promise<void>;
  onTimeOffFormChange: (form: TimeOffForm) => void;
  onSaveTimeOff: () => void;
  onRequestDeleteTimeOff: (entry: TimeOff) => void;
}) {
  const text = employeePageText(language);

  return (
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
              onClick={onClose}
              className={secondaryButtonClassName}
            >
              {text.close}
            </button>
          </div>

          <div className="space-y-6 px-5 py-5">
            <EmployeeForm
              language={language}
              form={form}
              onChange={onFormChange}
            />

            <EmployeeRolesEditor
              language={language}
              roles={roles}
              form={form}
              onToggleRole={onToggleRole}
              onUpdateRoleDetail={onUpdateRoleDetail}
            />

            <EmployeeWorkRulesEditor
              language={language}
              value={form.workRules}
              onChange={(workRules) =>
                onFormChange({
                  ...form,
                  workRules
                })
              }
            />

            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
              <button
                type="button"
                onClick={onSaveEmployee}
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
                  onClick={() => onToggleEmployeeActive(selectedEmployee)}
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
                <EmployeeAvailabilityEditor
                  language={language}
                  employee={selectedEmployee}
                  shiftTemplates={activeShiftTemplates}
                  employeeDayConstraints={employeeDayConstraints}
                  employeeShiftAvailability={employeeShiftAvailability}
                  isSaving={isSaving}
                  onSaveDayConstraint={onSaveDayConstraint}
                  onSaveShiftAvailability={onSaveShiftAvailability}
                />

                <EmployeeTimeOffEditor
                  language={language}
                  timeOffForm={timeOffForm}
                  selectedTimeOff={selectedTimeOff}
                  isSaving={isSaving}
                  onTimeOffFormChange={onTimeOffFormChange}
                  onSaveTimeOff={onSaveTimeOff}
                  onRequestDeleteTimeOff={onRequestDeleteTimeOff}
                />
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
  );
}
