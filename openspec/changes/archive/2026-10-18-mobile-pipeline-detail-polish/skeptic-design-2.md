## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 6477341111d4b4ec6d0368e5a1f46e473325f226. The planning artifacts are untracked under
openspec/changes/mobile-pipeline-detail-polish/. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio
branch=feature/mobile-pipeline-detail-polish/HEL-1668`.

### What I verified (with evidence)

**Round-1 change requests against the revised artifacts and the live code**

| R1 CR | Status | Ground truth |
|---|---|---|
| 1 D2 live regions | Partly resolved. The mechanism, a MODIFIED delta, topmost-by-open-order, the Tab trap, motion and the bottom offset are all now stated. The ordering mechanism and its proof are still unsound (CR1 below). The remount side effects are not stated (CR2). | `Toast.tsx:112-169` (a single `createPortal(..., document.body)`). `Modal.tsx:121-148` (`showModal` runs in a passive effect). |
| 2 D3 | Resolved. preventDefault only, an `overlay-management` delta, and an ActionsMenu-in-Modal test. | `usePortalPopover.ts:63-73` |
| 3 D4 API | Resolved. `place` is opt-in, and the `hasClampedRef` path (l.116-151, `right` only) is left alone. Width and cap come from custom properties, with no circular read. `scrollHeight` is a valid content height: the panel itself is the `overflow-y: auto` flex column (`OutputSchemaDisclosure.css:36-42`). | |
| 4 D4 fixture | Resolved. The fixture is pinned, the trigger `top` is recorded, and the complementary taller-than-room scenario is added. | |
| 5 D1 | Mostly resolved. The URL is derived from `open?.step.id`, and the consumed ref is owned by the page. Two ordering gaps remain (CR4). | `PipelineDetailPage.tsx:29-85`: `PipelineDetailPageContent` is keyed by route id and stays mounted across the `isPhoneShell` switch at l.82, so the page-owned ref is valid. `useStepSelection` is mounted only by `PipelineSpineLayout.tsx:52`, so it does not compete with the phone sync. |
| 6 HEL-1669 overlap | Resolved as a plan (task 5.2). "The driver was notified" is an assertion I cannot verify from ground truth. | |
| 7 D6(a) | Resolved. The condition "label text starts with `labelForKind(source.type)`" is correct. | `labelForKind("dataset")` is "Static" (`labelForKind.ts`). `describeSampleLabel` returns "Static · N rows" only for a non-live, non-truncated sample (l.37-41). A CSV card with a static sample keeps "CSV" plus "Static · N rows", which is correct. Truncated, loading, unavailable and viewer (`access === "no"`, null) states keep the meta. |
| 8 matrix | Resolved. The phone shell is `max-width: 768px` (`useIsPhoneShell.ts`), so 768 has the BottomNav. | |

**Measured: the failed-delete toast and the step restore land in one commit.**
- `usePipelineStepMutations.ts:91,100`: `setSteps` is a `useState` setter (`usePipelineEditorState.ts:14`) and `pushToast` is a Redux dispatch. They are called back to back in a promise `.catch`.
- Probe: `.concertino/scratch/HEL-1668/skeptic-design-2/lanes.cjs`, using the worktree's React 19.2.8, react-redux 9.3.0 and jsdom. The same shape gives one commit, `commit steps=2 toasts=1`, then `passive steps=2 toasts=1`. Reproduced 3/3 runs.
- So the D2 premise holds: the toast commits into the body regions in the same commit that reopens the sheet. The redux update is SyncLane, so the passive effects (and so `showModal`) also flush in that task.

**D5 inventory.**
- Pipeline-owned CSS with `:hover` rules: `PipelineMobile.css` 14, `PipelineSpine.css` 20, `PipelineSpineHeader.css` 8, `PipelineDetailPage.css` 8, `StepCardFocused.css` 3, `StepPreviewTable.css` 2, `PipelineSpineAccent.css` 2, `OutputSchemaDisclosure.css` 1.
- Some of these are mixed selector lists:
  - `PipelineSpine.css:326-330` and `:459-463`: `.spine-row:hover .spine-row__menu, .spine-row:focus-within .spine-row__menu`.
  - `OutputSchemaDisclosure.css:21-25`: `:hover, [aria-expanded="true"]`.
- `PipelineSpine.css:454-463` is the HEL-1608 compact-spine reveal. The row menu is `opacity: 0; pointer-events: none` and is shown only on `:hover` or `:focus-within`.

**D3 side effect checked.** `useLayoutEditEscape.ts:39` returns early on `event.defaultPrevented`. It already yields when a popover is open (`dismissibleSurfaceOpen()`), so the new preventDefault leaves its behaviour unchanged. This means the design's "outside dialogs the default action is a no-op" is slightly incomplete, but nothing changes.

**Containing block.** `BottomSheet.css` and `Modal.css` put no transform on the dialog at rest: the fills are backwards, and `expandFrom` uses `fill: "none"`. So a `position: fixed` toast stack portalled into the dialog positions against the viewport, except during the entrance, drag and exit, which the design accepts.

### Verdict: REFUTE

D3, D4, D6 and round-1 CRs 2, 3, 4, 7 and 8 are sound. Three problems remain:
- D2's announcement-ordering mechanism, as specified, does not produce the ordering its own MODIFIED requirement demands, and the planned e2e cannot detect that. This is exactly the green-but-unmet risk round 1 raised.
- D2's portal re-target has unstated remount side effects.
- D5's "wrap every `:hover` rule" breaks non-hover states that share those rules. It also makes the HEL-1608 compact row menu unreachable on touch tablets.

### Change Requests

1. **D2 / task 2.3 / task 7.5: "one animation frame later" is too short, and the planned check cannot prove ordering.**
   - *The mechanism.* The regions are committed in a task. A `requestAnimationFrame` callback runs at the start of the next rendering update, before that frame's style, layout and accessibility processing (HTML "update the rendering": rAF callbacks run first). So the empty region and the inserted message are first processed in the same rendering update. Chromium never has a lifecycle in which the region exists and is empty.
   - *The check.* A DOM MutationObserver plus a rAF counter would still record "message inserted one frame after the region" and pass. A `getFullAXTree` snapshot taken afterwards forces a fresh tree, so it only proves the region is exposed at snapshot time, not before the message.
   - Required:
     - (a) Define the boundary as at least one completed rendering update between connecting the regions and inserting the message. The minimum is a double rAF (a rAF inside a rAF), or rAF followed by a task. State the chosen primitive in design.md and task 2.3.
     - (b) Make the e2e's observable concrete. A page-side MutationObserver records the region-insert and message-insert records. A frame counter shows that a full rendering update completed between them: a rAF scheduled at region insertion has run, and a second rAF has started before the message mutation.
     - (c) For the "exposed to assistive technology" half, hold the insertion: for example, install Playwright's `page.clock` so rAF is frozen after the re-target. Take the AX snapshot while the region is in the dialog and empty, then release the clock and assert the message lands exactly once. Alternatively, restate the spec scenario as a DOM-plus-frame property and drop the AX-before claim. Either is acceptable. An AX snapshot taken after the fact is not.
     - (d) Keep the "escalate rather than weaken" risk line, but this should not be discovered mid-execution.

2. **D2: changing the portal container remounts every visible toast. State the consequences and decide them.**
   - `createPortal` with a new container unmounts and remounts the `ToastItem`s (`Toast.tsx:129-131`). So on every modal open and close:
     - (a) Each toast's auto-dismiss `setTimeout` restarts (`Toast.tsx:49-55`), so opening and closing the sheet extends a toast's life.
     - (b) `toast-slide-in` (`toast.css:53`) replays on every visible toast.
     - (c) A toast that is mid-exit (`exiting` state, l.32/43) snaps back to fully opaque until its pending removal fires.
   - Decide for each one: accept it and say so, or avoid it. For example, keep the timer and the exit state keyed by toast id outside the item, and suppress the entrance animation on a re-target-only mount.
   - Add the decision to the PR's "UI decisions taken overnight".

3. **D5 / task 5.1: "wrap every `:hover` rule" would break the non-hover states in the same rule, and gating the hover reveal makes the compact row menu unreachable on touch tablets.**
   - (a) Mixed selector lists: `PipelineSpine.css:326-330` (`:hover` + `:focus-within` + `--selected`), `:459-463` (`:hover` + `:focus-within`) and `OutputSchemaDisclosure.css:21-25` (`:hover` + `[aria-expanded="true"]`).
     - Wrapping these whole rules drops the focus-within reveal and the expanded-trigger style on every `hover: none` device. That contradicts the delta's own "Focus-visible and pressed states SHALL be unaffected".
     - Require that only the `:hover` selectors move into the `@media (hover: hover)` block. The other selectors stay where they are.
     - Extend the jest guard: no non-hover selector may sit inside a `(hover: hover)` block.
   - (b) Hover as reveal, not fill: `.spine-row:hover .spine-row__menu` (`PipelineSpine.css:459-463`, HEL-1608's 769-1100px compact spine).
     - At rest the menu is `opacity: 0; pointer-events: none`.
     - On a touch tablet in that range (iPad 820/834/1024/1180, `hover: none`), the sticky tap-hover is today the only reliable way the row menu appears. iOS does not focus a tapped button, so `:focus-within` does not help there.
     - Gating it leaves the step's actions menu invisible and untappable there. That breaks the run rule "keep HEL-1608's desktop compact-spine behaviour".
     - Decide how reveals behave under `hover: none`. For example, show the menu at rest under `(hover: none)`, or keep reveals ungated and exempt them from the guard by an explicit list.
     - Add an e2e at 1024×768 with `hasTouch` + `isMobile` that taps a compact row and opens its actions menu.
   - (c) Scope the requirement text. The pipeline-detail-mobile-layout delta says hover fills "on the pipeline detail page (… step sheet, preview table …)" SHALL be gated. The plan only touches pipeline-owned stylesheets. Shared controls inside the sheet keep ungated hovers: `IconButton`, `ActionsMenu` items, `.ui-modal-btn:hover` (`Modal.css:230,242`) and `Select`. Either narrow the SHALL to the pipeline page's own stylesheets, or include those shared controls. Otherwise the final gate will measure a sticky fill the spec forbids.

4. **D1 / tasks 1.2-1.3: two ordering gaps in the one-shot and the sync.**
   - (a) The phone layout mounts as soon as `currentPipeline` loads (`PipelineDetailPage.tsx:68-82`), which can be while steps are still loading. At that point `open` is `undefined`, so an ungated "sync `?step=` to `open?.step.id ?? null`" effect deletes the deep link before it is consumed. State that the sync writes nothing until the deep link has been consumed. Alternatively, have the page capture the initial `?step=` value into its ref at mount.
   - (b) State who marks the deep link consumed when the page first loads on desktop. It has to be the page, at its first steps load, whatever the layout. If only the phone layout consumes it, a desktop load followed by a narrow to 375 opens a sheet. The spec scenario forbids that.
   - Both are cheap to state now. The planned e2e would catch them, but only as an unexplained red mid-execution.

### Non-blocking notes
- D4: say whether `handleOpen` still takes a `computePos` when `place` is given, and what the interim position is before the first `place` call. "Hidden until placed" needs a flag the hook returns to the consumer.
- D2: the bottom offset of the toast inside the sheet comes with a check ("does not cover the sheet's bottom controls") but no decision about what happens if it does. Pre-decide one, for example the sheet-local offset `bottom: var(--space-4)` when inside `.bottom-sheet`.
- D3: also mention `useLayoutEditEscape.ts:39` (it reads `defaultPrevented`) in the scope list. Its behaviour is unchanged because it already yields to open popovers.
- D2's 100 ms window is justified for the failed-delete flow by the one-commit measurement above. Record that measurement (or rerun it) in the executor's red evidence, rather than relying on this report.
