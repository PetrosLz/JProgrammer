import type { UiLanguage } from "../utils/localization";
import type { PageId } from "./pageIds";

export type NavigationGroup = {
  title: string;
  items: Array<{
    id: PageId;
    title: string;
  }>;
};

export function navigationGroups(language: UiLanguage): NavigationGroup[] {
  if (language === "en") {
    return [
      {
        title: "Setup",
        items: [
          { id: "profile", title: "Profile" },
          { id: "opening-hours", title: "Opening Hours" },
          { id: "roles", title: "Roles" },
          { id: "shift-templates", title: "Shift Templates" },
          { id: "staffing-requirements", title: "Staffing Requirements" }
        ]
      },
      {
        title: "Team",
        items: [{ id: "employees", title: "Employees" }]
      },
      {
        title: "Schedule",
        items: [
          { id: "generate-schedule", title: "Generate Program" },
          { id: "schedule-view", title: "Schedule View" }
        ]
      },
      {
        title: "Output",
        items: [{ id: "reports", title: "Reports" }]
      },
      {
        title: "Advanced",
        items: [{ id: "backup-restore", title: "Backup / Restore" }]
      }
    ];
  }

  return [
    {
      title: "Ρυθμίσεις",
      items: [
        { id: "profile", title: "Προφίλ" },
        { id: "opening-hours", title: "Ώρες λειτουργίας" },
        { id: "roles", title: "Ρόλοι" },
        { id: "shift-templates", title: "Βάρδιες" },
        { id: "staffing-requirements", title: "Ανάγκες προσωπικού" }
      ]
    },
    {
      title: "Ομάδα",
      items: [{ id: "employees", title: "Εργαζόμενοι" }]
    },
    {
      title: "Πρόγραμμα",
      items: [
        { id: "generate-schedule", title: "Δημιουργία προγράμματος" },
        { id: "schedule-view", title: "Προβολή προγράμματος" }
      ]
    },
    {
      title: "Έξοδοι",
      items: [{ id: "reports", title: "Αναφορές" }]
    },
    {
      title: "Για προχωρημένους",
      items: [{ id: "backup-restore", title: "Backup / Restore" }]
    }
  ];
}
