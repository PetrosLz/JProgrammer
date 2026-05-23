import { Field } from "../../components/Field";
import { inputClassName } from "../../components/styles";
import type { UiLanguage } from "../../utils/localization";
import type { EmployeeForm as EmployeeFormState } from "./employeeTypes";
import { employeePageText } from "./employeeText";

export function EmployeeForm({
  language,
  form,
  onChange
}: {
  language: UiLanguage;
  form: EmployeeFormState;
  onChange: (form: EmployeeFormState) => void;
}) {
  const text = employeePageText(language);

  return (
    <section>
      <h4 className="text-sm font-semibold text-slate-800">
        {text.details}
      </h4>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label={text.firstName} required>
          <input
            value={form.firstName}
            onChange={(event) =>
              onChange({ ...form, firstName: event.target.value })
            }
            className={inputClassName}
          />
        </Field>
        <Field label={text.lastName} required>
          <input
            value={form.lastName}
            onChange={(event) =>
              onChange({ ...form, lastName: event.target.value })
            }
            className={inputClassName}
          />
        </Field>
        <Field label={text.phone}>
          <input
            value={form.phone}
            onChange={(event) =>
              onChange({ ...form, phone: event.target.value })
            }
            className={inputClassName}
          />
        </Field>
        <Field label={text.email}>
          <input
            type="email"
            value={form.email}
            onChange={(event) =>
              onChange({ ...form, email: event.target.value })
            }
            className={inputClassName}
          />
        </Field>
        <Field label={text.notes}>
          <input
            value={form.notes}
            onChange={(event) =>
              onChange({ ...form, notes: event.target.value })
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
                onChange({ ...form, isActive: event.target.checked })
              }
              className="h-4 w-4"
            />
            {form.isActive ? text.active : text.inactive}
          </label>
        </Field>
      </div>
    </section>
  );
}
