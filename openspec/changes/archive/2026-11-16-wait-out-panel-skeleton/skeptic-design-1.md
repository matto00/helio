## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD fd7064f7d700e49a2f7dfc1f6a244aab02048fd2 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/wait-out-panel-skeleton/HEL-1633`.
- `PanelGridSkeleton.tsx:30`: `<div className="panel-grid-shell" aria-label="Loading panels">`, desktop branch renders
  `DesktopPanelGridSkeleton` (an RGL `Responsive`, so stub items are `.react-grid-item`s), phone branch renders
  `MobilePanelStackSkeleton`. CONFIRMED.
- `Crossfade.tsx`: skeleton layer `crossfade__layer crossfade__skeleton` stays mounted with `aria-hidden`/`inert` while
  `!loading && !skeletonGone`, unmounts on `transitionend`/`transitioncancel`/no-running-animation rAF. Content layer is
  `crossfade__layer` without `crossfade__skeleton`; `PanelList.tsx:442-466` passes `contentFade={false}` and `block`,
  not `keepContentMounted`, so the live layer only exists once loading ends. CONFIRMED: both item sets coexist during the
  fade. Fade length: `Crossfade.css` `.crossfade__skeleton` transitions over `--motion-duration-standard`, which is
  `280ms` (`frontend/src/theme/theme.css:92`).
- hel1572 density test (`e2e/hel1572-appearance-preferences.spec.ts:339,352-400`) already uses the live-layer selector
  and loads `/dashboards` twice (lines 359, 384), not `/home`. Premise restatement CONFIRMED.
- `e2e/hel1575-reload-after-edit.spec.ts:47`: bare `.react-grid-item` `toHaveCount(1)` right after `page.reload()`.
  With a 1-entry saved layout the skeleton stubs (tier-1, `panelGridSkeletonStubs.ts`) also produce exactly 1 item,
  so this assertion can be satisfied by the skeleton. FIX target is real.
- hel1028:78, hel1457:44/120 existing waits CONFIRMED (`grep -rn "Loading panels" e2e`).
- Sweep size: `grep -rn "react-grid-item" e2e` = 74 hits in 28 files; `panel-grid-card` = 73 hits. Manageable.
- `npm run check:e2e-types` exists (`package.json:58`).
- AC coverage: AC1 -> task 1.8 / D5; AC2 -> tasks 1.4-1.6 / D2-D3. No AC uncovered; no scope drift beyond the
  ticket's own "What" plus a guard spec (justified as red-first proof for a new helper).

### Verdict: REFUTE

The plan is close, but the guard spec's red-first proof (D4) is not achievable as written, and D3 rests on a
false premise about where `.panel-grid-card` comes from. Both are cheap to fix in the artifacts now.

### Change Requests

1. **D4 "step-1-only" mutation cannot go red as specified.** D4 says the guard asserts "total `.react-grid-item` count
   exactly N (no stub left)" after the helper. If written as `expect(locator).toHaveCount(N)` (the repo idiom, and
   the natural reading), it auto-retries for up to 5 s, and the stub layer unmounts within ~280 ms of the swap
   (`theme.css:92`), so the mutated helper (step 1 only) still passes. Ditto the "every item's box non-zero"
   check if it is polled. Revise D4 (and task 1.7) to require that the post-helper assertions are **one-shot,
   non-retrying reads taken immediately after the helper returns** (`await page.locator(".react-grid-item").count()`,
   one `evaluateAll` for boxes, then plain `expect(value)`), and state that explicitly so the executor cannot
   satisfy it with a retrying matcher.

2. **D4 "step-2-only" mutation goes red only by timing luck.** With step 1 removed, the helper is just
   `getByLabel("Loading panels")` count 0. Whether that passes vacuously depends on whether the skeleton has mounted
   by the time `goto` resolves. If the panels-route delay (~1.5 s) means the skeleton is already on screen, step 2
   alone waits it out correctly and the mutant is green. The design must name a deterministic vacuous window, e.g.
   also delay the request that comes before PanelList mounts and shows the skeleton (session/dashboards bootstrap),
   or call the helper before the skeleton can exist. Alternatively, run each mutation repeatedly (for example
   `--repeat-each 5`) and require red on every repetition. Record which one is chosen. A mutation that is red only
   sometimes is not red-first evidence.

3. **D3's premise is wrong: the desktop skeleton renders `.panel-grid-card` too.** `DesktopPanelGridSkeleton.tsx:69-72`
   renders `<PanelCardSkeleton />` per stub, and `PanelCardSkeleton.tsx` root is
   `<div className="panel-grid-card" aria-hidden="true">`. So at desktop widths every skeleton stub is a
   `.react-grid-item > .panel-grid-card`, not just on phone (proposal Non-goals and design D3 both say "the phone
   skeleton renders that class"). Fix the stated rationale in proposal.md and design.md D3. Then add a D2 rule:
   a `.react-grid-item` locator filtered with `has: .panel-grid-card` (or any skeleton-shared class such as
   `.panel-grid-card__top`/`__footer`) is **not** `OK-filtered`, since the skeleton satisfies it. Only text, a
   title, or a real-card-only attribute counts. Deferring `.panel-grid-card` hits outside touched files is still
   acceptable scope, but the follow-up note must say they are desktop-exposed too.

### Non-blocking notes

- The helper only applies at desktop widths (phone real content has no `.react-grid-item`). Worth a one-line doc
  comment on `waitForPanelGrid` so nobody calls it from a phone-viewport test and gets a 5 s timeout.
- hel1584 motion specs (`hel1584-motion-surfaces`, `hel1584-motion-perf`) may observe the crossfade on purpose.
  Classify those hits carefully, and do not "fix" a test whose subject is the fade.
- D5: record `uptime` and `free -g` both before and after the run, as planned. If `--repeat-each 30` on the whole file
  takes very long, that is fine, but do not narrow it to `-g Compact` without saying so. AC1 is about hel1572.
