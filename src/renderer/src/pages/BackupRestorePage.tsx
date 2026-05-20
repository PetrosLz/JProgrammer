import { SectionHeading } from "../components/SectionHeading";
import type { UiLanguage } from "../utils/localization";

export function SimpleInfoPage({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-3xl">
      <SectionHeading title={title} description={description} />
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
        {description}
      </div>
    </div>
  );
}

export function BackupRestorePage({
  language,
  isResetting,
  onResetLocalData
}: {
  language: UiLanguage;
  isResetting: boolean;
  onResetLocalData: () => void;
}) {
  return (
    <div className="max-w-4xl">
      <SectionHeading
        title={
          language === "en"
            ? "Backup / Restore"
            : "Αντίγραφα ασφαλείας / Επαναφορά"
        }
        description={
          language === "en"
            ? "Local backup, restore and reset tools for the SQLite database."
            : "Τοπικά εργαλεία αντιγράφων ασφαλείας, επαναφοράς και καθαρισμού της βάσης SQLite."
        }
      />

      <div className="mt-6 rounded-lg border border-red-200 bg-white p-5">
        <h3 className="text-base font-semibold tracking-normal text-red-900">
          {language === "en"
            ? "Reset app / Clear local database"
            : "Επαναφορά εφαρμογής / Καθαρισμός τοπικής βάσης"}
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {language === "en"
            ? "This permanently deletes all local app data and returns the app to first setup. It does not delete project files."
            : "Διαγράφει οριστικά όλα τα τοπικά δεδομένα της εφαρμογής και επιστρέφει στην πρώτη ρύθμιση. Δεν διαγράφει αρχεία του project."}
        </p>
        <button
          type="button"
          onClick={onResetLocalData}
          disabled={isResetting}
          className="mt-4 rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isResetting
            ? language === "en"
              ? "Resetting..."
              : "Γίνεται επαναφορά..."
            : language === "en"
              ? "Reset app / Clear local database"
              : "Επαναφορά εφαρμογής / Καθαρισμός τοπικής βάσης"}
        </button>
      </div>
    </div>
  );
}
