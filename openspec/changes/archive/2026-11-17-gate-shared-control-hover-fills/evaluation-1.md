## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD a02681da07368d04bdfb619e7008c8bfe0edbf88 against base fd3fbe7d098e6518cfd5ea44469a5a398cde2742 (resolved live).

### Phase 1: Spec Review — PASS
- AC1 (no sticky hover after a tap, touch e2e failing first): verified independently. With the parent shared CSS swapped in,
  `e2e/hel1675-shared-hover.spec.ts` fails in both themes with instances 1, 3, 4, 5 and 6 RED. Each diff is the hover recipe
  (for example, instance 1 dark: bg `rgba(0,0,0,0)` -> `rgb(22,21,20)`, border 0.09 -> 0.18 alpha), not a focus ring.
  Instance 2 is green, logged, and not asserted. That is the C1 "guard + probe only" treatment, and it is disclosed in
  files-modified.md. On HEAD all six are green in both themes, and every "under pointer" check holds.
- AC2 (the guard covers the shared CSS): `sharedHoverGating.css.test.ts` walks `shared/**/*.css`. On the parent CSS it fails
  (1 failed / 3), and on HEAD it passes.
- AC3 (desktop hover unchanged): verified. See Phase 3.
- The ticket-premise corrections are recorded in design.md: IconButton and `.ui-modal-btn` are covered outside the sheet,
  and D4 instance 4 was corrected to the compute function-reference summary.
- Tidy items: both primary hover blocks are merged. The 1100px comment is rewritten, the 1280 gap is asserted, and
  SpineSourceCard makes one `useNow` call. The useNow test is red on the pre-split code (Expected 1, Received 2), which
  I verified. `useTopModalDialog` and the feature stylesheets are deferred to HEL-1736 / HEL-1735.
- Scope / HEL-1684 surface: the spine-area edits are limited to D6's files (PipelineSpineHeader.css, PipelineMobile.css,
  SpineSourceCard.tsx, SourceSampleLabel.tsx) plus the D3 guard refactor and the 2.3 jest test. pipelineDraft.ts, the step
  spine, the draft hooks and the draft preview are untouched.
- CONSTRAINTS C1 is honoured: red-first was shown, the non-red instance is probe-only, and the test reads computed styles,
  never `:hover`.

### Phase 2: Code Review — FAIL
Gates (fresh, in WORKTREE_PATH): `npm run lint` exit 0; `npm run format:check` exit 0; `npm test` exit 0 (root 66
suites / 579 tests, frontend 773 suites / 9477 tests); `npm --prefix frontend run build` exit 0. No backend changes.

CSS review: every shared rule is wrapped in place, with no specificity or order change. The mixed lists are split correctly:
- `inputs.css:147-155`: the hover block stays before `--selected`, so the original specificity and order relationship holds.
- `DataGrid.css:348-356` and `MobileNavSheet.css:285-293`: same correct split.
- The merged primary blocks compute the same as the old two-block cascade (border transparent, accent-strong, accent-ink).
  Desktop probe below.

Issues:
1. DRY / design D3 deviation:
   - `frontend/src/test/cssHoverGating.ts:68-93` adds `ungatedHoverSelectors(files, isAllowed)` and `mixedGatedRules(files)`.
   - `frontend/src/features/pipelines/ui/pipelineHoverGating.css.test.ts:63-94` still carries its own copies of both loops,
     which are the same logic.
   - The `isAllowed` parameter has no caller, so it is a dead abstraction.
   - D3 says the offender and mixed-list checks move into the shared module and the pipeline guard imports them.
