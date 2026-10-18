## Context

HEL-1582 (d83875077) added the phone layout (`features/pipelines/ui/mobile/PipelineMobileLayout.tsx`, its own
`openKey` state for the sheet, `MobileStepSheet.tsx`) on top of the shared `BottomSheet` (`shared/motion/`), which
composes `shared/ui/Modal.tsx` (native `<dialog>` + `showModal()`, Escape routed through its `cancel` listener).
HEL-1608 (647734111) keyed the desktop spine width to the page container (compact rows below ~259px). The desktop
`?step=` lives in `hooks/useStepSelection.ts` (`STEP_PARAM`, replace-writes via functional `setSearchParams`); the
phone layout never reads it. Toasts portal to `document.body` (`shared/ui/Toast.tsx` `ToastViewport`, z-index
`--z-toast`), which a modal `<dialog>`'s top layer always covers and makes inert. Popovers already escape this by
portalling into `closest("dialog[open]")` (ActionsMenu, Select, `OutputSchemaDisclosure`). `usePortalPopover`
closes on a document `keydown` Escape but does not stop the native dialog close request.

## Goals / Non-Goals

**Goals:** the seven ticket items, each with a test that is red on origin/main before the fix (item 7 is coverage of
existing behaviour: its guard is shown failable by a mutation instead). Desktop (HEL-1579/1608) behaviour unchanged
except item 4's intended placement and the item 6 copy.

**Non-Goals:** HEL-1661, HEL-1670, hover colour tokens (HEL-1669), the hel1579 spec and `App.tsx` (HEL-1620).

## Decisions

