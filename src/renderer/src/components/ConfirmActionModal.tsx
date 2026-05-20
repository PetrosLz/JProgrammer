import { useEffect } from "react";

import type { UiLanguage } from "../utils/localization";

export type ConfirmActionVariant = "danger" | "warning" | "normal";

export function ConfirmActionModal({
  language,
  title,
  body,
  confirmLabel,
  cancelLabel,
  variant,
  isWorking,
  onCancel,
  onConfirm
}: {
  language: UiLanguage;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: ConfirmActionVariant;
  isWorking: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isWorking) {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isWorking, onCancel]);

  const variantStyles = {
    danger: {
      ring: "ring-red-100",
      icon: "bg-red-50 text-red-700",
      button: "bg-red-700 hover:bg-red-800",
      symbol: "!"
    },
    warning: {
      ring: "ring-amber-100",
      icon: "bg-amber-50 text-amber-700",
      button: "bg-amber-600 hover:bg-amber-700",
      symbol: "!"
    },
    normal: {
      ring: "ring-slate-200",
      icon: "bg-slate-100 text-slate-700",
      button: "bg-emerald-700 hover:bg-emerald-800",
      symbol: "i"
    }
  }[variant];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4"
      data-language={language}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isWorking) {
          onCancel();
        }
      }}
    >
      <div
        className={`w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ${variantStyles.ring}`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-bold ${variantStyles.icon}`}
          >
            {variantStyles.symbol}
          </div>
          <div>
            <h3 className="text-lg font-semibold tracking-normal text-slate-950">
              {title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isWorking}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isWorking}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${variantStyles.button}`}
          >
            {isWorking ? `${confirmLabel}...` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeleteProgramConfirmModal({
  language,
  dateRange,
  isDeleting,
  onCancel,
  onConfirm
}: {
  language: UiLanguage;
  dateRange: string;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmActionModal
      language={language}
      title={language === "en" ? "Delete program" : "Διαγραφή προγράμματος"}
      body={
        language === "en"
          ? `Are you sure you want to delete the schedule for ${dateRange}? This action cannot be undone.`
          : `Θέλετε σίγουρα να διαγράψετε το πρόγραμμα ${dateRange}; Η ενέργεια δεν μπορεί να αναιρεθεί.`
      }
      confirmLabel={language === "en" ? "Delete" : "Διαγραφή"}
      cancelLabel={language === "en" ? "Cancel" : "Ακύρωση"}
      variant="danger"
      isWorking={isDeleting}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
