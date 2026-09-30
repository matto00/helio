import { useState } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";
import type { CrossFilterEq, PanelPaginationState } from "../types/panel";

const resultCountText = (n: number) => `${n} result${n === 1 ? "" : "s"}.`;

/** HEL-1191 design.md D7 — the live-region text announcing a SERVER-applied cross-filter and its
 *  clearing (`""` when there is nothing to announce). Only a panel the filter actually applies to
 *  (`crossFilterEq !== null`) announces the filtered state; the origin and unaffected panels stay
 *  silent. Announced only once the fetch reflecting the change has SETTLED: never from a loading
 *  state, and never from the stale window left between a mode flip and the refetch's dispatch —
 *  `lastQuery.crossFilterEq` names which query the settled window belongs to. */
export function useCrossFilterAnnouncement(
  crossFilterEq: CrossFilterEq | null,
  paginationEntry: PanelPaginationState | undefined,
): string {
  const activeCrossFilter = useAppSelector((state) => state.panels.crossFilter ?? null);
  const serverFilterActive = crossFilterEq !== null;
  const [wasServerFilterActive, setWasServerFilterActive] = useState(false);
  const [cleared, setCleared] = useState(false);
  if (serverFilterActive !== wasServerFilterActive) {
    // "Adjusting state when a prop changes" (react.dev), as `usePanelSortFilter` does. A mode
    // flip caused by anything OTHER than the filter being cleared (a capability rejection) is
    // not announced as a clearing.
    setWasServerFilterActive(serverFilterActive);
    setCleared(!serverFilterActive && activeCrossFilter === null);
  }

  if (!paginationEntry || paginationEntry.isLoadingMore) return "";
  const settledEq = paginationEntry.lastQuery?.crossFilterEq ?? null;
  if (crossFilterEq !== null) {
    return settledEq?.column === crossFilterEq.column && settledEq.value === crossFilterEq.value
      ? `Filtered by ${crossFilterEq.column} = ${crossFilterEq.value}: ${resultCountText(paginationEntry.total)}`
      : "";
  }
  return cleared && settledEq === null
    ? `Cross-filter cleared: ${resultCountText(paginationEntry.total)}`
    : "";
}