**D1 Deep link (item 1).** Extract the id-or-render-key resolver from `useStepSelection.ts` into a shared pure
function (no duplicate). The phone URL is DERIVED from the open step, not written per event: one effect replace-syncs
`?step=` to `open?.step.id ?? null` (functional `setSearchParams(prev => …, { replace: true })`, so `outputId`
survives). That single sync covers every open/close path: row tap, added step, deep link, close control, swipe, the
render-adjusted removal close (`PipelineMobileLayout.tsx:72`, including the optimistic delete before a failed-delete
reopen), and the AI-draft temp→server id swap (the URL follows the open step's current id). Deep-link open is a
ONE-SHOT owned by `PipelineDetailPage` (which stays mounted across the `useIsPhoneShell` layout switch,
`PipelineDetailPage.tsx:37,82`): at page mount it captures the initial `?step=` value into a ref, and at the page's
first steps load — whatever the layout — it marks the deep link consumed. The phone layout opens the captured step's
sheet only if it is the phone layout at that first load. The phone URL-sync effect is gated until the deep link is
consumed, so a phone layout mounting while steps still load never deletes `?step=` before it is used. A later
desktop→phone switch (window resize, iPad rotation to 768) therefore never pops a sheet: the phone layout has no open
sheet and the sync removes `?step=`. Phone→desktop with a sheet open keeps `?step=` and desktop selects that step. An
unresolvable initial value opens nothing and is removed by the same sync. Rejected: reusing `useStepSelection` on phone
(it always resolves a default step) and event-based writes (miss the removal-close and id-swap paths).

**D2 Toasts above the modal (item 2).** `ToastViewport` portals its visual stack AND its live regions into the topmost
open modal dialog, else `document.body` — the established in-dialog portal pattern (ActionsMenu, Select,
`OutputSchemaDisclosure`). The Popover API is rejected: measured by the design skeptic in Chromium 151, a popover shown
above an open modal is not hit-testable (the dialog subtree intercepts) and sits outside the modal's exposed subtree.
- *Topmost* = most recently opened, not DOM order: a `MutationObserver` on `document.body` (subtree,
  `attributeFilter: ["open"]`) maintains an open-order stack of modal dialogs (`dialog.matches(":modal")`, guarded
  for jsdom), pushing on open and removing on close.
- *Announcement ordering* (existing requirement: regions exist before their content). On a re-target the new regions
  are first committed EMPTY; one animation frame after they are connected, the viewport inserts the messages of toasts
  that were committed less than 100 ms before the re-target (the ones that raced the modal opening, e.g. the
  failed-delete flow: `usePipelineStepMutations.ts:91,100` restore the step and push the toast in one commit, and the
  sheet's `showModal()` runs in a later passive effect). Older toasts were already announced in the previous target and
  are not re-inserted, so nothing is announced twice. Implemented with a per-toast committed-at ref in `ToastViewport`.
- *Ordering mechanism.* The race-window messages are inserted after at least one FULL rendered frame: a
  `requestAnimationFrame` inside a `requestAnimationFrame` (a single rAF runs before that frame's layout/AX update, so
  the empty region and the message would be processed together). The e2e records, in the page, a frame counter
  advanced by a rAF loop and a MutationObserver on the dialog: it asserts the assertive region was connected inside the
  open dialog, empty, with not `inert`/`aria-hidden` ancestors, at least one completed frame before the message text was
  added, and that the text was added once. Threshold pinned: the frame counter at the message insertion minus the
  counter when the empty region was connected is >= 2 — a single-rAF implementation fails it (shown by mutation). A
  toast pushed during that two-frame window after a re-target is HELD with the deferred ones until the ready flag (C1),
  then inserted once; the deferred insertion skips ids already present, so nothing is inserted twice. The
  module map entry (deadline, entered flag) is deleted when the toast is dismissed or evicted. The spec scenario is stated as this DOM-and-frame property.
- *Remount of visible toasts on re-target.* Changing the portal target remounts each visible `ToastItem`. Decisions:
  the auto-dismiss timer is NOT restarted (the remaining time is computed from a per-toast deadline set when the toast
  is first shown, kept in a module-level map keyed by toast id, so a remount resumes the remaining time); the entrance
  animation does NOT replay for a toast that already entered (a `data-entered` flag from the same map suppresses it);
  a toast mid-exit at re-target is completed (removed) rather than snapping back to full opacity.
- *Tab trap.* Toast buttons inside the dialog join `Modal`'s Tab-trap list (`Modal.tsx` queries the whole dialog):
  intended, so a toast's dismiss is keyboard-reachable while a modal is open. If a focused toast is removed, focus
  moves to the dialog's first focusable element, never to `<body>`.
- *Motion.* During the sheet's entrance, drag and exit the dialog carries transform/opacity, so the toasts move with
  it and return to the body after close. Accepted: transient, and the alternative (outside the dialog) is inert.
- Inside the sheet the toast keeps its phone `bottom` offset (`toast.css`); the e2e checks it does not cover the
  sheet's own bottom controls.

**D3 Escape scoping (item 3).** In `usePortalPopover`'s Escape handler, call `event.preventDefault()` only (no
`stopPropagation()`, which would block `OverlayProvider`'s and `useShortcut`'s window listeners). Measured by the design
skeptic in Chromium: preventDefault on the document keydown suppresses the dialog's `cancel` and still reaches window
listeners. Scope stated honestly: this changes Escape for EVERY `usePortalPopover` consumer inside a dialog
(ActionsMenu incl. the sheet's "Step actions", UserMenu, DashboardAppearanceEditor, IconButton, Provenance; `Select`
already does this, `Select.tsx:120-122`): Escape closes only the popover. Outside dialogs the default action is a no-op.
Spec'd in an `overlay-management` delta; tested for the schema panel in the sheet and for an ActionsMenu in a Modal.

**D4 Placement (item 4).** `usePortalPopover` gains an OPT-IN `place?: (panel: HTMLElement, trigger: DOMRect) =>
PortalPopoverPos` option. When given, the hook calls it in a layout effect once the panel is mounted (and on window
resize), and the panel renders `visibility: hidden` until the first placement, so there is no flash. The existing
`computePos`/`hasClampedRef` path (horizontal, `right`-anchored, `usePortalPopover.ts:129`) is untouched for every
consumer that does not pass `place`. `OutputSchemaDisclosure` passes `place`:
- Values from CSS custom properties declared on `.output-schema-disclosure__panel` (`--schema-panel-max-width: 28rem`,
  `--schema-panel-max-height: 24rem`, `--schema-panel-edge-margin: 0.5rem`, also used by its `width`/`max-height`
  rules), read with `getComputedStyle(panel).getPropertyValue` and resolved to px against the root font size. The
  custom properties are never overridden inline, so reading them is not circular. The literal px constants go.
- Width: the mounted panel's measured `getBoundingClientRect().width`; the horizontal clamp moves into `place`.
- Real height: `panel.scrollHeight` (content height, unaffected by `max-height`), bounded by the cap.
- Rule: above if `min(contentHeight, cap) <= roomAbove`; else the side with more room, `maxHeight` = that room.
- Room below ends at the rendered `.bottom-nav`'s top edge when the nav is present and the panel is not inside an
  open dialog (the sheet covers the nav); else at the viewport edge minus the margin.
- Desktop: pinned fixture, trigger `top` recorded, content height below the room above but the 384px cap above it —
  red on origin/main (`OutputSchemaDisclosure.tsx:87` opens below), green after, at 1280×800 and 1000×800. A second
  scenario: content taller than the room above opens on the roomier side, capped.

**D5 Hover gating (item 5).** Scope: the pipeline page's OWN stylesheets (`ui/mobile/PipelineMobile.css`,
`ui/spine/*.css`, `ui/StepCardFocused.css`, `ui/OutputSchemaDisclosure.css`, `ui/PipelineDetailPage.css`). Shared
controls in the sheet (IconButton, ActionsMenu items, `.ui-modal-btn`, Select) are out of scope and listed as a
follow-up; the spec is narrowed to match. Two kinds of `:hover` rule are treated differently:
- *Hover fills* (background/colour/border/shadow changes): only the `:hover` selectors move into
  `@media (hover: hover)`. A fill rule that lists `:hover` next to non-hover states (e.g. `OutputSchemaDisclosure.css:21-25`)
  is SPLIT: the `:focus-within`/`[aria-expanded]`/selected selectors stay ungated with identical declarations, only the
  `:hover` selector moves. Values unchanged.
