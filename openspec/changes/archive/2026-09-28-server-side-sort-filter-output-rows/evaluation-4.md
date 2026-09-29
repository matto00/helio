## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed commit: `5f4fe0b24c394e6b4fea908ff06df96364c2c262` (cycle-4 diff base:
`03137f28bab9c61a3b6535440edb287805b67d1c`; full-change diff base:
`55ad1d6dedb9bad5d65f13a81e3b22731553e9b1`, LIVE-resolved). `skeptic-final-3.md` fully root-caused
the persisted-filter-default defect prior cycles couldn't pin down: `MobilePanelStack` never
threaded the resolved Output into `PanelCardBody`/`usePanelSortFilter`, so the correction effect's
guard never cleared on the phone-stack path — a 100% deterministic, viewport-width-gated gap, not a
timing race.

**Headline, per the requesting brief's non-negotiable instruction: I made my live check
discriminating this cycle. I independently reproduced "60 results." (the wrong total) against the
actual pre-fix commit (`03137f28`) at mobile width, on a freshly-restarted dev server, with browser
storage cleared, before ever accepting the fix's own "3 results." result at the same width on the
same fresh-restart methodology. This is the negative control that was missing in cycles 2 and 3.**

### Phase 1: Spec Review — PASS

AC #5's remaining gap (persisted filter default correctness) is now closed for both render paths.
Cycle 3's hardening in `usePanelSortFilter.ts` stays, correctly recharacterized (per CR3) as
addressing a real-but-different fragility, not the actual root cause. No scope creep: production
changes are confined to `PanelCard.tsx` (moves `useOutputMeta` ownership into `PanelCardBody`) and
`PanelContent.tsx` (`OutputPanelContent` accepts an optional `output`/`outputMetaLoading` and skips
its own fetch when supplied). `workflow-state.md`'s `CONSTRAINTS` remains empty.

### Phase 2: Code Review — PASS

