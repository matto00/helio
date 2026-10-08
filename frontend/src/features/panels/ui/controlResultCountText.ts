import { filterRecordRowsByDimension } from "../../../utils/crossFilterRows";
import type { CrossFilterMode } from "../hooks/useCrossFilterServerOps";
import type { PanelPaginationState, SelectionDescriptor } from "../types/panel";

/** The result-count text for a panel with visible controls. HEL-1191 D2a: when the cross-filter
 *  narrows this panel's loaded rows CLIENT-side (fallback), the count must be what is displayed
 *  (the narrowed count, with the loaded-scope wording when truncated), never the server's
 *  control-only total. */
function controlResultCountText(
  entry: PanelPaginationState,
  mode: CrossFilterMode,
  crossFilter: SelectionDescriptor | null,
): string {
  const plural = (n: number) => `${n} result${n === 1 ? "" : "s"}.`;
  if (mode !== "client-fallback" || !crossFilter) return plural(entry.total);
  const matched = filterRecordRowsByDimension(
    entry.rows,
    crossFilter.dimension,
    crossFilter.value,
  ).length;
  return entry.hasMore ? `${matched} of ${entry.rows.length} loaded rows match.` : plural(matched);
}

export { controlResultCountText };
