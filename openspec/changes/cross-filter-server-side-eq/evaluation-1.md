## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 2ff73ca8fe06818f64ea213ee444dc6d52af67ea (single squashed commit over main 9d14a9a9).

### Phase 1: Spec Review — FAIL
Issues:
- Spec scenario "Cross-filter and a control target the same column ... both apply (intersection), with no override in either direction" is NOT delivered on the server path against the real backend (see Change Request 1). The backend rejects two `eq` ops on the same column (`400 {"message":"duplicate filter op 'eq' for column 'region'"}`, `OutputRowsQueryParsing.scala:76`). The executor's same-column tests run against a faked server that accepts the duplicate, so they cannot see it; evidence.md's "real-request parity" section did not exercise this case.
- All other ACs / tasks verified (see below). Task 6.1 is unticked in tasks.md (live verification) - expected, this evaluation performed it; tick after the fix cycle.
- Constraints C1-C4 honored (crossFilterEq is a separate parameter, never concatenated; lastQuery reconciliation stated in evidence.md C4).
- Only `PanelInspectView` dispatches `setCrossFilter`: confirmed (source-scan test `crossFilterTrigger.sourceScan.test.ts` passes; `PanelInspectView.tsx` is the only writer). No backend file and no public route file changed (diff touches only `frontend/**` and `openspec/**`; the sole public-adjacent frontend change is `PublicDashboardViewerPage.tsx` passing `crossFilterMode="none"`).

### Phase 2: Code Review — PASS (gates), with the Phase 1/3 defect above
Fresh gate runs (my own, in WORKTREE_PATH; `CLEAN_WORKTREE` not set):
- `npm run lint` exit 0; `npm run format:check` clean; `npm --prefix frontend run typecheck` clean.
- `npm test` (root helio-mcp): 28 suites / 271 tests pass. Frontend jest: 375 suites / 3997 tests pass, 0 failures. **No flakes observed.**
- `npm --prefix frontend run build` exit 0.
- `scripts/check-openspec-hygiene.mjs` clean; `scripts/check-tokens.mjs` OK. No `any`, `@ts-*`, `eslint-disable`, TODO/FIXME, `console.log` added in the diff.
- **Red-first reproduced independently** (C1): scratch detached worktree of main 9d14a9a9 + the final `PanelCard.crossFilterServer.test.tsx` (plus a two-line stub for the not-yet-existing `filterCapabilitiesStore` export, ts-jest diagnostics off so the file compiles against main). Result: 7 failed / 7 passed; the headline test "a cross-filtered table over a multi-page Output reports the whole-Output match count..." fails with `Expected: 50 / Received: 250`, as the executor recorded. Scratch worktree removed.
- Deviation judgments:
  - D3 candidacy by schema column type (not field-mapping type): acceptable, matches D10 and was live-verified (numeric/string server; timestamp fallback).
  - Mount replay narrower than refresh replay: acceptable and well argued (C4); mobile remount verified live (51 rows, all `east`, no unfiltered flash observed).
  - Retry-without-eq on 400 and blocked-entry invalidation: acceptable in design (D3a) BUT this is exactly the path a same-column control triggers unintentionally (Change Request 1).
  - Zero-row server result shows the generic empty state ("No data to preview." in the live app for an empty intersection): acceptable, non-blocking; banner still explains the active cross-filter.
  - `PanelCard.tsx` 787 -> 815 lines (+28): file was already far over the ~250 soft budget and crossed 400 before this change; CONTRIBUTING says propose a split in the PR description rather than add to it. Non-blocking (budgets are informational), but the PR body must carry the split proposal.

### Phase 3: UI Review — FAIL
Dev servers verified to serve THIS worktree: `readlink /proc/202941/cwd` = `.../HEL-1191/frontend` (port 6623), `readlink /proc/202713/cwd` = `.../HEL-1191/backend` (port 9530). `assert-phase.sh servers` PASS.

Test data (dev DB, dev account): I appended 247 rows to the "HEL-1189 Skeptic Orders" dataset (Output "SkepticOrders" now 250 rows, page size 200, region cardinality 5: east 51, west 50, north 49, south 50, central 50) and added a chart Output "Orders by region" + panel "Orders chart" to dashboard "HEL-1189 Skeptic Verify".

