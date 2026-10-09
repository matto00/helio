## Standing Constraints

- [C1] Scope is rows-plus-output-meta (owner ruling 2026-10-08 via concertino answer, chat): serve rows from Redux on remount AND give useOutputMeta a shared cache with in-flight dedupe, invalidated on Output writes.
- [C2] No change to the backend rate limiter (RateLimitDirective/InMemoryRateLimiter/config) in any form.
- [C3] Burst proof counts ALL /api requests (not just /rows) across N desktop<->phone crossings in the RUNNING app, before and after the fix; state the StrictMode dev-doubling and the production expectation explicitly.
- [C4] Staleness is tested explicitly: an Output edit (config patch / kind change) and a pipeline re-run must still show fresh metadata and rows after a remount.
- [C5] Do not absorb HEL-1418 (live-resize e2e processed-width waits; DesktopPanelGrid.tsx split).
- [C6] Design-gate round 5 notes are binding: N1 the ownershipSkippedKey early return precedes (and its entry-present clear uses the render-captured entry, never store.getState()); N2 an ownership skip never leaves inFlightRef stuck — refresh() dispatches after the owned request settles or fails (jest check); N3 the parent records the request id it waited on and surfaces lastError for that request regardless of origin.

## 1. Red first and investigation

- [x] 1.1 Write the jest red-first test counting rows + metadata requests across a 768px container crossing (design
      Verification 1, with the persisted-default table and URL-control fixtures); run it on the unmodified tree and
      record the red output.
- [x] 1.2 Write the Playwright burst spec (Verification 4); run it against the unmodified tree and record baseline totals.
- [x] 1.3 Investigate the cold-load double row fetch (design D6); record root cause in `files-modified.md` notes.
- [x] 1.4 Mechanically enumerate every client write path with the D4 `httpClient` grep, classify every hit, record it.

## 2. Implementation

- [x] 2.1 Freshness module (D1): generation, invalidate\*, retain/release refcount with `REMOUNT_GRACE_MS`, test reset.
      Cards retain/release their Output on mount/unmount.
- [x] 2.2 Pagination state: `generation` read at request start and returned in the fulfilled payload (no `origin`); `lastFetchOk`/`lastError` (with request id) on
      page-0 pending/fulfilled/rejected exactly as D2 states.
- [x] 2.2a `normalize`/`isReusable`/`isPendingFor` helpers; `usePanelSortFilter`'s correction effect sets the card's
      `mountOwnership` token and skips on reusable/pending, reading live store state.
- [x] 2.2b `usePanelData` options arg `{ mountOwnership }` (passed only by `PanelCard`/`MobileStackPanelBody`); first
      mount decision only: skip when the token is set and record `ownershipSkippedKey` so StrictMode's re-run of the
      same mount also returns early (cleared on refresh/key change/entry present); otherwise live-state reusable/pending skip on
      its existing stripped query; prevFetchKey/inFlightRef bookkeeping; scoped `lastError` surfacing (D2).
- [x] 2.3 Shared metadata cache (`state/outputMetaCache.ts`, used by `useOutputMeta`) with in-flight merge, no caching of failures (D3).
- [x] 2.4 Wire invalidation into every enumerated write path, the SSE fan-out, and logout (D4).
- [x] 2.4a Keep `lastObservedRunIdByPipeline` across `closeEntry` so a reconnect after an unobserved run notifies;
      expose `hasRunBaseline` and gate row reuse on it (D5).
- [x] 2.5 Cold-load fix if same root cause (D6), else note as follow-up.

## 3. Verification

- [x] 3.1 Jest red-first test green; ordering test (Verification 2) and staleness tests (Verification 3) green, each
      with a recorded red-turning mutation.
- [x] 3.2 Playwright burst spec after-fix totals recorded next to the baseline, with StrictMode and production
      expectation stated (C3).
- [x] 3.3 Live staleness check in the running app (Output config edit + pipeline re-run, then cross) (C4).
- [x] 3.4 Visual check in the running app, both themes, desktop and phone width.
- [x] 3.5 `npm run lint`, `npm run typecheck`, `npm test`, format check all green; throwaway dev-DB residue removed by
      exact id.
