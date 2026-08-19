## Context

`frontend/src/features/assistant/ui/ActiveConversationPanel.tsx` derives `effectiveId` from
`startingNewConversation ? null : (selectedConversationId ?? items[0]?.id ?? null)`. On desktop,
`SidebarBody.tsx`'s chat section renders `SidebarItemList` with `onAdd={() => dispatch
(startNewConversation())}` and `addLabel="New chat"` — this is the only reachable path to the
`effectiveId === null` "new conversation" content today, entirely inside `.app-sidebar`, which is
`display: none` below 768px (`App.css`). Phone chrome (`BottomNav`/`MobileNavSheet`) only ever
exposes existing conversations — no phone-reachable dispatch of `startNewConversation()` exists.
This is Finding A below — real, but **confirmed separate** from Finding B (see Correction, next).

**Correction, mid-planning, direct from the user:** the actual "chat is broken on mobile" report is
about tapping the "Open assistant" quick-launcher icon (`CommandBar.tsx`, `onOpenQuickLauncher`)
from the dashboard page, and identically about tapping "Review proposal"
(`ProposalHandoff.tsx`) — both showing a blank area with just a horizontal line. This redirected the
investigation; see Finding B and D4-D6 below, which supersede the original (narrower) D4.

## Goals / Non-Goals

**Goals:**
- **Finding A (affordance gap):** a phone-width, `/chat*`-scoped control that dispatches
  `startNewConversation()`, mirroring the desktop "+" trigger exactly.
- **Finding B (blank-screen regression, corrected focus):** confirm the shared root cause across
  both reported trigger flows via live 390×844 testing, fix it if in scope, and widen the check to
  every other `Modal` consumer that could share the same defect (see D6).

**Non-Goals:**
- No new CRUD affordance inside `MobileNavSheet` (Finding A stays CommandBar-only, per
  `mobile-dashboard-sheet`'s "no CRUD in the sheet" rule).
- No desktop behavior change for either finding.
- No exhaustive real-device matrix — bounded to what Playwright can exercise at 390×844.

## Decisions

**D1 — Finding A: Command bar placement, not BottomNav or MobileNavSheet.** `BottomNav` tabs are
plain `NavLink`s with no secondary-action slot. `MobileNavSheet` is explicitly picker-only
(`mobile-dashboard-sheet` spec's existing "no CRUD" rule). `CommandBar.tsx` already renders a
phone-only `.app-command-bar__mobile-title` control; a sibling "+" `IconButton`
(`variant="secondary"`, `size="xs"`) next to it, gated on `pickerId === "chat"`, reuses the exact
same breakpoint mechanism.

**D2 — Reuse `startNewConversation()` verbatim**, not a new action. No slice change needed.

**D3 — aria-label matches desktop's `addLabel="New chat"`** for cross-surface consistency.

**D4 — Finding B: static-analysis evidence for a shared root cause (grounded, not assumed).**
Traced both exact trigger paths in the actual source:
- "Open assistant" from the dashboard: `CommandBar.tsx`'s `IconButton
  (aria-label="Open assistant", onClick={onOpenQuickLauncher})` → `AppShell` sets
  `isQuickLauncherOpen=true` → `QuickLauncherOverlay.tsx` renders `<Modal open={open} size="lg">`
  (`shared/ui/Modal.tsx`, native `<dialog>` + `showModal()`). **Confirmed: an overlay presentation,
  not a route navigation.**
- "Review proposal" (`ProposalHandoff.tsx`): a plain `navigate(path, {state:{proposal}})` — no
  overlay in `ProposalHandoff` itself. But the **destination route's own page component** —
  `ProposalReviewPage`/`PipelineProposalReviewPage`/`CombinedProposalReviewPage` (and
  `PatchSetReviewPage`, same family) — each render their entire page content as
  `<Modal open size="lg" ...>` (confirmed by reading `ProposalReview.tsx`,
  `PipelineProposalReview.tsx`, `CombinedProposalReview.tsx` directly — all three import and render
  `Modal` from `shared/ui/Modal` as their root).

**Both reported trigger flows route through the same `shared/ui/Modal.tsx`/`Modal.css` primitive.**
That primitive was modified today by HEL-716 ("Extend Modal size scale and retire hand-rolled
dialog lifecycles") — the newest, most directly relevant same-day change touching exactly this
component. This is the single shared root cause the user's correction asked to find, evidenced by
static trace, not yet confirmed live.

**D5 — Two candidate failure mechanisms for the live-testing pass to disambiguate** (both localize
to `Modal.tsx`/`Modal.css`, not to either consumer):
1. **CSS percentage-height-through-auto-parent collapse.** `.ui-modal` sets only `max-height: 90vh`
   (no explicit `height`) — per CSS, a `height: 100%` child (`.ui-modal__inner`, added by HEL-716's
   own in-file comment: "this must fill whatever height the actual `<dialog>` box ends up with")
   resolves against an *auto*-height ancestor as `auto`, not a percentage of `max-height`. A prior
   HEL-716 skeptic round already patched one instance of this class of bug (`.ui-modal__inner`
   itself moving from an independent `max-height: 90vh` to `height: 100%`) for a *different*
   symptom (footer/content clipping past a narrower fixed-height override). This diagnosis was
   validated for the browser/viewport that prior round tested against — worth confirming it still
   holds at 390px width, where flex-basis/available-space resolution in an auto-sized column
   container can differ.
2. **Mobile `vh`/dialog-centering viewport quirk.** `max-height: 90vh` plus the browser's own
   `<dialog>` auto-centering can interact badly with mobile browsers' dynamic-toolbar viewport units
   — if the dialog centers against a "large" viewport value while the visible viewport is smaller,
   most of the dialog could render off-screen, leaving only its header/top edge (a plausible source
   of "blank area with a horizontal line" — the header's `border-bottom`, or the dialog's own top
   edge, with the body/footer pushed out of the visible viewport).

Neither is asserted as confirmed — D6 below is how the executor/evaluator/skeptic distinguish them
(or find a third mechanism) with real evidence (computed styles, bounding rects, screenshots), not
by picking one on inspection alone.

**D6 — Investigation + fix plan, live at 390×844:**
1. Reproduce "Open assistant" from `/` (dashboard) exactly: open the quick-launcher, screenshot,
   check console, and read `getComputedStyle`/`getBoundingClientRect` for the `<dialog class="ui-
   modal...">` element, `.ui-modal__inner`, and `.ui-modal__body`.
