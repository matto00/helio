import type { ResourceKind } from "../../../shared/chrome/resourceNavigation";
import { titleMatchRank } from "./ranking";

/** HEL-503 design.md D7, task 3.4a — a small fixed cap, applied AFTER ranking so the best
 * matches survive, in ONE place. `rankActions` never truncates a `matchesQuery` action
 * (`ranking.ts`), and the dev DB alone carries ~85 Outputs, so an uncapped query would bury the
 * palette's own actions under hundreds of rows. */
export const SEARCH_RESULTS_PER_KIND_CAP = 5;

/**
 * One indexable item — the four kinds' shapes flattened to what the search selector actually
 * needs. Evaluator CR2 (cycle 2) — this MUST mirror `ResourceRef`'s discriminated union, not
 * carry `pipelineId` as an optional field on one flat shape: an optional `pipelineId?` on a flat
 * `SearchableItem` is exactly the shape that let `useResourceSearchActions.ts` construct an
 * Output ref via `item.pipelineId ?? ""` when the field happened to be absent — the SAME invalid
 * state (an Output with no real pipeline) `ResourceRef`'s union was chosen to make
 * unrepresentable, reintroduced one file away from where it was fixed. With the union below,
 * there is no `pipelineId` to coalesce for an output item: it is required in that arm, so a
 * caller either has a real one or the item cannot be constructed at all.
 */
export type SearchableItem =
  | { kind: "dashboard" | "source" | "pipeline"; id: string; title: string; subtitle?: string }
  | { kind: "output"; id: string; title: string; pipelineId: string; subtitle?: string };

interface RankedItem {
  item: SearchableItem;
  rank: number;
}

export interface SearchResultGroup {
  kind: ResourceKind;
  /** Ranked, capped matches for this kind — at most `SEARCH_RESULTS_PER_KIND_CAP`. */
  items: SearchableItem[];
  /** How many more matches exist beyond the cap (design.md D7 — "the group states how many more
   * exist rather than silently truncating"). `0` when the cap was not reached. */
  overflowCount: number;
}

/**
 * HEL-503 design.md D5/D7, tasks 3.1/3.4a — matches `items` against `query` (already assumed
 * non-empty; callers should skip calling this for an empty query) using the same title-prefix >
 * title-substring > title-subsequence tiering `rankActions` scores registered actions with, then
 * caps each kind at `SEARCH_RESULTS_PER_KIND_CAP`, ranked matches surviving the cut.
 */
export function searchResourceItems(
  items: readonly SearchableItem[],
  query: string,
): SearchResultGroup[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === "") return [];

  const byKind = new Map<ResourceKind, RankedItem[]>();
  for (const item of items) {
    const rank = titleMatchRank(item.title, trimmed);
    if (rank === undefined) continue;
    const bucket = byKind.get(item.kind) ?? [];
    bucket.push({ item, rank });
    byKind.set(item.kind, bucket);
  }

  const groups: SearchResultGroup[] = [];
  for (const [kind, ranked] of byKind) {
    ranked.sort((a, b) => a.rank - b.rank || a.item.title.localeCompare(b.item.title));
    const capped = ranked.slice(0, SEARCH_RESULTS_PER_KIND_CAP);
    groups.push({
      kind,
      items: capped.map((r) => r.item),
      overflowCount: Math.max(0, ranked.length - capped.length),
    });
  }
  return groups;
}
