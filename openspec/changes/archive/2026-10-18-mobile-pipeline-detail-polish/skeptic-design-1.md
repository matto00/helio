## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226 (planning artifacts untracked under
openspec/changes/mobile-pipeline-detail-polish/). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=feature/mobile-pipeline-detail-polish/HEL-1668`.

### What I verified (with evidence)

**D3 mechanism: measured in real Chromium (HeadlessChrome/151) on a bare `<dialog>` page.**
- With a document-level bubbling `keydown` listener that calls `preventDefault()` on Escape, focus inside a
  `showModal()` dialog: `{open:true, cancels:0, closes:0}`.
- Control, same page, no preventDefault: `{open:false, cancels:1, closes:1}`.
- `preventDefault()` alone, no `stopPropagation()`: `{open:true, cancels:0, closes:0, winSeen:1}`. The cancel is
  suppressed, and the event still reaches `window` listeners.
- Result: D3's preventDefault is correct and sufficient. Its `stopPropagation()` is unnecessary, and it has side
  effects (CR2).

**D2 rationale: measured.** I called `showPopover()` on a `popover=manual` element after the `showModal()` dialog
opened, so the popover sits higher in the top layer. `elementFromPoint` at the popover button returned the dialog's
`#inner`. Playwright's click on the popover button timed out with "<button id=inner> from <dialog> subtree
intercepts pointer events". So a top-layer popover outside the modal is inert for hit-testing. Rejecting the Popover
API is correct.

**D5 test premise: measured** (script `.concertino/scratch/HEL-1668/skeptic-design/hoverprobe.cjs`, Playwright
chromium).
- `hasTouch+isMobile` gives `hover:hover=false, hover:none=true, pointer:coarse=true`.
- After `tap()` the element's background is `rgb(255, 0, 0)` (the `:hover` colour, not the rest blue). Sticky hover
  reproduces in emulation, so the planned red-first e2e is viable.
- Desktop context gives `hover:hover=true`.

**Ground-truth reads.**
- `shared/ui/Toast.tsx`: the live regions sit in a body portal.
- `shared/ui/Modal.tsx`: the focus trap uses `dialog.querySelectorAll(FOCUSABLE_SELECTORS)`. A backdrop click closes
  only when `target === dialog`.
- `shared/motion/BottomSheet.{tsx,css}`: the exit and drag leave transform/opacity on the dialog until `open` turns
  false. The entrance uses translateY with a backwards fill.
- `hooks/usePortalPopover.ts`: its re-measure is horizontal only, and it returns early when `panelPos.right ===
  undefined` (l.129).
- `OutputSchemaDisclosure.tsx` (placement l.83-93, constants l.45-49) and its CSS (l.39-40).
- `PipelineMobileLayout.tsx`: the render-adjusted close is at l.72.
- `usePipelineStepMutations.ts`: the failed-delete path is at l.91 and l.100.
- `useStepSelection.ts`, `PipelineSpineLayout.tsx:109`, `SpineSourceCard.tsx:77`, `describeSampleLabel.ts`,
  `SourceSampleLabel.tsx`, `SpineRunStatus.tsx` (`SpineLastRunMeta`, shared with the desktop header).
- The `toast-surface-behavior` and `overlay-management` specs, and DESIGN.md §4.

**Sibling lane check.** The HEL-1669 worktree (`.claude/worktrees/bug/accent-hover-contrast-light/hel-1669`) has
uncommitted edits to `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css`,
`e2e/hel1582-mobile-pipeline.spec.ts` and DESIGN.md (`git status`/`git diff` read).

**Desktop "opens below when tall" claim.** It is real by code: `OutputSchemaDisclosure.tsx:87` opens above only if
`roomAbove >= min(384, innerHeight-80) || roomAbove >= roomBelow`. So a trigger with less than 384px above it and more
room below opens below, whatever the panel's real height. At or above the 12-field threshold the real height is often
well under 384. I did not reproduce it live: this is a design gate and seeding data is out of scope. CR4 asks the
implementation to pin it.

### Verdict: REFUTE

D3 and the D2 rationale are sound (measured above). D2, D4 and D1 have concrete gaps against the live code, and so do
the D5 overlap and D6(a), each of which would let the implementation pass its planned checks while missing the
requirement.