2. Reproduce "Review proposal" exactly: get a real `ProposalHandoff` card on screen (a completed
   `propose_*` tool call in a live conversation, or the `IS_DEV` demo-fixture fallback each review
   page already has for exactly this purpose — see `PipelineProposalReviewPage.tsx`'s
   `useDemoFixture`), tap "Review proposal", repeat the same screenshot/console/computed-style check
   against the resulting route's `Modal`.
3. Compare the two failure signatures. If both show the identical collapsed/mispositioned box
   geometry, that confirms D4's shared-root-cause hypothesis directly (not just by trace).
4. Identify which of D5's two mechanisms (or another) is actually occurring from the concrete
   numbers gathered, and fix it in `Modal.tsx`/`Modal.css` — a single shared fix, not two
   per-consumer patches (the whole point of finding the shared primitive).
5. **Widen the audit** (per the user's explicit ask): `Modal` has **16** consumers today (skeptic
   round 2 corrected an earlier miscount of 14, which also omitted `MfaEnrollModal`). Actual `size`
   prop per consumer, read directly from each call site (not grepped in isolation): `size="lg"` —
   `QuickLauncherOverlay`, `ProposalReview`, `PipelineProposalReview`, `CombinedProposalReview`,
   `PatchSetReview`, `PanelCreationModal`, `CreateMetricModal`, `PipelinePreviewModal`,
   `RunHistoryModal` (9 consumers); `PanelDetailModal` is conditional — `full` in view mode, `md`
   in edit mode; `size="sm"` — `CreatePipelineModal`, `ShapePickerModal`, `PipelineScheduleDialog`;
   `size="md"` — `PipelineShareDialog`, `MfaEnrollModal`, `AddSourceModal`. Spot-check at least the
   `size="lg"`/`"full"` ones (most likely to hit the same collapse) at 390×844 for the identical
   symptom, since a primitive-level regression is not necessarily confined to just the two reported
   flows — see tasks.md §1.6 for the concrete, accurate spot-check list.
6. If confirmed and fixed: re-verify all spot-checked consumers render correctly post-fix.
7. If the live evidence does NOT reproduce either flow's symptom (e.g., environment-specific),
   document exactly what was tried/observed and escalate for the actual device/recording, per the
   ticket's own fallback — never silently close on a static-analysis hypothesis alone.

## Risks / Trade-offs

- [Risk] A `Modal.tsx`/`Modal.css` fix is cross-cutting (16 consumers) — a fix for the mobile case
  could regress desktop or another consumer's already-correct sizing (including the specific
  narrower-fixed-height-override case HEL-716's own prior round already fixed).
  → Mitigation: D6 step 6's re-verification pass; keep the fix minimal and targeted at the
  confirmed mechanism rather than a broad rewrite.
- [Risk] The blank-screen report may depend on a device/OS/network condition unreproducible here.
  → Mitigation: document what was tried; escalate for the real device/recording rather than
  guessing further or closing without evidence.
- [Risk] Adding Finding A's second CommandBar control could crowd the phone command bar.
  → Mitigation: `xs` `IconButton`; the existing hidden-at-mobile triplet already clears the space.

## Planner Notes

- Self-approved D1 (CommandBar placement) — straightforward extension of an existing gated control.
- Self-approved bounding D6's audit to size="lg"/"full" consumers rather than all 16 exhaustively —
  proportionate for a hotfix; the fix itself (in the shared primitive) benefits every consumer
  regardless of which ones were spot-checked.
- Re-ran the design gate on this revision (superseding the first CONFIRM, which reviewed the
  pre-correction plan) rather than treating Finding A's earlier CONFIRM as covering Finding B.
- Round 2 of the design gate REFUTEd on two narrow points: tasks.md §1.6's spot-check list named
  two `size="sm"` consumers (`CreatePipelineModal`, `ShapePickerModal`) instead of the three real
  `size="lg"` ones it omitted (`CreateMetricModal`, `PipelinePreviewModal`, `RunHistoryModal`), and
  this D6 step 5's consumer count/list was off by one (14 vs the real 16, missing `MfaEnrollModal`).
  Both fixed here and in tasks.md §1.2/§1.6 — see tasks.md for the corrected, accurate lists.
