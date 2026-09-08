import { createElement, useEffect, useMemo, useState } from "react";
import { Database, LayoutDashboard, Table2, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { useAppSelector } from "../../hooks/reduxHooks";
import type { ResourceKind, ResourceRef } from "../../shared/chrome/resourceNavigation";
import { useResourceNavigator } from "../../shared/chrome/resourceNavigation";
import { useCommandQuery } from "./hooks";
import { SEARCH_SECTION } from "./model/builtInActions";
import { searchResourceItems, type SearchableItem } from "./model/resourceSearch";
import type { CommandAction } from "./model/types";
import { useIndexStatuses, type IndexStatuses } from "./useResourceIndexing";

const KIND_ICON: Record<ResourceKind, LucideIcon> = {
  dashboard: LayoutDashboard,
  source: Database,
  pipeline: Workflow,
  output: Table2,
};

const KIND_LABEL: Record<ResourceKind, string> = {
  dashboard: "dashboards",
  source: "sources",
  pipeline: "pipelines",
  output: "outputs",
};

const SEARCH_KINDS: readonly ResourceKind[] = ["dashboard", "source", "pipeline", "output"];

/** design.md D6, task 3.5 — debounce the MATCHING, not the input's own state (`CommandPalette`'s
 * `TextField` stays bound to `query`/`setQuery` unchanged, so typing is never blocked) or the
 * render. `debouncedQuery` only updates `DEBOUNCE_MS` after the last keystroke, and each render's
 * `useEffect` cleanup clears the PREVIOUS pending timeout before scheduling a new one — so a
 * fast typist collapses N keystrokes into exactly one scheduled match, and a slower/earlier
 * timeout can never fire after a newer one already did (it never fires at all; it's cleared).
 * That is also what rules out the "stale match overwrites a newer one" hazard: there is only
 * ever at most one pending timeout in flight per render cycle. */
const DEBOUNCE_MS = 150;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Evaluator CR2 (cycle 2) — `item.pipelineId` is REQUIRED on `SearchableItem`'s output arm now
 * (`resourceSearch.ts`), so there is nothing to coalesce here: this is a straight narrowing
 * `switch`, not a runtime guard papering over a possibly-missing field. `ResourceRef`'s own
 * `switch` (`resourceNavigation.ts`) is value-returning, so TypeScript enforces exhaustiveness
 * automatically here too — an unhandled `item.kind` fails typecheck with "not all code paths
 * return a value", same mechanism as `hrefFor`.
 */
function buildRef(item: SearchableItem): ResourceRef {
  switch (item.kind) {
    case "output":
      return { kind: "output", id: item.id, pipelineId: item.pipelineId };
    case "dashboard":
    case "source":
    case "pipeline":
      return { kind: item.kind, id: item.id };
  }
}

/**
 * HEL-503 design.md D4, task 4 — a human-readable coverage caveat computed from LIVE per-kind
 * status, never a hardcoded list: adding a kind to the index automatically adds it here, and a
 * kind whose fetch fails automatically drops out of the "covered" clause instead of silently
 * disappearing (`loading` and `failed` read differently — a failed kind says so explicitly
 * rather than reading as if it were simply never searched). `null` means full coverage — no
 * caveat at all (task 4.3).
 */
export function buildCoverageMessage(statuses: IndexStatuses): string | null {
  const covered: string[] = [];
  const loading: string[] = [];
  const failed: string[] = [];
  for (const kind of SEARCH_KINDS) {
    const status = statuses[kind];
    if (status === "succeeded") covered.push(KIND_LABEL[kind]);
    else if (status === "failed") failed.push(KIND_LABEL[kind]);
    else loading.push(KIND_LABEL[kind]);
  }
  if (loading.length === 0 && failed.length === 0) return null;

  const parts: string[] = [
    `Search currently covers ${covered.length > 0 ? covered.join(", ") : "nothing yet"}.`,
  ];
  if (loading.length > 0) parts.push(`Still loading: ${loading.join(", ")}.`);
  if (failed.length > 0) parts.push(`Could not be searched: ${failed.join(", ")}.`);
  return parts.join(" ");
}

export interface ResourceSearchResult {
  actions: CommandAction[];
  /** design.md D4 — `null` when every kind is `succeeded` (task 4.3: full coverage shows no
   * caveat at all). */
  coverageMessage: string | null;
  /** design.md D2/task 4.4 — true while any kind has not yet resolved (`idle`/`loading`), so
   * the caller can say "still searching" instead of "no results" for a query that currently
   * matches nothing only because indexing hasn't finished. */
  isIndexing: boolean;
  /**
   * Skeptic-final-1 CR2 (final gate, round 1) — design.md D7's "how many more exist" statement,
   * kept OUT of `actions` entirely. It was previously modeled as a `CommandAction` with a no-op
   * `run`, which rendered as a real `<button role="option">` reachable by arrow keys: selecting
   * it closed the palette, cleared the query, and navigated nowhere — the exact
   * "appears to work and goes nowhere" pattern this ticket's own premise corrections cite as the
   * reason `connector` was excluded from scope. An informational count is not an action and must
   * not be constructible as one; `CommandPalette.tsx` renders these as plain, non-interactive
   * text, never as an option.
   */
  overflowNotices: string[];
}

/**
 * HEL-503 design.md D1/D5 — builds the palette's resource-search results. Deliberately NOT
 * registered via `useCommandActions` (mirrors `useRecentPaletteActions`'s own rationale):
 * results depend on the live query, which the shared registry has no access to, so this is
 * computed at the call site and merged into `CommandPalette`'s action list only for a non-empty
 * query — `searchResourceItems` itself returns `[]` for an empty query, so these actions never
 * leak into the always-shown default list the way a registered `matchesQuery` action would.
 */
export function useResourceSearchActions(): ResourceSearchResult {
  const query = useCommandQuery();
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const navigateToResource = useResourceNavigator();
  const statuses = useIndexStatuses();

  const dashboards = useAppSelector((state) => state.dashboards.items);
  const sources = useAppSelector((state) => state.sources.items);
  const pipelines = useAppSelector((state) => state.pipelines.items);
  const outputs = useAppSelector((state) => state.outputs.allItems);

  return useMemo(() => {
    const pipelineNameById = new Map(pipelines.map((p) => [p.id, p.name]));
    const items: SearchableItem[] = [
      ...dashboards.map((d) => ({ kind: "dashboard" as const, id: d.id, title: d.name })),
      ...sources.map((s) => ({ kind: "source" as const, id: s.id, title: s.name })),
      ...pipelines.map((p) => ({ kind: "pipeline" as const, id: p.id, title: p.name })),
      ...outputs.map((o) => ({
        kind: "output" as const,
        id: o.id,
        title: o.name,
        pipelineId: o.pipelineId,
        subtitle: pipelineNameById.get(o.pipelineId),
      })),
    ];

    const groups = searchResourceItems(items, debouncedQuery);
    const actions: CommandAction[] = [];
    const overflowNotices: string[] = [];
    for (const group of groups) {
      const Icon = KIND_ICON[group.kind];
      for (const item of group.items) {
        const ref = buildRef(item);
        actions.push({
          id: `search.${item.kind}.${item.id}`,
          title: item.title,
          subtitle: item.subtitle,
          section: SEARCH_SECTION,
          icon: createElement(Icon),
          matchesQuery: true,
          run: () => navigateToResource(ref),
        });
      }
      if (group.overflowCount > 0) {
        // design.md D7 — states how many more exist rather than silently truncating.
        // Skeptic-final-1 CR2 — deliberately NOT a `CommandAction`: see `overflowNotices`'s own
        // doc on `ResourceSearchResult` for why an informational count must never be
        // constructible as a selectable option.
        overflowNotices.push(
          `+${group.overflowCount} more ${KIND_LABEL[group.kind]} match — refine your search`,
        );
      }
    }

    const isIndexing = SEARCH_KINDS.some(
      (kind) => statuses[kind] === "idle" || statuses[kind] === "loading",
    );

    return {
      actions,
      coverageMessage: buildCoverageMessage(statuses),
      isIndexing,
      overflowNotices,
    };
  }, [debouncedQuery, dashboards, sources, pipelines, outputs, statuses, navigateToResource]);
}
