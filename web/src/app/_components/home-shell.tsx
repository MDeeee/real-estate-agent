"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

type Tab = "chat" | "search";

interface HomeTabs {
  showSearch: () => void;
}

const HomeTabsContext = createContext<HomeTabs>({ showSearch: () => {} });

export function useHomeTabs(): HomeTabs {
  return useContext(HomeTabsContext);
}

const TABS: { id: Tab; label: string }[] = [
  { id: "chat", label: "Ask AI" },
  { id: "search", label: "Search" },
];

/**
 * Landing page layout. From `lg` the chat sits in a sticky left column next to
 * the filter search; below it the two are tabs, "Ask AI" first. Both panels
 * stay mounted so switching tabs keeps the conversation.
 */
export function HomeShell({
  chat,
  search,
}: {
  chat: ReactNode;
  search: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("chat");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    chat: null,
    search: null,
  });
  const showSearch = useCallback(() => setTab("search"), []);
  const context = useMemo(() => ({ showSearch }), [showSearch]);

  // WAI-ARIA tabs with automatic activation: arrows, Home and End move focus
  // to a tab and select it; only the selected tab is in the Tab order.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const current = TABS.findIndex(({ id }) => id === tab);
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (current + 1) % TABS.length;
        break;
      case "ArrowLeft":
        next = (current - 1 + TABS.length) % TABS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = TABS[next];
    if (!target) return;
    setTab(target.id);
    tabRefs.current[target.id]?.focus();
  };

  return (
    <HomeTabsContext.Provider value={context}>
      <div
        role="tablist"
        aria-label="Choose how to find a property"
        className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-surface p-1 lg:hidden"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            ref={(element) => {
              tabRefs.current[id] = element;
            }}
            type="button"
            role="tab"
            id={`home-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`home-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={onTabKeyDown}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === id
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:bg-border/40 hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div
          role="tabpanel"
          id="home-panel-chat"
          aria-labelledby="home-tab-chat"
          className={`${tab === "chat" ? "block" : "hidden"} min-w-0 lg:block`}
        >
          {chat}
        </div>
        <div
          role="tabpanel"
          id="home-panel-search"
          aria-labelledby="home-tab-search"
          className={`${tab === "search" ? "flex" : "hidden"} min-w-0 flex-col gap-6 lg:flex`}
        >
          {search}
        </div>
      </div>
    </HomeTabsContext.Provider>
  );
}
