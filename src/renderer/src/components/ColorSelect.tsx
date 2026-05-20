import { roleColors } from "../setupData";

import { inputClassName } from "./styles";

export function ColorSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClassName}
      >
        {roleColors.map((color) => (
          <option key={color} value={color}>
            {color}
          </option>
        ))}
      </select>
      <span
        className="h-8 w-8 rounded-md border border-slate-200"
        style={{ backgroundColor: value }}
      />
    </div>
  );
}
