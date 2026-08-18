## Context

`PipelineDetailPage.tsx` currently renders, in DOM order: `BoundSourceBar`, `BoundTypeBar`,
`PipelineScheduleBar` (each its own full-width bar: `background: var(--app-surface-soft)`,
`border-bottom`), `PipelineRiverView` (scrollable, `flex: 1`), `PipelineDetailFooter`
(`border-top`, `background: var(--app-surface)`), then — **below** the footer — an owner-only
Share button row (`__share-bar`) and a last-run metadata bar (`__meta-bar`). Six chrome regions
total. `PipelineDetailPage.css.test.ts` statically asserts the HEL-687 430px mobile-floor CSS
(footer stacks, `__footer-right` wraps, `__run-btn` full-width, 44px tap targets on
`.history-btn`/`.preview-btn`/`.dry-run-btn`/`.run-btn` etc.). This held for the original
consolidation (D1-D4), where nothing touched viewport-geometry behavior, only which DOM region
owns which control — **D8 below is the one exception**: the amendment retires
`.history-btn`/`.preview-btn` (and `.edit-btn`/`.share-btn`) as real selectors once D5/D7 replace
them with `ActionsMenu` items, and updates this same test's `it.each` list to match, rather than
holding it unchanged.

## Goals / Non-Goals

**Goals:**
- One header region (source + type + schedule), one footer region (name editor, schema, stats,
  run status, save/cancel, history/preview/dry-run/run, share, last-run metadata) — verified via
  Playwright screenshot by the skeptic/evaluator, not just DOM structure.
- Zero loss of function: every existing action stays reachable with the same accessible name
  (tests assert `getByRole("button", { name: "Edit source" })` etc. — preserve these).
- Preserve the HEL-687 430px/768px mobile floor unchanged.

**Non-Goals:**
- No new DESIGN.md tokens or PageShell pattern (none exists yet — ticket says "once established").
- No change to `SourceDetailPanel`'s own separate `labelForKind` copy.
- No behavior change to schedule CRUD, source/type ownership gating, share dialog, or run
  execution — this is a pure chrome relocation (and, per the amendment below, a density
  reduction using existing primitives — never new CRUD/gating behavior).

## Scope Amendment (post-final-gate, human-directed)

The final gate (skeptic-final-2.md) found the header's schedule field group still
ellipsis-truncates a third sibling element (`__schedule-next-run`) at 1440px once a schedule is
enabled with a computed next run — the third instance of the same width-crowding failure category
in this ticket's review history, this one with no redundant fallback elsewhere on the page. After
the final-gate REFUTE budget (`SKEPTIC_FINAL_ROUNDS`) was exhausted, the orchestrator escalated;
the human directed a scope amendment (see ticket.md's Scope Amendment section for the verbatim
directive) that overrides the "no visual redesign beyond consolidation" non-goal above:

- **Header**: compact the source/type/schedule display itself, and replace the three separate
  always-visible "Edit source" / "Edit type" / "Edit schedule" buttons with a single action
  button that opens a menu exposing those three options.
- **Footer**: keep "Dry run" and "Run pipeline" always visible regardless of viewport; collapse
  the remaining actions (Preview, Run history, Share, etc.) behind a popover/overflow action bar.

This is treated as a genuine amendment to Goals/Non-Goals, not a bugfix layered on top of the
original design — decisions D5–D7 below are new, added under this amendment. D1–D4 above still
stand: the amendment builds on the single-header/single-footer structure they already established,
it does not revert it.

**Amended Goals** (in addition to the three above): the header's per-field edit affordances
consolidate into one action-menu trigger; the header's field-group display is measurably denser
than the original consolidation (D6); the footer's always-visible action-button count drops to
two (`Dry run`, `Run pipeline`) plus one overflow trigger, at every viewport including 430px (D7).

## Decisions

