## Context

See proposal.md (Why). HEL-1668 gated the pipeline page's own hover fills and guards them in
`features/pipelines/ui/pipelineHoverGating.css.test.ts` (a CSS rule parser plus an allowlist of hover reveals).

Design round 1 (skeptic-design-1) showed the four controls in the ticket text are not the whole in-sheet set:
`MobileStepSheet.tsx` renders the `ActionsMenu` trigger (`popover__trigger`, `shared/chrome/Popover.css:21`), and
`StepCardFocused` renders every step-config editor (Select, IconButton, SegmentedRadioGroup, …) plus the preview
`DataGrid`/`SortableTh` and `OutputSchemaDisclosure` (`disclosureSummary.css`). Ticket premise correction: no
`.ui-modal-btn` renders inside the sheet itself; the nearest are page-level dialogs (`PipelineDraftDialogs.tsx`),
reachable on the phone page via Save (cascade confirm) or the leave guard, never from inside the sheet (D4).
So scope is every stylesheet under `frontend/src/shared/` (today: `grep -rn ':hover' frontend/src/shared --include=*.css`
lists 38 selector lines in about 20 files, all in `shared/ui` and `shared/chrome`). None is a reachability reveal:
SortableTh glyph colour, DataGrid resize-handle line, AccentPicker dot scale are hover effects, not controls that
become reachable only via hover. Mixed lists exist and are split: `inputs.css:145` (`:hover` + `--focused`),
`DataGrid.css:348` (`:hover::after` + `:active::after`), `MobileNavSheet.css:281` (`:hover` + `:focus-visible`).

Pre-planning probe (scratch, Playwright Chromium): with `devices["Pixel 7"]` (`(hover: hover)` false) a bare
`#a:hover { background: red }` is still red 1.5 s after `page.tap("#a")`; the gated rule stays at rest; at 1280x800
without touch `(hover: hover)` is true and `page.hover()` applies the gated rule. `el.matches(":hover")` read false
while the computed red persisted, so e2e reads computed styles only.

## Goals / Non-Goals

**Goals:** no shared control keeps a hover effect after a tap; desktop hover identical in light and dark; a written
rule and a guard over all of `shared/`; the tidy items, each minimal.

**Non-Goals:** feature stylesheets outside `shared/` and the HEL-1668 set; `useTopModalDialog` narrowing. Both are
filed as follow-ups (task 3.1: HEL-1735, HEL-1736).

## Decisions

**D1. Gate in place.** Wrap each hover rule in `@media (hover: hover) { … }` at its current source position. A media
block adds no specificity and keeps cascade order, so consumer overrides (skeptic-verified: `App.css:202-210,557-558`,
`ContextList.css:43-58`, `PanelGrid.css:327`, `PipelineSpine.css:404-410`) resolve exactly as today on desktop. Existing
mobile/coarse-pointer media blocks that contain `:hover` (if any) get the gate nested or are restated inside it so the
guard's "inside `@media (hover: hover)`" ancestor check holds. Rejected: a global reset or a JS `.has-hover` root class
(changes specificity/order for every consumer, adds runtime state).

**D2. Split mixed lists.** The non-hover member (`--focused`, `:active::after`, `:focus-visible`) stays ungated with
the same declarations; the `:hover` member moves into the gate.

**D3. One parser, two guards.** Move `stripComments/splitTop/parseRules` and the offender/mixed-list/allowlist-rot
checks into `frontend/src/test/cssHoverGating.ts`; the pipeline guard imports it with its FILES and allowlist unchanged
(assertions untouched, still green). New `frontend/src/shared/sharedHoverGating.css.test.ts` discovers files by
walking `frontend/src/shared/**/*.css` (no hand list, so a new shared stylesheet is covered automatically), has an empty
allowlist, and a non-vacuity floor equal to the measured hover-selector count after the change. Mutation proof: for
EACH gated file, un-gate one rule and record the guard failing with that file and selector (scripted, transcript kept as
evidence), plus one mixed-list mutation.

**D4. Touch e2e, red first.** New `e2e/hel1675-shared-hover.spec.ts`: `isMobile/hasTouch/deviceScaleFactor: 2` like
`hel1668-phone-sheet.spec.ts`, 390x844 (375x812 too if cheap), light and dark, seeded with `seedPipeline` from
`e2e/support/hel1582Phone.ts` (filter, sort, compute steps). Tap primitive: `realTap` from `e2e/support/hel1668.ts`;
plain `tap()` is also measured once on the unchanged CSS and the PR states which was red. Named instances. In the phone step sheet (seed `seedPipeline(page, ..., wide)` so the preview has more than 12 fields):
1. ActionsMenu trigger: the sheet header's "Step actions" trigger (stays mounted; tap opens, Escape closes).
2. ActionsMenu item: tap a non-destructive item that is enabled on the chosen step and stays enabled after it acts (e.g.
   "Move up" on the middle step, or an item that does not reorder), then reopen the menu and read the item at the
   tapped point; the executor confirms the reopened item at that point is the same enabled item kind.
