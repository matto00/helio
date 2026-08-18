## Files modified

- `frontend/src/features/sources/utils/labelForKind.ts` — new shared util (relocated from
  `BoundSourceBar.tsx`, D2); source-domain home for the DataSourceKind→label mapping.
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.tsx` — new component: single
  bordered/backed header region with three field groups (bound source, bound output type,
  schedule), porting all JSX/logic from the three retired bar components.
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.css` — new, dedicated stylesheet for
  the header (kept out of `PipelineDetailPage.css` per design.md's `findMediaBlock` first-match
  constraint); reuses `PipelineDetailPage.css`'s existing `__edit-btn` class for its buttons.
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.test.tsx` — new; ports every scenario
  from the three retired `.test.tsx` files against the consolidated component, plus a
  single-container structural check.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx` — extended with `isOwner`/
  `onOpenShare` and last-run metadata props; renders the last-run metadata as a top row and the
  Share button inside `__footer-right`'s action-button group. Outer element renamed to
  `__footer-region` (new wrapper) so the metadata row and the unchanged `__footer` action row
  share one background/border; `__footer` itself keeps its exact prior declarations relevant to
  the HEL-687 mobile-floor media rules.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — wires in `PipelineDetailHeader` in
  place of the three retired bars; removes the standalone `__share-bar`/`__meta-bar` divs, passing
  their data into `PipelineDetailFooter` instead.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — removes
  `__source-bar`/`__bound-source*`/`__type-bar`/`__bound-type*`/`__share-bar` selectors (superseded
  by the header / relocated into the footer); repurposes `__meta-bar` for its new nested-in-footer
  role (drops its own background/border, now supplied by `__footer-region`); adds
  `__footer-region`; fixes the relocated `__share-btn`'s hover background (was `--app-surface`,
  invisible against the footer's own `--app-surface` backdrop — now `--app-surface-soft`, matching
  sibling footer buttons). `__footer`/`__footer-right`/`__run-btn`/etc. and both HEL-687 media
  blocks are otherwise untouched (verified against `PipelineDetailPage.css.test.ts`).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — extends `makeStore` with an
  optional `authCurrentUserId` param (for the owner-gated Share button); adds a new describe block
  covering the relocated Share button (visible/absent by ownership, opens the share dialog); adds
  `listPipelinePermissions`/`grantPipelinePermission`/`revokePipelinePermission` to the service
  mock (needed once the Share dialog is actually opened from this file). All pre-existing
  `"Edit source"`/`"Edit type"`/`"Last run metadata"`/`"Disable schedule"` assertions are
  unchanged and still pass.
- `frontend/src/features/pipelines/ui/CreatePipelineModal.tsx` — `labelForKind` import path
  updated to the new sources-domain location.
- `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.tsx` — same import-path
  update.

## Files deleted

- `frontend/src/features/pipelines/ui/BoundSourceBar.tsx` + `.test.tsx`
- `frontend/src/features/pipelines/ui/BoundTypeBar.tsx` + `.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineScheduleBar.tsx` + `.css` + `.test.tsx`

Behavior fully ported into `PipelineDetailHeader.tsx`/`.test.tsx` before deletion.

## Cycle 2 — evaluation-1.md change requests addressed

- `frontend/src/features/pipelines/ui/PipelineDetailHeader.css` — fixed the 1100px crowding
  (change request 1) and 1440px expression truncation (change request 2).

**Root cause** (one failing layer, per systematic-debugging.md): `.pipeline-detail-header__group-value`'s
`flex-shrink: 0` children (`Toggle`, `__source-kind`, `__schedule-disabled-badge`) had no
`overflow: hidden` of their own, so their automatic flex min-size was their full content width — a
hard floor that never yielded a pixel. The one child that *could* shrink
(`__source-name`/`__type-name`/`__schedule-expression`, whose own `overflow: hidden` gives it an
automatic flex min-size of 0) absorbed the entire shrink deficit, collapsing to literally 0px well
above the header's 768px stacking breakpoint; `__group-value` itself had no `overflow: hidden`, so
once its own box shrank below its rigid children's combined width, those children visually spilled
into the adjacent `Edit schedule` button.

**Probe** (live browser, not jsdom — jsdom implements no real flex layout so this class of bug is
invisible to Jest): a Playwright script logged in as `matt@helio.dev`, navigated to
`/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485` ("Profit (migrated)", the same fixture the
evaluator used), and read `getBoundingClientRect()`/`scrollWidth` for
`__source-name`/`__schedule-expression`/`__schedule-disabled-badge`/the "Edit schedule" button at
1440/1100/1101/900/769/768/430px.