**D1 — One new `PipelineDetailHeader` component, not three components in a wrapper `<div>`.**
Wrapping `BoundSourceBar`+`BoundTypeBar`+`PipelineScheduleBar` unchanged in one bordered `<div>`
would still visually read as three bars (each keeps its own `background`/`border-bottom`) and
would not satisfy "no more than one info bar above the step list" under a Playwright screenshot.
Build one `PipelineDetailHeader.tsx` that owns the single `background`/`border-bottom` container;
source/type/schedule become three internal field groups (each: eyebrow label + value + optional
edit button), separated by a `border-left` divider on wide viewports and stacked full-width rows
on narrow ones (same `flex-wrap`/`flex-direction: column` idiom the footer already uses at
768/430px). Port `labelForKind`'s call sites, `formatNextRun`, `formatExpressionSummary`, and the
`Toggle` usage from the three retired components into the new one (`labelForKind` itself
relocates per D2, it is not duplicated here). Alternative considered: keep the three as internal
sub-components rendered without their own bar styling (just logic + JSX, no `background`/
`border`) inside the new header — acceptable too, and preferable if it keeps the diff smaller;
the executor may choose either as long as the outer container is the only bordered/backed region
and each retired component's existing `.test.tsx` coverage is ported.

**Header CSS MUST live in its own new `PipelineDetailHeader.css` file — never in
`PipelineDetailPage.css`.** `PipelineDetailPage.css.test.ts`'s `findMediaBlock` helper is a
first-match (not merge-all) lookup: it returns the body of the *first* `@media (max-width: 768px)`
/ `@media (max-width: 430px)` rule it finds in the file it reads and stops there. That file is
hardcoded to `PipelineDetailPage.css`, so any new `@media` block added to that same file — e.g.
responsive rules for the header, which sits earlier in the file than the existing footer/step-card
blocks at lines 1532/1546 — risks the test silently grabbing the wrong (header-only) block first
and every footer/`__run-btn`/`__history-btn`/step-card assertion throwing "Selector containing ...
not found." A dedicated `PipelineDetailHeader.css` is immune by construction (the test never reads
it), so this is not optional flexibility — it is the only safe choice given the existing test's
first-match semantics.

**D2 — `labelForKind` moves to `frontend/src/features/sources/utils/labelForKind.ts`.**
It operates on `DataSourceKind` (a sources-domain concept), and two consumers outside the
pipelines feature already import it from `BoundSourceBar` (`CreatePipelineModal.tsx`,
`ShapeInstantiateStep.tsx`) — a pipelines-UI file is the wrong home for a cross-feature source
util. `SourceDetailPanel.tsx`'s own private copy is left as-is (out of scope, noted in proposal).

**D3 — Footer absorbs Share button + last-run metadata as new sections, not new files.**
`PipelineDetailFooter.tsx` is already the single extracted footer component (CS3 precedent) —
extend its props rather than introduce a second footer component. Layout:
- Add a slim top row inside the footer (above the existing `__footer-left`/`__footer-right` row)
  for last-run metadata (relative time, row count, status chip) — conceptually distinct from
  both "what will be output" and "actions," and only rendered when `lastRunAt != null` (same
  conditional as today).
- Add the Share button into the `__footer-right` button group, alongside Run history / Preview /
  Dry run / Run pipeline — it is an action like those, and `pipeline-sharing`'s spec already
  permits "page header or actions menu" placement, so no spec delta is needed for it.
- Keep the existing `__footer`, `__footer-right`, `__run-btn`, `__history-btn`, `__preview-btn`,
  `__dry-run-btn`, `__save-btn`, `__cancel-btn`, `__cancel-confirm-btn`, `__share-btn` class names
  unchanged so `PipelineDetailPage.css.test.ts`'s selectors keep resolving without modification.
  `__share-btn` already sits inside the existing `@media (max-width: 768px)` 44px-floor rule.
  **Superseded for `__history-btn`/`__preview-btn`/`__share-btn` by the amendment's D8 below** —
  this bullet's "keep unchanged" framing was correct for the original consolidation (nothing here
  ever removed these three as their own buttons) but no longer holds once D7 relocates them into
  an `ActionsMenu`; see D8 for the amendment's actual, current handling of these three selectors.
  `__footer`, `__footer-right`, `__run-btn`, `__dry-run-btn`, `__save-btn`, `__cancel-btn`,
  `__cancel-confirm-btn` are unaffected by the amendment and this bullet still governs them as
  written.

