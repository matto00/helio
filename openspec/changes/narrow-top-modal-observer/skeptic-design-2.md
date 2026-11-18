## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 361c22f223ee27409b045860aab6ab889bbbb687 on branch task/narrow-top-modal-observer/HEL-1736. The planning artifacts are uncommitted files in the change dir. The cwd guard returned READY.

### What I verified (with evidence)

**Prior CR1 (native `close` event versus StrictMode reopen): addressed.**
- design.md Decision 2 now unregisters on `close` only when `!dialog.open`, and it gives the reason: the event is queued, and the app runs StrictMode, so the sequence is showModal → close → showModal.
- The unmount cleanup now unregisters unconditionally.
- R3 covers both directions:
  - `close` dispatched while `open` is true must keep the toast in the dialog. Its recorded mutation is "drop the `!dialog.open` check".
  - `close` after `open` is removed must return the toast to the body.
- Tasks 3.2 and 3.2a carry this through. I checked the live tree: `Modal.tsx:122-170` has the `[open]` effect, the sole `showModal()` at :134 with `close()` at :144, and the unmount cleanup's early return at :166. That matches the design's description of each insertion point.

**Prior CR2 (enumeration): addressed.**
- MobileNavSheet has been removed from the Modal composers in both proposal.md and design.md.
- MobileNavSheet and RefinementChatDrawer are now listed as non-native `role="dialog"` divs that are out of scope.
- Task 1.1 now records the `role="dialog"` and `aria-modal` sites.

**Native enumeration re-derived against the tree.**
- I ran `grep -rn "showModal\|<dialog"` over production `.ts`/`.tsx` files, excluding tests, `src/test` and comment lines.
- The only real sites are `Modal.tsx:134` (`showModal()`) and `Modal.tsx:240` (`<dialog`).
- The remaining hits are comments in App and PanelFullscreenOverlay, plus jest stubs in `pipelineMobileTestKit.tsx` and `conditionalFormatsEditorHarness.tsx`. The design's "Modal is the sole writer" claim holds.

**Hook and consumer.**
- `useTopModalDialog.ts:46` has the `document.body` subtree observer, so R1 will be red on main.
- `grep useTopModalDialog` finds only `Toast.tsx` as a consumer, and the `isConnected` guard is at `Toast.tsx:193`.
- `useSyncExternalStore(subscribe, getTopOpenModal, () => null)` returns a stable element snapshot, which is sound.

**Fixture move.**
- `Toast.modal.test.tsx:15-37` drives raw `<dialog>`s by setting the `open` attribute. That is the signal being removed.
- No other test depends on it. I grepped the other ToastViewport tests (`Toast.test.tsx`, `deniedPipelineToastA11y.test.tsx`) for dialog use: no hits.
- Re-pointing the harness to the registry with `act()`, keeping every assertion, and adding a real-Modal test is a forced change, not a weakening.

**Guard test (Decision 5).**
- It scans for `showModal(` or a JSX `<dialog` and compares the results against an allow-list, with a recorded mutation. That is sufficient.
- The import-check weakness is now disclosed under Risks (my round-1 note).

**ACs and scope.**
- AC1 is covered by R1 and the hook rewrite. AC2 is covered by R2, R3 and the full `hel1668-phone-sheet.spec.ts` run.
- `usePortalPopover` is untouched; only the Non-Goals mention it.
- `.openspec.yaml` has `skip_specs: true`.
- There are no placeholders or TBDs, and I found no contradictions between proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes
- The out-of-scope list is incomplete. The `role="dialog"` grep also finds `features/panels/provenance/ProvenancePopover.tsx:146` and `features/pipelines/ui/OutputSchemaDisclosure.tsx:73`. Both are non-modal portalled popovers, not in the top layer. design.md mentions them only under Non-Goals and in the comment-only file list, not in the "Not native dialogs" bullet. Task 1.1's enumeration should list them there, so the "none missed" claim is complete.
- Decision 2 says to register "immediately after showModal()". Registration is idempotent, so the more robust choice is to register whenever the `open` branch ends with `dialog.open` true, outside the inner `if (!dialog.open)` block. That way an already-open dialog reached by any path is still registered.
- Two Modals that open in the same commit register in effect order (children first, then siblings in order). Today's hook used document order. The e2e and R2 stacking test open sequentially, so this is not observable there. Keep R2's stacking test sequential.
