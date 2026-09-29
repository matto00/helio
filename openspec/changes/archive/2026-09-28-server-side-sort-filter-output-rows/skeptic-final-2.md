## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed commit: `2f24ea23f60bf6e858a7c1e967e688da63e99f71` (review base
`55ad1d6dedb9bad5d65f13a81e3b22731553e9b1`, resolved fresh via
`resolve-review-base.sh`, exit 0). Cold spawn; every finding below is from my own
fresh reads/runs, not from the executor's or evaluator's narration.

### What I verified (with evidence)

**1. Code read, cold, from scratch.**
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts` (full file) — confirmed
  the new `REFETCH_DEBOUNCE_MS`/`refetchTimerRef` (lines 16, 132-142) is a genuinely
  separate mechanism from `TableRenderer.tsx`'s own `PERSIST_DEBOUNCE_MS`/
  `persistTimerRef` (that file's line 223 and its `canWrite`-gated persist timers at
  lines 449, 557-560, 598-607, 623-629): `TableRenderer.handleSort`/`handleFilterChange`
  call `onSortChange?.(...)`/`onFilterChange?.(...)` **unconditionally and
  synchronously** (lines 595, 619, before the `canWrite` gate), which is
  `usePanelSortFilter.handleSortChange`/`handleFilterChange` — those set local state
  and call `debouncedRefetch` (its own 300ms timer). `TableRenderer`'s own
  `persistTimerRef`/`filterPersistTimerRef` fire independently, gated on `canWrite`,
  to PATCH the config. Confirmed via `git diff ad84d7f6..2f24ea23 --stat`: 
  `TableRenderer.tsx` has **zero** lines changed this cycle — the persist path is
  untouched, matching the evaluator's own claim (evaluation-2.md D4 section), which I
  independently re-derived rather than trusted.
- `frontend/src/features/panels/state/panelsSlice.ts` — `latestFetchRequestId`
  (lines 70-92, 283-345): recorded unconditionally in `.pending` (dispatch order =
  registration order, by construction — correct), checked in both `.fulfilled` and
  `.rejected` against `action.meta.requestId`. The guard logic itself is correct as
  written — my objection below is that the fix upstream of this guard (the dispatch
  that's supposed to happen) doesn't reliably happen, not that this guard is wrong.
- `frontend/src/features/panels/ui/PanelCard.tsx` — `handleLoadMore` (lines 169-184)
  now correctly threads `activeSort`/`activeFilter` into the page>0 request. Confirmed
  by reverting `PanelCard.tsx` alone to `ad84d7f6` and re-running
  `PanelCard.loadMoreCarriesSortFilter.test.tsx` (see red-first section below).

**2. Fresh gates, run myself, output read:**
- `npm run typecheck` — clean (`tsc --noEmit`, no output = pass).
- `npm run lint` — clean (`eslint src --max-warnings=0`, no output = pass).
- `npx jest --testPathPatterns="panels/"` — **86 suites / 927 tests, all passed.**
- `npx jest` on the three new regression test files individually — all green.

**3. Red-first re-verification of the three cycle-2 regression tests (independent,
not trusted from evaluation-2.md's own claim of having done this):**
Reverted `usePanelSortFilter.ts`, `panelsSlice.ts`, `PanelCard.tsx` to their exact
`ad84d7f6` content via `git show ad84d7f6:<path> > <path>`, re-ran the three new test
files:
```
Test Suites: 3 failed, 3 total
Tests:       4 failed, 4 total
```
— `PanelCard.filterTyping.test.tsx` failed exactly as documented (the quick-filter
textbox could no longer be found by role after the second keystroke — the DOM showed
only `panel-body-skeleton`). Restored all three files (`cp` from my own pre-revert
backup), confirmed `git status --short` clean against HEAD, re-ran: **3 suites / 4
tests green again.** These three regression tests are genuine, not tautological.

**4. Full frontend suite health:** the above gates plus the targeted `panels/` run
give high confidence nothing regressed; I did not re-run backend `sbt test` since the
cycle-2 diff touches zero backend files (confirmed via `git diff --stat
ad84d7f6..2f24ea23`) and cycle-1's backend work is out of this round's scope per the
task brief.

**5. Live reproduction of both original defects — genuinely fixed for the
interactive-typing case:**
- Started servers via `scripts/concertino/start-servers.sh`, confirmed
  `assert-phase.sh servers` → `PASS`, confirmed both listeners' `/proc/<pid>/cwd`
  resolve into this worktree.
- Typed `"target"` character-by-character (`pressSequentially`, real per-key DOM
  events) into the existing "Revenue table" panel's quick filter (Output
  `fb968d18-34bc-442a-a32c-93ba6ca0199d`, 60 rows, 3 containing "target" at idx
  5/25/45 — an existing fixture dashboard, "HEL-1027 live verify dashboard").
  Confirmed via direct DOM read (`element.value`) that the textbox retained the FULL
  string `"target"` and stayed connected/mounted throughout — Defect 1 (keystroke
  drop) is genuinely fixed. Network log showed exactly ONE debounced filtered
  request, and the disclosure correctly settled to "3 results." immediately
  afterward in that same interactive session.

### Verdict: REFUTE

### A NEW, live, reproduced, SETTLED-wrong defect — the persisted-default variant of
### Defect 2 is NOT fixed, contradicting `evaluation-2.md`'s PASS claim for this exact scenario

Per the task brief's explicit instruction to "reproduce the StrictMode double-invoke
stale-response race with a persisted filter default on a fresh page load," I did
exactly that — and it fails, reproducibly, on a genuinely fresh dev-server process
(ruling out any HMR-staleness confound from my own earlier file-revert testing):

1. Confirmed via `fetch('/api/outputs/fb968d18-...')` from the browser (not curl —
   session-cookie-authenticated) that the Output's config has a genuinely PERSISTED
   filter default: `"columnFilters": {"quick": "target"}`.
2. Killed the (possibly-stale-from-my-own-editing) frontend dev server entirely
   (`kill <pid>`, confirmed port free), restarted it fresh via
   `start-servers.sh` — new Vite process confirmed started at 16:12:00, **after**
   the reviewed commit's timestamp (15:44:48) and after all my earlier file
   revert/restore activity, eliminating any possibility of stale HMR module state.
   Re-ran `assert-phase.sh servers` → `PASS`.
3. Did a genuine full-page `page.goto` (not an SPA navigation) to the dashboard,
   THREE separate times (two on the fresh server, one more after clearing
   `caches`/`localStorage`/`sessionStorage` to rule out any browser-side cache
   confound). **All three times**, after waiting 2s, 8s, and 2s respectively (well
   past the 300ms `REFETCH_DEBOUNCE_MS`), the panel settled on:
   - Table correctly shows only the 3 "target" rows (idx 5/25/45) — this is
     `TableRenderer`'s own, separate, client-side filter masking, not evidence the
     server round-trip happened.
   - Disclosure text: **"60 results."** — the RAW unfiltered total, not "3
     results." This is the exact wrong, settled state `skeptic-final-1.md`
     originally reported and this cycle's fix (`usePanelSortFilter.ts`'s task-7.3
     effect, lines 167-176, "live-UI-verification finding") explicitly claims to
     correct.
4. Network log (`browser_network_requests`, non-static, full list, all three
   trials): exactly two unfiltered `GET /api/outputs/.../rows?offset=0&limit=200`
   requests (the `usePanelData` mount-effect StrictMode double-invoke) and **zero**
   requests carrying a `filter=` query parameter, in any of the three trials. The
   task-7.3 effect that is supposed to fire the compensating filtered fetch once the
   persisted default is known simply never dispatches it — this is not a race two
   requests are losing, it is a fetch that never happens.
5. Confirmed via React DevTools' global hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`,
   read-only fiber-tree introspection — no source file modified) that the LIVE
   Redux state for this panel's `paginationState` genuinely holds `total: 60` (the
   raw value), i.e. this is a real, settled store-state defect, not a rendering
   artifact layered on top of correct state.
