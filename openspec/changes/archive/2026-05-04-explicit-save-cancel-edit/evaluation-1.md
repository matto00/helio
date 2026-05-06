## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

Issues:
- **✕ (close) button behavior deviates from the spec.** `panel-detail-modal/spec.md` states: "The modal MUST close when … the user clicks the close (✕) button — with a discard warning if there are unsaved changes and the modal is in edit mode." The design non-goals reinforce this: "Changing behavior of close (✕) button — it retains current behavior (close with warning if dirty)." The design's Planner Notes even stated: "The `handleDiscard` function (closes modal) stays for the ✕ close button path." In the implementation, the ✕ button shares `handleCancel` with the Cancel footer button and — because `handleDiscard` was updated (per task 1.5) to always call `setModalMode("view")` — clicking ✕ from edit mode now returns to view mode instead of closing the modal. The spec makes an explicit distinction: Cancel/Escape → view mode; ✕ → close. That distinction is lost.

All other spec items verified:
- [x] No auto-save: `accumulatePanelUpdate` removed; field changes fire no API calls ✅
- [x] Save commits via API on all five tabs and transitions to view mode ✅
- [x] Cancel / Esc with discard confirmation returns to view mode ✅
- [x] Unsaved changes badge shown in header when dirty in edit mode ✅
- [x] All tasks.md items [x] and match the implementation ✅
- [x] No scope creep; no regressions to other features observed ✅
- [x] No backend/API contract changes (correct — existing PATCH /api/panels/:id reused) ✅
- [x] OpenSpec specs created for `panel-edit-mode-save-cancel`, updated `panel-detail-modal`, and `panel-view-mode` ✅

### Phase 2: Code Review — PASS

Issues: none

- **DRY**: `resetFormToPanel()` cleanly consolidates all form-state reset logic. `setupDialog()` eliminates repeated dialog mock setup in tests. `cancelEditModeRef` avoids re-registering the DOM listener on every render. ✅
- **Readable**: The `cancelEditModeRef` pattern is documented with a clear inline comment explaining the stale-closure rationale. `isAnyDirty` is extracted as a named boolean (replacing the previous inline expression in the ref assignment). ✅
- **Modular**: Save handlers are symmetric — each wraps the API dispatch in a try/catch/finally with consistent loading + error state. ✅
- **Type safety**: No `any` usage. `DividerOrientation` cast in `resetFormToPanel` is appropriate (enum narrowing from `string | null`). ✅
- **Security**: No new user-controlled inputs reach raw DOM or API without the existing validation layer. ✅
- **Error handling**: Appearance save now has `isAppearanceSaving` / `appearanceSaveError` states, a disabled-during-save button, and `<InlineError>` display — matching the patterns on the other tabs. ✅
- **Tests meaningful**: 53 tests passing. All 9 task items have corresponding tests (2.1–2.9). The `setupDialog()` DRY-up is a genuine improvement to the test suite. Tests would catch real regressions (e.g., a revert to `accumulatePanelUpdate` would fail 2.1, 2.9, and the App.test integration). ✅
- **No dead code**: `accumulatePanelUpdate` import removed; no leftover TODOs or unused variables. ✅
- **No over-engineering**: The `cancelEditModeRef` pattern is minimal — a single ref, no new abstractions. ✅

### Phase 3: UI Review — PASS

Checks verified via Playwright against `http://localhost:5350` (backend 8257, frontend 5350):

- **Happy path (Save)**: Entered edit mode → changed transparency → clicked Save → PATCH `/api/panels/:id` confirmed in network log → modal returned to view mode with Edit button visible and no footer. ✅
- **Dirty cancel**: Changed a field → clicked Cancel → discard warning appeared → clicked Discard → modal returned to view mode, badge gone, form reset, dialog still open. ✅
- **Escape (clean)**: Entered edit mode (no changes) → fired `cancel` DOM event on dialog → modal returned to view mode. ✅
- **Unsaved changes badge**: Appeared in header ("Unsaved changes") after transparency change; not present before change; gone after returning to view mode. Screenshot confirms muted badge inline with title, consistent with the app's design language. ✅
- **No console errors**: Zero errors/warnings during all tested flows. ✅
- **Visual consistency**: Badge styling (`0.72rem`, `var(--app-text-muted)`, `var(--app-border-subtle)`, `var(--app-radius-sm)`) uses design tokens throughout; visually consistent with the rest of the modal. ✅
- **ESLint**: `npm run lint` exits clean (zero warnings). ✅

Unhappy path gap noted (non-blocking): did not observe appearance save error UI in production because the API succeeded; the `<InlineError>` render path is covered by existing unit tests.

### Overall: FAIL

### Change Requests

1. **Restore the ✕ button's "close" behavior from edit mode.**

   Currently `PanelDetailModal.tsx:412` wires `onClick={handleCancel}` to the ✕ button. `handleCancel` now returns to view mode in edit mode (and `handleDiscard` also goes to view mode), so the ✕ button can no longer close the modal from edit mode — breaking the `panel-detail-modal` spec requirement.

   Suggested fix — introduce a `discardAndClose` flag so the discard confirmation can distinguish between the Cancel-button path (→ view mode) and the ✕-button path (→ close):

   ```tsx
   // Add state (alongside showDiscardWarning)
   const [discardClosesModal, setDiscardClosesModal] = useState(false);

   // Separate handler for the ✕ button
   function handleCloseButton() {
     if (modalMode === "view") {
       dialogRef.current?.close();
       onCloseRef.current();
       return;
     }
     // Edit mode
     if (isAnyDirty) {
       setDiscardClosesModal(true);   // discard should close, not go to view mode
       setShowDiscardWarning(true);
     } else {
       dialogRef.current?.close();
       onCloseRef.current();
     }
   }

   function handleDiscard() {
     resetFormToPanel();
     setShowDiscardWarning(false);
     if (discardClosesModal) {
       setDiscardClosesModal(false);
       dialogRef.current?.close();
       onCloseRef.current();
     } else {
       setModalMode("view");
     }
   }
   ```

   Then wire `onClick={handleCloseButton}` on the ✕ button (`PanelDetailModal.tsx:412`).

   Also update the `attemptClose` function inside the useEffect (backdrop click and `cancel` DOM event) to use the same close-from-edit-mode logic if the ✕ path is intended to be separate. Currently backdrop/Escape call `attemptClose` which goes to view mode — that aligns with the spec (Escape in edit mode → view mode; backdrop in edit mode is not specified). Only the ✕ button needs this fix.

   Add a test: "✕ button in edit mode with no changes closes the modal" and "✕ button in edit mode with unsaved changes shows discard warning; confirming closes the modal".

### Non-blocking Suggestions

- The `<span class="panel-detail-modal__unsaved-badge">` is rendered dynamically when dirty. Adding `aria-live="polite"` to its containing element (or the header) would allow screen readers to announce the change when it appears — a low-effort accessibility improvement.
- `handleCancel` (the React click handler for the Cancel button) and `attemptClose` (the DOM event handler inside useEffect for Esc/backdrop) share similar logic. Both could delegate to a shared function exposed via a ref; the current duplication is justified by the closure constraints but worth a comment acknowledging the intentional divergence.
- Tests cover the main scenarios but two spec scenarios (from `panel-edit-mode-save-cancel/spec.md`) lack explicit tests: "Save shows loading state during submission" and "Save error stays in edit mode" for the appearance tab. These paths are exercised indirectly but a direct test would harden the regression guarantee.
