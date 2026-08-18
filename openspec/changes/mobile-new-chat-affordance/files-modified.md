## Files modified

- `frontend/src/shared/ui/Modal.css` — **Finding B fix.** Root cause: `.ui-modal` only declares
  `max-height: 90vh`, never an explicit `height`; per CSS, a percentage `height` on a child
  (`.ui-modal__inner`'s prior `height: 100%`, added by HEL-716) only resolves against an ancestor
  with a *definite* height, and `max-height` alone doesn't establish one for a `display: block`
  ancestor — so it silently fell back to content-driven `auto`. Once a consumer's content grew
  taller than 90vh, `.ui-modal__inner` grew past the dialog's real box, the header/footer lost their
  fixed pinning, and the dialog itself (native `overflow: auto`) became the scroll container for the
  whole header+body+footer stack instead of just the body — a consumer with auto-scroll-to-latest
  behavior (the assistant panel's `scrollIntoView({block: "end"})`) then scrolled that oversized
  column to an arbitrary position, landing on a mostly-blank slice (the reported "blank area with a
  horizontal line"). Fix: `.ui-modal[open]` becomes the flex container (`display: flex; flex-
  direction: column`) and `.ui-modal__inner` becomes its `flex: 1 1 auto; min-height: 0` item instead
  of a `height: 100%` block child — flex layout resolves a definite size for its item directly from
  the container's own box (`max-height` included), sidestepping the percentage-resolution rule
  entirely. One shared fix in the primitive; no per-consumer patches.
- `frontend/src/shared/ui/Modal.css.test.ts` — added a static-source regression guard (jsdom has no
  real layout engine, so this can't be a rendered-layout assertion) asserting `.ui-modal[open]` is a
  flex column and `.ui-modal__inner` is `flex: 1 1 auto; min-height: 0` (not `height: 100%`),
  mirroring this file's existing HEL-313/HEL-319 static-source guards.
- `frontend/src/app/CommandBar.tsx` — **Finding A.** Added a phone-only "+" `IconButton`
  (`variant="secondary"`, `size="xs"`, `aria-label="New chat"`) next to
  `.app-command-bar__mobile-title`, gated on `pickerId === "chat"`, dispatching the existing
  `startNewConversation()` action — mirrors the desktop `SidebarBody.tsx` sidebar trigger exactly
  (same action, same `aria-label`/`addLabel` text), giving phone users on `/chat*` a reachable way to
  start a fresh conversation (the desktop trigger lives inside `.app-sidebar`, `display: none`
  below 768px).
- `frontend/src/app/CommandBar.test.tsx` — new file. Covers the new control's React-conditional
  gating (`pickerId === "chat"` — present on `/chat`, absent on `/` and `/pipelines`) and that
  clicking it dispatches `startNewConversation()` (asserted via
  `assistantConversations.startingNewConversation` flipping `true`), plus the DESIGN.md §5
  icon-button tooltip convention (`title` defaulting to `aria-label`).
- `frontend/src/app/App.css` — added the `.app-command-bar__mobile-new-chat` breakpoint rule
  (hidden by default, shown only under the existing `@media (max-width: 768px)` block), mirroring
  `.app-command-bar__mobile-title`'s own pattern. Uses a compound `.app-command-bar
  .app-command-bar__mobile-new-chat` selector (not the single class alone) — `IconButton.css`'s own
  base rule also sets `display` on the same element at equal (single-class) specificity, so a
  same-specificity selector was resolving by stylesheet load order (confirmed live: the control was
  incorrectly visible on desktop before this fix) rather than reliably losing to the page-level
  override.
- `frontend/src/app/App.css.test.ts` — new file. Static-source regression guard (same jsdom
  limitation as `Modal.css.test.ts`) asserting `.app-command-bar__mobile-new-chat` is `display: none`
  by default and `display: inline-flex` inside the `max-width: 768px` block.

## Root cause / probe evidence (systematic-debugging.md)

**Finding B — root cause:** `frontend/src/shared/ui/Modal.css`'s `.ui-modal__inner` rule (CSS
layer). See the detailed root-cause comment left in `Modal.css` at that rule, and the file-level
summary above.

**Probe (live, Playwright, iPhone-13 viewport 390×844, `matt@helio.dev`, dev servers on
localhost:6178/9085):**

1. Opened "Open assistant" (`CommandBar`'s quick-launcher) on the dashboard. Captured
   `getBoundingClientRect`/`getComputedStyle` for the `<dialog class="ui-modal...">`,
   `.ui-modal__inner`, `.ui-modal__body`:
   - Dialog: `top: 42.2px, height: 759.6px` (correctly capped at 90vh of 844px).
   - `.ui-modal__inner`: `top: -3403.8px, height: 4277.2px` — nearly 6x the dialog's own height,
     positioned almost entirely above the visible viewport.
   - `dialog.scrollTop: 3447` of `scrollHeight: 4277` / `clientHeight: 758` — the **dialog itself**
     was the scroll container, scrolled almost to its maximum.
2. Live monkey-patch probe: set `dialog.style.height` to the dialog's own already-computed used
   height (`757.59px`) — `.ui-modal__inner`'s rendered height immediately dropped from `4277.19px`
   to `757.59px`. This directly confirms the percentage-height-resolution hypothesis (design.md D5
   mechanism #1): giving `.ui-modal` an *explicit* `height` (not just `max-height`) is what makes
   `height: 100%` resolve correctly on the child — ruling out D5 mechanism #2 (viewport `vh`/
   dialog-centering quirk), since the dialog's own box was always correctly positioned and sized.
3. Reproduced "Review proposal" (`pipeline` kind) via `PipelineProposalReviewPage`'s `IS_DEV` demo
   fixture (`/pipeline-proposals/review`, no `location.state`). The tiny 2-row/0-step default fixture
   didn't overflow 90vh, so it rendered correctly — this by itself doesn't disprove the shared cause,
   so a 25-step proposal was injected via `history.pushState({usr:{proposal}}) +
   popstate` (exercising the real `PipelineProposalReviewPage`/`PipelineProposalReview` render path,
   not a mock). Result: `.ui-modal__inner` grew to `2863px` against the same `759.6px`-capped dialog —
   the identical collapse mechanism, confirming Finding B's shared root cause (design.md D4) is not
   scoped to the chat auto-scroll case.
4. `ProposalReview`'s own default (non-demo, DataType-derived) fixture content was already tall
   enough to overflow on its own: `.ui-modal__inner` measured `898.8px` against the `759.6px` cap,
   pre-fix.
5. Applied the fix (`Modal.css` only) and re-ran every capture above: `.ui-modal__inner` bounded to
   `757.6px` in the "Open assistant" case (body internally scrolled to latest message, `bodyScrollTop:
   3447` of `bodyScrollHeight: 4200`, header/footer now correctly pinned) and to `757.6px` in the
   25-step "Review proposal" case (screenshot confirms: fixed header with title + close button,
   internally-scrolling step list, fixed Reject/Accept footer). `ProposalReview`'s own overflowing
   fixture also bounded correctly post-fix (`757.6px`).
6. Spot-checked every other `size="lg"`/`full` consumer post-fix per tasks.md §1.6 —
   `PatchSetReview`, `CombinedProposalReview` (neither overflowed even pre-fix at their current demo
   content length; unaffected either way), `PanelCreationModal`, `CreateMetricModal`,
   `RunHistoryModal`, `PipelinePreviewModal`, `PanelDetailModal` (view mode, `full` size) — all
   render correctly (bounded, header visible, no overflow) with the fix applied. `PanelDetailModal`
   is the one pre-existing consumer with its own explicit `height` override
   (`PanelDetailModal.css`), which the fix's reasoning (flex resolves the same box either way)
   predicted would be unaffected — confirmed live, screenshot shows a correctly-rendered full-screen
   panel view with no regression.

**Console:** no new console errors/warnings attributable to the fix in any captured state (pre-
existing `401` entries seen in a couple of captures are an unrelated dev-account auth probe on an
endpoint the account doesn't have access to, present before this change too).

**Finding A** is a plain missing-affordance gap (no bug to root-cause) — see `CommandBar.tsx`'s
change above. Live-verified separately at 390×844: the control appears only on `/chat` at phone
width (absent on `/` at phone width; present-but-`display:none` on `/chat` at desktop width — a
`git stash`-verified regression during this same session, see `App.css`'s entry above), does not
crowd the command bar, and clicking it correctly navigates to the "New conversation" empty state
(screenshot-confirmed) without opening any `Modal` — so it cannot itself trigger Finding B.
