## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Tree reviewed: HEAD 27b4a7402e0135322c2fcac1aeba16540ddce0a4 (= main). The change dir is untracked, so I read the artifacts from disk.

### What I verified (with evidence)

**Round-1 CR2 (proposal vs D4 contradiction): resolved.**
- proposal.md "What Changes" now scopes "ids, titles, kinds and bound Output ids only" to the assistant's search, context and detail.
- It states that MCP `get_dashboard` returns what the app's panel list returns to the same grantee.
- D4 says the same and names `config.controls` column names explicitly.
- The round-1 non-blocking notes were also absorbed. The `snapshotId = id` mapping is stated. The REST `deleteInternal` OwnerOnlyDelete is in D3. The `authorizeEditorOnDashboard` signature change is named with its 3 call sites. The 200-cap regression and the name-based `accessRole` filter are noted in D4.

**Round-1 CR1 (Output-route proof): partly resolved.**
- D5 item 6 adds viewer and editor cases on `helio_app_test` with an owner positive control.
- D6 adds m9, and Risks states the BYPASSRLS divergence and accepts it.
- There are three defects in how this landed (see Change Requests).

**Claims checked against the tree:**
- **RLS-only gate on the plain Output reads: confirmed.** `OutputRepository.findById` (`OutputRepository.scala:144-145`) is a plain `withUserContext` select. The following all funnel through it with no app-level check, so m9 genuinely turns these red:
  - `OutputService.findById`, `rows`, `listPanels`, `assertionStatus`, `filterCapabilities`, `distinctValues` (`OutputService.scala:212,309,333,353,363,367`)
  - `OutputHistoryService.read` and `payloadRows` (`OutputHistoryService.scala:52-64`)
  - `ProvenanceService.forUser` (`ProvenanceRoutes.scala:15-17`)
- **`/insight` is NOT RLS-only.**
  - `OutputInsightReadService.read` goes through `InsightAccess.resolve` (`InsightAccess.scala:16-23`). That calls `findById` and then `accessChecker.requireAccess("pipeline", ...)`.
  - `AccessCheckerImpl.requireAccess` (`AccessCheckerImpl.scala:51-80`) is an app-level owner check plus a `findGrant` lookup. A dashboard-only grantee gets `NotFound` even on a BYPASSRLS pool.
  - A non-`insight` Output is `NotFound` for every caller, including the owner.
- **Viewer and owner refusal sites exist where D3 says.**
  - `PatchSetApplyResolvers.scala:127,159,204`
  - `DashboardService.scala:156` (deleteInternal, which also covers a viewer delete), `:217`, `:269`
  - `DashboardContentsService.scala:148`
  - `AutoLayoutService.scala:164`
  - `PanelService.scala:148,225,282,320`
  - D3 delegates the enumeration and requires it to be listed. That is acceptable.
- **List record carries `accessRole`.** `GET /api/dashboards?include=shared` returns it (`DashboardRoutes.scala:46`, `DashboardProtocol.scala:57,131`), so D4's branch on the list record's `accessRole` has a real field to read.
- **`/panels` default page is 200, max 500** (`pagination.scala:11-12`). The D4 viewer branch reads one page. See notes.
- **App-pool route specs exist** (`DashboardLayoutRepairRoutesSpec`, `PatchSetPreviewServiceSpec`, `OutputInsightRlsSpec` use `helio_app_test`), so D5 items 5-6 are constructible.

### Verdict: REFUTE

Narrow. All three items are small text revisions to design.md and tasks.md. No re-think is needed.

### Change Requests

1. **tasks.md contradicts design.md on the mutation set.**
   - tasks.md:40 (task 4.6) reads "Mutations m1-m8 each red at its own assertion". D6 now defines m9, the mutation round 1's CR1 required.
   - An executor working from tasks.md will skip m9, and an evaluator checking task 4.6 will pass without it.
   - Change 4.6 to "m1-m9". Also add a task (or extend 3.1) for D5 item 6's Output-route proof by name, since 3.1 just says "(D5)".

2. **D5 item 6 and m9 are wrong about `/insight`.** Two problems make that line either unexecutable or vacuous as written:
   - (a) **Positive control.** `/api/outputs/:id/insight` is `404` for any non-`insight` Output, owner included (`InsightAccess.scala:17-23`). Item 6 tests the shared dashboard's bound Output, which is chosen as one with a stored history payload, so that Output is not an `insight` kind. The owner positive control there returns 404 and cannot "return data". Specify a second fixture: an `insight`-kind Output with an `ok` render in `output_insights`, bound to a panel on the same shared dashboard. Run `/insight` against that Output for the viewer, editor and owner.
   - (b) **m9 claim.** D6 says m9 (Output reads on the BYPASSRLS pool) goes "red at the 404 assertions (proves the proof depends on RLS, not on something else returning 404)". For `/insight` that is false. `InsightAccess.resolve` adds an app-level `accessChecker.requireAccess("pipeline", ...)` (`AccessCheckerImpl.scala:51-80`), so a dashboard-only grantee stays 404 under m9. Restate m9 as red at the RLS-only routes (`/:id`, `/rows`, `/history`, `/history/:point/rows`). Record `/insight` as gated twice (RLS plus the app-level pipeline grant) and expected green under m9. If the design wants `/insight`'s app-level gate proved too, add a separate mutation, for example `requireAccess` -> `Right(Viewer)`.

3. **Cover, or explicitly reduce to, the rest of the `/api/outputs/:id/*` surface.**
   - The AC is "no `/api/outputs/*` data".
   - `/distinct-values` returns actual column values. `/filter-capabilities`, `/assertion-status`, `/panels` and `/provenance` also exist, and D5 item 6 does not list any of them.
   - Either add `/distinct-values` (it returns row data) to item 6's call list, or state the reduction with its evidence: every one of these goes through the same `OutputRepository.findById` statement (cite `OutputService.scala:309,333,363,367` and `ProvenanceRoutes.scala:15-17`), so the statement-level proof plus `/rows` covers them.
   - Silently omitting them leaves the evaluator unable to trace the AC.

### Non-blocking notes

- **D4 viewer branch paging.** The viewer branch reads one `/panels` page (default 200). A dashboard with more panels than that is truncated without notice. Either pass `limit=500` or follow `total`. Export has no such cap, so this is a small owner/viewer asymmetry.
- **D3 enumeration.** D3's list should include `DashboardService.scala:217,269`, `DashboardContentsService.scala:148`, `AutoLayoutService.scala:164` and `PanelService.scala:148,225,282,320`. That is the set I found. `DashboardService.scala:176` (duplicate) and `:245` are owner-only refusals outside the MCP write path, so leaving them is fine if stated.
- **`deleteInternal` covers viewers too.** `DashboardService.scala:156` fires for any non-owner, viewer included. A viewer's MCP `delete_dashboard` will therefore read "Only the dashboard's owner can delete it" rather than the view-only text. That is accurate. The D4 test asserting "view-only text" should target `update_dashboard`/`delete_panel` only, as written.
