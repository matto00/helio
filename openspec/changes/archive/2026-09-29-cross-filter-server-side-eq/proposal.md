## Why

HEL-588's cross-filter narrows only the rows already loaded in the browser, so a cross-filtered table ranks and counts the loaded window (one page) rather than the whole Output, disagreeing with server-filtered siblings (HEL-1027, HEL-1190). HEL-1188's `eq` operator makes a server-side apply possible.

## What Changes

- The active cross-filter becomes a server-side `eq` op appended to each eligible target panel's existing filter ops (the same `controlFilterOps` array HEL-1190 threads into `composeOutputRowsFilter`), so match count and `hasMore` describe the whole filtered Output.
- Eligibility is decided from the Output's `filter-capabilities` (HEL-1188) plus today's field-mapping criterion. A panel eligible on the field mapping but whose contract disallows `eq` on the dimension keeps today's client-side loaded-rows behaviour and its truncation disclosure.
- Clearing the cross-filter re-fetches without the `eq` op; the existing `latestFetchRequestId` guard prevents a stale response from winning.
- The filtered state and its clearing are announced through the panel's existing live region.
- Unchanged: trigger flow (only `PanelInspectView` dispatches `setCrossFilter`), Redux-only persistence (owner ruling), public route allowed columns.

## Capabilities

### Modified Capabilities
- `panel-cross-filtering`: application moves from client-side loaded rows to a server-side `eq` filter (with defined fallback), plus announcement.

## Impact

Frontend only: `useCrossFilteredPanelData`, `PanelContent` (OutputPanelContent), `PanelCard`/`PanelCardBody`, `usePanelSortFilter`/`usePanelData` callers, new capabilities hook. No backend, no migration, no schema change.
