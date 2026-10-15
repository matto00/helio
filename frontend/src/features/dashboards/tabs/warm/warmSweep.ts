import type { RootState } from "../../../../store/store";
import { serverNowMs } from "../serverClock";
import { sweepWarm } from "./warmCache";
import { isTabWarm } from "./warmValidity";

/** Releases the retentions and in-memory lists of every dashboard that stopped being warm (expired,
 *  evicted from the warm 8, closed). Run on the minute timer and whenever the tab set changes, so a closed
 *  or evicted tab lets go at once rather than up to a minute later. */
export function sweepWarmForState(state: RootState): void {
  const { tabs, activeId } = state.dashboardTabs;
  const now = serverNowMs();
  sweepWarm((id) => isTabWarm(tabs, id, now), activeId);
}
