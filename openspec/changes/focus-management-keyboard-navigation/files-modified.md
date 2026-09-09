# Files modified — HEL-520

## Cycle 1

- `e2e/support/stateContrast.mjs` — extended `classifyState` with a `stateKind` parameter (D1a/D1c). For
  `stateKind: "focus"`, an outline/border/box-shadow-only change is now ratio-enforcing instead of the
  pre-existing `"advisory"` deferral. Default (`"hover"`) path unchanged.
- `e2e/support/stateContrast.selftest.mjs` — added selftest cases for the focus path. 35 passed, 0 failed.
- `e2e/support/stateContrastProbe.ts` — added `FOCUSABLE_SELECTOR` (D1d).
- `frontend/src/shared/ui/Modal.test.tsx` — added restore-on-close unit coverage (AC4).

## Cycle 2

- `e2e/support/forceFocusVisible.ts` (new) — extracted `forceFocusVisible` out of
  `state-surface-contrast-guard.spec.ts`, namespaced the marker `data-hel520-force-focus`.
- `e2e/state-surface-contrast-guard.spec.ts` — replaced the module-local `forceFocusVisible` with an import.
  **CR6 (evaluation-1.md) correction of what was actually confirmed, cycle by cycle:**
  - **Cycle 2** ran a stashed-source A/B against a pre-extraction copy of this file and observed the SAME
    `/settings` coverage-partition failure the post-extraction copy produced — evidence the extraction didn't
    introduce that failure, but that run was NOT carried to full completion (it was cut short before the
    suite's final summary line).
  - **Cycle 3**'s own re-run of the full (post-extraction) file was independently cut short by a tighter watch
    window before its final assertion line printed either — genuinely NOT re-confirmed to completion that
    cycle, despite files-modified.md's prior wording claiming otherwise ("reconfirmed in Cycle 3 below"). That
    wording was wrong and is corrected here rather than repeated.
  - **The question is now settled by the evaluator's own fresh, full-completion run** (evaluation-1.md Phase 2
    issue 5): `e2e/state-surface-contrast-guard.spec.ts` on this branch — **1 passed (3.9m), 470 probed, 470
    resolved, 22 reviewed exemptions, no partition failure**. The `/settings` failure both executor cycles saw
    did not reproduce; it was transient/environmental, and the "pre-existing, not introduced by this diff"
    judgement is correct, but on THIS evidence, not on either executor cycle's own (incomplete) claim. Task
    2.6a-ii's `[x]` is justified by the evaluator's run.

## Cycle 3 — the AC2 spine (per orchestrator's explicit cycle-3 scope: items 1–4 only; §4/§5 dropped to
follow-up tickets)

### New files

- `e2e/support/focusPresenceProbe.ts` (new) — shared AC2 measurement core (`readIndicatorSnapshot`,
  `parseHaloSpread`/`parseHaloColor`, `readAncestorClipBoxes`, `readBackdrop`, `measureOneElement`), on the
  `touchTargetProbe.ts`/HEL-813 pattern: imported by BOTH the steady-state guard and its regression harness so
  "the same measurement logic goes red on the known-bad shape" is guaranteed by import.
- `e2e/focus-presence-guard.spec.ts` (new) — the AC2 focus-presence e2e spec (tasks 2.3, 2.5, 2.5a, 2.6a–2.6c).
  Sweeps every visible `FOCUSABLE_SELECTOR` match (uncapped) across 4 routes x 2 themes, using a REAL
  `.focus()` + CDP-forced `:focus-visible` (see the in-file comment on why real focus is required: several
  row-hosted triggers reveal only via an ancestor `:focus-within` rule, which `CSS.forcePseudoState` alone
  never triggers — a harness bug this cycle found and fixed, not a live app defect). Measures presence,
  clipping (ancestor overflow-hidden geometry), and contrast (reusing `stateContrast.mjs`'s `classifyState`
  with `stateKind: "focus"`). Occlusion detection (task 2.4) is explicitly NOT implemented — see below.
- `e2e/hel520-focus-presence-guard.regression.spec.ts` (new) — §7's demonstrated-RED harness. One case
  (clipped ring) fully proven red-then-green against real rendering source. See below for what's missing.

