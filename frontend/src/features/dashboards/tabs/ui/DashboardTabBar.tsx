import { Plus, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import "./DashboardTabBar.css";
import { useAppDispatch, useAppSelector } from "../../../../hooks/reduxHooks";
import { useCommandPalette } from "../../../commandPalette/hooks";
import { PaletteSearchBox } from "../../../commandPalette/ui/PaletteSearchBox";
import { IconButton } from "../../../../shared/ui/IconButton";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { activateTab, closeTab, moveTab } from "../dashboardTabsSlice";
import { selectTabHasChanged, tabAccessibleName } from "../dashboardTabsSelectors";
import { DASHBOARD_TABPANEL_ID, TAB_CLOSE_HINT_ID, dashboardTabDomId } from "./tabDomIds";
import { useTabDrag } from "./useTabDrag";

interface TabItemProps {
  id: string;
  name: string;
  active: boolean;
  tabStop: boolean;
  dropSide: "before" | "after" | null;
  dragging: boolean;
  dragHandlers: ReturnType<ReturnType<typeof useTabDrag>["handlers"]>;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, id: string) => void;
  onFocusTab: (id: string) => void;
}

function DashboardTabItem({
  id,
  name,
  active,
  tabStop,
  dropSide,
  dragging,
  dragHandlers,
  onKeyDown,
  onFocusTab,
}: TabItemProps) {
  const dispatch = useAppDispatch();
  const changed = useAppSelector((state) => selectTabHasChanged(state, id));
  const className = [
    "dashboard-tab",
    active ? "dashboard-tab--active" : null,
    dragging ? "dashboard-tab--dragging" : null,
    dropSide ? `dashboard-tab--drop-${dropSide}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    // The wrapper is presentational: it carries the drag handlers and holds the tab and its pointer-only close
    // control as SIBLINGS, so the tablist owns tabs only (the close control is never inside the tab).
    <div role="presentation" className={className} {...dragHandlers}>
      <button
        type="button"
        role="tab"
        id={dashboardTabDomId(id)}
        className="dashboard-tab__button"
        aria-selected={active}
        aria-controls={active ? DASHBOARD_TABPANEL_ID : undefined}
        aria-label={tabAccessibleName(name, changed)}
        aria-keyshortcuts="Delete"
        aria-describedby={TAB_CLOSE_HINT_ID}
        tabIndex={tabStop ? 0 : -1}
        data-tab-id={id}
        onClick={() => dispatch(activateTab(id))}
        onFocus={() => onFocusTab(id)}
        onKeyDown={(event) => onKeyDown(event, id)}
      >
        {changed && <span className="dashboard-tab__dot" aria-hidden="true" />}
        <span className="dashboard-tab__name" aria-hidden="true">
          {name}
        </span>
      </button>
      <button
        type="button"
        className="dashboard-tab__close"
        aria-hidden="true"
        tabIndex={-1}
        title={`Close ${name}`}
        onClick={() => dispatch(closeTab(id))}
      >
        <X size={ICON_SIZE.sm} aria-hidden="true" />
      </button>
    </div>
  );
}

/** HEL-1575 D8: the open-dashboard tab strip, "+" and the "Search, jump, or ask" box. An APG deletable-tabs
 *  tablist: roving tab stop; Left/Right (wrapping), Home/End move focus; Enter/Space activate (native button);
 *  Delete/Backspace close; Alt+Shift+Left/Right reorder. Mounted by `AppShell` on the rail shell's dashboard
 *  view only. Static (no motion) until the motion foundation lands. */
export function DashboardTabBar() {
  const dispatch = useAppDispatch();
  const { open } = useCommandPalette();
  const tabs = useAppSelector((state) => state.dashboardTabs.tabs);
  const activeId = useAppSelector((state) => state.dashboardTabs.activeId);
  const dashboards = useAppSelector((state) => state.dashboards.items);
  const nameOf = (id: string) => dashboards.find((d) => d.id === id)?.name ?? "Dashboard";

  const tabIds = tabs.map((tab) => tab.id);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const drag = useTabDrag(tabIds);

  // Roving tab stop: the focused tab, else the active one, else the first.
  const tabStopId =
    (focusedId !== null && tabIds.includes(focusedId) ? focusedId : null) ??
    (activeId !== null && tabIds.includes(activeId) ? activeId : null) ??
    tabIds[0] ??
    null;

  function focusTab(id: string | undefined) {
    if (id === undefined) return;
    setFocusedId(id);
    stripRef.current?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.focus();
  }

  // A reorder or close re-renders the tab list; put focus where the user's action left it.
  useLayoutEffect(() => {
    if (pendingFocus.current !== null) {
      focusTab(pendingFocus.current);
      pendingFocus.current = null;
    }
  });

  // The active tab stays in view when the strip overflows.
  useEffect(() => {
    if (activeId === null) return;
    const el = stripRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeId)}"]`,
    );
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeId, tabs.length]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const index = tabIds.indexOf(id);
    const last = tabIds.length - 1;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const step = event.key === "ArrowRight" ? 1 : -1;
    if (horizontal && event.altKey && event.shiftKey) {
      event.preventDefault();
      const toIndex = index + step;
      if (toIndex >= 0 && toIndex <= last) {
        dispatch(moveTab({ id, toIndex }));
        pendingFocus.current = id;
      }
      return;
    }
    if (horizontal) {
      event.preventDefault();
      focusTab(tabIds[(index + step + tabIds.length) % tabIds.length]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(tabIds[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(tabIds[last]);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      pendingFocus.current = tabIds[index + 1] ?? tabIds[index - 1] ?? null;
      dispatch(closeTab(id));
    }
  }

  return (
    <div className="dashboard-tab-bar">
      <div
        ref={stripRef}
        className="dashboard-tab-bar__strip"
        role="tablist"
        aria-label="Open dashboards"
        aria-orientation="horizontal"
        // APG: when focus leaves the tablist the tab stop returns to the active tab.
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null);
        }}
      >
        {tabs.map((tab) => (
          <DashboardTabItem
            key={tab.id}
            id={tab.id}
            name={nameOf(tab.id)}
            active={tab.id === activeId}
            tabStop={tab.id === tabStopId}
            dropSide={drag.indicator?.id === tab.id ? drag.indicator.side : null}
            dragging={drag.dragId === tab.id}
            dragHandlers={drag.handlers(tab.id)}
            onKeyDown={handleKeyDown}
            onFocusTab={setFocusedId}
          />
        ))}
      </div>
      <IconButton
        icon={<Plus size={ICON_SIZE.md} />}
        aria-label="Open a dashboard in a new tab"
        title="Open a dashboard in a new tab"
        className="dashboard-tab-bar__add"
        onClick={() => open({ intent: "open-tab" })}
      />
      <span className="dashboard-tab-bar__spacer" />
      <PaletteSearchBox />
      <span id={TAB_CLOSE_HINT_ID} className="sr-only">
        Press Delete to close
      </span>
    </div>
  );
}
