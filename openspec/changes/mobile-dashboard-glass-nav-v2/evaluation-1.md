## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `c1f01eb6d2b44b0047990ded665d01863fc77168` against live-resolved base `60086f02bb5b1ee48f2246bc09e3e66349199585`.
Scope: Phase A only (tasks 1.x, 2.1, 2.2; ACs 1, 2, 4 and the Phase A spec deltas). Phase B / AC3 is blocked on the
pending owner escalation (C4) and was not judged. Task 2.3 (full e2e suite) is deferred to the final head by plan.

### Fresh gate evidence (this evaluator's own runs, this worktree)
- `npm run lint`: exit 0. `npm run format:check`: exit 0 ("All matched files use Prettier code style!").
- `npm test` (local cap of 3 workers): exit 0. Root 51 suites / 469 tests, frontend 615 suites / 7292 tests. A targeted verbose re-run
  from `.../HEL-1583/frontend` (DashboardChipRow, PanelList.phoneShell, PanelList.css, MobilePanelStack.css,
  mobilePanelHeights, token guards): 9 suites / 81 tests passed.
- `npm --prefix frontend run build`: exit 0.
- e2e (`DEV_PORT=7015`, 2 workers): `hel1583-mobile-dashboard`, `hel813-mobile-touch-target-floor` and
  `hel1023-breakpoint-layout-derivation` all passed, 43 tests in 1.9m, and the 43 throwaway users were deleted.
- Independent rendered-pixel probe: my own Chromium instance, not the shared MCP browser, on port 7015 only. It ran after
  `document.fonts.ready` at 320/375/390/430/768 in light and dark. Raw log:
  `/home/matt/Development/helio/.concertino/runs/HEL-1583/evidence/openspec/changes/mobile-dashboard-glass-nav-v2/evidence/eval1-probe.log`.

### Phase 1: Spec Review — FAIL
- AC1 (markdown text <= 28px at 375px): **holds.** I measured it from text Range rects. The first glyph is 27px from the left edge
  at every width and in both themes. Cards are 12/12px from the edges, and the markdown and text bodies are 27/27px.
- AC2 (one-tap chip switch, active chip in view on load): **holds.** Chip B tap goes to `/dashboards/B` and B becomes active.
  I also ran the chip A -> sheet C -> chip A sequence. The sheet changed the selection to C while the URL stayed at
  `/dashboards/A`. One tap on chip A then showed A again, with C's body gone. The order stayed the same through all the
  taps. The active chip is inside the row at load at every width (`scrollLeft` 41 at 320 light). Enter on a focused chip
  switches dashboards too, and the chip shows a 2px solid focus outline.
- AC4 (nothing floats but the nav, plus bottom clearance): **holds.** At every width and theme, the only visible fixed or
  sticky element is `.bottom-nav`. `.app-skip-link` is also fixed but sits off-screen at top -800. There are no zoom
  widgets (0 in the DOM) and no horizontal overflow. Scrolled to the end, the last card's bottom is at 712 and the nav
  top is at 732.
- Not rendered at desktop (1100) or 769px. Not rendered on `/sources`. It does render on `/home`, which is correct on
  this base: `AppRoutes.tsx:112` mounts `PanelList` at `/home`, so that route is the dashboard view.
- **Issue 1 (spec vs implementation): the chip 44px floor is not met for short names.** Spec
  `specs/mobile-dashboard-chips/spec.md` says "Every chip SHALL meet the 44px touch-target floor". The chip has no
  minimum width, and the `::after` expander only grows the hit area vertically (`left: 0; right: 0`). I made a
  dashboard named "Q" and bisected its hit area with `elementFromPoint`: **37.75px wide x 44.75px tall**. The painted
  box is 37x32. Evidence: `.../evidence/eval1-375-light-shortchip.png`. The e2e and CSS tests miss this because they
  only check the `::after` height and use long names ("HEL-1583 ... Board N").
- **Issue 2 (spec text vs implemented and tested behaviour).** `specs/mobile-viewer-stack/spec.md` says the markdown
  body's "last line SHALL end no more than 28px from the right edge". Ragged-right text can't meet that, and nothing
  tests it. Measured right-edge gaps of the longest line: 42px at 390, 51px at 430, 153px at 768. The executor's own
  measurements.md also reports 132px at 768. The e2e asserts the body box's right edge instead (27px). The spec needs
  to say what is actually built and tested.
- Tasks 1.1–1.5, 2.1 and 2.2 are ticked and match the diff. Task 2.3 is open by plan. No scope creep. The `hel813` and
  `hel1023` edits follow from the retired 431–768 zoom rule and the 12px inset; both specs pass.
- CONSTRAINTS C1–C4 are honoured. The guard pins for the new CSS file went from 135 to 136, recounted rather than
  loosened (C3). No Phase B work was started (C4).