### Modified

- `frontend/src/features/pipelines/ui/PipelineDetailHeader.css` — added
  `.pipeline-detail-header__add-source-btn:focus-visible { outline-offset: -2px; }`. A REAL defect the AC2
  sweep found: the button's default global focus ring (`outline: var(--app-focus-ring); outline-offset: 2px`)
  extended 4px beyond its own 20x20 box, clipped by `.pipeline-detail-header__group-value`'s 25px-tall
  `overflow: hidden` text-ellipsis ancestor. `-2px` is DESIGN.md §8's own documented carve-out for exactly this
  shape ("use -2px only where the ring would clip (flush list items)"). Confirmed fixed by re-running the
  sweep (clip finding gone) and by the regression harness's Case B (proven red on revert, green on the fix).
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — updated one line-pinned baseline entry for
  `PipelineDetailHeader.css` (333 -> 350): unchanged content (`padding: 2px 6px;`), shifted purely because the
  clip-fix rule + its comment were inserted earlier in the same file. Caught by the pre-commit hook itself on
  first attempt; fixed and re-verified (`tokenAuditSweep.css.test.ts`: 46 passed) before this commit.

## AC2 measurement results (task 3 adjudication, by rendering — not CSS reading)

**Superseded by Cycle 4 below (CR1: the enforced floor was corrected from 1.10 to the 3:1 non-text floor;
re-measuring at the corrected floor roughly doubled the named-residual population).** This paragraph is left
for history; see "Cycle 4" for the current, accurate numbers.

Cycle-3 sweep (superseded): 196 elements measured, 8 views, runtime ~98s, 1 real defect fixed (the add-source
button clip), 5 named residuals — all measured against `CONTRAST_THRESHOLD` (1.10), a constant `stateContrast.
mjs`'s own header comment discloses is NOT a WCAG floor (evaluation-1.md CR1). That measurement undercounted
the true residual population; do not cite the "5" figure.

**Task 3's full 11-named-site enumeration was NOT completed by rendering** — the sweep's 4 seeded routes never
render `AccentPicker`, `PanelGrid`'s panel-title input, `DashboardList`'s rename inputs, or
`PipelineDetailPage`'s schedule/output inputs (each needs a specific interaction — a panel, a rename click, a
schedule set — the seed data doesn't produce). Only the sites that happened to render in the swept views were
actually measured; `tasks.md` reflects this (3.1/3.2a left unchecked). Task 3.2c's specific lead
(`inputs.css:60-64`'s aria-invalid variant) was similarly not rendered — no seeded field is in an invalid
state. Task 3.2d's grep sweep (`\[[a-z-]+(=[^]]*)?\]:focus`) still stands from cycle 2: exactly one hit, so the
attribute-qualified blind spot is a one-off, not systematic.

## What's incomplete, and exactly why — reported, not softened

- **Task 2.4 (occlusion detection): NOT SHIPPED.** A `document.elementsFromPoint`-based sampler was built and
  run against the live app. It produced a confirmed FALSE POSITIVE: `.app-skip-link`'s outline ring — correctly
  stacked above `.app-command-bar` by `z-index` — sampled as "100% occluded", because neither `outline` nor
  `box-shadow` ever expands an element's HIT-TEST box (both are paint-only effects); `elementsFromPoint`
  returns whatever sits underneath in DOM hit-test geometry regardless of actual paint order. This cannot
  distinguish "painted behind a sibling" (the real defect this check exists to catch) from "correctly painted
  on top of something unclickable" (the normal case for nearly every ring in this app). Removed rather than
  shipped broken; a sound version needs real paint-order resolution (z-index/stacking-context comparison, or
  pixel screenshot diffing) that this cycle's budget did not reach.
- **§7 Case A (suppressed-with-no-replacement): now delivered — see Cycle 4.** The cycle-3 file-mutation
  attempts described here are superseded; kept as history of the wrong turns actually taken (CR4's
  `page.addStyleTag` approach avoided the Vite-HMR race entirely — see Cycle 4).
- **§7 Case C (occluded): not attempted** — occlusion detection itself was never shipped (above), so there is
  no detector to prove red against. Still true after Cycle 4.
- **§4 (AC1 rendered measurement) and §5 (AC3 keyboard flows): explicitly dropped from this ticket's scope**
  by the orchestrator's cycle-3 decision, to be split into follow-up tickets. Still true after Cycle 4.

## Cycle 4 — addressing evaluation-1.md CR1–CR6

### CR1 [BLOCKING] — the enforced contrast floor was 1.10, not the 3:1 non-text floor every artifact states

`e2e/support/focusPresenceProbe.ts` — replaced the inherited `CONTRAST_THRESHOLD` (1.1, `stateContrast.mjs`'s
own constant, whose header comment explicitly disclaims being a WCAG floor) with a new, local
`FOCUS_NONTEXT_CONTRAST_THRESHOLD = 3.0`, with a comment stating which floor is enforced and why. Branch (a)
per the orchestrator's explicit steer: enforce 3:1, re-measure, name every site that then fails.

Re-measured: the residual population **roughly doubled** — 10 named sites (5 per theme; previously the
1.10-threshold measurement found only the 5 light-theme instances). All 10 are the same root cause
(`.ui-input`-family `--app-accent-dim` focus halo) at two exact measured ratios, one per theme (1.0828 light,
1.1443 dark) — both now short of 3.0 (previously only the light-theme ratio was short of 1.10). The
`KNOWN_RESIDUAL_RATIO` allowance (now `KNOWN_RESIDUAL_RATIOS`, a two-entry list) still matches on the exact
measured floats per theme, not on desc/view text. Per design.md D1c, **the token's own derivation stays out of
this ticket's scope** (HEL-1046/1050 own it) — named, not fixed.

### CR2 — deleted the two de-scoped spec deltas

Deleted `openspec/changes/focus-management-keyboard-navigation/specs/dialog-focus-lifecycle/spec.md` and
`.../specs/keyboard-flow-operability/spec.md` in full. Updated `proposal.md`'s Capabilities section (both
deltas removed from "New Capabilities"; a new "Scope amendment" section records the cycle-3 orchestrator
decision and points to the follow-up tickets that will carry these deltas). `openspec validate --type change
focus-management-keyboard-navigation`: **valid**.

