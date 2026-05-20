import type { BusinessSettings } from "../../types";

export type UiLanguage = "el" | "en";

export function appLanguage(settings: BusinessSettings | null): UiLanguage {
  return settings?.language === "en" ? "en" : "el";
}
