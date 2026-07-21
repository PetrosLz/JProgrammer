import { databaseApi } from "../../services/databaseApi";
import type { BusinessSettings, OpeningHours } from "../../types";
import type { BusinessInfoDraft, OpeningHoursDraft } from "../setupData";
import { optionalText } from "../setupData";
import { localizedDayLabels } from "./scheduleDisplay";
import type { UiLanguage } from "./localization";
import { isNextDayTimeRange } from "../../services/scheduler/model/workingTime";

export type OpeningHoursFormRow = OpeningHoursDraft & {
  label: string;
  notes?: string;
};

export async function upsertBusinessSettings(
  form: BusinessInfoDraft,
  existingId?: string
): Promise<void> {
  const existing =
    existingId ??
    (await databaseApi.listRecords("business_settings", { limit: 1 }))[0]?.id;

  const payload = {
    business_name: form.businessName.trim(),
    business_type: optionalText(form.businessType),
    location: optionalText(form.location),
    timezone: "Europe/Athens",
    week_starts_on: form.weekStartsOn,
    language: form.language,
    locale: form.language,
    currency: "EUR"
  };

  if (existing) {
    await databaseApi.updateRecord("business_settings", existing, payload);
    return;
  }

  await databaseApi.createRecord("business_settings", payload);
}

export async function saveOpeningHours(
  openingHours: Array<OpeningHoursDraft & { notes?: string }>
): Promise<void> {
  const existingRows = await databaseApi.listRecords("opening_hours", {
    limit: 20
  });

  for (const day of openingHours) {
    const existing = existingRows.find(
      (row) => row.day_of_week === day.dayOfWeek
    );
    const payload = {
      day_of_week: day.dayOfWeek,
      is_open: day.isOpen,
      is_24_hours: day.isOpen && day.is24Hours,
      open_time: day.isOpen && !day.is24Hours ? day.openTime : null,
      close_time: day.isOpen && !day.is24Hours ? day.closeTime : null,
      is_overnight:
        day.isOpen && !day.is24Hours
          ? isNextDayTimeRange(day.openTime, day.closeTime)
          : false,
      notes: optionalText(day.notes ?? "")
    };

    if (existing) {
      await databaseApi.updateRecord("opening_hours", existing.id, payload);
    } else {
      await databaseApi.createRecord("opening_hours", payload);
    }
  }
}

export function businessSettingsToForm(
  settings: BusinessSettings | null
): BusinessInfoDraft {
  return {
    businessName: settings?.business_name ?? "",
    businessType: settings?.business_type ?? "",
    location: settings?.location ?? "",
    weekStartsOn: settings?.week_starts_on === 0 ? 0 : 1,
    language: settings?.language === "en" ? "en" : "el"
  };
}

export function validateBusinessProfileForm(
  form: BusinessInfoDraft,
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  if (!form.businessName.trim()) {
    errors.push(
      language === "en"
        ? "Business name is required."
        : "Το όνομα επιχείρησης είναι υποχρεωτικό."
    );
  }

  if (form.weekStartsOn !== 0 && form.weekStartsOn !== 1) {
    errors.push(
      language === "en"
        ? "Choose a valid week start day."
        : "Επιλέξτε έγκυρη ημέρα έναρξης εβδομάδας."
    );
  }

  return errors;
}

export function openingHoursToDraft(
  openingHours: OpeningHours[],
  language: UiLanguage
): OpeningHoursFormRow[] {
  const labels = localizedDayLabels(language);

  return labels.map((day) => {
    const row = openingHours.find(
      (openingHour) => openingHour.day_of_week === day.dayOfWeek
    );

    return {
      dayOfWeek: day.dayOfWeek,
      label: day.label,
      isOpen: row ? Boolean(row.is_open) : false,
      is24Hours: Boolean(row?.is_24_hours),
      openTime: row?.open_time ?? "08:00",
      closeTime: row?.close_time ?? "17:00",
      isOvernight:
        row?.open_time && row?.close_time
          ? isNextDayTimeRange(row.open_time, row.close_time)
          : Boolean(row?.is_overnight),
      notes: row?.notes ?? ""
    };
  });
}

export function validateOpeningHoursForm(
  openingHours: OpeningHoursDraft[],
  language: UiLanguage
): string[] {
  const errors: string[] = [];

  for (const day of openingHours) {
    if (!day.isOpen || day.is24Hours) {
      continue;
    }

    if (!day.openTime || !day.closeTime) {
      errors.push(
        language === "en"
          ? `${day.label}: opening and closing times are required.`
          : `${day.label}: χρειάζεται ώρα ανοίγματος και κλεισίματος.`
      );
    }

    if (day.openTime && day.closeTime && day.openTime === day.closeTime) {
      errors.push(
        language === "en"
          ? `${day.label}: equal opening and closing times are only valid for 24-hour operation.`
          : `${day.label}: ίδιες ώρες ανοίγματος και κλεισίματος επιτρέπονται μόνο με 24ωρη λειτουργία.`
      );
    }
  }

  return errors;
}

export function openDayCount(openingHours: OpeningHours[]): number {
  return openingHours.filter((day) => day.is_open).length;
}