**D4 — Spec deltas target `pipeline-editor-page` and `pipeline-schedule-config-ui` only.**
`pipeline-sharing`'s "page header or actions menu" wording already covers the Share button's new
location — no delta needed there. `pipeline-editor-page`'s section-count requirement and its
last-run-metadata requirement need rewording to match the new two-region (header/footer) layout.
`pipeline-schedule-config-ui`'s schedule-bar-placement requirement and its "existing editor
layout unaffected" backward-compat scenario currently name the old four-bar layout by name and
must be restated against the new structure. Two further requirements in that same spec — "User
can set a new schedule" and "User can edit an existing schedule" — are not being modified in
behavior, but their scenario THENs still say "the schedule bar reflects the new schedule/
expression..."; left untouched, the archived spec would contradict itself (asserting both "no
separate schedule bar" and "the schedule bar reflects..." in the same file). Those two scenarios'
wording is restated too (schedule bar → header's schedule section), with no other change — see
specs/ deltas.

**D5 — Header per-field edit actions consolidate into one `ActionsMenu`.** Replace the three
always-visible "Edit source" / "Edit type" / "Edit schedule" buttons with a single trigger button
built from the existing, DESIGN.md-ratified `shared/chrome/ActionsMenu.tsx` (`items:
ActionsMenuItem[]`, WAI-ARIA menu-button pattern already implemented via `usePortalPopover` —
focus management, Escape-to-close, arrow-key navigation, portal rendering all come for free; no
new popover primitive is built). Items: "Edit source" (ownership-gated, same condition as today),
"Edit type" (ownership-gated, same condition as today), "Edit schedule" / "Set schedule"
(always present — mirrors the existing gating exactly, just relocated from three buttons into one
menu's item list, computed at render time). The schedule enable/disable `Toggle` switch is **not**
moved into the menu — it is a persistent, always-visible state control, not a navigation action,
and moving it would regress "state conveyed without an extra click." Each item's visible label
stays the exact existing string ("Edit source", "Edit type", "Edit schedule", "Set schedule") so
downstream consumers only need a role change (`button` → `menuitem`, present only while the menu
is open), never a text/copy change. The trigger's own accessible name is `aria-label="Pipeline
actions"`, matching the codebase's existing `${subject} actions` `ActionsMenu` convention
(`PanelCard.tsx`'s `"${name} actions"`, `DashboardList.tsx`, `SidebarItemList.tsx`).

**D6 — Header field groups compact to a single line each.** Each of the three field groups
(source/type/schedule) drops the original consolidation's stacked eyebrow-label-then-value layout
in favor of one compact inline line per field (e.g. a short inline label + value, smaller
font-size token, tighter `gap`/`padding` than D1's original treatment). This is the direct lever
for the amendment's density goal, and it also resolves skeptic-final-2.md's open CR1
(`__schedule-next-run` truncating to "next r…" at 1440px): removing the three edit buttons from
the header's trailing edge (replaced by D5's single menu trigger) and tightening each field
group's own footprint substantially increases the horizontal budget available to the schedule
group's text at every canonical breakpoint. This is expected to resolve CR1 as a side effect of
the amendment, but the executor MUST NOT treat it as automatically fixed — re-measure
`scrollWidth` vs. rendered `width` for every truncatable header child (source name, type name,
schedule expression, next-run, disabled badge) at 1440/1100/768/430px, **using an enabled
schedule with a computed next run** (the exact state skeptic-final-2.md found undertested by every
prior review round — the fixture pipeline `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485` used
throughout this ticket's review history works: toggle its schedule on, measure, toggle back off
to restore its original disabled state), as part of this cycle's own gates.

**Committed fallback (not just a non-regression floor):** if task 6.3's re-measurement shows
button-removal + compaction alone does not fully close the `__schedule-next-run` gap at 1440px,
the default next step — not merely "keep cycle 2's scheme," which is the status quo that
triggered the escalation — is: (a) switch `__schedule-next-run`'s formatted string to a more
compact date format sized to the group's realistic remaining width budget (e.g. drop the year,
shorten the month to a 3-letter abbreviation, or use a `M/D h:mma`-style form — measure the
group's actual leftover width first, per skeptic-final-2.md's own suggestion, rather than
guessing a format), **and** (b) add a `title="<original, full-format date>"` attribute so the
complete information stays recoverable via hover/keyboard regardless of which format is visually
rendered — mirroring the `title` fallback already added to the "Disabled" badge in cycle 3. Only
if a compact format still does not fit at 1440px should the executor fall back further to
reprioritizing the group's shrink order (yield `__schedule-expression` before `__schedule-next-run`,
reversing cycle 2's current priority) — since, per this decision's own reasoning, `next-run` has
no redundant equivalent anywhere else on the page and should be the last element to lose visible
width, not the first.

**D7 — Footer pins "Dry run"/"Run pipeline"; the rest move into a second `ActionsMenu`.**
`__footer-right` keeps exactly two always-visible action buttons — `Dry run`, `Run pipeline` — at
every viewport, 430px included, preserving their existing 44px HEL-687 tap-target treatment
unchanged. `Run history`, `Preview`, and `Share` (owner-only, same gating as today) move into a
second `ActionsMenu` instance (`aria-label="More actions"`), rendered in `__footer-right` where
those three buttons used to sit. This is the direct lever for reclaiming horizontal room at 430px,
per the amendment's explicit mobile-focused rationale — the footer's always-visible button count
drops from up to six to two (+ the one overflow trigger). Order within the overflow menu mirrors
the original left-to-right button order (Run history, Preview, Share) so relative priority reads
the same as before.

**D8 — `PipelineDetailPage.css`'s now-dead per-button selectors are removed, and
`PipelineDetailPage.css.test.ts`'s guard list is updated to match — not preserved verbatim per
D3's original framing.** D5/D7 replace `.pipeline-detail-page__edit-btn` (the three header edit
buttons) and `.pipeline-detail-page__history-btn`/`__preview-btn`/`__share-btn` (the footer's
non-pinned buttons) with `ActionsMenu`-rendered `menuitem` elements. `ActionsMenuItem` has no
`className` field, so these `menuitem`s can never carry those class names again — this is a
structural consequence of reusing `ActionsMenu` (see skeptic-design-3.md), not an implementation
choice, and it makes these four selectors' CSS rules dead code the moment D5/D7 ship. D3's "keep
`__history-btn`/`__preview-btn`/`__share-btn` unchanged" framing (and task 4.1's inclusion of
`__edit-btn` in the same list) was correct for the original consolidation but is now superseded
for exactly these four selectors — see the note added to D3 above. Per this change's own
established convention for retiring superseded selectors (task 4.1 already did this for
`__source-bar`/`__type-bar`/`__schedule-bar`/`__share-bar` in the original consolidation), the
amendment executes the same pattern one layer further in:

1. Remove `.pipeline-detail-page__edit-btn`'s base rule and its entry in the
   `@media (max-width: 768px)` combined-selector list from `PipelineDetailPage.css`.
2. Remove `.pipeline-detail-page__history-btn`/`__preview-btn`/`__share-btn`'s base rules and
   their entries in that same media-query combined-selector list.
3. Update `PipelineDetailPage.css.test.ts`'s `it.each` list (currently
   `[".pipeline-detail-page__history-btn", ".pipeline-detail-page__preview-btn",
   ".pipeline-detail-page__dry-run-btn"]`, each asserted to have `min-height: 44px` inside the
   768px block) to drop the now-nonexistent `__history-btn`/`__preview-btn` entries, keeping only
   `__dry-run-btn` — which remains a real, always-visible button under D7 and must keep passing
   this exact assertion unchanged.
4. Do not duplicate the removed 44px coverage locally in `PipelineDetailPage.css.test.ts`.
   `ActionsMenu.css.test.ts` already independently verifies `.actions-menu__trigger`/
   `.actions-menu__item`'s HEL-687 tap-target floor (confirmed directly by the design gate,
   skeptic-design-3.md), and both new `ActionsMenu` instances (D5's header trigger, D7's footer
   "More actions" trigger) inherit it for free by construction, with no page-local rule needed.

`__footer`, `__footer-right`, `__run-btn`, `__dry-run-btn`, `__save-btn`, `__cancel-btn`, and
`__cancel-confirm-btn` are unaffected by D5/D7/D8 — D3's original "keep unchanged" framing still
governs those, unmodified.

## Risks / Trade-offs