### CR3 — narrowed the accessible-focus-indicator delta to clipping only; removed dead occlusion claims

`specs/accessible-focus-indicator/spec.md` — retitled "Occlusion and clipping count as absence" to "Clipping
counts as absence", deleted the "An indicator painted behind a sibling is not credited" scenario, and added an
inline note naming occlusion as an unowned follow-up with the reason (hit-test geometry excludes paint-only
effects). `e2e/focus-presence-guard.spec.ts` — removed "unoccluded" from the test title (line 70) and the
failure message (line ~265); rewrote the module comment to state occlusion is explicitly out of scope rather
than implying coverage. `e2e/support/focusPresenceProbe.ts` — removed the unreachable `| "occluded"` member
from the `Verdict` union.

### CR4 [BLOCKING] — Case A (suppressed-with-no-replacement) now delivered via `page.addStyleTag`

`e2e/hel520-focus-presence-guard.regression.spec.ts` — added a real Case A test: reads `#email`'s own resting
`border-color`/`background-color` live (before any focus on the page — see the real timing bug found and fixed
below), injects a real `<style>` element via `page.addStyleTag` with a higher-specificity
`#email:focus-visible { outline: none !important; box-shadow: none !important; border-color: <resting>
!important; background-color: <resting> !important; }`, and drives the SAME `measureOneElement` path the
steady-state guard uses. No file on disk is touched; the injected `<style>` is removed via `el.remove()` to
revert.

**A real bug was found and fixed while building this**, not merely worked around: calling `measureLive` twice
on the same element within one test (baseline, then mutated) intermittently corrupted the SECOND call's `base`
snapshot — `inputs.css`'s `transition: border-color, box-shadow` from the FIRST call's blur was still
resolving when the second call read its resting state, misreading a real indicator as absent (or vice versa).
Root-caused by direct reproduction (a minimal debug spec calling `measureLive` twice and logging every
intermediate value), not guessed. Fixed by adding an explicit blur + 200ms settle at the START of `measureLive`
before it reads `base`, not only in the `finally` cleanup at the end — this is now the correct, general fix for
`measureLive` itself, not a Case-A-specific workaround.

