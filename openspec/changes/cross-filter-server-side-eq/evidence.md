# HEL-1191 executor evidence (cycle 1)

## Red-first (task 1.1 / C1)
Test `PanelCard.crossFilterServer.test.tsx` > "a cross-filtered table over a multi-page Output reports the whole-Output match count and hasMore of the filtered set", written and run against current main (before any production change). Faked server: 250-row Output, page size 200, 50 rows are "Q1". Cross-filter `quarter = Q1` active, sibling table panel:

```
● PanelCard — HEL-1191 server-side cross-filter (red-first) › a cross-filtered table over a multi-page Output reports ...
    Expected: 50
    Received: 250
    > expect(entry?.total).toBe(Q1_TOTAL);
```
On main the eq never travels; `paginationState.total` stays the raw Output total (250), `hasMore` true, and the only narrowing is the client-side loaded-window one ("40 of 200 loaded rows match."). After the change the same test is green (total 50, hasMore false, rows 50, live region "Filtered by quarter = Q1: 50 results.").

## Real-request parity (task 5.4 / D10) - backend served from THIS worktree (readlink /proc/202713/cwd = .../HEL-1191/backend, frontend 202941 = .../HEL-1191/frontend; ports 9530/6623)
Output "SkepticOrders" (`amount:integer` stored 10.0, `region:string`):
- server `eq` on amount: value "10" -> 1 row, "10.0" -> 1 row, "1e1" -> 1 row, "10.5" -> 0 rows.
- client `cellMatchesValue("10", v)`: "10" true, "10.0" true, "1e1" true, "10.5" false. Numeric parity holds.
- string column: server `eq` region "east" -> 2 rows, "East" -> 0 rows; client `cellMatchesValue("east","East")` false. Exact-text on both (parity for strings too).
- timestamp columns are still listed with `eq` by the server (created_at) but the client sends none (fallback), as designed (D10).
- Live cardinality-cap 400: Output "HEL-1027 live verify table" (60 distinct revenue values): `filter-capabilities` lists revenue as `["contains","gte","lte"]` (no eq); a request with `eq` on it returns HTTP 400 `op 'eq' not valid for column 'revenue'` - exactly the rejection D3a detects.

## C4 - user sort/filter persistence vs lastQuery replay
`usePanelSortFilter`'s `activeSort`/`activeFilter` are component-local `useState`, seeded from the Output's persisted `columnSort`/`columnFilters`; `TableRenderer` only persists a user edit as the default when `canWrite` (owner). So a user's sort/column-filter does NOT survive a `PanelCardBody` remount (breakpoint change) for non-owners, and does for owners only via the Output's own default (which the corrective effect re-applies). Replaying it on a remount would desync rows from the remounted table's controls. Therefore reconciliation: a mount/remount replays only what lives OUTSIDE component state (viewer-control ops in the URL, the Redux cross-filter eq); `refresh()` (manual/poll/SSE, same live hook instance) replays the FULL last query (sort, table filter, ops, eq) - safe, because the hook state that produced `lastQuery` is still the live state. Tests: `usePanelData.crossFilter.test.tsx` ("a mount replays only the terms that outlive the component", "refresh() replays the FULL last query").

