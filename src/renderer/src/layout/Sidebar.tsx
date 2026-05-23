import type { NavigationGroup } from "../navigation/navigationGroups";
import type { PageId } from "../navigation/pageIds";

export function Sidebar({
  groups,
  activePageId,
  onNavigate
}: {
  groups: NavigationGroup[];
  activePageId: PageId;
  onNavigate: (pageId: PageId) => void;
}) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-5">
        <h1 className="text-xl font-semibold tracking-normal">JProgrammer</h1>
        <p className="mt-1 text-sm text-slate-500">Τοπικός προγραμματισμός</p>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {group.title}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const isActive = item.id === activePageId;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={[
                      "w-full rounded-md px-3 py-2 text-left text-sm font-medium transition",
                      isActive
                        ? "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                    ].join(" ")}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