- *Reveals and their backings* stay UNGATED, as named allowlist units in the guard, each with its reason:
  (1) `PipelineSpine.css:207` `.spine-row:hover .spine-row__grip` (drag-grip reveal; dragging is pointer-only, harmless
  on touch); (2) `PipelineSpine.css:326-330` (regular-spine row-menu opacity reveal, mixed with `:focus-within` and
  selected — left exactly as is, not split); (3) the WHOLE HEL-1608 compact-mode block `PipelineSpine.css:459-486`
  inside `@container spine-column (max-width: 226px)` — the menu reveal, its backing, and the selected-row
  `:hover` select/menu tones (`:479-485`) — as ONE unit. On a touch tablet a tap on the row is what reveals the menu
  today, and the design skeptic measured that gating only `:479-485` turns the just-tapped selected row from accent-mid
  to neutral grey; keeping the block whole keeps HEL-1608 exactly (including its tapped-row tones).
- Guard (jest, CSS source, red first on origin/main): every selector containing `:hover` in those files is either
  inside `@media (hover: hover)` or on a named reveal allowlist (each entry with its reason); no selector list mixes a
  gated `:hover` with a non-hover selector. An e2e at 1024×800 with `hasTouch`+`isMobile`, light and dark, taps a compact
  row, asserts its select and menu-backing backgrounds equal origin/main's (selected: accent-mid / accent gradient) and
  opens its step menu — recorded identical before and after.
- Red-first e2e for the sticky fill: `hasTouch`+`isMobile` (measured: `hover: none`; sticky colour reproduces after
  `tap()`), tap a step row on the phone, close the sheet, the row's fill equals its rest fill.