### Change Requests

1. **D2 re-creates the live regions in exactly the ticket's flow. That contradicts the existing
   `toast-surface-behavior` requirement, and the planned check cannot detect it.**
   - The existing spec (l.66-68) says live regions are "mounted before any toast exists, so that announcement never
     depends on a live region being created together with its content".
   - The failed-delete flow runs like this:
     - `usePipelineStepMutations.ts:91` `setSteps(previousSteps)` and l.100 `pushToast` run in one batched commit.
       The restored step reads as "added", so the sheet reopens.
     - The toast text therefore commits into the body regions first.
     - `Modal`'s passive effect then calls `showModal()`, which makes the body regions inert.
     - The MutationObserver re-targets after that, so the dialog-side regions are created already containing the
       message.
   - The planned e2e ("text is in the assertive region in Chromium's AX tree") passes in that case, so it proves
     presence, not announcement.
   - Required:
     - (a) Design the regions so that, whatever the target, they are connected and exposed before the message node is
       inserted. For example, re-insert any already-present messages a frame after a re-target, or keep the regions
       mounted per target before content arrives. State the mechanism.
     - (b) Change the verification to prove that ordering in Chromium. Record, via a MutationObserver/AX snapshot,
       that the assertive region node holding the message existed, empty and in the AX tree, at least one frame
       before the message text was added, in the failed-delete flow.
     - (c) Add a MODIFIED delta for the "Live-region politeness follows toast intent" requirement so the re-targeting
       case is in the contract.
   - Also decide and state each of these:
     - (d) "Topmost" must mean most recently shown, not "last `dialog[open]` in DOM order". Top-layer order is open
       order, so DOM order is wrong for any stacked modal that sits earlier in the DOM.
     - (e) Toast buttons portalled into the dialog join `Modal`'s Tab-trap list (`Modal.tsx` focus trap queries the
       whole dialog). Say this is intended, and say where focus goes when a focused toast auto-dismisses inside a
       modal.
     - (f) During BottomSheet entrance, drag and exit the dialog carries a transform/opacity (`BottomSheet.css`,
       `sheetMotion`). The toasts then slide or fade with the sheet and snap back to body afterwards. Accept it
       explicitly or avoid it.

2. **D3: drop `stopPropagation()` and scope the behaviour change honestly.**
   - preventDefault alone suppresses the dialog cancel (measured above).
   - `stopPropagation()` on a document listener only blocks `window` listeners. That includes `OverlayProvider`'s
     Escape (`shared/chrome/OverlayProvider.tsx:24`, which closes CommandPalette, QuickLauncher and
     RefinementChatDrawer) and `useShortcut`'s window listener. That is an unplanned behaviour change.
   - preventDefault in the shared hook also changes Escape for every `usePortalPopover` consumer inside any dialog,
     not just the schema panel. Affected: ActionsMenu (e.g. BottomSheet `headerActions`), UserMenu,
     DashboardAppearanceEditor, IconButton, Provenance. `Select` already preventDefaults in its own handler
     (`Select.tsx:120-122`).
   - Put the requirement in an `overlay-management` delta: Escape on an overlay inside a modal closes only the
     overlay. Add a test for one more consumer, such as an ActionsMenu inside a Modal.

3. **D4 names a mechanism that does not exist as described, and reads values that are not where it says.**
   - (a) `usePortalPopover`'s re-measure path (`hasClampedRef`) is horizontal only and returns early when
     `panelPos.right === undefined` (`usePortalPopover.ts:129`). This panel is `left`-anchored. "Reuse" therefore
     means changing the shared hook. Specify the API (e.g. an opt-in `place(panelEl, triggerRect)` callback) and
     state that the other consumers are unaffected.
   - (b) The panel has no CSS `max-width`; it uses `width: min(28rem, …)` (`OutputSchemaDisclosure.css:39`).
   - (c) Once the first placement sets inline `maxHeight` (`OutputSchemaDisclosure.tsx` style prop),
     `getComputedStyle(panel).maxHeight` returns that inline value, not the CSS cap. Reading it back is circular.
   - (d) The horizontal clamp currently runs in `computePos`, before the panel exists (l.73-79), so a computed width
     cannot be read there.
   - Specify where width, cap and margin come from (e.g. CSS custom properties on the panel class, read before any
     inline override) and that the horizontal clamp moves into the post-mount measure.

