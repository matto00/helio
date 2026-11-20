import { createAsyncThunk } from "@reduxjs/toolkit";

import type { RootState } from "../../../store/store";
import { fetchDashboardChanges } from "./dashboardChangesService";
import { changeSignalsReceived } from "./dashboardTabsSlice";
import { setServerOffsetMs } from "./serverClock";
import { MAX_TABS } from "./tabTypes";
import { getSessionEpoch } from "../../../shared/session/sessionEpoch";

/** D7: fetch the change signals for `ids` (default: every open tab) and record the server clock offset.
 *  Only ever hits `/api/dashboard-changes`. A failure leaves the previous signals in place (the caller
 *  treats missing signals conservatively). Resolves to whether signals were received. */
export const refreshChangeSignals = createAsyncThunk<
  boolean,
  string[] | undefined,
  { state: RootState }
>("dashboardTabs/refreshChangeSignals", async (ids, { dispatch, getState }) => {
  const wanted = (ids ?? getState().dashboardTabs.tabs.map((tab) => tab.id)).slice(0, MAX_TABS);
  if (wanted.length === 0) return false;
  const startEpoch = getSessionEpoch();
  try {
    const result = await fetchDashboardChanges(wanted);
    // HEL-1634: signals fetched for a previous session never reach the next user's tabs or the shared clock.
    if (startEpoch !== getSessionEpoch()) return false;
    // Measured when the response ARRIVES (design D7): one RTT of error is the accepted trade-off.
    const serverOffsetMs = Date.parse(result.serverNow) - Date.now();
    setServerOffsetMs(serverOffsetMs);
    dispatch(changeSignalsReceived({ items: result.items, serverOffsetMs }));
    return true;
  } catch {
    return false;
  }
});