- No `hover: hover` exists in `frontend/src` today; an app-wide DESIGN.md rule is a follow-up (HEL-1669 also edits
  DESIGN.md).
- **HEL-1669 overlap:** its worktree adds an ungated `.mobile-pill` hover fill to `PipelineMobile.css` and edits
  `e2e/hel1582-mobile-pipeline.spec.ts`. HEL-1669 merged first; this lane gated its light `.mobile-pill` hover rule in place (values untouched). The hel1582 hover-contrast test and HEL-1669's Dry run hover test now run in a non-touch, hover-capable 375x812 context (driver lifted the do-not-edit rule): hover fills no longer apply under `hover: none`, and the touch side is covered by the hel1668 sticky-hover e2e.

**D6 Copy (item 6).** (a) The dedupe condition is the label text, not the source kind: export a small selector/hook
from `SourceSampleLabel` that returns the label text it renders (`describeSampleLabel`), and `SpineSourceCard` omits
its kind meta only when that text starts with `labelForKind(source.type)`. Truncated ("first 1,000 of N rows"),
loading and unavailable labels keep the meta line, so "Static" is always shown exactly once. (b) `SpineOutputs` reads
"from <subtitle>" / "from the pipeline's source". (c) `SpineLastRunMeta` (shared with the desktop header) splits the
row count and the relative time into sibling spans: the row-count span is all-or-nothing (the whole "N rows written ·" or absent, never a fragment: the line is a one-line-high wrapping flex row formed time-first and shown count-first, so a count that does not fit wraps onto a clipped second line). The meta box is sized from the time alone (`contain: inline-size` on the text box) and then grows into the header's genuinely free space, so a hidden count reserves no width: the pipeline name is not truncated next to blank space, and the count shows exactly when it fits (phone: the same growth in the run line), the time span is
`flex-shrink: 0`; `title` unchanged. Checked on phone and on desktop at 1000 and 1280. To keep the time from being squeezed out, `.spine-header__meta` keeps `min-width: 15ch` (the longest relative time in the mono face) and the whole meta line is hidden at a page container <= 685px instead of <= 600px: at 601-685px (about a 905-990px window with the context list open) it is hidden rather than clipped (origin showed a 74px fragment with 24px of overflow at 960px). On the phone, with the kind meta omitted, the source card's label takes `margin-top: calc(var(--space-4) + var(--space-1))` so the name button's and the refresh button's 44px expanders do not overlap. All three are reversible UI
decisions listed in the PR body.

**D7 Coverage (item 7).** A new phone e2e (not an edit to HEL-1648's spec): editor grantee at 375 and 768, both themes,
refreshes a source sample on the phone source card; exactly one `?pipelineId=`-scoped request, 200, label still
rendered. Shown failable by a mutation (dropping the `pipelineId` scope) and labelled a guard, not a red-first test.

**Tests.** New specs named `e2e/hel1668-*.spec.ts`, Playwright at 375, 390 and 768 plus 1280/1000 for item 4, light
and dark, screenshots under `.concertino/scratch/HEL-1668/`. Jest units for D1 resolver/URL sync, D3 handler, D4
placement math, D6 copy. Workers capped at 2, `nice -n 19`.

## Risks / Trade-offs

- D2 changes every Modal's toast surface; the 100 ms race window is a heuristic, proven by the ordering e2e. If the
  ordering cannot be proven in Chromium the executor escalates rather than weakening the check.
- D3 changes Escape for every in-dialog `usePortalPopover` consumer (intended, spec'd).
- D4 adds an opt-in hook option; non-opting consumers are unchanged (their existing tests must stay green).
- D5 conflicts textually with HEL-1669 in `PipelineMobile.css`; resolved by whichever lane merges second.

## Planner Notes

Self-approved: D1 two-way URL sync (reversible), D2 portal-into-dialog mechanism, D6 wording "from <step>" and the
static meta omission, D7 as a new spec file to avoid editing HEL-1648's spec.
