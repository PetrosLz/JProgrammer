import type { ReactNode } from "react";

import type { NavigationGroup } from "../navigation/navigationGroups";
import type { PageId } from "../navigation/pageIds";
import type { UiLanguage } from "../utils/localization";
import { HeaderBar } from "./HeaderBar";
import { NoticeBanner } from "./NoticeBanner";
import { Sidebar } from "./Sidebar";

export function AppShell({
  language,
  activePageTitle,
  today,
  sidebarGroups,
  activePageId,
  notice,
  children,
  onNavigate
}: {
  language: UiLanguage;
  activePageTitle: string;
  today: string;
  sidebarGroups: NavigationGroup[];
  activePageId: PageId;
  notice: string;
  children: ReactNode;
  onNavigate: (pageId: PageId) => void;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-950">
      <Sidebar
        groups={sidebarGroups}
        activePageId={activePageId}
        onNavigate={onNavigate}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <HeaderBar language={language} title={activePageTitle} today={today} />

        <section className="flex-1 px-8 py-8">
          <NoticeBanner notice={notice} />
          {children}
        </section>
      </main>
    </div>
  );
}
