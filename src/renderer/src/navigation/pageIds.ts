export type PageId =
  | "profile"
  | "opening-hours"
  | "roles"
  | "shift-templates"
  | "staffing-requirements"
  | "employees"
  | "generate-schedule"
  | "schedule-view"
  | "reports"
  | "backup-restore";

export type LegacyPageId =
  | "dashboard"
  | "business-settings"
  | "employee-constraints"
  | "time-off";

export function normalizePageId(pageId: PageId | LegacyPageId | string): PageId {
  if (pageId === "dashboard" || pageId === "business-settings") {
    return "profile";
  }

  if (pageId === "employee-constraints" || pageId === "time-off") {
    return "employees";
  }

  const validPageIds: PageId[] = [
    "profile",
    "opening-hours",
    "roles",
    "shift-templates",
    "staffing-requirements",
    "employees",
    "generate-schedule",
    "schedule-view",
    "reports",
    "backup-restore"
  ];

  return validPageIds.includes(pageId as PageId)
    ? (pageId as PageId)
    : "profile";
}