6. Screenshot persisted:
   `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/.skeptic-evidence/hel1027-defect2-persists-fresh-reload.png`
   (captured on the fresh-server trial, before the cache-clear trial).

**This directly contradicts `evaluation-2.md`'s Phase 3 claim** ("Defect 2 live
reproduction (both reloads, dark theme): ... both times the settled disclosure
correctly read '3 results.'", citing screenshot `hel1027-c2-dark-settled.png`,
which I also viewed — it does show "3 results." for the identical Output/dashboard).
I cannot explain the discrepancy from code reading alone (the render-time seeding
logic and the task-7.3 effect look structurally sound, and the three new unit/
integration tests for this exact scenario — including
`PanelCard.staleFetchSequencing.test.tsx`'s own StrictMode-wrapped harness — pass).
What I can state with confidence, from repeated, reproduced, fresh-process,
cache-cleared live evidence: **the fix does not reliably hold in the actual running
app**, whatever the evaluator observed in their own session. Per this role's
"single anomalous reading is not a verdict" discipline, I re-ran this three times
under progressively more rigorous conditions specifically to rule out my own
tooling being the anomaly, and the wrong "60 results." state was the *only* outcome
I ever observed, never the correct one.

### Change Requests

1. **Root-cause, with a probe, why the persisted-default correction effect
   (`usePanelSortFilter.ts` lines 167-176) never dispatches a filtered fetch in the
   real running app**, even though `output.config.columnFilters` is confirmed
   present and `isFiltering` on it is confirmed true. The existing unit test
   (`PanelCard.staleFetchSequencing.test.tsx`) evidently does not reproduce whatever
   real-app condition suppresses this — that test's `mockGetOutputById` resolves
   near-instantly via a plain `mockResolvedValue`, which may not accurately model
   the real network-latency-driven interleaving between `PanelCard`'s own
   `useOutputMeta(outputId)` resolving and `usePanelData`'s own mount-effect fetch.
   Per `systematic-debugging.md`, add instrumentation (a probe) to confirm exactly
   which of these is true before changing code: (a) `seededOutputId` never
   transitions off `null` in the live app, (b) it transitions but `activeFilter`
   read by the effect is stale/empty, or (c) the effect runs and calls
   `dispatchFetch` but the dispatch itself is somehow suppressed. The React
   DevTools fiber-introspection technique in this report (read-only,
   `__REACT_DEVTOOLS_GLOBAL_HOOK__.onCommitFiberRoot`) is one way to get this
   answer directly from the running app without guessing.
2. Once root-caused, fix the persisted-default path so the filtered total
   genuinely lands on a fresh page load with a persisted filter default — this is a
   direct, unresolved AC #5 violation ("With a filter active, `hasMore` and any
   displayed count describe the filtered set") for a very ordinary scenario
   (anyone who filters a table and then reloads the page, or anyone visiting a
   dashboard someone else already filtered and saved).
3. Add a regression test that fails against the CURRENT committed code (not just
   against `ad84d7f6`) for this exact scenario, since the existing
   `PanelCard.staleFetchSequencing.test.tsx` passes today despite the live app
   being broken — that test's mock timing needs to be widened (e.g. genuinely
   asynchronous/deferred `getOutputById`, matching its own already-deferred
   `getOutputRows` pattern) until it can demonstrate the gap a real browser shows.

### Non-blocking notes

- The three cycle-2 regression tests for Defect 1, the sequencing guard's own unit
  behavior, and the Load More sort/filter carry-through are all genuine, well-
  targeted, and red-first-verified by me independently. Only the specific
  persisted-default-on-reload path is broken.
- Gate-defect note (CON-160-adjacent): `evaluation-2.md`'s own Phase 3 section
  states its three screenshots were initially captured to the main checkout's root
  by the Playwright tool rather than persisted at capture time, then "caught and
  corrected before finalizing." I did independently view the persisted
  `hel1027-c2-dark-settled.png` this report cites, so I am not merely taking that
  correction on faith — but flagging per this role's instructions that a gate
  accepting an evidence artifact whose capture-time discipline was already
  self-reported as violated (even if later corrected) is worth noting. In this
  case it does not change my verdict either way — my REFUTE rests on my own fresh,
  independently-captured, independently-persisted evidence, not on any deficiency
  in the evaluator's own screenshot handling.
- Per the task brief, this is final-gate round 2 of a `SKEPTIC_FINAL_ROUNDS: 2`
  budget — this REFUTE should escalate to a human rather than starting a third
  round, per `workflow-state.md`'s own annotation.
