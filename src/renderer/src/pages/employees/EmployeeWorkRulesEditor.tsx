import { NumberField } from "../../components/Field";
import type { UiLanguage } from "../../utils/localization";
import { applyEmploymentPatternPreset } from "./employeeForms";
import {
  employmentPatternPresets,
  type EmployeeWorkRulesForm
} from "./employeeTypes";
import { employeePageText } from "./employeeText";

export function EmployeeWorkRulesEditor({
  language,
  value,
  onChange
}: {
  language: UiLanguage;
  value: EmployeeWorkRulesForm;
  onChange: (value: EmployeeWorkRulesForm) => void;
}) {
  const text = employeePageText(language);

  return (
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
                onChange(applyEmploymentPatternPreset(value, preset.id))
              }
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <NumberField
          label={text.maxShiftsPerWeek}
          value={value.maxShiftsPerWeek}
          onChange={(nextValue) =>
            onChange({
              ...value,
              maxShiftsPerWeek: nextValue
            })
          }
        />
        <NumberField
          label={text.maxHoursPerDay}
          value={value.maxHoursPerDay}
          onChange={(nextValue) =>
            onChange({
              ...value,
              maxHoursPerDay: nextValue
            })
          }
        />
        <NumberField
          label={text.targetHoursPerDay}
          value={value.targetHoursPerDay}
          onChange={(nextValue) =>
            onChange({
              ...value,
              targetHoursPerDay: nextValue
            })
          }
        />
        <label className="flex items-center gap-2 pt-7 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={value.canWorkWeekends}
            onChange={(event) =>
              onChange({
                ...value,
                canWorkWeekends: event.target.checked
              })
            }
            className="h-4 w-4"
          />
          {text.canWorkWeekends}
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-500">{text.workRulesHelp}</p>
    </section>
  );
}
