import { format } from "date-fns";
import { useMemo, useState } from "react";

type Page = {
  id: string;
  title: string;
  description: string;
};

const pages: Page[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    description: "Overview placeholder for scheduling status and quick actions."
  },
  {
    id: "business-settings",
    title: "Business Settings",
    description: "Placeholder for company profile, location, and planning defaults."
  },
  {
    id: "opening-hours",
    title: "Opening Hours",
    description: "Placeholder for weekly operating hours and closed days."
  },
  {
    id: "roles",
    title: "Roles",
    description: "Placeholder for job roles and required skills."
  },
  {
    id: "shift-templates",
    title: "Shift Templates",
    description: "Placeholder for reusable shift patterns."
  },
  {
    id: "staffing-requirements",
    title: "Staffing Requirements",
    description: "Placeholder for coverage rules by day, time, and role."
  },
  {
    id: "employees",
    title: "Employees",
    description: "Placeholder for employee records and availability basics."
  },
  {
    id: "employee-constraints",
    title: "Employee Constraints",
    description: "Placeholder for scheduling limits and preferences."
  },
  {
    id: "time-off",
    title: "Time Off",
    description: "Placeholder for leave requests and approved absences."
  },
  {
    id: "generate-schedule",
    title: "Generate Schedule",
    description: "Placeholder for future schedule generation controls."
  },
  {
    id: "schedule-view",
    title: "Schedule View",
    description: "Placeholder for reviewing and editing generated schedules."
  },
  {
    id: "reports",
    title: "Reports",
    description: "Placeholder for labor summaries and schedule reports."
  },
  {
    id: "backup-restore",
    title: "Backup / Restore",
    description: "Placeholder for local backup and restore workflows."
  }
];

export function App() {
  const [activePageId, setActivePageId] = useState(pages[0].id);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const today = useMemo(() => format(new Date(), "EEEE, MMMM d, yyyy"), []);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-950">
      <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-5">
          <h1 className="text-xl font-semibold tracking-normal">JProgrammer</h1>
          <p className="mt-1 text-sm text-slate-500">Local schedule planner</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {pages.map((page) => {
            const isActive = page.id === activePage.id;

            return (
              <button
                key={page.id}
                type="button"
                onClick={() => setActivePageId(page.id)}
                className={[
                  "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition",
                  isActive
                    ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                ].join(" ")}
              >
                {page.title}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
          <div>
            <p className="text-sm font-medium text-slate-500">{today}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-normal">
              {activePage.title}
            </h2>
          </div>
          <span className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600">
            Offline desktop app
          </span>
        </header>

        <section className="flex-1 px-8 py-8">
          <div className="max-w-3xl">
            <p className="text-base leading-7 text-slate-600">
              {activePage.description}
            </p>

            <div className="mt-8 rounded-lg border border-dashed border-slate-300 bg-white p-6">
              <h3 className="text-base font-semibold tracking-normal">
                Phase 1 placeholder
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                This screen is reserved for the next implementation phase. No
                scheduling logic, database schema, authentication, server, or
                cloud behavior has been added.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
