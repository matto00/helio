## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `2f24ea23f60bf6e858a7c1e967e688da63e99f71` (cycle-2 diff base:
`ad84d7f6e5e7c909c1eb5cc40d20bc1d5dee81e7`, the cycle-1 commit this cycle's fixes sit on top of;
full-change diff base: `55ad1d6dedb9bad5d65f13a81e3b22731553e9b1`, LIVE-resolved via
`resolve-review-base.sh`). This cycle responds to `skeptic-final-1.md`'s REFUTE (two blocking,
live-reproduced defects) and does NOT re-litigate cycle 1's already-PASSed findings except where
this cycle's changes touch them.

### Phase 1: Spec Review — PASS

Both defects the final-gate skeptic found directly threaten ACs already marked satisfied in
cycle 1 (AC #4, AC #5) plus a self-found AC #2 gap ("Load more" not carrying active sort/filter).
All three are now fixed and independently re-verified (see Phase 2/3). No new scope creep: every
file touched this cycle is either the two hooks/slice at the center of the two defects, the
`PanelCard.tsx` self-found fix, or new/updated tests. No backend files touched (confirmed via
`git diff --stat` — zero `backend/` paths in the cycle-2 diff). `workflow-state.md`'s `CONSTRAINTS`
remains empty (`[]`) — nothing new to honor.

### Phase 2: Code Review — PASS

**Gates run fresh in `WORKTREE_PATH`:**
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` (frontend) — **359 suites / 3892 tests, all passed** (up from 356/3885 at cycle 1's
  close, consistent with the executor's claimed +3 files/+7 tests).
- `npm --prefix frontend run build` — succeeds (pre-existing chunk-size warning only).
- `cd backend && sbt test` — re-ran fresh despite zero backend changes this cycle (out of caution,
  since the requesting message asked for every gate to be re-run): **4854/4854 passed**, identical
  to cycle 1.
- `openspec validate server-side-sort-filter-output-rows --type change` — valid.

**Independent RED-FIRST verification (not trusted from the executor's/skeptic's narration) —
reverted each fix to its exact cycle-1-committed (`ad84d7f6`) file content via `git show
ad84d7f6:<path>`, ran the new regression test, confirmed genuine failure, restored, confirmed
green, confirmed `git status` clean after each restore:**

1. **Defect 1 (`PanelCard.filterTyping.test.tsx`)** — reverted `usePanelSortFilter.ts` and
   `PanelCard.tsx` to `ad84d7f6`. Test failed exactly as predicted: `screen.getByRole("textbox",
   {name: "Quick filter across all columns"})` could no longer be found after the second
   keystroke — the DOM showed only the `panel-body-skeleton`. Restored → 2/2 passing.
2. **Defect 2 (`PanelCard.staleFetchSequencing.test.tsx`)** — reverted `panelsSlice.ts` alone
   (keeping the debounce fix, isolating this test to the sequencing guard specifically). Test
   failed exactly as predicted: settled `total` was `60` (the stale unfiltered value) instead of
   `3`. Restored → 1/1 passing.
3. **Self-found "Load more" gap (`PanelCard.loadMoreCarriesSortFilter.test.tsx`)** — reverted
   `PanelCard.tsx` alone. Test failed exactly as predicted: `mockGetOutputRows` was called with
   `sort: undefined` instead of the active sort on the page-1 request. Restored → 1/1 passing.

All three RED-FIRST claims are genuine, not narrated.

**Fixture fallout — read every diff and independently confirmed comprehensiveness, not just
trusted the count:**
- `renderWithStore.tsx`'s `normalizedState.panels` now unconditionally includes
  `latestFetchRequestId: {}` in the FULLY-normalized `panels` slice object it always constructs
  (every field defaulted explicitly, never a partial passthrough) — this means EVERY test using
  this shared harness for its `panels` state is covered by this one fix, not just the ones that
  happened to already pass `latestFetchRequestId` explicitly. Confirmed by reading the function in
  full: `PanelCard.filterEmptyState.test.tsx` (unchanged this cycle) is safe for exactly this
  reason, verified by tracing its `renderWithStore` call through the normalization function.
- The four individually-touched fixtures (`usePanelData.test.ts`,
  `PanelCardBody.fanoutStatus.test.tsx`, `panelsSlice.test.ts`, `PatchSetReviewPage.test.tsx`) each
  hand-construct their OWN `configureStore` call bypassing `renderWithStore` — each now correctly
  adds `latestFetchRequestId: {}`. `PanelCardBody.predispatch.test.tsx` (unchanged this cycle,
  also hand-constructs its own store) is independently safe because it seeds its frozen state via
  `panelsReducer(undefined, {type: "@@INIT"})` — the real reducer's own initial state, which
  already includes `latestFetchRequestId: {}` — confirmed by reading the file.
- Searched the whole frontend test suite for any other `configureStore`-with-`panels:` construction
  outside these accounted-for files; rather than manually re-deriving each one's safety, the fresh
  full-suite run (3892/3892 passed) is the definitive empirical check — a missed fixture that ever
  dispatches `fetchPanelPage.pending` against an object lacking `latestFetchRequestId` would throw
  a real runtime `TypeError` inside Immer's `produce`, not silently pass. None did.

**D4 canWrite-gating / debounce-separation concern (explicitly requested) — confirmed genuinely
separate, not merged:**
- `TableRenderer.tsx` is **completely untouched this cycle** (`git diff` for that file is empty)
  — its own `PERSIST_DEBOUNCE_MS`/`persistTimerRef`/`filterPersistTimerRef` (the `canWrite`-gated
  persist-as-default debounce, unchanged since cycle 1) live entirely inside that file, unaffected.
- The new `REFETCH_DEBOUNCE_MS`/`refetchTimerRef` (the server-refetch debounce, Defect 1's fix)
  lives entirely inside `usePanelSortFilter.ts`, a different file/hook, with its own `useRef` timer
  and its own unmount-cleanup effect (cancel-never-flush, since an abandoned READ has nothing worth
  completing — a deliberately different policy from the persist debounce's flush-on-unmount, which
  the doc comments correctly distinguish). The two debounces share only a numeric coincidence
  (both `300`ms) with an explicit comment stating this is not a coupling. `onSortChange`/
  `onFilterChange` still fire from `TableRenderer`'s UNCONDITIONAL first half (before the `canWrite`
  gate), unchanged from cycle 1 — confirmed by the empty diff on that file.

**Canonical code-quality compliance:** no violations found in the cycle-2 diff. The new
`latestFetchRequestId: Record<string, string>` field is well-typed (no `any`), the staleness guard
(`if (state.latestFetchRequestId[panelId] !== action.meta.requestId) return;`) is a correct,
minimal, self-documenting use of `createAsyncThunk`'s own `meta.requestId` (no new dependency, no
over-engineered abstraction like a full cancellation-token library where a simple id comparison
suffices).

### Phase 3: UI Review — PASS

Dev servers reconfirmed as belonging to THIS worktree (`readlink /proc/<pid>/cwd` for both the
9366/6459 listeners, unchanged pids from cycle 1's own start).

- **Defect 1 live reproduction (dark theme):** typed `"revenue"` character-by-character
  (`pressSequentially`, real per-key events) into the quick filter. The textbox stayed mounted and
  showed the full `"revenue"` value throughout — confirmed via direct DOM read after typing
  completed. Network log showed exactly ONE debounced `filter=` request, carrying the full term
  (`filter=%7B%22quick%22:%22revenue%22...%7D`). Correctly rendered "No rows match your filter."
  (no row genuinely contains "revenue").
- **Defect 1 live reproduction (light theme):** toggled theme via command palette, appended
  `"-5"` character-by-character to an existing `"target"` filter value; the textbox showed the full
  `"target-5"` value afterward — no keystroke loss in light theme either.
- **Defect 2 live reproduction (both reloads, dark theme):** persisted a `quick: "target"` filter
  default (typed, waited for the persist debounce to commit), then did a genuine full-page
  `page.goto` reload (not an SPA navigation) TWICE. Both times the network log showed the exact
  race the skeptic described — two unfiltered mount-effect requests (React StrictMode's
  double-invoke, confirmed still enabled per `main.tsx`) plus one filtered request — and both times
  the settled disclosure correctly read **"3 results."**, never the stale raw "60 results.".
  Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/hel1027-c2-dark-settled.png`.
- **"Clear filters"/"Clear all" still works post-fix:** clicking "Clear all" (light theme)
  correctly cleared the filter and refetched the full unfiltered 60-row set — confirmed via
  screenshot (`/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/hel1027-c2-clearall.png`)
  and no lingering stale disclosure.
- **No console errors** attributable to this ticket's code in any tested flow. The same single
  unrelated pre-existing background error (`.../run-events` `502`, a different pipeline's SSE
  polling, out of this ticket's scope) recurred, exactly as both cycle 1's and the final-gate
  skeptic's reports already dismissed it.
- **Breakpoint spot-check (768px, light theme):** re-verified no layout breakage post-fix
  (screenshot `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/hel1027-c2-768.png`) — expected, since no CSS/markup changed this cycle
  (`TableRenderer.tsx`/`DataGrid.tsx` both untouched).
- **Accessible names/keyboard support:** unaffected — no markup changes this cycle; the quick/
  per-column filter inputs retain their existing accessible names, confirmed via the accessibility
  snapshots used throughout this verification.

**Evidence-persistence note (CON-160):** the three screenshots captured this cycle were initially
saved by the Playwright tool to the MAIN CHECKOUT's root (`/home/matt/Development/helio/`, not
this worktree — a known shared-browser-session artifact-location hazard, not something this
evaluator's own commands caused) rather than persisted at the moment of capture as this role's
protocol requires. Caught and corrected before finalizing this report: all three are now run
through `persist-evidence.sh` (durable refs cited above) and the stray copies removed from the
main checkout's root. No claim in this report rests on a screenshot as its only support — each is
also corroborated by self-authenticating network-log/DOM-value evidence quoted inline — but the
late persistence is itself noted here rather than silently corrected with no record.

### Overall: PASS

No change requests. All four of `skeptic-final-1.md`'s change requests are addressed: CR1
(debounce, live-verified), CR2 (sequencing guard, live-verified across two independent reloads),
CR3 (real DOM typing regression test, independently RED-FIRST-confirmed), CR4 (StrictMode
sequencing regression test, independently RED-FIRST-confirmed). The self-found "Load more"
sort/filter gap is a genuine, in-scope AC #2 fix with its own independently-confirmed RED-FIRST
test.

### Non-blocking Suggestions

1. (Carried from evaluation-1.md, still applicable, unaffected by this cycle) `NodeSnapshotRepository.scala`
   and `OutputService.scala` remain over CONTRIBUTING.md's 250-line soft file-size budget.
2. (Carried from evaluation-1.md) The `400` error body shape differs cosmetically from design.md
   D3's originally-sketched JSON shape; functionally equivalent and already reconciled in
   `openspec/specs/output-routes-api/spec.md`.
3. This evaluator's own screenshots from this cycle were captured to the main checkout's root
   (not this worktree) by the Playwright tooling and were not persisted until after the fact
   (corrected before finalizing, see the Phase 3 evidence-persistence note) — a process
   reminder for next cycle to persist evidence the moment it is captured, not a defect in the
   ticket's own code.
