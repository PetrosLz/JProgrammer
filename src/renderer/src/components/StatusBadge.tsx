import type { UiLanguage } from "../utils/localization";

export function StatusBadge({
  isActive,
  language
}: {
  isActive: boolean;
  language: UiLanguage;
}) {
  return (
    <span
      className={[
        "inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold",
        isActive
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
          : "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
      ].join(" ")}
    >
      {isActive
        ? language === "en"
          ? "Active"
          : "Ενεργός"
        : language === "en"
          ? "Inactive"
          : "Ανενεργός"}
    </span>
  );
}

export const LocalizedStatusBadge = StatusBadge;
