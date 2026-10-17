import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import "./DashboardChipRow.css";
import { loadRecentHistory } from "../../commandPalette/model/recentHistoryStore";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { prefersReducedMotion } from "../../../utils/prefersReducedMotion";
import { setSelectedDashboardId } from "../state/dashboardsSlice";

/** Most chips the row ever renders (HEL-1583 D3). */
export const DASHBOARD_CHIP_CAP = 12;

/** The session's chip order (HEL-1583 D3): ids in the order the row first rendered after load, held at module
 *  scope so neither a tap nor the `PanelList` remount a `/dashboards` -> `/dashboards/<id>` navigation causes reshuffles
 *  the row. Keyed by the signed-in user so a different user never inherits it. */
let sessionOrder: { userId: string | null; ids: string[] } | null = null;

/** Test-only: forget the session order so cases do not leak ordering into each other. */
export function resetDashboardChipOrderForTests(): void {
  sessionOrder = null;
}

function snapshotOrder(dashboardIds: string[]): string[] {
  const present = new Set(dashboardIds);
  const recent = loadRecentHistory()
    .filter((entry) => entry.kind === "dashboard" && present.has(entry.id))
    .map((entry) => entry.id);
  const seen = new Set(recent);
  return [...recent, ...dashboardIds.filter((id) => !seen.has(id))];
}

/** The ids to render: the snapshot (recents first, then list order) filtered to dashboards that still exist, new
 *  dashboards appended at the end, capped; a current dashboard outside the cap takes the last slot (the one
 *  intended exception to stability). */
function chipIds(
  userId: string | null,
  dashboardIds: string[],
  currentId: string | null,
): string[] {
  if (dashboardIds.length === 0) return [];
  if (sessionOrder === null || sessionOrder.userId !== userId) {
    sessionOrder = { userId, ids: snapshotOrder(dashboardIds) };
  }
  const present = new Set(dashboardIds);
  const known = new Set(sessionOrder.ids);
  const ordered = [
    ...sessionOrder.ids.filter((id) => present.has(id)),
    ...dashboardIds.filter((id) => !known.has(id)),
  ];
  const capped = ordered.slice(0, DASHBOARD_CHIP_CAP);
  if (currentId !== null && present.has(currentId) && !capped.includes(currentId)) {
    capped[DASHBOARD_CHIP_CAP - 1] = currentId;
  }
  return capped;
}

/** Scroll the row's own `scrollLeft` so the active chip is fully visible with one gutter of breathing room. Never
 *  `scrollIntoView`, which would also scroll the page vertically. */
function revealChip(row: HTMLElement, chip: HTMLElement, smooth: boolean): void {
  const rowRect = row.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const gutter = parseFloat(getComputedStyle(row).paddingLeft) || 0;
  const left = chipRect.left - rowRect.left + row.scrollLeft;
  const right = left + chipRect.width;
  let target = row.scrollLeft;
  if (left - gutter < target) target = Math.max(0, left - gutter);
  else if (right + gutter > target + row.clientWidth) target = right + gutter - row.clientWidth;
  if (target === row.scrollLeft) return;
  if (smooth && !prefersReducedMotion() && typeof row.scrollTo === "function") {
    row.scrollTo({ left: target, behavior: "smooth" });
  } else {
    row.scrollLeft = target;
  }
}

/** Phone dashboard chip row (HEL-1583): one tap switches dashboards; the active chip is filled and scrolled into
 *  view. Mounted by `PanelList` on the phone shell only, so it exists only on the dashboard view. */
export function DashboardChipRow() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const dashboards = useAppSelector((state) => state.dashboards.items);
  const selectedId = useAppSelector((state) => state.dashboards.selectedDashboardId);
  const userId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
  const rowRef = useRef<HTMLDivElement>(null);
  const hasRevealedRef = useRef(false);

  const byId = new Map(dashboards.map((dashboard) => [dashboard.id, dashboard]));
  const ids = chipIds(
    userId,
    dashboards.map((dashboard) => dashboard.id),
    selectedId,
  );
  const idsKey = ids.join("|");

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || selectedId === null) return;
    const chip = Array.from(row.querySelectorAll<HTMLElement>("[data-dashboard-id]")).find(
      (candidate) => candidate.dataset.dashboardId === selectedId,
    );
    if (!chip) return;
    revealChip(row, chip, hasRevealedRef.current);
    hasRevealedRef.current = true;
  }, [selectedId, idsKey]);

  if (ids.length === 0) return null;

  function handleSelect(id: string) {
    dispatch(setSelectedDashboardId(id));
    const path = `/dashboards/${id}`;
    if (location.pathname !== path) navigate(path);
  }

  return (
    <div ref={rowRef} className="dashboard-chip-row" role="group" aria-label="Dashboards">
      {ids.map((id) => {
        const active = id === selectedId;
        const name = byId.get(id)?.name ?? "";
        return (
          <button
            key={id}
            type="button"
            data-dashboard-id={id}
            className={`dashboard-chip${active ? " dashboard-chip--active" : ""}`}
            aria-current={active ? "true" : undefined}
            aria-label={name}
            onClick={() => handleSelect(id)}
          >
            <span className="dashboard-chip__label">{name}</span>
          </button>
        );
      })}
    </div>
  );
}