**Gates run fresh:**
- `npm run lint` — clean.
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` — **360 suites / 3894 tests, all passed** (+1 suite/+1 test vs. cycle 3, matching the
  new `MobilePanelStack.staleFetchSequencing.test.tsx`).
- `npm --prefix frontend run build` — succeeds.
- Backend: zero `backend/` paths touched this cycle (confirmed via `git diff --stat`); not re-run,
  consistent with every prior cycle's identical reasoning; cycle-1's fresh `sbt test` (4854/4854)
  stands.

**Requested check — is the "single shared `useOutputMeta`, net fetch count unchanged" claim real?
Traced both render paths myself:**
- **Mobile path**: `MobilePanelStack.tsx` is **untouched this cycle** (empty diff) — it doesn't need
  to be, since `MobileStackPanelBody` already renders the shared `<PanelCardBody>` (imported
  directly from `PanelCard.tsx`), and the fix moved `useOutputMeta(outputId)` INTO `PanelCardBody`
  itself (no longer an externally-supplied, desktop-only `output` prop — that prop was removed
  entirely from `PanelCardBodyProps`). Before this fix: 0 real fetches available to seed
  `usePanelSortFilter` on this path (the actual bug), plus 1 independent fetch inside
  `OutputPanelContent` for kind-dispatch. After: exactly 1 fetch (`PanelCardBody`'s own), shared by
  both `usePanelSortFilter`'s seed and `OutputPanelContent` (which now receives it as a prop and
  skips its own fetch — verified by reading `useOutputMeta(outputId)`'s own source: passing `null`
  genuinely skips the `getOutputById` call rather than just discarding the result). Net: 1, not 0,
  not 2.
- **Desktop path**: `PanelCard`'s own separate `useOutputMeta(outputId)` call for
  `chartInspectConfig` (line 336, pre-existing, HEL-572 D1/D5, untouched) plus `PanelCardBody`'s new
  own call — 2 fetches, same count as before (previously: `PanelCard`'s own + `OutputPanelContent`'s
  own independent one, now: `PanelCard`'s own + `PanelCardBody`'s own/shared). No regression, and
  the previously-documented "two independent fetches could theoretically disagree for a render"
  cosmetic limitation between `PanelCardBody`'s seed and `OutputPanelContent`'s render is now closed
  by construction for that specific pair (a genuine bonus, not previously requested).
- **`PanelFullscreenOverlay`/`PanelDetailModal`**: confirmed by reading both call sites directly —
  neither passes `output`/`outputMetaLoading` to `<PanelContent>`, so `outputProp` stays `undefined`,
  `hasExternalOutput` is `false`, and `OutputPanelContent` falls through to its own independent fetch
  exactly as before. Zero behavior change for these two callers, confirmed not merely asserted.

**Requested check — does this reintroduce `evaluation-1.md`'s double-fetch race?** No. That race was
specifically a SECOND independent `useOutputMeta` fetch inside `MobileStackPanelBody` itself, racing
against `OutputPanelContent`'s own. This fix produces the opposite shape: `OutputPanelContent` no
longer fetches at all once a caller supplies `output` — there is exactly one fetch on the mobile
path, never two independently-resolving copies.

**Requested check — the incidental `PanelCard.test.tsx` fix.** Read the diff and surrounding test in
full: the added `await act(async () => { await Promise.resolve(); await Promise.resolve(); })` runs
strictly BEFORE `callsBeforeRerender` is captured, not after — it only lets `PanelCardBody`'s own new
internal `useOutputMeta` mount-settling finish before the baseline is taken. The actual regression
assertions (`mockUsePanelPolling.mock.calls.length` unchanged, `getOutputRowsMock` still called
exactly once after an unrelated title-edit re-render) are untouched and remain a real, strict check
of the memo boundary. Not a loosened assertion.

**Independent red-first re-verification of `MobilePanelStack.staleFetchSequencing.test.tsx`:**
reverted `PanelCard.tsx` and `PanelContent.tsx` to their exact `03137f28` content via `git show`, ran
the new test — failed exactly as claimed (`filteredCalls.length` was `0`, expected `>= 1`). Restored
both files exactly (`git status --short` clean confirmed), re-ran — 1/1 passing.

**Minor doc-staleness (non-blocking):** `PanelCard.tsx`'s pre-existing comment at the `chartInspectConfig`
`useOutputMeta` call (line ~328) still cites "`PanelContent`'s own `OutputPanelContent`... already
fetch[es] this same Output independently" as supporting precedent — that's no longer true for a
`PanelCardBody`-rendered panel post this fix (that fetch was just eliminated). Similarly,
`MobileStackPanelBody`'s own comment ("The cross-filter is now applied entirely inside
`OutputPanelContent`, using the Output it already resolves") is still functionally accurate but now
describes the Output's *source* imprecisely (it's supplied, not resolved by that component anymore).
Cosmetic; flagged as a suggestion.

### Phase 3: UI Review — PASS, with a genuine, matched-condition negative control this time

**Negative control (mandatory per the brief) — reproduced the defect myself, live, against the
actual pre-fix code:**
1. Reverted `PanelCard.tsx`/`PanelContent.tsx` to `03137f28` (`git show 03137f28:<path> > <path>`,
   confirmed via `git status --short`).
2. Killed the running dev server, confirmed port free, restarted fresh (`start-servers.sh`, new pid
   `1826950`, `readlink /proc/1826950/cwd` confirmed against this worktree's `frontend/`, started
   after the revert).
3. Re-seeded the Output's persisted filter default (`columnFilters: {"quick":"target"}`) via the
   real UI (typed into the quick filter, waited for the `canWrite`-gated persist debounce, confirmed
   via `GET /api/outputs/:id` that it actually persisted).
4. Resized to 375×812, cleared `localStorage`/`sessionStorage`/`caches`, did a genuine full-page
   `page.goto` reload.
5. **Result: "60 results." (wrong)** — reproduced. Network log confirmed exactly two unfiltered
   `GET /rows` requests and **zero** `filter=` requests. React fiber introspection on
   `LoadedScopeDisclosure`'s own `memoizedProps` confirmed a genuine wrong store value
   (`matchCount: 60`), not a stale-DOM-text illusion. Screenshot persisted:
   `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/hel1027-c4-negative-control-mobile-wrong.png`.

**This negative control succeeded — unlike every prior cycle's live check (mine in cycles 2/3, and
the executor's), which always settled correctly even against known-broken code. This is the first
time in this ticket's evaluation history that I have personally, directly reproduced the reported
defect.**

**Positive result, same matched rigor:**
1. Restored `PanelCard.tsx`/`PanelContent.tsx` to their exact committed content (`git status
   --short` clean confirmed).
2. Killed the dev server again, restarted fresh (new pid `1831535`, cwd/start-time confirmed).
3. Cleared storage, full reload at 375×812 (persisted filter default still intact from step 3
   above — no re-seed needed since the config PATCH is server-side, unaffected by the frontend
   restart). **Result: "3 results." (correct)**, with the network log showing the `filter=target`
   request actually reaching the server. Repeated twice more (3 total mobile trials) — identical
   correct result every time.
4. Resized to 1440×900 on the same fixed build, reloaded — **"3 results." (correct)**, confirming no
   desktop regression. Screenshots persisted:
   `/home/matt/Development/helio/.concertino/runs/HEL-1027/evidence/hel1027-c4-fixed-mobile-correct.png`
   and `.../hel1027-c4-fixed-desktop-correct.png`.

**A methodology note worth disclosing, since it bears on how much weight to put on fiber-level
introspection in this whole dispute's evidence trail:** on the mobile-fixed trial, my first
fiber-walk attempt read `LoadedScopeDisclosure`'s `memoizedProps.matchCount` as `60` — apparently
contradicting the correct DOM text ("3 results.") and correct network request I'd just observed on
the SAME page state. Investigating rather than reporting a false anomaly: `fiber.alternate.
memoizedProps.matchCount` read `3` — the correct, current value. This is a known subtlety of React's
fiber double-buffering (`current` vs. `alternate` trees); a naive `element.__reactFiber$*` walk (the
technique used by the final-gate skeptic and by me across cycles 2-4) can land on either buffer
depending on exactly when it reads, and does not automatically resolve to the authoritative one the
way the real React DevTools extension does internally. The DOM text and the network request are
self-authenticating and were never in question; only my own ad-hoc fiber-introspection script
briefly was. I flag this because prior cycles' fiber-introspection evidence (mine and the
skeptic's) should be understood as corroborating, not infallible — the DOM/network evidence is the
primary source of truth throughout this dispute, and it has been consistent throughout.

No console errors attributable to this ticket's code in any trial.

### Overall: PASS

This is a confident PASS, not a deferred or hedged one, for the first time in this dispute's
history: I obtained genuine discriminating evidence — a working negative control against the actual
pre-fix code, on the exact scenario and viewport the final-gate skeptic identified, followed by a
clean positive result on the fix using the identical methodology. Combined with an independently
re-derived red-first regression test, a traced-and-confirmed "no reintroduced race, no fetch-count
regression" analysis of the actual diff, and all other gates green, this closes the loop the prior
two cycles could not.

### Non-blocking Suggestions

1. Two stale doc comments (`PanelCard.tsx`'s `chartInspectConfig` `useOutputMeta` comment;
   `MobileStackPanelBody`'s cross-filter comment) still describe `OutputPanelContent` as
   independently fetching, which is no longer accurate for a `PanelCardBody`-rendered panel post
   this fix. Cosmetic; a follow-up comment pass would keep the file's own narrative accurate.
2. (Carried, unaffected) `NodeSnapshotRepository.scala`/`OutputService.scala` remain over the
   250-line soft file-size budget.
3. (Carried, unaffected) The `400` error body shape cosmetic deviation from design.md D3, already
   reconciled in the spec.
