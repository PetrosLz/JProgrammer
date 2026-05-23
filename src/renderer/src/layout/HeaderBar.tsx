import type { UiLanguage } from "../utils/localization";

export function HeaderBar({
  language,
  title,
  today
}: {
  language: UiLanguage;
  title: string;
  today: string;
}) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
      <div>
        <p className="text-sm font-medium text-slate-500">{today}</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-normal">{title}</h2>
      </div>
      <span className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
        {language === "en" ? "Offline SQLite" : "Τοπική SQLite"}
      </span>
    </header>
  );
}