2. Dead comment: `e2e/hel1675-shared-hover.spec.ts:61` has a JSDoc ("Applies the instance's effect with the given
   activation ...") but no member under it. It is left over from a removed field.
3. Planning-artifact mismatch: design.md D4 says the desktop test runs at "1280x800, no touch". In fact the "desktop"
   describe (`e2e/hel1675-shared-hover.spec.ts:348-349`) runs at 390x844 with a mouse. The behaviour is sound, because the
   in-sheet instances only exist in the phone layout. I also confirmed it with my own 1280 probe below. But neither the
   artifact nor the spec says this.

Checked and acceptable:
- Blur-before-read (`hel1675-shared-hover.spec.ts:332`) does not mask a hover defect. I probed with the blur removed on HEAD.
  The only difference in either theme is instance 3 (Select trigger): accent border `rgb(219,101,19)` plus a 3px
  accent box-shadow, which is the `:focus-visible` ring after the Escape key closes the listbox. No other instance changes.
  With the parent CSS, the RED reads survive the blur, so blurring does not clear `:hover`.
- Readiness waits:
  - The waits use real signals: menuitem/listbox/dialog visible or gone, `details[open]`, the GET `/sample` response, then
    `aria-busy="false"` and the button enabled, then `getAnimations()` settled.
  - `openPipeline` waits on `.spine-row`, `data-theme` and `document.fonts.ready`.
  - There are no fixed timeouts.
- The kept `SourceSampleLabel` wrapper is now referenced only by `SourceSampleLabel.test.tsx`. CONTRIBUTING.md has no
  dead-code or test-only-export rule, and keeping the wrapper avoids churning the existing component test. It is acceptable,
  and is listed as a suggestion below.

### Phase 3: UI Review — PASS
Servers were started with start-servers.sh on 7107/10014 (PASS servers).
- Touch e2e: on HEAD, 4/4 passed (touch and desktop-mouse, both themes). With the parent CSS, the 2 touch tests fail
  (5/6 RED) and the 2 mouse tests pass. So the DESKTOP_HOVER fixture really is the unchanged-CSS hover paint, and HEAD
  matches it.
- Desktop/phone visual cohesion (C12):
  - Probe: an evaluator scratch spec, deleted after the run.
  - What it does: mouse-hovers the spine-header / mobile-pill primary button, the refresh IconButton and the first
    `.popover__trigger`, at 1280x800 and at 390x844 (hover-capable), in light and dark. It records the rest and hover
    computed paint.
  - What it ran against: HEAD, and then the parent CSS (all 20 shared stylesheets plus PipelineSpineHeader.css and
    PipelineMobile.css).
  - Result: the two JSON outputs are byte-identical, and the hover paint differs from rest in every case. Desktop hover is
    unchanged, including the merged primary blocks.
  - I checked a screenshot of the 1280 light page visually; there was no layout breakage.
- `e2e/hel1668-header-meta.spec.ts` + `e2e/hel1668-phone-sheet.spec.ts`: 23/23 passed on HEAD.
- The change is CSS gating only, with no layout rules touched, so breakpoint layout is unaffected beyond the probes above.
- The worktree was restored to clean after every CSS swap (`git status` empty).

### Overall: FAIL

### Change Requests
1. In `frontend/src/features/pipelines/ui/pipelineHoverGating.css.test.ts`, replace the hand-written loops in the
   "every :hover selector" test (lines ~63-80) and the "no gated rule mixes" test (lines ~83-94) with calls to the shared
   helpers:
   - `ungatedHoverSelectors(rulesByFile, (file, rule, selector) => REVEAL_ALLOWLIST.some(...))`, keeping the existing
     allowlist predicate.
   - `mixedGatedRules(rulesByFile)`.

   This removes the duplicated logic and gives `isAllowed` its caller, as D3 specifies. The assertions and the allowlist
   stay the same. Re-run the guard and one un-gate mutation to show it still fails.
2. Delete the orphaned JSDoc at `e2e/hel1675-shared-hover.spec.ts:61`.
3. Record the desktop-mouse viewport in two places:
   - design.md D4: the mouse test runs at 390x844 with a hover-capable pointer, because the named in-sheet controls only
     render in the phone layout.
   - A one-line comment at `e2e/hel1675-shared-hover.spec.ts:349`.

   Alternatively, add a 1280x800 pass. The evaluator's 1280 probe shows identical values, so recording the deviation is
   enough.

### Non-blocking Suggestions
- `SourceSampleLabel.tsx`: the wrapper's JSDoc ("owns the one manual re-fetch") now describes `SourceSampleLabelView`.
  Move that sentence to the View, or retire the wrapper and render the View plus the hook in its test.
- `e2e/hel1675-shared-hover.spec.ts:379`: `if (DESKTOP_HOVER[theme])` is always true. Drop the condition.
- The module-level `touchMode` flag toggled in `beforeAll`/`afterAll` works per worker. A describe-scoped option (or reading
  `hasTouch` from the test info) would be less stateful.
- The blur is only needed for instance 3. Its comment could say so.
