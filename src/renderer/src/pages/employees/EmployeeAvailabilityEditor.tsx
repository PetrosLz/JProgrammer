import type {
  DayOfWeek,
  Employee,
  EmployeeDayConstraint,
  EmployeeShiftAvailability,
  ShiftTemplate
} from "../../../types";
import { inputClassName } from "../../components/styles";
import type { UiLanguage } from "../../utils/localization";
import { localizedDayLabels } from "../../utils/scheduleDisplay";
import {
  dayConstraintSelectOptions,
  dayConstraintValue,
  shiftAvailabilityClassName,
  shiftAvailabilitySelectOptions,
  shiftAvailabilityValue
} from "./employeeFormatters";
import type {
  DayConstraintValue,
  ShiftAvailabilityValue
} from "./employeeTypes";
import { employeePageText } from "./employeeText";

export function EmployeeAvailabilityEditor({
  language,
  employee,
  shiftTemplates,
  employeeDayConstraints,
  employeeShiftAvailability,
  isSaving,
  onSaveDayConstraint,
  onSaveShiftAvailability
}: {
  language: UiLanguage;
  employee: Employee;
  shiftTemplates: ShiftTemplate[];
  employeeDayConstraints: EmployeeDayConstraint[];
  employeeShiftAvailability: EmployeeShiftAvailability[];
  isSaving: boolean;
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
}) {
  const text = employeePageText(language);
  const dayOptions = localizedDayLabels(language);

  return (
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
              employee.id,
              day.dayOfWeek,
              employeeDayConstraints
            );

            return (
              <select
                key={day.dayOfWeek}
                value={value}
                onChange={(event) =>
                  void onSaveDayConstraint(
                    employee,
                    day.dayOfWeek,
                    event.target.value as DayConstraintValue
                  )
                }
                disabled={isSaving}
                className={`${inputClassName} ${shiftAvailabilityClassName(value === "neutral" ? "available" : value)}`}
              >
                {dayConstraintSelectOptions(language).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
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
              shiftTemplates.length
            )}, minmax(150px, 1fr))`
          }}
        >
          <span>{text.day}</span>
          {shiftTemplates.length === 0 ? (
            <span>{text.shift}</span>
          ) : (
            shiftTemplates.map((shiftTemplate) => (
              <span key={shiftTemplate.id} className="whitespace-nowrap">
                {shiftTemplate.name}
              </span>
            ))
          )}
        </div>

        {shiftTemplates.length === 0 ? (
          <p className="px-4 py-5 text-sm text-slate-500">
            {text.noShiftTemplates}
          </p>
        ) : (
          dayOptions.map((day) => (
            <div
              key={day.dayOfWeek}
              className="grid min-w-[920px] items-center gap-3 border-t border-slate-200 px-4 py-3"
              style={{
                gridTemplateColumns: `150px repeat(${shiftTemplates.length}, minmax(150px, 1fr))`
              }}
            >
              <p className="text-sm font-semibold text-slate-900">
                {day.label}
              </p>
              {shiftTemplates.map((shiftTemplate) => {
                const value = shiftAvailabilityValue(
                  employee.id,
                  day.dayOfWeek,
                  shiftTemplate.id,
                  employeeShiftAvailability
                );

                return (
                  <select
                    key={shiftTemplate.id}
                    value={value}
                    onChange={(event) =>
                      void onSaveShiftAvailability(
                        employee,
                        day.dayOfWeek,
                        shiftTemplate.id,
                        event.target.value as ShiftAvailabilityValue
                      )
                    }
                    disabled={isSaving}
                    className={`${inputClassName} ${shiftAvailabilityClassName(
                      value
                    )}`}
                  >
                    {shiftAvailabilitySelectOptions(language).map((option) => (
                      <option key={option.value} value={option.value}>
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
  );
}