### Phase 2: Code Review — FAIL
Mechanical DESIGN.md violations in `frontend/src/features/dashboards/ui/DashboardChipRow.css`:
- **:29 `height: 32px;`.** This breaks §3 "Never hardcode a value a token exists for" and Control metrics ("Every
  button ... uses a control-height token ... No other control heights"). `--control-md` is 32px (`theme.css:61`).
- **:41–43 `transition: ... var(--app-transition)`.** Per §10 Motion, new code takes durations and easings from the motion
  scale, and `--app-transition` is kept only for its existing consumers until HEL-1573 migrates them. This is a new
  consumer. The behaviour-identical replacement is `var(--motion-duration-quick) var(--motion-ease-standard)`, which is
  160ms ease, the same as `--app-transition: 0.16s ease`.
- The hit-area floor defect is Issue 1 above. Per DESIGN.md §3/§4 the tap-target floor is 44x44.

Otherwise sound:
- The D1 gutters are scoped to `@media (max-width: 768px)` and use tokens plus 2px optical tweaks, which §3 allows.
- `mobilePanelHeights` constants were re-derived from the new chrome (0 + 30).
- D2 zoom gating is correct: effective zoom 1.0, the wheel handler is inert, and the saved level is untouched. A unit
  test covers this, including that above 768px the zoom widget, the saved level and the absence of a chip row are all
  kept.
- `revealChip` sets the row's own `scrollLeft` and never calls `scrollIntoView`, and it respects reduced motion.
- Chip tap dispatches the selection and navigates. Accessible names and `aria-current` are present.
- The RTL tests are meaningful: order, cap, remount stability, the A -> sheet -> A sequence, and scrollLeft. No dead
  code or untyped escape hatches.

### Phase 3: UI Review — FAIL (one objective defect; the rest PASS)
- Happy path, chip switching, keyboard activation, the stack at 768, the absence of the zoom widget, and bottom
  clearance all pass. No horizontal overflow at 320–768 in either theme.
- Console: the only errors were two 429s, from my own probe's rapid seeding and deleting against the shared rate
  limit. They are environmental, not app errors.
- Chip hit areas: the painted chips are 32px, and on visible chips a 44px vertical `elementFromPoint` probe hits the
  chip itself. Neighbouring hit regions do not overlap (8px gap; the expanders do not extend horizontally). But a
  chip's width is bounded only by its name, so short names fall below the floor (Issue 1).
- Chip contrast: the active chip's computed colours are `rgb(33,29,25)` on `rgb(253,252,250)` in light and
  `rgb(26,24,22)` on `rgb(242,239,233)` in dark, both about 16:1. The executor's pixel-derived 15.0+ is consistent with
  this.
- Visual cohesion with the running app in both themes: on a quick look the chips sit fine against the command bar and
  cards, and the inverted active fill is distinct without using the accent. Subjective calls are left to the skeptic.
- Evidence (persisted):
  `/home/matt/Development/helio/.concertino/runs/HEL-1583/evidence/openspec/changes/mobile-dashboard-glass-nav-v2/evidence/{eval1-375-light.png, eval1-320-dark.png, eval1-375-dark-bottom.png, eval1-768-light.png, eval1-375-light-shortchip.png, eval1-probe.log}`.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/dashboards/ui/DashboardChipRow.css` (`.dashboard-chip`): give every chip a 44px-wide hit
   floor. For example, add `min-width: 44px` to `.dashboard-chip`, or give the `::after` expander `min-width: 44px`
   centred with `left: 50%; transform: translate(-50%, -50%)` and keep the 8px gap so neighbours still tile. Then
   extend `e2e/hel1583-mobile-dashboard.spec.ts` with a short-named dashboard (e.g. "Q") and an `elementFromPoint`
   bisection of that chip's hit width and height (>= 44 - samplingStep, per DESIGN.md §3 Expander tiling). Add a
   matching pin in `DashboardChipRow.css.test.ts`.
2. `DashboardChipRow.css:29`: change `height: 32px;` to `height: var(--control-md);`, and update the CSS test pin if it
   matches the literal.
3. `DashboardChipRow.css:41-43`: replace `var(--app-transition)` with
   `var(--motion-duration-quick) var(--motion-ease-standard)` on all three properties.
4. `openspec/changes/mobile-dashboard-glass-nav-v2/specs/mobile-viewer-stack/spec.md`: reword "its last line SHALL end
   no more than 28px from the right edge" to what is built and tested: the markdown body's content box ends no more than
   28px from the screen's right edge, with text ragged-right inside it.

### Non-blocking Suggestions
- `PanelList.tsx` is now 508 lines, past CONTRIBUTING.md's ~400-line "propose a split" mark. Note a split proposal in
  the PR description.
- The spec says text and other content panels add no further horizontal inset. Output, form and table renderers still
  inset their own content inside the 27px body. On a real dev-account dashboard: output text starts at 51px, form text
  at 43px. Design D1 deliberately scopes the inset removal to markdown and plain text, so consider tightening the
  spec's "and other content panels" wording to match D1.
- The e2e "active chip visible on load" case passes partly by fixture order. Consider seeding the active dashboard as
  the last chip at 320px so the reveal path is always exercised.
