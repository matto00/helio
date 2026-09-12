## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed at HEAD `7931a11b56f8ee9864150d1cc3b9ce77bc903ac2`, diffed against the
LIVE-resolved review base `f0dfc8a73153883904c191cc203d1039ccb46ee2`
(`scripts/concertino/resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/dedupe-dashboard-list-duplicate/HEL-1119`.
- **Diff read in full** (`git diff BASE...HEAD`): 3 source files + change-dir artifacts. No
  `e2e/` file touched (`git diff --name-only BASE...HEAD -- e2e/ | wc -l` → `0`), so AC2's
  "not by loosening the locator" holds mechanically, not just by assertion.

- **AC1 — probe-confirmed root cause, RED before the fix.** Not taken on the executor's or
  evaluator's word. I mutated `createDashboard.fulfilled` back to the exact pre-fix line
  (`state.items.push(action.payload)`) myself and re-ran the probe:
  ```
  Expected length: 1
  Received length: 2
  Received array:  [{"id": "dashboard-2", ...}, {"id": "dashboard-2", ...}]
  Tests: 1 failed, 21 skipped, 22 total
  ```
  Restored; `git status --porcelain` shows no modification to the slice and
  `git diff --stat` on it is empty. **The guard is genuinely failable by the claimed
  mutation — not vacuous.**
- **AC2 — fix at the source.** `upsertDashboardById` (push-or-replace-by-id) in
  `dashboardsSlice.ts:113-120`, applied at `createDashboard.fulfilled` (L303),
  `duplicateDashboard.fulfilled`, `importDashboard.fulfilled`, `applyProposal.fulfilled`, and
  reused by the pre-existing `dashboardUpserted` reducer rather than duplicating a fifth copy.
- **AC3 — regression guard.** `dashboardsSlice.test.ts` `describe("createDashboard /
  fetchDashboards race (HEL-1119)")`; asserts both exactly-one-survivor *and*
  `items` length 2 (so it cannot pass by the array being wrong in a different way).
- **The race is mechanically reachable, checked independently.** `fetchDashboards.fulfilled`
  wholesale-replaces `items` (L272) while `createDashboard.fulfilled` appended — so a GET
  issued at boot but *served* after the create commits, whose response beats the POST
  response back to the client, produces exactly the probed ordering. The ticket's driver
  note doubted this was mechanical; it is.
- **Sibling-slice claims verified directly, not from the report:**
  - `pipelinesSlice.ts:409-410` — `fetchPipelines.fulfilled` does `state.items = action.payload`
    (wholesale replace); `createPipeline.fulfilled` previously bare-pushed. Same shape, correctly fixed.
  - `panelsSlice.ts` — no `createPanel.fulfilled` case; every `items` write is a replace/map/filter.
    The one `.push` (L285) is a local array in a helper, not `state.items`. Correctly ruled out.
  - sources — no `.push(` into `state.items` anywhere. Correctly ruled out.
- **HEL-706 distinction is sound.** HEL-706 is a double-submit producing two backend rows with
  two *distinct* ids; an id-keyed de-dupe cannot merge two different ids, so it is mechanically
  a different defect. The claim is correct and correctly bounded ("this fix does not address HEL-706").
- **`pipelinesSlice.ts` scope addition is justified and bounded.** proposal.md's Modified
  Capabilities and design.md Decision 3 pre-authorized "fix inline if small and same-shape,
  else file a follow-up". It is one call site, mechanically identical, and disclosed in
  `files-modified.md`. Not overreach.
- **Gates re-run fresh by me in the worktree:**
  - `npm run lint` → exit 0, zero warnings.
  - `npm run typecheck` → exit 0.
  - `npx jest --testPathPatterns='dashboardsSlice|pipelinesSlice'` → `Tests: 83 passed, 83 total`.
- **UI review (Phase 4): correctly N/A.** The only frontend files touched are two Redux slices
  and one slice test — no component, route, or stylesheet. There is no changed view to screenshot
  and no DESIGN.md token/parity surface in this diff. Servers deliberately not started; nothing
  visual is load-bearing for this verdict, so no screenshot evidence needed to be persisted.

### Verdict: CONFIRM

### Non-blocking notes

1. **`files-modified.md`'s "Real-user visibility" (task 3.3) overstates its cited vector.** It
   claims a user opening the command palette re-triggers `fetchDashboards`. That call site
   (`useResourceIndexing.ts:77`) fires only when the dashboard index status is `idle`/`failed`,
   and `fetchDashboards` additionally carries a thunk `condition`
   (`dashboardsSlice.ts:88-90`: `status !== "loading" && status !== "succeeded"`). After a
   successful boot fetch the status is `succeeded` and never returns to `idle`, so that
   particular path does **not** refetch for a normal user. The *conclusion* (the race is real,
   not merely a test artifact) still stands via the boot-fetch-in-flight ordering above — but
   the stated mechanism is wrong and should not be carried into the PR body as written.
   Task 3.3 was explicitly investigation-only with no acceptance signal, so this is not a gate failure.
2. **`useResourceIndexing.ts:50`'s docblock is stale** — it asserts `fetchDashboards` has no
   thunk `condition`, but it does (`dashboardsSlice.ts:88-90`, added by HEL-503). Pre-existing,
   not introduced by this diff; worth a follow-up so the next reader isn't misled the way note 1 was.
3. **The `pipelinesSlice.ts` fix ships without its own regression test.** The dashboards fix is
   mutation-guarded; the pipelines one is not, so it could be silently reverted. A three-line
   sibling test mirroring the dashboards probe would close that.
4. The evaluator's non-blocking suggestion (extract a generic `upsertById<T>`) is reasonable but
   correctly deferred — two call sites do not justify the abstraction.
