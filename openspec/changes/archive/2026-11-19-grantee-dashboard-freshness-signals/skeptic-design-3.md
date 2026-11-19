## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD b2603ab7998f3e9b4bdca5089a18f89da16fdc8b. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn cwd**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/shared-dashboard-freshness-refresh-invalid/HEL-1786`.

- **Round-2 CR1 (stale `lastRunAt` trigger text): resolved.**
  - I grepped proposal/design/tasks/spec for `succeeded fires`, `last run time advances`, and `lastRunAt.*fire|trigger`. The only remaining hits are correct ones:
    - spec.md:24, the "follows committed data" scenario;
    - design.md:40, the "not `lastRunAt`" statement;
    - design.md:60, which says `lastRunAt`/`runStatus` never trigger;
    - design.md:86, the jest list, which now contains exactly the five cases round 2 asked for, including "`lastRunAt` advance with `succeeded` and unchanged `dataUpdatedAt` does NOT fire".
  - The proposal now keys the refresh on "latest stored-data capture time".
  - The Risks entry is rewritten in terms of `dataUpdatedAt`.

- **Round-2 CR2 (`sources` via a factored method, no `forOutput` on the poll path): resolved, and feasible against the code.**
  - In `ProvenanceService.scala:56-88`, `forOutput` derives sources from these pieces:
    - `stepRepo.listWithRootIdsInternal`;
    - `rootRepo.listInternal`;
    - `closureFor` (:91);
    - `feedingRootIds` (:95);
    - `secondarySourceIds` (:103);
    - `dataSourceRepo.findNameKindsInternal`.
  - All of these are pure or per-pipeline, so they can be extracted into a `sourcesFor` that `forOutput` then calls. The other reads, `latestNonDryRunInternal`, `assertionsFor` and `countRows` (:73-75), are separable.
  - D1 forbids `forOutput` and `count(*)` on the poll path. Risks now states a per-request bound of O(distinct pipelines) plus a constant.

- **Round-2 non-blocking notes: all folded in.**
  - The schema-after-rows Risk is present. It matches `PipelineRunSucceededWrites.scala:156-162`, where `replace.flatMap` runs schema inference after `overwriteRowsWith`.
  - The spec THEN clause now includes the "stored-data capture time".
  - The `invalid` rule keeps `listByPipelineInternal` + `find(_.status != "dry_run")`, which is the `OutputService.scala:340-341` path.
  - The Risks entry handles the fact that `listByPipelineInternal` is unbounded (`PipelineRunRepository.scala:560-566`, no `take`): if bounded, the bound must be a `LIMIT` with the same ordering, and the Output route's specs must stay unchanged.

- **Commit-order facts re-checked fresh.** `PipelineRunSucceededWrites.scala:126-155` builds `OutputHistoryInsert` for every Output on the node with `capturedAt = now`, then passes it as `historyAction` to `nodeSnapshotRepo.overwriteRowsWith`. That puts the history point and the rows in one transaction, as round 2 found. `DashboardChangesRepository.scala:30-38` has the LATERAL `LIMIT 1` `dataQuery` that D1 cites.

- **ACL directive semantics.** `AclDirective.scala:80-150`:
  - a signed-in caller who is neither owner nor grantee, with no token, gets `NotFound(notFoundMessage)`;
  - the public-viewer-grant fallback applies only to the anonymous (`None`) arm;
  - an unknown id gets the same `NotFound`.

  So the D1 claims "stranger 404 identical to unknown id" and "public grant does not admit an authenticated stranger" both hold. `findGrant` filters on `granteeId`.

