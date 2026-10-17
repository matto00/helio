import type { Dashboard } from "../../dashboards/types/dashboard";

export const SHELF_SIZE = 4;

/** The shelf's up-to-four dashboards: those showing the changed dot first, then by last update, newest first
 *  (owner answer `four-changed-first`). Pure; never mutates `dashboards`. */
export function shelfOrder(
  dashboards: readonly Dashboard[],
  changedIds: ReadonlySet<string>,
  limit: number = SHELF_SIZE,
): Dashboard[] {
  return [...dashboards]
    .sort((a, b) => {
      const changed = Number(changedIds.has(b.id)) - Number(changedIds.has(a.id));
      if (changed !== 0) return changed;
      return Date.parse(b.meta.lastUpdated) - Date.parse(a.meta.lastUpdated);
    })
    .slice(0, limit);
}
