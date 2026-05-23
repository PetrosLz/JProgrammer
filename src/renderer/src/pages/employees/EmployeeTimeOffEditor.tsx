import type { TimeOff } from "../../../types";
import { Field } from "../../components/Field";
import { inputClassName, secondaryButtonClassName } from "../../components/styles";
import type { UiLanguage } from "../../utils/localization";
import {
  timeOffTypeLabelLocalized,
  timeOffTypeOptions
} from "./employeeFormatters";
import type { TimeOffForm } from "./employeeTypes";
import { employeePageText } from "./employeeText";

export function EmployeeTimeOffEditor({
  language,
  timeOffForm,
  selectedTimeOff,
  isSaving,
  onTimeOffFormChange,
  onSaveTimeOff,
  onRequestDeleteTimeOff
}: {
  language: UiLanguage;
  timeOffForm: TimeOffForm;
  selectedTimeOff: TimeOff[];
  isSaving: boolean;
  onTimeOffFormChange: (form: TimeOffForm) => void;
  onSaveTimeOff: () => void;
  onRequestDeleteTimeOff: (entry: TimeOff) => void;
}) {
  const text = employeePageText(language);

  return (
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
              onTimeOffFormChange({
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
              onTimeOffFormChange({
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
              onTimeOffFormChange({
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
              onTimeOffFormChange({
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
        onClick={onSaveTimeOff}
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
            .sort((a, b) => a.start_date.localeCompare(b.start_date))
            .map((entry) => (
              <div
                key={entry.id}
                className="grid gap-3 border-t border-slate-200 px-4 py-3 text-sm first:border-t-0 md:grid-cols-[1fr_1fr_1fr_1.2fr_auto]"
              >
                <span>{entry.start_date}</span>
                <span>{entry.end_date}</span>
                <span>{timeOffTypeLabelLocalized(entry.type, language)}</span>
                <span className="text-slate-600">
                  {entry.reason || text.noReason}
                </span>
                <button
                  type="button"
                  onClick={() => onRequestDeleteTimeOff(entry)}
                  className={secondaryButtonClassName}
                >
                  {text.delete}
                </button>
              </div>
            ))
        )}
      </div>
    </section>
  );
}
