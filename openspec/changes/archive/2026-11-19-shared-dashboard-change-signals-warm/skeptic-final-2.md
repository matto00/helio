## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `2d3210e63097dfca35ec2e2357ab1cc19fd6b177`. I resolved the base live with `resolve-review-base.sh` (exit 0):
`dfb65eebb2dac32afbd1eaeb7fd6e94b369d0369`. The worktree is clean apart from the untracked evaluation-1/skeptic-final-1 reports.
Durable evidence is under `/home/matt/Development/helio/.concertino/runs/HEL-1783/evidence/.concertino/scratch/HEL-1783/skeptic/`
(`r2-probes.txt`, `r2-e2e-hel1783.txt`, `r2-backend-spec.txt`).

The lane DB `helio_hel1783` was created for this round and dropped at the end. Servers were started with `start-servers.sh`
(`assert-phase servers` PASS) and stopped with `stop-servers.sh` (`STOPPED ports=7215,10122`). No .env file was read.

### What I verified (with evidence)

**skeptic-final-1 CR1 (stale query after a marker reuse): fixed, and the fix is the mechanism CR1 asked for.**
- `usePanelSortFilter.ts` correction effect: `restoredNoTerms = !hasTerms && hasRestoreMarker(panelId)`. A restored card with no
  terms now compares its own query (no sort, `composeOutputRowsFilter(null, ops)`) against the window, and calls `dispatchFetch`
  when they differ.
- `mountOwnership` is set only once a difference is found. The parent's reuse decision is therefore left alone when the window
  already matches.
- Under panel scope, the HEL-1780 server-key skip turns a client-only difference into `panelQueryRecorded` with no request. A
  control-column difference fetches once.
- Red-first: commit d054ec831 adds 8 cases that are red before the fix (`evidence/red-cycle2-jest.txt`: 8 failed / 13 passed),
  and m13 turns all 8 red. Cases (i) control-column filter, (i) control-column sort, (i) "default removed", (ii) non-control
  sort and filter, and (iii) the memory path are all present in `usePanelData.restoreMarker.test.tsx`.
- An `afterEach` asserts that `getOutputRows` and `getOutputById` are never called.

**My own probes through the real hooks.** I used the same harness, copied into a temporary test file that was removed afterwards
(`r2-probes.txt`):
- **P1, memory path, non-control interactive sort, no terms.** 0 rows requests. The recorded query is the card's (no sort). The
  hook is not loading or refreshing, so the parent wait does not wedge.
- **P2, memory path, persisted default equal to the window.** 0 requests, no wedge.
- **P3, stored path where the scoped metadata read FAILS.** 0 requests and the window keeps its filtered `lastQuery`. This is not
  a visible stale path: `OutputPanelContent.tsx:125` renders the skeleton while `output` is null, so no mismatched rows are ever
  shown. The marker is spent on unmount, so the next mount re-reads.
- **P4, StrictMode, control-column interactive filter.** Exactly 1 request, and the window ends unfiltered.
- **P5, leave-and-return (unmount, then remount after a marker reuse).** The marker is gone after the remount. The remount made
  no request because the HEL-1780 skip applies to an unchanged server query. See the non-blocking note.
- **P6, stale window (generation moved at restore).** Re-read: 1 request.

**design-6 CR1-CR3 (C13-C15), re-judged against the current code.**
- **C13.** `usePanelData.ts:300-311` sets `restoredMount = isFirstMountDecision && mountOwnership !== undefined && hasRestoreMarker`
  and calls `replayableQuery(..., fullReplay || restoredMount)`. Without a marker the argument is unchanged, so the parent behaves
  byte-identically. Option A is named in files-modified.md, and the scoped metadata stub is not persisted
  (`peekOutputMeta` returns undefined for scoped entries; `applyWarmEntry` seeds metadata only for `scope === "output"`).
- **C14.** The stored-copy cases assert zero `fetchPublicPanelRows` calls both before and after the metadata resolves, for
  persisted sort, persisted columnFilters and the URL control filter, each also under StrictMode. The "differing default" case
  asserts exactly 1 per-panel request, carrying `desc`.
- **C15.** m11 and m12 are in `evidence/mutations-frontend.txt`. The e2e Output has a persisted `columnSort`
  (`revenue desc`), and (d) asserts no DA list or rows request on the stored reload.

**AC1 / AC3: data times for grantees without over-disclosure, under RLS. MET.**
- `DashboardChangesRepository.changes`: the content query runs in user context, and the data query runs in `withSystemContext`
  only over the `readable` ids that query returned, with `p.kind = 'output'`. Only (dashboard id, output id, newest captured_at)
  is read, and the inline bypass justification is present.