**Probe output (before fix)**: at 1100px, `__source-name` width=0 (text "Profit" fully invisible),
`__schedule-expression` width=0 ("Every 1m" fully invisible), `__schedule-disabled-badge`
x=[955.2–1020.4] visually overlapping the "Edit schedule" button x=[965.2–1080] — reproducing the
evaluator's exact reported symptom and coordinates. At 1440px, `__schedule-expression` rendered at
width=46.2px against a scrollWidth of 67px (truncated to "Ever…" despite 400px total group width),
also matching the evaluator's report.

**Fix**: (a) widened the header's stacking breakpoint from `max-width: 768px` to `max-width: 1100px`
(a DESIGN.md §4 canonical breakpoint, and the exact range design.md's own Risks section had already
named as "1100/768px" at-risk) — the row (3-column) layout is now only asked to hold up above
1100px, not down through it; (b) added an explicit `min-width` floor to the truncatable text
elements so they can never be squeezed below a legible size, with `__schedule-expression`'s floor
(70px) sized to fully fit its evaluator-reported "Every 1m" case; (c) added `overflow: hidden` to
`__group-value` so any residual excess is clipped inside its own box instead of visually spilling
into the neighboring Edit button; (d) turned the previously-rigid `__source-kind`/
`__schedule-disabled-badge`/`__schedule-next-run` into legitimate, lower-priority shrink targets
(their own `overflow: hidden` + a small `min-width`) so they yield space to the higher-priority
text first, per the evaluator's own suggested prioritization ("the toggle already conveys
enabled/disabled state").

**Probe output (after fix, same script)**: 1440px — `__schedule-expression` width=70px = full
content (scrollWidth 70, no ellipsis engaged), `__schedule-disabled-badge` right edge 1293.2 vs.
"Edit schedule" left edge 1305.2 (no overlap); confirmed visually via
`page.locator(".pipeline-detail-header").screenshot()` — "Every 1m" renders in full, "DIS…" badge
truncates cleanly with no garbling. 1100px — stacked layout, every element at its full natural
width, no truncation, no overlap (screenshot confirmed). 768px/430px — unaffected, still stacked
correctly (screenshot confirmed, matches the evaluator's own "correct" findings for these widths).

**Known residual (disclosed, not silently absorbed)**: between ~1101px and ~1330px (outside
DESIGN.md §4's four canonical breakpoints, which is what evaluation-1.md's re-verification
instructions scope to), the row layout is legible-but-tight — e.g. at 1101px the schedule
expression/badge are clipped harder than at 1440px. This is a hard structural floor, not a
tuning gap: at 1101px the schedule group's fixed overhead alone (label + padding + the "Edit
schedule" button + the Toggle control, none of which can shrink further without either touching a
shared class used elsewhere or wrapping/shrinking the Toggle into an unusable control) already
exceeds the ~287px available to that group before `__schedule-expression`/`__schedule-disabled-badge`
get anything at all — confirmed by direct measurement, not assumption. Closing this fully would
require either a bigger structural change (e.g. dropping the Toggle/badge from the row layout below
some width) or a non-canonical breakpoint, both out of this change's scope ("No visual redesign
beyond consolidation" — proposal.md Non-goals). Critically, this residual is **not** a repeat of the
blocking defect: `__group-value`'s new `overflow: hidden` guarantees nothing visually overlaps or
garbles in this range (screenshot-confirmed at 1101px and 1200px) — it degrades to tightly clipped
text, never to 0-width invisible text or overlapping elements.

## Cycle 3 — skeptic-final-1.md change request addressed