4. **D4 desktop scenario vs D4's own rule.**
   - The spec says a "many fields" panel opens entirely above at 1280×800 and 1000×800. D4's rule opens a panel whose
     content does not fit above on the side with more room.
   - Pin the fixture: a field count whose content height is below the trigger's room above, but whose 384px cap is
     not. That is exactly the case `OutputSchemaDisclosure.tsx:87` gets wrong today. Record the trigger's measured
     `top` in the test so its red on origin/main is shown, not assumed.
   - Add the complementary scenario: content taller than the room above opens on the roomier side, capped. Otherwise
     a 200-field fixture makes the spec unsatisfiable.

5. **D1: event-based URL writes miss the close paths and an unstated direction.**
   - (a) The sheet also closes without `onClosed`: the render-adjusted removal close at
     `PipelineMobileLayout.tsx:72`, i.e. delete, including the optimistic delete before a failed-delete reopen. The
     planned writes then leave `?step=<removed id>`, breaking the spec's "while open names the open step; closing
     removes it".
   - (b) An AI-draft temp→server id swap keeps the sheet open but leaves the old id in the URL.
   - Specify the URL as derived from `open?.step.id`: one replace-write sync covering every open and close path,
     with the "once" deep-link guard. Add a jest case for removal-close.
   - (c) Desktop writes `?step=` on every step click (`useStepSelection.selectStep`, `PipelineSpineLayout.tsx:109`).
     Under D1, crossing desktop→phone (window resize, iPad rotation to 768) remounts the phone layout and pops a
     sheet open. Decide this direction explicitly (the design only covers phone→desktop) and test it.

6. **D5 overlap with HEL-1669 is concrete, not "subject only".**
   - HEL-1669's worktree adds an ungated `:root[data-theme="light"] .mobile-pill:not(.mobile-pill--primary):hover:not(:disabled)`
     rule to `ui/mobile/PipelineMobile.css`, around this file's l.413-424 `.mobile-pill` hover block.
   - It also edits `e2e/hel1582-mobile-pipeline.spec.ts`, which task 7.8 re-runs.
   - Whichever lane merges second breaks: HEL-1668's "no ungated :hover" source test fails on HEL-1669's new rule, or
     the two hunks conflict.
   - Correct the Risks entry and state the plan: report to the driver before writing D5, and gate that rule too (or
     sequence after HEL-1669) so the guard is green after both merge.

7. **D6(a) condition is wrong for some static sources.**
   - `describeSampleLabel` leads with "Static" only for a static, non-truncated, loaded sample. A truncated static
     sample reads "first 1,000 of N rows", and loading or unavailable states read "Loading sample…" or "Sample
     unavailable".
   - "Omit the kind meta when the sample label renders and the source is static" would remove "Static" entirely in
     those states.
   - Specify the exact condition (the label text actually leads with the kind) and where the card learns it (the
     sample-entry selector, or move the dedupe into `SourceSampleLabel`/`describeSampleLabel`).
   - Add the truncated-static and loading cases to 7.4.

8. **Tasks 7.6 omit the AC's matrix for item 4's phone half.** The AC requires 375 and 768, light and dark. Task 7.6
   names no widths or themes for "phone below-placement clears the bottom nav". State them, and say whether 768 has a
   `.bottom-nav` to measure.

### Non-blocking notes
- D5 cites DESIGN.md §4 "gate on the input device", but that rule is written for tap targets. There is no
  `@media (hover: hover)` anywhere in `frontend/src` today (0 files). Consider a DESIGN.md line, coordinated with
  HEL-1669, which is also editing DESIGN.md, or a follow-up so the pattern is not pipeline-only.
- `SpineLastRunMeta` is shared with the desktop header (`PipelineSpineHeader.tsx`). D6(c) changes desktop too. Fine,
  but check it at 1000 and 1280.
- Inside the sheet the toast keeps its phone offset `bottom: calc(var(--bottom-nav-height) + var(--space-4))`
  (`toast.css`) although the nav is covered. Check that it does not sit over the sheet's bottom actions.
