## Why

`PipelineDetailPage` has accumulated three separate top-of-page info bars (source, type,
schedule) plus a dense footer, PLUS two more strips rendered below the footer (an owner-only
Share button bar and a last-run metadata bar) — six chrome regions total around one step list.
It reads as a stack of retrofitted strips rather than one designed surface (HEL-719, from the
beta UI/UX polish sweep).

## What Changes

- Consolidate `BoundSourceBar`, `BoundTypeBar`, and `PipelineScheduleBar` into one new
  `PipelineDetailHeader` component: a single bordered/backed region above the river view,
  containing source, type, and schedule as three field groups that wrap/stack at narrow widths
  but never render as separate bars.
- Fold the owner-only Share button and the last-run metadata bar into the existing
  `PipelineDetailFooter`, so the footer is the one bottom region (no strips render below it).
- Relocate `labelForKind` (currently exported from `BoundSourceBar`, imported by
  `CreatePipelineModal` and `ShapeInstantiateStep`) to a shared, source-domain location.
- Delete `BoundSourceBar`, `BoundTypeBar`, `PipelineScheduleBar` (+ their `.css`/`.test.tsx`)
  once their behavior is ported into the new header and its tests.
- Preserve the HEL-687 430px mobile-floor treatment (footer stacks, action row wraps, 44px tap
  targets) — `PipelineDetailPage.css.test.ts` is the regression guard; its asserted selectors
  must keep passing.
- **BREAKING** (internal only): `labelForKind`'s import path changes for its two consumers.

### Scope amendment — header/footer density (post-final-gate, human-directed; see ticket.md)

- **Header actions consolidate into one menu.** Replace the three always-visible "Edit source" /
  "Edit type" / "Edit schedule" buttons with a single `ActionsMenu` trigger (reusing the existing
  ratified `shared/chrome/ActionsMenu.tsx` primitive — see DESIGN.md's canonical chrome-primitives
  list) exposing those actions as menu items, ownership-gated exactly as today. The schedule
  enable/disable `Toggle` stays inline (a persistent state control, not a navigation action).
- **Header field-group display compacts.** Source/type/schedule each render denser (single-line
  label+value, tighter spacing) rather than the original consolidation's eyebrow-label rows —
  this both satisfies the amendment's density goal and frees the horizontal budget that was
  feeding the final-gate skeptic's open next-run-truncation finding.
- **Footer pins Dry run + Run pipeline; the rest move into an overflow popover.** `Dry run` and
  `Run pipeline` stay unconditionally visible in `__footer-right` at every viewport, 430px
  included. `Run history`, `Preview`, and `Share` (owner-only) move into a second `ActionsMenu`
  instance (`aria-label="More actions"`), reducing the footer's always-visible action-button
  count and reclaiming horizontal room, especially on mobile.
- **BREAKING** (accessibility structure, internal): the "Edit source"/"Edit type"/"Edit schedule"
  buttons and the footer's "Run history"/"Preview"/"Share" buttons change `role` from `button`
  (always present in the DOM) to `menuitem` (present only while their respective menu is open),
  though their visible label text/accessible name is unchanged. Any test or spec scenario that
  queries `getByRole("button", { name: "Edit source" })` etc. directly must instead open the
  owning menu first and query `getByRole("menuitem", { name: "Edit source" })`.

## Capabilities

### New Capabilities

(none — no new user-facing capability, this is a chrome consolidation of existing ones)

### Modified Capabilities

- `pipeline-editor-page`: the page's section count/description changes from "four sections"
  (bound-source bar, bound-type bar, river, footer) to one header region + river + one footer
  region; the last-run-metadata requirement relocates from a standalone bar to the footer.
- `pipeline-schedule-config-ui`: the schedule bar's placement description changes from "between
  the bound-type bar and the river view" to "within the page header, alongside source and type";
  the "existing editor layout unaffected" backward-compat scenario is restated against the new
  single-header/single-footer structure instead of the old four-bar layout it currently names.

## Impact

Frontend only, `frontend/src/features/pipelines/ui/`: new `PipelineDetailHeader.tsx` + new
`PipelineDetailHeader.css` + new `PipelineDetailHeader.test.tsx`. `PipelineDetailFooter.tsx` is
extended with new props — its styles and tests are **not** being extracted into their own files;
they stay exactly where they already live today (`PipelineDetailPage.css`'s `__footer*` selectors,
`PipelineDetailPage.test.tsx`'s footer-level assertions), which is also what keeps
`PipelineDetailPage.css.test.ts`'s existing selectors resolving unchanged. `PipelineDetailPage.tsx`
rewired; `PipelineDetailPage.css` has its `__source-bar`/`__type-bar`/`__schedule-bar`/`__share-bar`
selectors removed (superseded by the new header) while every footer/step-card selector
`PipelineDetailPage.css.test.ts` asserts on is preserved unchanged; deletions of the three retired
bar components; two importers of `labelForKind` updated. No backend, schema, or API changes —
every existing action (edit source/type, schedule, run history, preview, dry run, run, share)
stays reachable, just relocated.

**Amendment additions:** `PipelineDetailHeader.tsx`/`.css` gain an `ActionsMenu` (imported from
`shared/chrome/ActionsMenu.tsx`, no new component file) replacing the three edit buttons, plus
denser field-group markup/styles. `PipelineDetailFooter.tsx` gains a second `ActionsMenu` instance
for Run history/Preview/Share; `Dry run`/`Run pipeline` remain plain buttons in `__footer-right`.
Both header and footer test files, plus `PipelineDetailPage.test.tsx`'s role-based assertions for
the affected buttons, are updated for the button→menuitem role change (see Scope amendment
above). Spec deltas for `pipeline-editor-page` and `pipeline-schedule-config-ui` are updated to
describe the menu-based header actions and the footer's pinned/overflow split.

## Non-goals

- No new DESIGN.md tokens/components: the header and footer overflow menus reuse the existing,
  already-ratified `ActionsMenu`/`usePortalPopover` primitives (already used by `PanelCard`,
  `DashboardList`) — no bespoke menu/popover component is introduced. (Supersedes this proposal's
  original broader "no visual redesign beyond consolidation" non-goal — see ticket.md's Scope
  Amendment section for why.)
- No change to `PageShell`/App.tsx route-registry conventions — DESIGN.md has no page-header
  convention section yet to align to (ticket says "once established"); this change does not
  block on that.
- No dedup of `SourceDetailPanel`'s own separate `labelForKind` copy — out of scope.