- `DashboardChangesRoutesSpec` run fresh on the lane DB: **13/13 passed**, including "prove the app pool is genuinely
  non-BYPASSRLS" (`rolbypassrls` of `helio_app_test` is false).
- The editor case now creates a real `editor` grant (`share(..., "editor")`, spec line 160), which addresses the round-1 nit.

**AC2: dots and the warm cache for shared dashboards, with a grantee e2e. MET.** I re-ran
`e2e/hel1783-shared-dashboard-tabs.spec.ts` myself against the lane servers and lane DB with `DEV_PORT=7215`:
**1 passed (1.2m)** (`r2-e2e-hel1783.txt`). Its assertions, read in full:
- (a) the warm switch makes no DA list or rows request;
- (b) the dot appears after the owner's run, with the accessible name "changed since you last viewed"; on return, "North" is
  read through the per-panel rows route and the dot clears;
- (c) `dataUpdatedAt` is non-null and `outputs` equals exactly `[outputId]`;
- (d) the stored reload makes no DA requests;
- `expectInvariant` holds: no `/api/outputs` or `/api/pipelines` request while viewing, no `/api` error, and no console error.

**No `/api/outputs/*` or `/api/pipelines/*` request from a non-owned dashboard.**
- The restore path calls `applyPanelReadScopes(..., scope === "panel")`.
- Scoped metadata uses `fetchPublicOutputMeta`, and `registerOutputPipeline` is skipped for scoped reads.
- The jest `afterEach` and the e2e invariant both enforce this.

**Owner behaviour unchanged.**
- The unscoped branch of `isReusable` is unchanged.
- `restoredNoTerms` requires a marker, and markers are set only for `scope === "panel"`; the owner path calls
  `clearRestoreMarkersExcept`.
- Without a marker, the parent's replay argument is unchanged.

**Visual check.** The PR changes no UI component or CSS: every non-test frontend file is state, hooks or warm-cache code. I viewed
the e2e's warm-reload screenshot (`e2e-evidence/HEL-1783/viewer-shared-tab-reload-warm.png`). The restored shared table shows
North/West/East in `revenue` descending order, matching the persisted default, with the existing header sort indicator, the
SHARED badge and the tab dot. The table is consistent with its controls, and nothing is off-pattern.

**Gates run fresh.**
- Focused jest: 33 suites / **316 tests passed** (`tabs/warm`, `usePanel*`, `panelRowsReuse`, `panelStatusStore`, `panelThunks`,
  `outputMetaCache`, `restoreMarker`).
- `npm run typecheck`: exit 0.
- ESLint `--max-warnings 0` on every changed frontend TS file: exit 0.

**skeptic-final-1 CR2 and CR3.**
- design.md D5 (lines 133-145) now maps m3/m8 to e2e (d), not (a), and gives the reason.
- The marker timer moved into `useConsumeRestoreMarkerOnUnmount` (`restoreMarkers.ts`). `usePanelData.ts` is **527 lines**
  (`wc -l`; the base was 504). It is still over the ~400-line guideline, but the split proposal is recorded in files-modified.md
  for the PR description, as CONTRIBUTING.md:24 allows.

**Gate-defect check (CON-160).** No report I read rests on mtime ordering, so there is nothing to record.

### Verdict: CONFIRM

### Non-blocking notes
- **Pre-existing HEL-1780 gap, not introduced here (spinoff recommended).** `usePanelSortFilter.dispatchFetch`'s panel-scope
  client-only skip checks `lastFetchOk` and the server key, but not `entry.generation === currentGeneration(outputId)`.
  - Probe P7 builds this case: a stale window (generation 0 vs 1), no marker, the scoped metadata servable at mount, and a
    persisted non-control default. It makes **0 requests**, so the stale rows stay.
  - In this change's restore flows the metadata is not servable after `restoreFromMemory`'s `invalidateOutput`, because the
    generation differs and the refetch is async. P6 confirms that path re-reads. So I found no reachable trigger inside this
    ticket's scope.
  - It is still a latent stale-rows path for any panel-scoped remount where the metadata resolves after an invalidation.
  - Recommended follow-up: require the current generation (or `isReusable`-equivalent freshness) before the skip records instead
    of fetching.
- **The PR body must carry the `usePanelData.ts` split proposal** that files-modified.md records (for example, moving the
  wait/queue machinery into its own hook).
- files-modified.md still says "Base d8cdfb460", but the branch is on dfb65eebb. Refresh it in the PR text.
