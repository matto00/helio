## Context

Baseline at 375×812, measured on the running app (`.concertino/scratch/HEL-1582/baseline/baseline.md`, both themes
identical): command bar 0–56, river header 56–201, tabs 201–250 (buttons 36 tall), steps scroller 250–551 (**301px**),
footer region 551–744, glass nav 744–800 (`.app-content` already pads by `--bottom-nav-height`, so the page ends at
744). Only step 1 of 3 is fully visible; step 3 and the output are below the fold. 38/46 visible controls < 44px.

`PipelineDetailPage.tsx` branches on `useIsPhoneShell()` (≤768px): phone → river (`PipelineDetailHeader`, tabs,
`PipelineRiverView`, `OutputsGalleryTab`, `PipelineDetailFooter`); desktop → `spine/PipelineSpineLayout`. Both read one
`usePipelineDetailPage()` result; dialogs are a sibling (`PipelineDetailDialogs`) so a 768px crossing never loses them.
HEL-1579's pieces are presentational and reusable: `PipelineSpine` (source cards with HEL-1628's `SourceSampleLabel`
+ refresh, `SpineLane`/`SpineStepRow` with number, title, `summarizeStepConfig` mono summary and row count,
`SpineOutputs`), `StepCardFocused` (every kind via `StepOpEditor`, Disable/Duplicate/Remove, `flushOnUnmount`),
`StepPreviewTable`, `SpineRunStatus`/`SpineLastRunMeta`, `SpineStatusStrip`, `useStepSaveSeam`, `useStepSelection`.
`shared/motion/` has tokens + `useIndicatorSlide`, `useLayoutSlide`, `useStaggeredEntrance`, `useValueTween`; no sheet.
`shared/ui/Modal.tsx` is the native-`<dialog>` primitive (focus trap, focus restore, vetoable `onClose`). HEL-1584 is
editing `Modal.*` and `shared/motion/**` concurrently; HEL-1583 (PR #1052) owns `BottomNav`/phone shell.

## Goals / Non-Goals

**Goals:** the four ACs, the approved board, DESIGN.md §0/§3/§10/§12, a reusable sheet, measured clearance/touch/contrast.
**Non-Goals:** see proposal. No change above 768px; no API change; no new dependency; no edit to `BottomNav`.

## Decisions

**D1 — New phone layout, same page state.** `ui/mobile/PipelineMobileLayout.tsx` replaces `phoneLayout`, takes `page` like
`PipelineSpineLayout`, wraps `StepSaveContext` (`useStepSaveSeam`), reuses `createInFlightDedupe`, and owns
`useSpineStepActions` (D4) at layout level so header overflow and sheet menus work on every tab. Dialogs stay a sibling.

**D2 — Header (`MobilePipelineHeader`).** Row 1: back link to `/pipelines` (44px hit, "Back to pipelines"), the name
in mono, one line, ellipsis, `title` = full name (not a heading), "Pipeline actions" `ActionsMenu`. Row 2 (status
line): `SpineRunStatus` · `SpineLastRunMeta` (rows · relative time · truncation badge), then the schedule state via
`SpineScheduleChip` in its compact form ("Add schedule" / expression / calendar icon, the "Paused" marker always
visible, full state in its title; tap opens the schedule dialog). A failed run's full error stays reachable: the
status label's `title` and the Runs tab row. Overflow: Rename, Edit source (single resolvable root), Add source, Add
Outputs from a shape, Set/Edit schedule, Pause/Resume schedule, Share (owner). Rename swaps the name for the existing
`TextField` with Save / Cancel / discard confirm on a second row (same handlers as `PipelineSpineHeader`).
`SpineStatusStrip` (cost verdict, truncation) renders under the tabs only when it has content. Header ≤ 72px.

**D3 — Tabs.** Steps / Preview / Runs, ARIA tabs (roving tabindex, Left/Right/Home/End), ≥44px tall, active indicator
`.motion-indicator` driven by `useIndicatorSlide` (accent: an active indicator, §0). Local state, Steps on load.
Preview and Runs mount only while active, so loading the page adds no request (HEL-1620).

**D4 — Steps tab reuses `PipelineSpine` with `variant="phone"`.** Extract `useSpineStepActions` (palette target, shape
picker, add-root state and openers, `useLaneReorder`, `menuItemsFor`, the three dialogs) from `PipelineSpine`,
behaviour-preserving on desktop. Phone variant: the "Source/Steps/Outputs" eyebrow text is visually hidden (kept for
the a11y tree) but the Steps heading's **"N steps" text and `TruncatedRowCountBadge` stay visible** on one compact
line (the partial marker is the only visible truncation signal). "+ Add source" and "Add Outputs from a shape" move to
the header overflow; no drag grip or per-row menu (HTML5 DnD is mouse-only; Move up/down is in the sheet's Step actions,
D5). A row is one full-width button ≥60px: number badge on the vertical line, title, mono summary (ellipsis), count,
chevron, `aria-haspopup="dialog"`, markers unchanged. "+ Add step" is a dashed 44px row.
**Source card:** the card is not one button: its mono name is the "Edit source" button (when the source resolves in
the caller's list; else plain text), siblings of the menu and refresh controls, never nesting them; its existing "Source actions for <name>" menu (Edit source, Remove from pipeline — disabled with one
root) stays on every card at 44px, with the sample label and its refresh control. **Output card:** tapping opens the
Output editor sheet (existing `handleOpenOutput`); its "History for <name>" menu stays; the section keeps "+ Output"
("New output"). The chevron is decoration on the tappable card, never a separate control. Gutters 12px (`--space-3`).
Budget at 375×812 (content 56–744): header ≤72 + tabs 44 + count line 24 + pad 12 + source 64 + 3×64 + add 44 + output
64 + gaps ≈ 560 → list ends ≈ 616 vs bar top ≈ 692. AC1 is asserted by e2e (D10).

**D5 — Step sheet.** The open step is stored as its `stepRenderKey` (stable through an AI draft's temp→server id swap,
HEL-1109) and resolved each render. Ordinary creates carry no `renderKey` (`usePipelineStepCreation.ts:97/193`,
`usePipelineLaneStepCreation.ts:110`), so on confirm the temp step vanishes as the server step appears: in that same
commit the sheet **re-keys** to the step `useAddedStepId` reports and stays open, with no exit/entrance animation (the
editor remounts under its new key exactly as the desktop editor does). It closes only when its key is gone and no step
was added in that commit (a removal). Added-step detection is extracted from
`useStepSelection` into a shared `useAddedStepId(steps)` used by both layouts (no re-implementation): any step that
appears (append, insert, branch, duplicate, shape) opens in the sheet, as the desktop selects it. The sheet holds
`StepCardFocused` (keyed by render key) then `StepPreviewTable`, with the props `PipelineSpineLayout` passes, and a
"Step actions for <label>" menu (`menuItemsFor`). Closing unmounts the editor, so `flushOnUnmount` sends a pending edit.

**D6 — Sheet primitive in `shared/motion/`: `useSheetSwipe` + `BottomSheet` composing `Modal` (no edit to `Modal.*`).**
(a) Gesture surface: the grab handle and the sheet header only, both `touch-action: none`, pointer events with capture.
No body path (a pointer drag on a scrollable body gets `pointercancel` once the browser claims the pan); the body
always scrolls. The sheet follows the finger via inline `transform: translateY(dy)` (dy ≥ 0, no transition while
dragging). Release: dy > 25% of sheet height or velocity > 0.5 px/ms → request close; else spring back.
(b) At rest the sheet has **no transform**: the inline style is removed after settle (never `translateY(0)`), because
a transform containing block mis-anchors portalled `Select` popovers (Modal.css:13-18). Unit-tested.
(c) Exit: `BottomSheet` keeps `Modal`'s `open` true through its exit animation (slide down on `--motion-duration-move`
+ `--motion-ease-out`; Subtle: opacity fade; Off: instant), then calls the consumer's close, since Modal closes
synchronously. (d) Veto order: a swipe/close/Escape first asks the consumer (`onRequestClose` returning false vetoes);
vetoed → spring back, allowed → exit then close. `pointercancel` springs back. (e) Entrance: the sheet's own class
selector, of higher specificity than `.ui-modal[open]`, replaces `ui-modal-in` with a rise from the bottom on the move
token; under Subtle (`:root[data-motion="subtle"]`, the same scope HEL-1584 uses) a fade only; under Off/OS-reduce
nothing. Following the finger works at every level (direct manipulation). Phone presentation: full height minus
`--space-4` top inset, top radius, opaque `--app-surface`, Modal's own close button (phone tap expander already at
IconButton.css:103). No literal timing. API documented in DESIGN.md §10 for HEL-1584's split / HEL-565.