- **Frontend sites.** Each of these matches the tree:
  - `PanelCardBody.tsx:195` (`usePanelRunRefresh(scope.kind === "output" ? ...)`);
  - `PanelCard.tsx:149` (`useDataInvalid(scope.kind === "output" ? ...)`) and :337;
  - `PanelProvenance.tsx:28` (`invalidBadge={scope.kind === "output" && invalidBadge}`);
  - `ProvenanceTrigger.tsx:83`;
  - `DashboardMetaRow.tsx:93-94` (the non-owner keeps only `panelCount`);
  - `DashboardRefreshLine.tsx:76-80` (the `!isOwner` early return);
  - `onFreshnessReset` (in `outputFreshness.ts` / `outputMetaCache.ts` / `pipelineRunFanout.ts`);
  - `getAssertionStatusShared` (`provenanceCache.ts:91`);
  - `usePullRefreshControl` (`pullRefreshRegistry.ts:164`, which delegates to the panels' registered `refresh`, so the D3 verification instruction is the right one).

  The test files D5/D6 cite all exist: `DashboardMetaRow.roles.test.tsx`, `DashboardRefreshLine.test.tsx`, `e2e/hel1773-viewer-grantee-dashboard.spec.ts`, `DashboardSharedListRoutesSpec`, `DashboardGranteePanelRoutesSpec`, `SharedDashboardOutputRoutesRlsSpec` and `TwoUserRlsApiFixture`.

- **Reserved-slot rule for grantees.** `feedingOutputIds` (`dashboardMeta.ts:35`) reads `panel.config.outputId`. The grantee panel list is built by `PublicPanelListResolver` -> `PanelResponse.fromDomain(panel, ...)`, so a grantee's panels carry `config`. D4's "the reserved-slot rule applies to grantees too" is therefore implementable without new data.

- **AC coverage, re-checked across the whole design:**
  - Dashboard-scoped route: D1 / task 2.2.
  - Per-request ACL, stranger 404, NOBYPASSRLS transcript: D5 / task 2.3.
  - Run-finish signal discloses nothing beyond what the panels show: allow-list, `additionalProperties: false`, m1, and the Risks disclosure entry.
  - e2e for viewer and editor with no Output/pipeline requests: D6 / task 4.1.
  - Red first: tasks 1.x and mutations m1-m9.
  - No TODO/TBD placeholders.

- **Self-decision S1 (show `failed` intent to grantees).** The ticket's "no ... errors" sits inside "reveals nothing beyond what the grantee's panels show". Per-panel provenance already shows grantees `lastRun.status` (`ProvenanceLastRun.status`, `ProvenanceService.scala:84`). The status is therefore within the AC and is not a product question that needs escalation.

### Verdict: REFUTE

### Change Requests

1. **spec.md contradicts design D1 on source names (internal contradiction in a normative SHALL).** The requirement "Grantees see the dashboard freshness line" says the client "SHALL show the same refresh fact (relative time and success/failure intent) and source names the owner sees". Design D1 (`sources` bullet) says the grantee's list "deliberately differs from the owner's meta row for a multi-root pipeline whose bound Outputs read only some roots". The ordering differs too: owner = pipeline roots in panel order (`deriveDashboardMeta`); grantee = provenance order. The first requirement in the same spec also mandates provenance-restricted names, and the D5 two-root test plus m9 enforce that.
   - **Why it matters:** an evaluator checking the implementation against this SHALL, or an e2e author comparing the grantee row to the owner row, would rightly fail a correct implementation. And the archived spec would assert something false.
   - **Fix:** reword that requirement so it says something like "the same refresh fact (relative time and success/failure intent) the owner sees, and the source names from the panel-status route (the sources the per-panel provenance shows for the dashboard's Output panels)".
   - **Also:** optionally add one sentence to the proposal's "What Changes" saying that the grantee's source list can be a subset of the owner's.

### Non-blocking notes

- In D4, `isDataInvalid = scope.kind === "output" ? useDataInvalid(outputId) : usePanelStatus(...)?.invalid === true` is written as a conditional hook call, and the parenthetical then says the opposite. The executor should write both calls unconditionally, with null inputs, and select between the results afterwards (rules-of-hooks lint will catch it otherwise).
- D1 says the history-latest read runs "through system context after the ACL". The cited `DashboardChangesRepository` runs its query under `withUserContext`. Under `helio_app` a grantee's user context would see 0 history rows, so the new read must really use system context, and the D5 RLS transcript should include a non-null `dataUpdatedAt` to prove it.