Also fixed while diagnosing: the baseline assertion could not be `expect(baseline.verdict).toBe("pass")` as
originally planned, because at the corrected 3:1 floor `#email` itself is one of the CR1 named residuals (its
real baseline is `"fail"` at a known ratio, not `"pass"`). Changed to assert the baseline is one of
`["pass","fail"]` (i.e., a real indicator is present and measured, just possibly below today's floor) and that
the reverted state exactly matches the baseline's verdict AND ratio — a stronger, more honest check than
asserting a "pass" that isn't actually true right now.

### CR5 [BLOCKING] — added a coverage-partition assertion to the main sweep

`e2e/focus-presence-guard.spec.ts` — added `stampFocusableDocument`/`assertRouteFullyCovered`, adapted from the
sibling HEL-866 guard's `stampDocument`/`assertPartitioned` pattern for this spec's simpler single-view-per-
route shape (no chrome/sidebar-rail split to union). Stamps every element this spec's own filter would accept
(visible, enabled, `FOCUSABLE_SELECTOR`-matched) with a unique `data-hel520-doc-id`, records which ids were
actually swept, and asserts the two sets are equal after each route — naming any leftover element loudly. The
prior `expect(totalMeasured).toBeGreaterThan(0)` headline-only check is superseded (left removed, not merely
supplemented, since a per-route partition assertion subsumes it).

### CR6 — corrected files-modified.md's Cycle 2 claim

See the Cycle 2 section above, rewritten in place to state precisely what was and was not confirmed in each
cycle, including the evaluator's own fresh full-completion run (470 probed, no partition failure) as the actual
basis for task 2.6a-ii's `[x]`.

### Non-blocking suggestions actioned

- `tasks.md` — checked 2.6a (CDP `forcePseudoState` is used, with a real `.focus()` layered under it — a
  documented, correct deviation) and 2.6 (the "don't use a bare `getComputedStyle` presence read" prohibition
  is honoured) with a one-line note each.
- `focusPresenceProbe.ts`'s `KNOWN_RESIDUAL_RATIOS` comment now states the expected trigger explicitly ("if
  this goes red after a theme-token change, re-measure and update the constant, do not widen the epsilon").
- The `readBackdrop` duplication and the missing root `node_modules` note are left as follow-up items, per the
  evaluator's own framing (not blocking, and out of this cycle's remaining scope).

## Verification transcripts (fresh, Cycle 4)

- `npm run check:e2e-types`: clean.
- `npx eslint` on every new/changed e2e file: clean, 0 warnings.
- `npm run format:check`: clean.
- `npx openspec validate --type change focus-management-keyboard-navigation`: valid.
- `e2e/focus-presence-guard.spec.ts` fresh run at the corrected 3:1 floor: **1 passed** (196 elements, 8 views,
  ~98s; 10 named residuals logged — 5 per theme — 0 unnamed failures; coverage-partition assertion ran without
  incident on all 8 routes).
- `e2e/hel520-focus-presence-guard.regression.spec.ts` (opt-in, `HEL520_REGRESSION=1`,
  `playwright.regression.config.ts`): **2 passed** —
  - Case A: baseline `fail` (ratio=1.1443, the known dark-theme residual) -> mutated `no-indicator` (the
    injected-style override) -> reverted `fail` at the SAME ratio (1.1443) as baseline.
  - Case B: baseline `pass` (ratio=5.109) -> mutated `clipped` (`clipped on X by ancestor box [302.0,553.3]`)
    -> reverted `pass` (ratio=5.109), against the real `PipelineDetailHeader.css` source.
  - `git status --short` confirmed clean after the run (no leftover mutations; Case A never touches a file).

## Cycle 5 — addressing evaluation-2.md CR-A and CR-B

### CR-A [BLOCKING] — retraction: the "10 named residuals" were a probe defect, not real gaps

