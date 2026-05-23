import type {
  Employee,
  EmployeeDayConstraint,
  EmployeeRole,
  EmployeeShiftAvailability,
  EmployeeWorkRules,
  Role
} from "../../../types";
import { Field } from "../../components/Field";
import { LocalizedStatusBadge } from "../../components/StatusBadge";
import { inputClassName } from "../../components/styles";
import type { UiLanguage } from "../../utils/localization";
import {
  employeeAvailabilitySummary,
  employeeRoleLabelsLocalized,
  workRulesSummaryLocalized
} from "./employeeFormatters";
import { employeePageText } from "./employeeText";

export function EmployeeList({
  language,
  employees,
  filteredEmployees,
  employeeRoles,
  employeeWorkRules,
  employeeDayConstraints,
  employeeShiftAvailability,
  roles,
  searchTerm,
  selectedEmployeeId,
  onSearchTermChange,
  onAddEmployee,
  onSelectEmployee
}: {
  language: UiLanguage;
  employees: Employee[];
  filteredEmployees: Employee[];
  employeeRoles: EmployeeRole[];
  employeeWorkRules: EmployeeWorkRules[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  roles: Role[];
  searchTerm: string;
  selectedEmployeeId: string | null;
  onSearchTermChange: (value: string) => void;
  onAddEmployee: () => void;
  onSelectEmployee: (employee: Employee) => void;
}) {
  const text = employeePageText(language);

  return (
    <div className="min-w-0">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Field label={text.search}>
            <input
              value={searchTerm}
              onChange={(event) => onSearchTermChange(event.target.value)}
              className={`${inputClassName} w-full min-w-[260px]`}
              placeholder={text.searchPlaceholder}
            />
          </Field>
          <button
            type="button"
            onClick={onAddEmployee}
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
              .filter((employeeRole) => employeeRole.employee_id === employee.id)
              .map((employeeRole) => employeeRole.role_id);
            const rules =
              employeeWorkRules.find(
                (workRules) => workRules.employee_id === employee.id
              ) ?? null;
            const isSelected = employee.id === selectedEmployeeId;

            return (
              <button
                key={employee.id}
                type="button"
                onClick={() => onSelectEmployee(employee)}
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
  );
}
