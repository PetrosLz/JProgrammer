import type { DayOfWeek } from "../types";

export type Language = "el" | "en";
export type WeekStartsOn = 0 | 1;

export type BusinessInfoDraft = {
  businessName: string;
  businessType: string;
  location: string;
  weekStartsOn: WeekStartsOn;
  language: Language;
};

export type OpeningHoursDraft = {
  dayOfWeek: DayOfWeek;
  label: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
  isOvernight: boolean;
};

export type RoleDraft = {
  name: string;
  color: string;
  description: string;
};

export type ShiftTemplateDraft = {
  name: string;
  startTime: string;
  endTime: string;
  isOvernight: boolean;
  color: string;
  notes: string;
};

export type SetupDraft = {
  businessInfo: BusinessInfoDraft;
  openingHours: OpeningHoursDraft[];
  roles: RoleDraft[];
  shiftTemplates: ShiftTemplateDraft[];
};

export const setupSteps = [
  "Business info",
  "Opening hours",
  "Custom roles",
  "Shift templates"
] as const;

export const dayLabels: Array<{ dayOfWeek: DayOfWeek; label: string }> = [
  { dayOfWeek: 1, label: "Δευτέρα" },
  { dayOfWeek: 2, label: "Τρίτη" },
  { dayOfWeek: 3, label: "Τετάρτη" },
  { dayOfWeek: 4, label: "Πέμπτη" },
  { dayOfWeek: 5, label: "Παρασκευή" },
  { dayOfWeek: 6, label: "Σάββατο" },
  { dayOfWeek: 0, label: "Κυριακή" }
];

export const roleColors = [
  "#0f766e",
  "#2563eb",
  "#9333ea",
  "#dc2626",
  "#ca8a04",
  "#475569",
  "#0891b2",
  "#16a34a",
  "#ea580c",
  "#7c3aed",
  "#be123c",
  "#0369a1",
  "#65a30d",
  "#c2410c",
  "#4f46e5",
  "#0d9488",
  "#a21caf",
  "#b45309",
  "#15803d",
  "#334155"
];

export function createInitialSetupDraft(): SetupDraft {
  return {
    businessInfo: {
      businessName: "",
      businessType: "",
      location: "",
      weekStartsOn: 1,
      language: "el"
    },
    openingHours: dayLabels.map(({ dayOfWeek, label }) => ({
      dayOfWeek,
      label,
      isOpen: dayOfWeek !== 0,
      openTime: "09:00",
      closeTime: "17:00",
      isOvernight: false
    })),
    roles: [createBlankRole()],
    shiftTemplates: [createBlankShiftTemplate()]
  };
}

export function createBlankRole(): RoleDraft {
  return {
    name: "",
    color: roleColors[0],
    description: ""
  };
}

export function createBlankShiftTemplate(): ShiftTemplateDraft {
  return {
    name: "",
    startTime: "09:00",
    endTime: "17:00",
    isOvernight: false,
    color: roleColors[1],
    notes: ""
  };
}

export function validateSetupStep(
  stepIndex: number,
  draft: SetupDraft
): string[] {
  if (stepIndex === 0) {
    return validateBusinessInfo(draft.businessInfo);
  }

  if (stepIndex === 1) {
    return validateOpeningHours(draft.openingHours);
  }

  if (stepIndex === 2) {
    return validateRoles(draft.roles);
  }

  if (stepIndex === 3) {
    return validateShiftTemplates(draft.shiftTemplates);
  }

  return [];
}

export function validateBusinessInfo(info: BusinessInfoDraft): string[] {
  const errors: string[] = [];

  if (!info.businessName.trim()) {
    errors.push("Το όνομα επιχείρησης είναι υποχρεωτικό.");
  }

  if (!["el", "en"].includes(info.language)) {
    errors.push("Επιλέξτε γλώσσα.");
  }

  return errors;
}

export function validateOpeningHours(openingHours: OpeningHoursDraft[]): string[] {
  const errors: string[] = [];

  for (const day of openingHours) {
    if (!day.isOpen) {
      continue;
    }

    if (!day.openTime || !day.closeTime) {
      errors.push(`${day.label}: συμπληρώστε ώρα ανοίγματος και κλεισίματος.`);
      continue;
    }

    if (!day.isOvernight && day.closeTime <= day.openTime) {
      errors.push(`${day.label}: η ώρα κλεισίματος πρέπει να είναι μετά το άνοιγμα.`);
    }
  }

  return errors;
}

export function validateRoles(roles: RoleDraft[]): string[] {
  const activeRoles = roles.filter((role) => hasAnyRoleValue(role));
  const errors: string[] = [];
  const names = new Set<string>();

  for (const role of activeRoles) {
    const name = role.name.trim();

    if (!name) {
      errors.push("Κάθε ρόλος που προσθέτετε χρειάζεται όνομα.");
      continue;
    }

    const key = name.toLocaleLowerCase();
    if (names.has(key)) {
      errors.push(`Ο ρόλος "${name}" υπάρχει ήδη στη λίστα.`);
    }

    names.add(key);
  }

  return errors;
}

export function validateShiftTemplates(
  shiftTemplates: ShiftTemplateDraft[]
): string[] {
  const activeTemplates = shiftTemplates.filter((template) =>
    hasAnyShiftTemplateValue(template)
  );
  const errors: string[] = [];

  for (const template of activeTemplates) {
    if (!template.name.trim()) {
      errors.push("Κάθε βάρδια που προσθέτετε χρειάζεται όνομα.");
    }

    if (!template.startTime || !template.endTime) {
      errors.push("Κάθε βάρδια χρειάζεται ώρα έναρξης και λήξης.");
      continue;
    }

    if (!template.isOvernight && template.endTime <= template.startTime) {
      errors.push(
        `Η βάρδια "${template.name || "χωρίς όνομα"}" πρέπει να τελειώνει μετά την έναρξη.`
      );
    }
  }

  return errors;
}

export function hasAnyRoleValue(role: RoleDraft): boolean {
  return Boolean(role.name.trim() || role.description.trim());
}

export function hasAnyShiftTemplateValue(
  template: ShiftTemplateDraft
): boolean {
  return Boolean(template.name.trim() || template.notes.trim());
}

export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
