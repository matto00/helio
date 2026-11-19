## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Tree reviewed: HEAD 27b4a7402e0135322c2fcac1aeba16540ddce0a4 (= main). The change dir is untracked, so I read the artifacts from disk. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/assistant-search-mcp-shared-dashboards/HEL-1785`.

### What I verified (with evidence)

**Round-2 CR1 (tasks vs design on the mutation set): resolved.**
- tasks.md 4.6 now reads "Mutations m1-m10 each red (m9: `/insight` recorded green, by design)". That matches D6's m1-m10.
- New task 3.1a names D5 item 6 explicitly: Output routes A (including `/distinct-values`), insight B, viewer/editor/owner on the app pool, and the reduction cited.

**Round-2 CR2 (`/insight` fixture and m9 claim): resolved, and the new claims hold against the tree.**
- **(a) Fixture.** D5 item 6 now uses two Outputs. Output B is an `insight`-kind Output with an `ok` row in `output_insights`, bound to a panel on the same dashboard, and `/insight` runs against B. The owner positive control (a non-null `render`) is therefore achievable.
- **(b) m9.** m9 is restated as red only at the RLS-only routes (`/:id`, `/rows`, `/history`, `/history/:point/rows`, `/distinct-values`). `/insight` is recorded as staying 404, which is correct: `InsightAccess.scala:16-22` calls `findById` and then `accessChecker.requireAccess("pipeline", ...)`, and maps a `Left` to `NotFound`.
- **m10 is sound.** It forces `requireAccess` to `Right(Viewer)` while on the BYPASSRLS pool:
  - `findById` admits the Output on that pool.
  - `OutputInsightReadService.read` (lines 30-36) then reads `insightRepo.latestOk`/`latestAttempt` with no further gate.
  - So m10 turns `/insight` red, and that proves the app-level gate is load-bearing.

**Round-2 CR3 (rest of the `/api/outputs/:id/*` surface): resolved.** `/distinct-values?column=` was added to the calls. The reduction for the remaining routes is stated, and I checked it:
- `OutputService.listPanels` (`:309`) and `assertionStatus` (`:333`) call `outputRepo.findById` directly.
- `filterCapabilities` and `distinctValues` (`:363`, `:367`) delegate to `OutputRowReads`, which calls `outputRepo.findById` first (`OutputRowReads.scala:80,94`; rows `:40`).
- `ProvenanceService.forUser` calls `outputRepo.findById` (`ProvenanceService.scala:50-51`).
- The cited lines for 363/367 and Provenance are the delegate or route lines, not the `findById` call itself. The design tells the executor to re-verify them, so this is acceptable.
- On `/distinct-values`, `parameter("column")` resolves before the service call (`OutputRoutes.scala:212-216`). A request that supplies the column still reaches `findById` first, so a no-access caller gets 404, not a column 400.

**Other claims re-checked:**
- `findAllVisiblePaged(userId, page)` exists (`DashboardRepository.scala:172-186`). It does a named-grant left join, runs in `withUserContext`, and resolves the role as owner if owned, else the grant role.
- `WorkspaceContextService.scala:126` and `WorkspaceSearchService.scala:88` both call `dashboardService.findAll(user, Page.Default)`, so passing `Page.Default` to `findAllVisible` keeps the current 200-item budget.
- `GET /api/dashboards/:id/panels` accepts `offset` and `limit`, and `limit` is clamped to `Page.MaxLimit` (`PublicDashboardRoutes.scala:63-87`). D4's `limit=500` plus following `total` is therefore implementable.
- helio-mcp `listDashboards(limit = 200, offset = 0)` is at `helioApi.ts:244` and `getDashboard` is at `:249-260` (uses `/export`). These match D4.
- No `TODO`/`TBD` placeholders. Proposal, design, tasks and spec delta agree on scope. Every ticket AC maps to a task:
  - search/context: 1.3, 1.4
  - no forbidden proposals: 1.6, 1.7, 4.3
  - MCP: 2.x, 4.5
  - no Output data: 3.1a
  - RLS: 3.1
  - red first: C0, 4.6
  - deploy note: D4
- C17 is honoured: nothing in the design edits `PublicDashboardRoutes` or the per-panel resolvers; MCP only calls `/panels`.

### Verdict: CONFIRM

All three round-2 change requests are resolved in substance, not just reworded. The revision introduced no new contradiction or unexecutable step.

### Non-blocking notes

- **Spec delta and the Output-route AC.** The spec delta does not record the AC that a dashboard-only grantee gets no `/api/outputs/*` data. Its second requirement covers only the assistant's Output detail. D5 item 6 proves the AC, but the durable spec has no scenario for it. Consider adding one scenario, "a dashboard-only grantee's `GET /api/outputs/:id/rows` for the shared dashboard's Output is not found when RLS is enforced", so the archived spec carries the guarantee.
- **Stale header comment.** `helio-mcp/src/helioApi.ts:9-11` says `getDashboard` composes with `/export` and that there is no `/:id/panels`. After D4 that is half wrong. Update it alongside the `types.ts:62` comment.
- **Ordering change.** `findAllVisiblePaged` sorts by `lastUpdated desc, id asc`. If `findAll` orders differently, the assistant context's and search's dashboard order changes. That is harmless, but an existing ordering assertion in `WorkspaceContextServiceSpec` may need a deliberate update rather than a silent one.
- **Snapshot-only MCP reads.** `getDashboardSnapshot` (`helioApi.ts:1246-1248`) has other callers that read `/export` alone, and those will 403 for a viewer. D4 covers `context.ts` placement degrading. The executor should confirm no other read tool through that path now lists viewer dashboards and then fails on them, or that it fails cleanly via `guarded`.
