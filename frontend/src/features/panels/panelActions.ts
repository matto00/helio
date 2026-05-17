// Plain action creators used by panel thunks.
//
// `markDashboardPanelsStale` is referenced from inside `createPanel` and
// `deletePanel` thunks (to invalidate the cached panel list). Keeping the
// action creator here — instead of pulling it out of `panelsSlice.actions`
// — avoids a cyclic import between the slice and the thunks file.

import { createAction } from "@reduxjs/toolkit";

/** Mark the cached panel list stale for the given dashboard. The slice's
 *  reducer handles this action by clearing `loadedDashboardId` so the next
 *  `fetchPanels` call refetches. */
export const markDashboardPanelsStale = createAction<string>("panels/markDashboardPanelsStale");