Verified live (screenshots persisted):
- Set via Inspect action "Filter dashboard by region = east" (desktop, dark): request carries `filter={"ops":[{"column":"region","op":"eq","value":"east"}]}`; table shows 51 rows (whole-Output count, not loaded-window), no Load more, live region "Filtered by region = east: 51 results.". `evidence/eval-07-dark-crossfilter-set.png` (ref /home/matt/Development/helio/.concertino/runs/HEL-1191/evidence/openspec/changes/cross-filter-server-side-eq/evidence/eval-07-dark-crossfilter-set.png).
- Clear (server path): live region "Cross-filter cleared: 250 results."; rows restored to unfiltered, Load more back.
- Light theme (real, via reload with `helio-theme=light`): same behavior, visually consistent (eval-15-desktop-light-real.png). Dark/light parity fine; this ticket adds no new visual component.
- Mobile stack (390x844): cross-filter set on desktop then viewport shrunk (remount): 51 rows, 0 non-east rows, live region "Filtered by region = east: 51 results.", banner visible (eval-12-mobile-dark-crossfilter.png). Mobile has no Inspect gesture to SET a cross-filter (pre-existing, chart click only selects).
- Fallback path (capabilities lack `eq`, `amount` after cardinality>50): cross-filter `amount = 100` sends NO eq (rows request unchanged), fetches `/filter-capabilities`, client-narrows the loaded rows and keeps the disclosure "1 of 200 loaded rows match." Confirmed unchanged prior behavior.
- Console: no errors other than the defect below.

**Defect found live (same-column control + cross-filter)**: with dashboard cross-filter `region = east` active and the panel's HEL-1190 dropdown control set to `region = west`:
- Request 1 (both eq ops) returns HTTP 400 (console error in a supported flow); the client then retries with the control op only (200) and flips the panel to client-fallback, invalidating the capabilities cache entry for that Output for the TTL (every panel on that Output loses the server path for 5 minutes as a side effect of one viewer's normal same-column selection).
- The panel shows "No data to preview." with live-region text "50 results." (the server count of the control-only fetch, not the intersection, which is 0) - an incorrect count announcement.
- With control = east (same value) the same 400 occurs and the panel lands on the fallback, so the server-side intersection promised by D2/spec never happens in any same-column combination.
Screenshot: eval-08-dark-samecolumn-400.png. Network log lines: `.../rows?...ops=[{region eq west},{region eq east}] => 400`.

Other checks: happy path, empty/fallback states, no stale flashes on clear, accessible names on controls unchanged, breakpoints 1440 / 390 render without layout breakage. Keyboard/a11y: live-region text verified for set and clear (server path). Screenshots stay under the change dir evidence folder (gitignored `*.png`, persisted copies cited above).

### Overall: FAIL

### Change Requests
1. `frontend/src/features/panels/hooks/useCrossFilterServerOps.ts` (mode derivation): when the panel's `controlFilterOps` already contain an op with the same `(column, op)` as the cross-filter's eq (i.e. an `eq` on `crossFilter.dimension`, or generally any duplicate the backend parser rejects at `OutputRowsQueryParsing.scala:76`), do not send the cross eq as a second `eq`. Choose one and document it in design.md (D2 currently claims server-side AND):
   - preferred: report `mode: "client-fallback"` deterministically for that panel (client narrows loaded rows, loaded-scope disclosure shown) WITHOUT provoking a 400 and WITHOUT invalidating the capabilities cache, so other panels/next selection keep the server path; or
   - fold both constraints into a single non-duplicate op the backend accepts (only if verified against the real backend with a request, e.g. `in` requires a `values` array - note my probe with `value: [...]` returned `op 'in' requires a 'values' array of strings`).
   Either way the empty-intersection case (west control + east cross) must announce a count consistent with what is displayed (0 / no results), not "50 results.".
2. Tests: add a test whose faked `/rows` server mirrors the backend rule (reject two ops with the same column+op with 400 "duplicate filter op") and asserts (a) no 400 is issued for a same-column control + cross combination, (b) the capabilities cache entry for the Output is NOT invalidated, (c) displayed rows and announced count agree, (d) a subsequent different-column selection still uses the server path. Verify it fails on the current code (red) before the fix.
3. Evidence: record a real-request check of the same-column case (request URL + status) in evidence.md, and update the spec scenario "Cross-filter and a control target the same column" wording if the mechanism becomes client-side for that case (intersection still applies).
4. PR-description note (no code): PanelCard.tsx is 815 lines (was 787); CONTRIBUTING requires a split proposal in the PR body.

### Non-blocking Suggestions
- On the server path with an empty result, the generic "No data to preview." replaces the table; consider an empty-table state that keeps columns (spec D2 wording) in a follow-up.
- Mobile stack has no path to set a cross-filter (pre-existing HEL-588 behavior); state in the PR body that mobile verification was via remount after desktop set.
- The name of screenshot `eval-01-desktop-light-initial.png` in the evidence dir is misleading (it is dark); eval-13/14 came from a `data-theme` attribute flip that rendered inconsistently and should be disregarded - eval-15 is the real light-theme capture.