**D7 — Floating action bar (`MobilePipelineActions`).** Absolute inside `.pipeline-detail-page` at
`bottom: var(--space-2)`, right-aligned at the gutter (the page already ends above the nav; re-measured against
HEL-1583). Dry run: secondary, **opaque** `--app-surface` + `--app-border-strong` (DESIGN.md §3: the glass carve-out
"does not widen"; explained in the PR). Run pipeline: the only accent fill. Both `--control-lg` with a full ::after
expander (§3: no `min-height:44px` on buttons), gap ≥ `--space-1`. Disabled while queued/running. Scroller
`padding-bottom` = measured bar height + `--space-4` via `--pipeline-mobile-actions-h` (ResizeObserver), so a taller
bar keeps clearance. **HEL-1631 slot:** the bar is a column: an empty, zero-height `data-slot="draft-status"` row (no padding/gap while
empty, `:empty` collapses it) above the pills
for "Draft · unsaved changes", and a pill row whose secondary/primary become Discard / Save & run while a draft exists.
On phone the draft status lives here, not in the header (to be noted on HEL-1631).

**D8 — Preview and Runs.** Preview: a 44px `Select` "Step N · label" (default: last step of the first root's trunk;
every lane's steps listed), the step's output schema chips (`getAnalyzeOutputSchema`), `StepPreviewTable`. Runs: extract
`RunHistoryList` (rows + loading/empty/error) from `RunHistoryModal` (modal output unchanged); add
`ensureRunHistoryLoaded()` to `useRunHistory` (loads unless fresh, never sets `historyOpen`), called on first Runs
activation; Retry uses the existing retry.

**D9 — Retire the river; keep every non-layout obligation.** Delete `PipelineRiverView`, `RootColumn`, `LaneColumn`,
`StepCard` (+`StepCardHeader`, `StepCardPreviewTray` if unreferenced), `RibbonSegment`, `BranchAffordance`,
`OutputsRail`, `OutputsGalleryTab`, `PipelineDetailHeader`, `PipelineDetailFooter` and their CSS/tests once `tsc` and an
import grep prove them unreachable. **Tests:** the ~183 jest tests in the 9 `installPhoneShell` files that drive page
logic through the river are sorted per `describe` into (a) layout-independent → retargeted to the spine or phone DOM
with no weakened assertion, (b) phone behaviour → ported to the new layout, (c) river-only → deleted with the
replacement test named; the mapping is recorded in `evidence/test-mapping.md`. `PipelineDetailPage.spine.test.tsx:709`
is inverted to assert the phone layout. Six e2e specs with river selectors are ported (intent kept). **Specs:** one
requirement states that each "Layout scope (HEL-1579)" paragraph's desktop-side obligations that are not about
placement apply at ≤768px too unless this capability says otherwise — named: truncation context on counts, the
boot-request bound, the create-in-flight guard, inline validation/warnings/schema-diff on every lane, schedule-state
visibility. Rewriting the ~41 paragraphs is follow-up candidate FU-1 (the driver files follow-ups for this run).

**D10 — Verification.** New e2e `hel1582-mobile-pipeline.spec.ts` (1 seeded user, requests counted): AC1 at 375×812
both themes (source card, 3 rows, output card fully inside the scroller and above the bar top at scrollTop 0); AC2 every
`OpType`'s editor rendered in the sheet in jest, plus an e2e geometry sweep of every op kind's editor in the sheet at
375 (no horizontal overflow, controls inside the sheet), a real CDP touch drag on the handle dismissing it, and the close
button; AC3 scrolled-to-end last item bottom ≤ bar top − 8 and bar bottom ≤ nav top; AC4 `touchTargetProbe` /
`expectTapExpander` sweep of each tab, the cards' menus and the open sheet at 375/390/768. Phone hover/focus/pressed of
new controls measured with `stateContrast` (state surface ≥1.10, text ≥4.5, non-text ≥3), JSON in evidence. A
mutation shows each new guard can fail.

## Risks / Trade-offs

- HEL-1583/HEL-1584 touch CSS-count pins, `theme.css`, `shared/motion`: expect conflicts; reconcile and re-measure
  nav clearance when #1052 lands.
- Large diff (river deletion + test retargeting); done in its own commits after the new layout is green.
- The ~41 "Layout scope" paragraphs stay textually until FU-1; the superseding requirement keeps their obligations.
- The spine-layout delta keeps the scenario name "Phone layout unchanged": `openspec validate` refuses a MODIFIED block
  that drops an existing scenario name (verified), so the name stays and the body says what is true.
- No body swipe path: a user scrolls to the top and drags the header/handle, or taps close.

## Planner Notes

Self-approved (reversible, recorded in the PR): opaque Dry run (D7); overflow contents (D2); Preview default (D8); row
chevron, no row menu (D4); sheet thresholds and no body path (D6); river deletion here (D9); accent tab indicator (D3);
every added step opens the sheet (D5). Design decisions HEL-1631 builds on: the action-bar slot and clearance variable
(D7), the sheet API (D6), Preview hosting `StepPreviewTable` (D8). Phone `?step=` deep link opening the sheet is not in
scope (follow-up candidate FU-2).