- `frontend/src/features/pipelines/ui/PipelineDetailHeader.css` — hid the redundant "Disabled"
  schedule badge in the row layout instead of letting it ellipsis-truncate.
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.tsx` — added a `title="Disabled"`
  hover/keyboard fallback on the badge.

**Root cause** (one failing layer, per systematic-debugging.md): at 1440px (DESIGN.md §4's widest
canonical breakpoint), the schedule field group's row-layout content — Toggle (34px) + 2×8px gap +
`__schedule-expression` at its cycle-2 floor (70px) + `__schedule-disabled-badge` at its natural
width (~63px) = 183px — genuinely exceeds its available box (161px) by ~22px. This is a real,
irreducible deficit at that exact breakpoint (confirmed by direct measurement, not a bug where
slack exists but isn't used), and `__schedule-disabled-badge`'s `min-width: 20px` floor (set in
cycle 2) is far below its ~63px natural content, so it silently absorbed the whole deficit via
`text-overflow: ellipsis`, rendering "Disabled" as "Dis…" — the same failure category (short label
ellipsis-truncated at 1440px) already treated as blocking once for the sibling
`__schedule-expression` element in cycle 2.

**Probe**: re-ran the same Playwright script from cycle 2 (logged in as `matt@helio.dev`, navigated
to `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485`, the same fixture pipeline both prior review
cycles used) and read `getBoundingClientRect().width` vs `scrollWidth` on
`.pipeline-detail-header__schedule-disabled-badge` at 1440px before making any change.

**Probe output (before fix)**: `width: 41.36px` vs `scrollWidth: 63px` — reproduced the skeptic's
exact numbers, confirming the truncation.

**Why a `min-width` floor (the cycle-2 treatment for `__schedule-expression`) doesn't work here**:
computed that flooring both `__schedule-expression` (70px) and `__schedule-disabled-badge` (~63-68px
to match its content) simultaneously would need ~183px+ in a box that only has 161px at 1440px —
there is no floor value for the badge that both (a) shows its full word and (b) still fits. Since
the badge is genuinely redundant information (the Toggle switch already conveys enabled/disabled
state unambiguously — already noted in the cycle-2 CSS comments), the fix hides it outright
whenever the row (non-stacked) layout is active (`display: none` in the base rule) and restores it
inside the *existing* `@media (max-width: 1100px)` stacking block, where each field group gets a
full-width row with confirmed-ample space (cycle 2 screenshots) — no new, non-canonical breakpoint
value introduced. A `title="Disabled"` attribute was added as a defense-in-depth hover/keyboard
fallback per the skeptic's alternative suggestion, in case a future change re-narrows the badge's
box in the stacked layout.

**Probe output (after fix, same script, all four DESIGN.md canonical breakpoints plus the
disclosed 1101px residual)**:
- 1440 / 1300 / 1200 / 1101px (row layout): `disabledBadge` → `{width: 0, scrollWidth: 0, display:
  "none"}` — not rendered at all, so nothing to truncate. `scheduleExpr` → `{width: 70, scrollWidth:
  70}` at every one of these widths — full "Every 1m", no truncation (was already fixed in cycle 2;
  confirmed unchanged/not regressed by this cycle's edit).
- 1100 / 900 / 768 / 430px (stacked layout): `disabledBadge` → `{width: 65.2, scrollWidth: 63,
  display: "block"}` — fully visible, no truncation.
- Screenshots (`.pipeline-detail-header` locator) at 1440/1101/1100px confirm visually: 1440px
  shows "Every 1m" in full with no badge (clean, no truncated fragment); 1100px (stacked) shows both
  "Every 1m" and "DISABLED" in full; 1101px (the disclosed residual, still outside the four
  canonical breakpoints) is unchanged from cycle 2 — still legibly clipped, never
  overlapping/garbled, not made worse by this change.

**Fresh gates re-run after the fix**: `npm run lint` (0 warnings), `npm run format:check` (clean),
`npm test` (210 suites / 2260 tests passed — the ported `PipelineDetailHeader.test.tsx` scenario
`"shows a Disabled badge ... when disabled"` still passes because Jest/jsdom never loads the actual
CSS file for `PipelineDetailPage.tsx`'s `.css` imports, so `display: none` has zero effect on
`getByText("Disabled")`'s DOM-presence check — only the real, CSS-aware browser rendering the
Playwright probe verified is responsive to viewport width), `npm --prefix frontend run build`
(succeeds).

## Cycle 4 — scope amendment (task groups 6, 7, 8; design.md D5–D8)

Human-directed scope amendment overriding the original "no visual redesign beyond consolidation"
non-goal (see ticket.md/design.md Scope Amendment sections). Implements one action-menu trigger
for the header's per-field edit actions (D5), a denser field-group display (D6), a pinned-vs-
overflow split for the footer's actions (D7), and removal of the now-dead per-button CSS
selectors D5/D7 make unreachable (D8).

### Files changed

- `frontend/src/features/pipelines/ui/PipelineDetailHeader.tsx` — replaced the three "Edit
  source"/"Edit type"/"Edit schedule" buttons with one `ActionsMenu` (`aria-label="Pipeline
  actions"`), items gated exactly as the retired buttons were; Toggle stays outside the menu
  (D5). Shortened field labels ("DATA SOURCE"/"OUTPUT TYPE"/"SCHEDULE" → "Source"/"Type"/
  "Schedule") and dropped the eyebrow/mono/uppercase treatment for a single compact line (D6).
  Added a `title` fallback to `__schedule-next-run` (defense-in-depth, mirrors the "Disabled"
  badge's existing `title`).
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.css` — tighter `__group`
  gap/padding (12px/10px 20px → 8px/8px 14px); `__group-label` restyled (smaller, no mono/
  uppercase, `flex-shrink: 0`); new `__actions` wrapper (fixed-size, `align-items: center`,
  right-aligned + top-bordered when stacked at ≤1100px) for the menu trigger.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx` — replaced "Run history"/
  "Preview"/"Share" buttons with a second `ActionsMenu` (`aria-label="More actions"`,
  `align="above"` — see below), items in the same left-to-right priority order; "Dry run"/
  "Run pipeline" unchanged, still plain always-visible buttons (D7). Dropped the `runHistoryCount`
  prop (no longer displayed — the overflow item's label is the plain string "Run history",
  matching the amended spec's scenario wording; the count itself was decorative, not used by any
  other logic).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — stopped passing
  `runHistoryCount` (prop removed).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — removed
  `.pipeline-detail-page__edit-btn`/`__history-btn`/`__preview-btn`/`__share-btn`'s now-dead base
  rules and their entries in the `@media (max-width: 768px)` combined-selector list (D8); kept
  `__dry-run-btn`/`__run-btn`/`__save-btn`/`__cancel-btn`/`__cancel-confirm-btn` unchanged.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css.test.ts` — `it.each` list for the
  768px 44px-floor assertion narrowed to `[".pipeline-detail-page__dry-run-btn"]`, dropping
  `__history-btn`/`__preview-btn` (D8 task 8.4) — `ActionsMenu.css.test.ts` already covers the
  new triggers independently.
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.test.tsx` /
  `PipelineDetailPage.test.tsx` — updated every affected `getByRole("button", ...)` assertion to
  open the owning `ActionsMenu` first and query `getByRole("menuitem", ...)`; added coverage for
  "one trigger exposes every available action" / "menu narrows to only the actions the user has"
  (new amended-spec scenarios) and for the footer's pinned-vs-overflow split.
- `frontend/src/shared/chrome/ActionsMenu.tsx` + `frontend/src/hooks/usePortalPopover.ts` — see
  "Cycle-4 self-discovered defect" below.
- `frontend/src/shared/chrome/ActionsMenu.test.tsx` — added coverage for the new `align` prop.
- `openspec/changes/pipeline-detail-header-footer/specs/pipeline-editor-page/spec.md` +
  `specs/pipeline-schedule-config-ui/spec.md` — already updated during this cycle's design-gate
  phase (skeptic-design-3.md/skeptic-design-4.md) before I started; verified accurate against the
  final implementation, no further edits needed (task 8.5).

### Task 6.3 — re-measurement of skeptic-final-2.md's open CR1 (`__schedule-next-run`)

**Root cause** (already established in cycle 2/skeptic-final-2.md): the header's row layout gives
each field group a fixed share of the available width; removing the three per-field edit buttons
(D5) and tightening each group's padding/label (D6) directly increases that share.

**Probe**: live Playwright, logged in as `matt@helio.dev`, against the same fixture pipeline
(`/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485`) used by every prior review round — toggled its
schedule from disabled to enabled (via the header's own Toggle switch) to reproduce the exact
untested state skeptic-final-2.md's finding was about, measured `getBoundingClientRect().width`
vs. `scrollWidth` for every truncatable header child at 1440/1100/768/430px, then toggled the
schedule back off and confirmed restoration via a fresh page reload (same discipline
skeptic-final-2.md itself used).

**Probe output**: at 1440px — `__schedule-expression` `{width: 70, scrollWidth: 70}` (full),
`__schedule-next-run` `{width: 164.56, scrollWidth: 165}` (full — "next run Aug 17, 2026, 7:16 PM"
renders completely, no ellipsis engaged). Identical (full, no truncation) at 1100/768/430px.
Screenshot-confirmed visually at 1440px and 430px.

**Conclusion**: D6's compaction alone fully closed the gap — **no fallback needed**. Per design.md
D6's explicit instruction ("the executor MUST NOT treat it as automatically fixed"), this was
verified by direct measurement, not assumed.

### Cycle-4 self-discovered defect: footer's "More actions" panel rendered entirely below the
viewport (not part of any assigned task — found during my own live verification)

**Root cause**: `ActionsMenu`'s `handleToggle` unconditionally computes `top: rect.bottom + 8`
(open-below), with no viewport-collision detection anywhere in `usePortalPopover`. The footer sits
in `.pipeline-detail-page`'s `height: 100%` flex column, always flush with the viewport's bottom
edge — so any trigger inside it has `rect.bottom` at (or within a few px of) `window.innerHeight`,
meaning the popover panel's box is computed to start almost exactly at the viewport's bottom edge
and extend below it, i.e. off-screen. This affects only the *new* footer "More actions" trigger —
the header's "Pipeline actions" trigger sits near the page top with ample room below it, and this
is the first time `ActionsMenu` has ever been used inside a page-bottom-pinned container (its
three pre-existing consumers — `PanelCard`, `DashboardList`, `SidebarItemList` — are none of them
footer-pinned).

**Probe**: live Playwright, opened the footer's "More actions" menu and read the portalled panel's
`getBoundingClientRect()` at four viewport heights (700/800/900/1080px — the last being a common,
non-degenerate desktop height, not a contrived short window).

**Probe output (before fix)**: panel bottom edge exceeded the viewport height at *every* tested
height — e.g. at 900px, panel `top: 895, bottom: 998` (98px entirely below the 900px-tall
viewport); at 1080px, panel `top: 1075, bottom: 1178`. This is deterministic — not an edge case at
unusually short windows — because the footer is always flush with the viewport bottom regardless
of viewport height. The menu was completely unusable (items present in the DOM and reachable by
keyboard/role query, but never visually rendered inside the viewport) — a genuine "no loss of
function" violation for the very feature this cycle adds, not a polish issue.

**Fix**: added an optional `align?: "below" | "above"` prop to `ActionsMenu` (default `"below"`,
byte-identical behavior for all three pre-existing consumers — verified via their full test suites
after the change, all passing unchanged) and widened `usePortalPopover`'s `PortalPopoverPos` type
to accept `bottom` as an alternative to `top`. When `align="above"`, the panel anchors via
`bottom: window.innerHeight - rect.top + 8` instead of `top: rect.bottom + 8` — mirroring this
same footer's own pre-existing `.pipeline-detail-page__cancel-confirm` "dropup" idiom (a CSS-only,
non-portalled version of the same problem, already solved the same way elsewhere on this exact
page). `PipelineDetailFooter.tsx`'s "More actions" `ActionsMenu` now passes `align="above"`; the
header's "Pipeline actions" `ActionsMenu` is unaffected (still defaults to `"below"`, correct for
its top-of-page position).