## D9a(c) - was refresh already dropping control ops / sort / filter on main?
Yes, a real pre-existing defect (by code): main's `usePanelData` dispatched `filter: controlFilterOpsKey ? {ops} : undefined` with no `sort`, and the ops-less hosts (`PanelCard`, `MobilePanelStack`) pass no ops, so mount and `refresh()` replaced the panel's server-filtered/sorted window with an unfiltered one (the table's client-side D7 masking hid it for tables). No other mechanism preserved them. `lastQuery` replay fixes it; the refresh tests fail (mutation-proved) when replay is disabled.

## Guards proven failable by mutation
- Replay disabled in `usePanelData.replayableQuery` -> 6 tests fail (mobile remount, mobile refresh, 4 in usePanelData.crossFilter).
- `PublicDashboardViewerPage` `crossFilterMode="none"` -> `"client-fallback"` -> the public isolation test fails.
- Adding a `setCrossFilter` import to `PanelCard.tsx` -> the source-scan test fails (lists PanelCard.tsx).

## Gates (fresh runs, exit codes)
- `npm run lint` exit 0; `npm run typecheck` exit 0; `npm run format:check` exit 0 ("All matched files use Prettier code style!")
- root `npx jest --maxWorkers=3`: 28 suites / 271 tests passed, exit 0
- `frontend npx jest --maxWorkers=3`: 375 suites / 3996 tests passed (before adding the final desktop-refresh test; final re-run recorded in the report), exit 0
- `npm --prefix frontend run build` exit 0
- Flakes: none observed.

## Not folded / stated
- D8 (HEL-1198 unfiltered-then-filtered chart read) untouched, as designed.
- A server-narrowed set that is empty renders the generic "No data available" panel state (same as an empty HEL-1190 control result today): with zero rows there are no columns for `TableRenderer` to draw, so D2's "the table's own empty state" is not reachable without a schema-driven empty table; reported, not changed.
- Live desktop/mobile, light/dark verification is the evaluator's job; a dev server for THIS worktree is running (ports above).

# Cycle 2 (evaluation-1.md CR1-CR4)

## Red-first for the same-(column,op) defect (CR2)
New tests in `PanelCard.crossFilterServer.test.tsx` ("same-(column,op) control + cross-filter (D2a)") use a fake `/rows` that mirrors the backend rule (rejects two ops with the same column+op with 400). Run against the cycle-1 code BEFORE the fix:
```
● ... same-(column,op) control + cross-filter (D2a) › takes the client fallback with no 400, no cache invalidation, and an announcement matching the display
    Expected: "ready"
    Received: "unavailable"      (capabilities cache invalidated by the provoked 400)
● ... › the same control value as the cross-filter also falls back (intersection = that value)
    Expected: 0
    Received: 1                  (a duplicate-op 400 was issued)
```
After the fix all 17 tests in the file pass: (a) no duplicate-op 400 (counter 0), (b) capabilities entry stays `ready`, (c) empty intersection (control Q2 + cross Q1) announces "0 results." and does not say 200/50, (d) a control on a DIFFERENT column (idx eq 5 + quarter eq Q1) still composes on the server path (1 row, both ops in one request, no 400).

## Fix (design D2a)
`useCrossFilterServerOps` derives the panel's control ops itself (same URL-held `useViewerControls` source as every host) and refuses the server path when a control `eq` already targets the dimension -> deterministic `client-fallback` (no request that can 400, no cache invalidation; the control stays a server filter, the cross-filter narrows the loaded control-filtered rows). Because the decision lives in the hook, `PanelCardBody`, `PanelCard` (overlay/Inspect) and `PanelDetailModal` all reach the same result. `PanelCard`'s control result-count text now reports the client-narrowed count on the fallback path (`N results.` / `M of L loaded rows match.`), never the server's control-only total.

## Real-request same-column check (CR3) - backend from THIS worktree (ports 9530/6623, cwd verified), Output "SkepticOrders" ab6aab08-...:
- `GET /api/outputs/ab6aab08-454d-41af-8cb9-4c003533db98/rows?filter={"ops":[{"column":"region","op":"eq","value":"west"},{"column":"region","op":"eq","value":"east"}]}` -> HTTP 400 `{"message":"duplicate filter op 'eq' for column 'region'"}`
- same URL with only `{"column":"region","op":"eq","value":"west"}` -> HTTP 200, total 50 (the control-only fetch the fallback now uses)
- `filter={"ops":[{"column":"amount","op":"gte","value":"10"},{"column":"region","op":"eq","value":"east"}]}&limit=200` -> HTTP 200, total 51 (different (column,op) pairs compose server-side)

## Not changed / stated
- Detail-modal and fullscreen-overlay control-count live regions still announce `rawRows.length` (pre-existing HEL-1190 wording); on the fallback path they are not narrowed by the cross-filter. Left as a follow-up candidate.
- Task 6.1 left unticked: I did no browser verification this cycle (the evaluator did it in cycle 1); mobile verification was via remount after a desktop set (mobile has no Inspect gesture to set a cross-filter - pre-existing HEL-588).

## PR-body note: PanelCard.tsx split proposal (CR4)
`frontend/src/features/panels/ui/PanelCard.tsx` is now ~830 lines (787 on main; it was already far over the ~250-line budget). Proposal for a follow-up, not done here to keep this change focused: (1) move `PanelCardBody` (+ its `controlResultCountText` helper and the sort/filter/cross-filter wiring) to `PanelCardBody.tsx`; (2) move the header/footer chrome of `PanelCard` to `PanelCardChrome.tsx`; (3) extract the "ops for this panel" bundle (`useViewerControls` + `buildViewerControlFilterOps` + `useCrossFilterServerOps` + announcement) into one `usePanelQueryOps` hook shared by `PanelCardBody`, `PanelDetailModal` and the overlay path. Also note in the PR body: high-cardinality dimensions (>50 distinct) always take the client fallback; the red-first test uses a low-cardinality dimension.