- [Combining three field groups into one header risks visual crowding at 1100/768px, where the
  three groups previously had a full row each] → Mitigate by stacking field groups vertically
  below 768px (mirrors the footer's own existing breakpoint), same idiom already proven for the
  footer at HEL-687.
- [Deleting `BoundSourceBar`/`BoundTypeBar`/`PipelineScheduleBar` outright loses their existing,
  focused unit tests if not ported first] → Port every existing scenario (name+kind display,
  Edit-button ownership gating, schedule empty/enabled/disabled/no-next-run states, toggle) into
  `PipelineDetailHeader.test.tsx` before deleting the old `.test.tsx` files; do not delete a test
  file until its assertions have an equivalent home.
- [`PipelineDetailPage.test.tsx` is a large (2000+ line) file with role/label-based assertions
  scattered throughout — a rename or removed accessible name would silently break unrelated
  assertions] → Preserve every existing accessible name/aria-label (`"Edit source"`,
  `"Edit type"`, `"Last run metadata"`, `"Disable schedule"`/`"Enable schedule"`, etc.) verbatim;
  run the full Jest suite, not just the touched files.
- [A new `@media (max-width: 768px)`/`@media (max-width: 430px)` block added to
  `PipelineDetailPage.css` for the header would collide with `PipelineDetailPage.css.test.ts`'s
  first-match `findMediaBlock` helper and silently break the HEL-687 regression guard] → Header
  responsive CSS goes in its own `PipelineDetailHeader.css` (see D1) — a file the test never
  reads — never appended as new `@media` blocks inside `PipelineDetailPage.css`.

- [Consolidating three always-visible edit buttons into one menu (D5) reduces keyboard/
  screen-reader discoverability if the menu is hand-rolled] → Mitigated by construction: reusing
  `ActionsMenu`/`usePortalPopover`, which already implements the WAI-ARIA menu-button pattern
  (focus-follows-open, arrow-key navigation, Escape-to-close, focus-out-closes) — the same
  component already shipped and accessibility-reviewed for `PanelCard`/`DashboardList`, not new
  a11y surface.
- [Moving "Run history"/"Preview"/"Share" into a footer overflow menu (D7) could read as hiding
  frequently-used actions] → Accepted trade-off per the amendment's explicit direction ("collapse
  the remaining actions... especially on mobile"); `Dry run`/`Run pipeline` — the two most
  frequent actions — are exactly what stays pinned, so the trade-off targets the intended lower-
  frequency actions.
- [D6's compaction is *expected* to resolve skeptic-final-2.md's open CR1 as a side effect, but
  is not guaranteed to by construction alone] → D6 explicitly requires the executor to
  re-measure the previously-untested enabled-schedule/next-run state at all four canonical
  breakpoints as part of this cycle's own gates, not assume the amendment closes it, and now
  names a committed fallback (compact date format + `title` recoverability, then shrink-order
  reprioritization only if that still isn't enough) rather than leaving the pre-amendment status
  quo as the only named Plan B (skeptic-design-3.md CR2).
- [D5/D7 reusing `ActionsMenu` makes `.pipeline-detail-page__edit-btn`/`__history-btn`/
  `__preview-btn`/`__share-btn` dead CSS, which would otherwise silently break or hollow out
  `PipelineDetailPage.css.test.ts`'s existing HEL-687 guard for exactly the elements it protects]
  → D8 makes the selector removal and the guard-test update an explicit, scheduled part of this
  amendment (task group 6-8), relying on `ActionsMenu.css.test.ts`'s already-existing coverage
  instead of duplicating it (skeptic-design-3.md CR1).

## Planner Notes

- Self-approved: relocating `labelForKind` to `features/sources/utils/` (D2) — a mechanical
  move required by deleting `BoundSourceBar`, not a new architectural pattern.
- Self-approved: choosing the footer's new top row for last-run metadata over folding it into
  `__footer-left` (D3) — keeps the name-editor/schema section uncluttered; either placement
  satisfies "one footer region," this is a minor layout call within that constraint.
- **Human-directed, not self-approved**: D5–D7 (the header/footer density amendment) originate
  from an explicit human escalation answer (recorded via `concertino answer HEL-719`,
  `escalation.answered` at t=1787021663047), raised after the final-gate REFUTE budget was
  exhausted on the pre-amendment design — see ticket.md's Scope Amendment section for the
  verbatim directive. The choice of `ActionsMenu` as the reuse target for both menus, and the
  specific item ordering/gating within D5/D7, are the planner's own implementation of that
  directive, self-approved as a direct, DESIGN.md-compliant (already-ratified primitive)
  execution of explicit human intent — not a further architectural decision requiring its own
  escalation.