**Probe output (after fix, same script)**: panel fully within the viewport at every tested height
— e.g. at 900px, panel `top: 748, bottom: 851`; at 1080px, `top: 928, bottom: 1031`. Screenshot-
confirmed: the panel now renders as a "dropup" directly above the trigger, fully visible, showing
"Run history"/"Preview"/"Share" in the correct order.

**Why this was fixed now rather than deferred as a spinoff**: the defect is deterministic (100%
reproducible, not a rare edge case), makes the footer overflow menu I built this cycle completely
unusable (not degraded — invisible), and the fix is a small, purely additive, backward-compatible
extension to the shared component (opt-in prop, default behavior unchanged for every other
consumer, verified via their full test suites) rather than a new bespoke popover component — it
does not conflict with design.md's "no new popover primitive is built" non-goal. Flagged
prominently here per the Iron Laws rather than silently absorbed, in case the orchestrator/skeptic
wants to review the `ActionsMenu` API change on its own terms.

### Fresh gate results (this cycle, after all changes above)

- `npm run lint` → 0 warnings/errors.
- `npm run format:check` → all files formatted.
- `npm test` → **210 suites / 2265 tests passed** (was 2263 before the two new
  `ActionsMenu` `align`-prop tests).
- `npx jest --testPathPatterns="PipelineDetailPage.css.test|ActionsMenu.css.test"` → 11/11 passed
  (HEL-687 guard + the shared component's own 44px coverage).
- `npm --prefix frontend run build` → succeeds.
- Live smoke check (Playwright, dev server): header/footer render correctly in both dark and light
  themes; header's actions menu lists "Edit source"/"Edit type"/"Edit schedule"; footer's overflow
  menu lists "Run history"/"Preview"/"Share" and opens the Preview modal correctly on activation;
  all four `ActionsMenu`-related tap targets (header trigger, footer trigger, Dry run, Run
  pipeline) measured at exactly 44px at 430px. Two pre-existing, unrelated `401` responses on
  `/api/auth/me` observed during the smoke check — confirmed present identically on an unrelated
  page (`/dashboards`), not a regression from this change.