**`e2e/support/focusPresenceProbe.ts`'s `measureOneElement` graded exactly ONE channel by precedence
(`outline > box-shadow > border`), not every channel that actually changed.** Every one of the 10 sites cycle
4 named as accepted `--app-accent-dim` residuals is `.ui-input`-family, governed by `inputs.css:36-42`, which
sets THREE things under `:focus-visible`: `outline: none` (so precedence always fell through), a real,
contrast-derived `border-color: var(--app-focus-ring-color)` (the ACTUAL conforming indicator), and a
deliberately decorative `box-shadow: 0 0 0 3px var(--app-accent-dim)` halo. Precedence graded the halo and
never measured the border. Measured live with the fixed rule: the border alone clears the 3:1 floor at
**4.9596 (dark)** and **3.4815 (light)** — comfortably above threshold — while the halo alone measures
1.1443/1.0828, exactly the ratios `KNOWN_RESIDUAL_RATIOS` matched on. **None of the 10 lacked a conforming
indicator; the HEL-1046/1050 attribution in cycles 3-4 was wrong** — it would have sent that ticket lineage to
"fix" a glow that is behaving exactly as designed, not a real defect.

**Fix: an any-channel rule**, not a reordered precedence (reordering to prefer border would be the identical
bug pointed the other way, and would misgrade a real site where the shadow — not the border — is the only
conforming channel). `measureOneElement` now: (1) collects every channel that changed (outline/box-shadow/
border/background) as independent candidates, each with its own ring-band geometry (outline and box-shadow
extend outward and get their own clip check; border/background are painted at the element's own edge); (2)
measures each unclipped candidate's contrast against the same composited backdrop; (3) passes if ANY channel
clears `FOCUS_NONTEXT_CONTRAST_THRESHOLD` and reports that channel's ratio (the best one, if multiple pass);
(4) if none pass, reports the best (highest) ratio measured, so the failure message still names the closest
channel rather than an arbitrary one.

Re-measured with the fix: **196 elements, 8 views, 0 named residuals, 0 unnamed failures.** The residual
population went to zero, exactly as the evaluator predicted. Per the evaluator's explicit instruction, the
`KNOWN_RESIDUAL_RATIOS` allowance block is **deleted outright**, not left empty — `e2e/focus-presence-guard.
spec.ts` now asserts on `findings.filter(f => f.verdict !== "pass")` directly, with a comment recording the
retraction and pointing here. `design.md` and `proposal.md` were checked and do not name the 10 sites or the
ratios directly (only `files-modified.md` and the guard's own in-code comments did), so no further correction
was needed there.

### CR-B — added a per-view non-emptiness floor

`e2e/focus-presence-guard.spec.ts`'s `assertRouteFullyCovered` opened with `if (coveredIds.size >=
totalStamped) return;`, which is vacuously true when both sides are 0 — a route rendering zero focusable
elements (a login regression, an error boundary, a seeding change) passed silently. Added an explicit
`totalStamped === 0` check that throws before the partition comparison, naming the view.

### Verification transcripts (fresh, Cycle 5)

Dev servers had died between evaluator cycles (noted by the orchestrator) — restarted via
`scripts/concertino/start-servers.sh`, and `readlink /proc/<pid>/cwd` confirmed both processes' cwd resolved
to this worktree before trusting any reading.

- `npm run check:e2e-types`: clean.
- `npx eslint` on every changed file: clean, 0 warnings.
- `npm run format:check`: clean.
- `e2e/focus-presence-guard.spec.ts`: **1 passed** (196 elements, 8 views, ~98s, 0 residuals — re-run twice,
  once before and once after deleting the `KNOWN_RESIDUAL_RATIOS` block, both clean).
- `e2e/hel520-focus-presence-guard.regression.spec.ts` (`HEL520_REGRESSION=1`): **2 passed** —
  - Case A: baseline now `pass` (ratio=4.9596 — the border channel, correctly graded) -> mutated
    `no-indicator` -> reverted `pass` at the same ratio.
  - Case B: baseline `pass` (ratio=5.109) -> mutated `clipped` (detail now correctly labelled
    `outline: clipped on X by ancestor box [302.0,553.3]`, naming which channel was clipped) -> reverted
    `pass` (ratio=5.109).
  - `git status --short` clean after the run.
- `e2e/state-surface-contrast-guard.spec.ts` (sibling HEL-866 guard, untouched this cycle, re-run per the
  orchestrator's instruction): **1 passed (4.1m)** — 490 probed, 490 resolved, 0 unresolved, 22 reviewed
  exemptions, no partition failure.

## Cycle 6 — addressing evaluation-3.md's flaky Case A

### The blocker: Case A was flaky (2 failures in 5 runs, including the evaluator's first run of the cycle)

Failure signature: `[Case A][mutated] verdict=fail detail=ratio=1.440754096742417` where `no-indicator` was
expected. Root cause, diagnosed by the evaluator and confirmed by inspection, not re-derived independently:
`e2e/hel520-focus-presence-guard.regression.spec.ts`'s `measureLive` waited only **200ms** after blur before
reading `base` — but `theme.css`'s `--app-transition` is **160ms**, and `inputs.css` transitions
`border-color` on it, so 200ms was only 1.25x headroom. A mid-transition `base.raw.borderColor` read made
`borderChanged` evaluate true, collected a spurious border candidate, and produced a `fail` verdict at a
ratio corresponding to an intermediate transition frame — the identical ratio across both observed failures
is exactly what a deterministic mid-transition read produces, not noise. The function's own line ~4 lower
already used 400ms for the equivalent post-focus wait, with a comment arguing 400ms as ">2x headroom" against
this same 160ms transition — the 200ms wait was the one spot that hadn't been brought in line with that
reasoning.

**Fix:** changed 200 to 400 in `measureLive`'s pre-`base`-read wait, matching the existing post-focus wait's
margin and rationale.

### Documented, not fixed: absolute-contrast-vs-delta gap in the any-channel rule (measured, zero exposure today)

Per the evaluator's instruction, this is recorded as a documentation item, not treated as a bug to fix this
cycle. `measureOneElement`'s any-channel rule (Cycle 5) grades each changed candidate channel on its ABSOLUTE
contrast against the backdrop, not on the MAGNITUDE of the change from its resting value — so, in principle,
an imperceptible 1/255 background shift on an already-high-contrast element could be credited as a passing
indicator it never actually presented. This is inherited unchanged from the old precedence rule's background
fallback branch, not introduced by the any-channel change. The evaluator's own sweep of 50 focusable elements
across `/` and `/settings` measured the live channel-change distribution — outline 47, box-shadow 11, border
3, background 2, none 0 — and found **zero elements rescued only by a border or background candidate** (every
passing element also had a passing outline or box-shadow candidate). Exposure measured at zero today; the gap
is named in `focusPresenceProbe.ts`'s in-code comment (next to the `Candidate` interface) so a future reader
finds it documented rather than rediscovering it as new.

### Verification: 5 consecutive regression-harness runs, 5/5 green (the actual evidence this cycle needed)

Dev servers had died again between evaluator cycles (per the orchestrator's note) — restarted via
`scripts/concertino/start-servers.sh`, `readlink /proc/<pid>/cwd` confirmed both processes' cwd resolved to
this worktree before trusting any reading.

Ran `HEL520_REGRESSION=1 npx playwright test --config=playwright.regression.config.ts
e2e/hel520-focus-presence-guard.regression.spec.ts` **five consecutive times**, each a fresh process against
the same live server (not a single run repeated in-process — five independent invocations, per the
evaluator's ask for repetition as evidence a single green run cannot provide):

| Run | Case A | Case B | Result |
| --- | --- | --- | --- |
| 1 | baseline `pass` (4.9596) → mutated `no-indicator` → reverted `pass` (4.9596) | baseline `pass` (5.1090) → mutated `clipped` → reverted `pass` (5.1090) | 2 passed (17.9s) |
| 2 | pass (4.9596) → no-indicator → pass (4.9596) | pass (5.1090) → clipped → pass (5.1090) | 2 passed (17.5s) |
| 3 | pass (4.9596) → no-indicator → pass (4.9596) | pass (5.1090) → clipped → pass (5.1090) | 2 passed (18.5s) |
| 4 | pass (4.9596) → no-indicator → pass (4.9596) | pass (5.1090) → clipped → pass (5.1090) | 2 passed (17.1s) |
| 5 | pass (4.9596) → no-indicator → pass (4.9596) | pass (5.1090) → clipped → pass (5.1090) | 2 passed (17.2s) |

**5/5 green, identical ratios on every run** — the fix resolved the flake, not merely happened to pass once.

Also re-ran the main sweep once (`e2e/focus-presence-guard.spec.ts`, unaffected by this cycle's change but
confirmed clean regardless): **1 passed**, 196 elements, 8 views, 0 residuals, ~98s.

## Gate results (task 8.1, fresh)

`npm run lint`, `npm run typecheck`, `npm run check:e2e-types`, `npm run format:check`, `npm run check:tokens`,
`npm run check:state-contrast:selftest`, `npm test` (full pre-commit hook chain) — all green. See commit's
pre-commit hook output.


## Ownership of unmeasured surfaces and de-scoped ACs (orchestrator, post-evaluation)

`accessible-focus-indicator` requires that a site knowingly left unverified be named with its reason
AND carry a filed item owning the remainder. Naming alone is not sufficient. Those items now exist:

- **HEL-1062** — Dialog focus lifecycle (AC1 / §4, de-scoped from this ticket): `MobileNavSheet`'s
  hand-rolled trap/restore/Escape verified by rendered measurement, `Select.tsx` judged against
  listbox semantics, and the `Modal` restore-heuristic generalisation question (design.md D4a)
  answered on evidence.
- **HEL-1063** — Keyboard-only flows (AC3 / §5, de-scoped) **and the owner of this sweep's
  unmeasured surfaces**: `AccentPicker`, panel-title inputs, rename inputs and schedule inputs, which
  this ticket's seeded routes never render. Also owns the documented absolute-contrast-vs-delta gap in
  the any-channel rule should extending coverage ever give it non-zero exposure.

Both spec deltas drafted here for those capabilities (`dialog-focus-lifecycle`,
`keyboard-flow-operability`) were **deleted rather than archived**: archiving would have canonised
normative requirements that nothing in the tree implements or verifies. They are recoverable from this
change's history and are noted in both tickets as starting points.

### AC accounting as delivered

- **AC1** — not claimed. De-scoped to HEL-1062.
- **AC2** — met for the measured population: 196 focusable elements across 4 routes x 2 themes,
  uncapped, by rendered measurement, one real defect found and fixed (a clipped ring in
  `PipelineDetailHeader.css`), zero unnamed failures. The AC is worded universally; the surfaces the
  seeded routes never render are named above and carry to HEL-1063. Reported as met-for-the-measured-
  population rather than universally, per design.md D2b's pre-committed framing.
- **AC3** — not claimed. De-scoped to HEL-1063.
- **AC4** — met unqualified, as of Cycle 7. Trap coverage pre-existed; restore-on-close coverage was added
  to `Modal.test.tsx` in Cycle 1 but was vacuous until Cycle 7's fix (see below) — until then this line
  overclaimed. Now proven by mutation (RED with `Modal.tsx`'s restore line removed, GREEN with it
  present), and `ShareDialogFocusRestore.test.tsx` serves as the consuming surface.

## Cycle 7 — addressing skeptic-final-1.md CR1 (AC4's restore assertions were vacuous)

### The blocker: both AC4 restore cases in `Modal.test.tsx` asserted nothing, proven by mutation

`frontend/src/shared/ui/Modal.test.tsx`'s `beforeEach` stub for `HTMLDialogElement.prototype.showModal`
only set the `open` attribute — it never moved focus, unlike a real `showModal()` (which moves focus into
the dialog per the HTML spec). Consequence: while the modal was "open" in the test, `document.activeElement`
never left the trigger, so `expect(document.activeElement).toBe(trigger)` after close was true **by
precondition**, whether or not Modal's own restore effect ran at all. The skeptic proved this by mutation
(deleting `Modal.tsx:116`'s `previouslyFocusedRef.current?.focus();` and observing all 23 tests in the file
still pass) and reproduced it twice. This is exactly the MISTAKES.md/HEL-1060 "assertion whose precondition
guarantees it" shape, sitting in the one AC this change was about to report as met unqualified.

### Fix

1. **The `showModal` stub now moves focus**, to the dialog's first focusable descendant (its own `Close`
   icon-button, in DOM order before any body content) — mirroring real `<dialog>` behaviour closely enough
   for this file's fixtures. This also makes the file more internally coherent: the existing Tab/Shift+Tab
   trap cases below already assumed focus starts inside the dialog.
2. **Both restore cases now assert the precondition explicitly**: focus is asserted to have actually LEFT
   the trigger (onto the Close button) while the modal is open, THEN asserted to return to the trigger after
   close. The first half is what makes the second half meaningful — without it, the assertion is provably
   vacuous, as demonstrated above.
3. **The second case ("does not throw when the trigger is detached") was rewritten**, not left as-is: `?.
   focus()` on a captured-but-detached element can never throw, so `.not.toThrow()` alone was never real
   coverage. Investigated what actually happens (a disconnected element's `.focus()` call is a documented
   no-op in both real browsers and jsdom — it does NOT move focus to `document.body`, an assumption an
   earlier draft of this fix got wrong and corrected before shipping) and rewrote the assertion around the
   real, testable behaviour: focus is left completely undisturbed (still on the Close button, the element
   focused immediately before the restore effect ran). This has a genuine failure mode — it catches a
   regression where restore-on-close was changed to move focus even when the captured element can no longer
   receive it (e.g. an unconditional fallback focus target).
4. **Checked the other 21 (now 21, unchanged) tests in the file** — none depend on the stub's prior
   no-focus-movement behaviour; all pass unmodified alongside the two rewritten restore cases.

### Mutation proof (RED then GREEN), the actual transcript

Deleted `Modal.tsx:116` (`previouslyFocusedRef.current?.focus();`, replaced with a comment marker), ran
`npm --prefix frontend test -- --testPathPatterns=Modal.test` fresh:

```
FAIL src/shared/ui/Modal.test.tsx (6.146 s)
  ● Modal › focus restore on close › restores focus to the element that was focused before the modal opened

    expect(received).toBe(expected) // Object.is equality

    - Expected  -  2
    + Received  + 24

    - <button>
    -   Trigger
    + <button
    +   aria-label="Close"
    ...
    > 324 |       expect(document.activeElement).toBe(trigger);
          |                                      ^

Test Suites: 1 failed, 6 passed, 7 total
Tests:       1 failed, 118 passed, 119 total
```

**RED, for the stated reason**: the exact restore assertion fails, showing `document.activeElement` is still
the Close button (never restored) rather than the trigger. Reverted `Modal.tsx` (`git diff --stat` confirmed
byte-identical to the pre-mutation file), re-ran the same command:

```
Test Suites: 7 passed, 7 total
Tests:       119 passed, 119 total
```

**GREEN.** The suite now genuinely depends on `Modal.tsx`'s restore-on-close behaviour, not merely on a stub
artifact.

### Non-blocking items also fixed this cycle

- `e2e/hel520-focus-presence-guard.regression.spec.ts` step 2's comment claimed `#email`'s "real baseline
  verdict is 'fail' at a specific, known ratio, not 'pass'" — stale since Cycle 5's any-channel-rule fix
  (CR-A). Every observed run since (six by the evaluator, one by the skeptic, this cycle's own re-runs)
  reports `verdict=pass ratio=4.9596`. Comment corrected to state the current, accurate behaviour and why the
  assertion is deliberately left as `["pass","fail"]` rather than narrowed.
- Two stale "occlusion sampling" comments in `e2e/focus-presence-guard.spec.ts` (~268, ~273) still described
  removed code (occlusion detection was removed in Cycle 3/4 — see `focusPresenceProbe.ts`'s module comment).
  Corrected to describe what the code actually measures today (clip/backdrop reads, no occlusion sampling).

### Verification (fresh, Cycle 7)

- `npm run typecheck`, `npm run check:e2e-types`, `npm run lint`, `npm run format:check`: all clean.
- `npm --prefix frontend test -- --testPathPatterns=Modal.test`: **119 passed, 119 total** (post-fix, with the
  real restore assertions in place).
- `git status --short` after the mutation-and-revert cycle: clean (no leftover diff on `Modal.tsx`).

## Gate results (task 8.1, fresh, Cycle 7)

`npm run lint`, `npm run typecheck`, `npm run check:e2e-types`, `npm run format:check` — all green.
