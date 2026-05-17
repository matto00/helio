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

/** Mark the cached row pagination stale for every panel bound to the given
 *  DataType id. The slice's reducer handles this action by deleting matching
 *  `paginationState[panelId]` entries so `usePanelData`'s next effect tick
 *  refetches `/api/types/:id/rows`. Dispatched from `PipelineDetailPage` on
 *  SSE `succeeded` for the pipeline's `outputDataTypeId` (HEL-242). */
export const markDataTypeRowsStale = createAction<string>("panels/markDataTypeRowsStale");