3. Select trigger: the filter step's `Select` (`FilterConfig.tsx:106`) or the sort step's field Select
   (`SortConfig.tsx:64`); tap opens the listbox, Escape closes it, the trigger stays mounted.
4. Disclosure summary: the compute step's function-reference `<details>` summary (`ComputeFunctionReference.tsx`,
   class `disclosure-summary`, `disclosureSummary.css:40`, a colour-only hover); tapping toggles it without unmounting.
   (Correction, execution cycle 1: the step preview's `OutputSchemaDisclosure` trigger is
   `.output-schema-disclosure__trigger`, a pipeline-owned control HEL-1668 already gated, so it was never a shared
   control and reads green on unchanged CSS by design.)
Measured fact: with this fixture the sheet's only shared IconButton is the Modal Close button, which unmounts the
sheet, and no `.ui-modal-btn` dialog opens from inside the sheet (sheet "Remove" is a draft-only delete). So these two
are covered on the phone pipeline page, outside the sheet:
5. IconButton: the phone source card's "Refresh sample of <source>" IconButton (`SourceSampleLabel.tsx`, `size="xs"`):
   tap, wait for the refresh to finish (`aria-busy` false and the button enabled again), read it. It stays mounted. If it
   cannot be made red, IconButton is "guard + probe only".
6. `.ui-modal-btn`: route A, remove a step with dependents in the sheet, close the sheet, tap the phone page's Save;
   if the save returns `cascadeRequired` the cascade dialog opens; tap Cancel, Save again to reopen, read the button at
   the tapped point. The executor first confirms whether the seeded linear filter/sort/compute chain triggers
   `cascadeRequired` (`usePipelineDraftSave.ts:297-300`); if not, route B, the unsaved-draft leave guard
   (`PipelineDraftDialogs.tsx`): make a draft edit, navigate away, tap "Stay"/Cancel, trigger the guard again, read.
Each check: read rest computed `background-color`, `border-color`, `color` (and `transform` where relevant); tap; wait
on a real signal (menu/listbox/dialog visible or gone, disclosure `open` toggled, refresh settled, then
`getAnimations()` on the control empty), never a timeout or skeleton-matchable selector; re-read and expect rest.
**Red-or-not-covered rule:** the spec is committed and run against the UNCHANGED CSS first; only instances shown red
there count as e2e-covered. An instance that cannot be made red through its named route is NOT claimed as e2e-covered:
it is listed in the PR body as "guard + probe only" (its rule is gated and guarded; the bare-rule probe above is the
substitute evidence). Expected red: instances 1, 3 and 4 (stay mounted, canonical sticky case), likely 5; 2 and 6 depend
on reopen-at-point behaviour. Escalate if instance 1 or 3 is not red, or if fewer than four of the six are red.
Desktop test (hover-capable mouse at 390x844, both themes: the named in-sheet controls render only in the phone
layout; the evaluator's 1280x800 probe of the header, refresh IconButton and popover trigger gave identical values): mouse-hover each named control and assert hover computed values equal
the values recorded from the unchanged CSS (committed as a fixture in the spec).

**D5. DESIGN.md rule** in §5 next to the control hover recipes: hover effects live inside `@media (hover: hover)`;
reachability reveals are named exceptions registered in the guard allowlist; focus/active/selected/pressed are never
gated; name both guards.

**D6. Tidy, minimal diffs (HEL-1684 rebase surface).** `spine/PipelineSpineHeader.css`: merge the two
`.spine-header__btn--primary` hover blocks into one (`border-color: transparent; background: var(--app-accent-strong);
color: var(--app-accent-ink)`), and rewrite the top comment to today's meta-line behaviour read from the CSS.
`mobile/PipelineMobile.css`: same merge for `.mobile-pill--primary`. `spine/SpineSourceCard.tsx` +
`sources/ui/SourceSampleLabel.tsx`: split a presentational `SourceSampleLabelView` taking the hook result; the card
calls the hook once and renders the view (one `useNow` per card; jest test counting intervals, red before).
`e2e/hel1668-header-meta.spec.ts`: at 1280 assert `trailingLeft - boxRight` (the meta box's right edge to the trailing
controls) is at most the header gap plus 1px, the bound read from the logged measurement, red under a mutation that
reserves width. No other spine file is touched. If any tidy item needs more, drop it to a follow-up.

## Risks / Trade-offs

- [Wide CSS diff across `shared/`] → mechanical wrap in place; guard + desktop e2e + visual cohesion screenshots.
- [A consumer relies on ungated shared hover on touch] → all in-scope rules are effects, none reveals (verified above).
- [Merged primary block computes differently] → computed-style comparison before/after in both themes.
- [Touch e2e flake from transitions] → wait on `getAnimations()` empty, not a timeout.

## Planner Notes

- Self-approved: `useTopModalDialog` and non-shared feature stylesheets go to follow-ups (driver-authorised; filed).
- Ticket premise correction recorded: no `.ui-modal-btn` and no stays-mounted IconButton render inside the sheet with
  this fixture; both are covered on the phone pipeline page (D4 instances 5 and 6), not as in-sheet coverage.
