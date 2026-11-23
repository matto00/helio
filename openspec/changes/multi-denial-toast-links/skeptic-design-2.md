## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 1b3c309e01080bbca65e246036694dc24b19328d. The planning artifacts are uncommitted in the change dir.
Owner rulings Q1 (each row gets a link, plus an inline run where canRun; the toast closes once no run action remains) and Q2 (list every pipeline, scroll, no truncation) are taken as given and not reopened.

### What I verified (with evidence)
- **Round-1 CR1 (focus lost on consume) is addressed.**
  - D8 defines both landing targets:
    - When rows remain: focus goes to the activated row's link.
    - When the toast is removed: focus goes to the element focused before the user entered the viewport, then another toast's control, then `main#app-main-content`.
  - spec.md adds two scenarios ("Keyboard focus stays in the toast…", "Focus is not dropped when the last row action removes the toast"), and the requirement text says "never … the document body".
  - Tasks 1.3a (jsdom `document.activeElement`), 3.2 (e2e activeElement) and the 3.1(e) mutation give this a failable check.
- **D8 premises checked against the live tree:**
  - `Toast.tsx:106-115`: the unmount layout-effect cleanup returns early when `!dialog`. Confirmed. Extending it to the non-modal case is a contained change to an existing hook.
  - `app/App.tsx:270`: `<main className="app-content" id="app-main-content">` exists with no `tabIndex`. That matches D8's "set tabIndex=-1 if absent".
  - `FOCUSABLE_SELECTORS` is already imported in `Toast.tsx`, so it can be reused for fallback (2).
- **Round-1 non-blocking notes were folded in:**
  - Store serializability: Risks names the `ignoredActionPaths` gap (`store.ts:125` holds only `"payload.action.onClick"`, confirmed), and task 1.3b plus mutation 3.1(f) give it a failable check.
  - Task 1.3c is a `FormPanelView` wiring test that catches a wrong toastId or key.
  - Focus ring: D6 now relies on the global `:focus-visible` rule (`theme/theme.css:659`, confirmed) with no bare `:focus` rule.
- **Remaining premises re-checked:**
  - `ToastViewport` is rendered only at `App.tsx:433`, under `BrowserRouter` (`main.tsx:114`), so a router `Link` inside a toast is valid.
  - `/pipelines/:id` is a real route (`AppRoutes.tsx:126`).
  - The only builder caller is `FormPanelView.tsx:86-92`. It is also reached through `useCompactCounterSubmit.ts:145`.
  - `pushToast` returns its id synchronously via `prepare` (`toastsSlice.ts:58-63`), so D4's `toastId` closure works.
  - `useRunToUpdate(pipelineId, dismissToastId?)` (`useRunToUpdate.ts:21`) matches D4's call without a dismiss id.
  - The coalesce in `toastsSlice.ts:73-75` is variant+message. D7's "repeat write replaces with a fresh toast that has all actions again" is what the reducer does.
  - `--space-1` exists (`theme.css:127`).
- **Consistency across ticket, proposal, design, tasks and spec:**
  - AC1 (link, per-row run, no storm) is covered by D1/D3/D4/D7 and tasks 1.1, 1.2, 1.3c and 3.2.
  - AC2 (persistent, keyboard, computed ARIA) is covered by D3 (`duration: 0`), D5 (`aria-label` "Run to update: <name>", `aria-describedby` on the row text), D8, and tasks 1.3, 1.3a and 3.2.
  - No pipeline-page component is in the Impact list (C3 holds).
  - No TODO/TBD placeholders. Frontend only, so no schema delta is needed.

### Verdict: CONFIRM

### Non-blocking notes
1. **D5/D6 padding wording conflicts.** D6 says `.toast__list` has "zero padding", but D5's last bullet requires a small `--space-*` inline/block padding so the focus ring isn't clipped. Read D6's "zero padding" as resetting the `<ul>` default only; the D5 token padding wins. Task 3.3's "ring not clipped" screenshot check is the acceptance signal.
2. **The e2e last-action assertion (3.2) should match D8's rule, not a fixed element.** D8 records the `focusin` `relatedTarget`. That is the Submit button only if the test moves focus straight from Submit into the toast (e.g. `locator.focus()`). A real Tab traversal enters from the last focusable element before the portalled viewport. Assert "the recorded pre-entry element, or `#app-main-content`, and never `body`", or drive focus so the expected element is known. Do not loosen the assertion to "anything but body" without saying so.
3. **The non-modal hand-off cannot tell "removed" from "remounted".** The cleanup also runs when the viewport moves into or out of a modal, which remounts every `ToastItem` (HEL-1668). Focus inside a remounting toast is lost to `body` today anyway, so this is no regression. Still, prefer gating the hand-off on the toast actually leaving the store (for example, it is absent from `items`, or its `toastLife` entry was marked exiting), so a viewport move does not pull focus out of a newly opened modal.
4. **Fallback (3) can draw a large ring.** Programmatic focus on `main` with `tabIndex=-1` after a keyboard activation can paint the global `:focus-visible` ring around the whole content area. Check this in the 3.3 screenshots. `main#app-main-content` exists only inside the authenticated shell, so on any shell-less route fallback (3) is absent. Form submits happen only in the shell, so this is acceptable, but say so in a code comment.
5. **D8 also changes every other toast's dismiss and auto-dismiss outside a modal** (their focus no longer drops to `body`). The design calls this a strict improvement, and I agree. Call it out in the PR so a reviewer doesn't read it as scope drift.
6. **Row layout.** The link is followed directly by the reason `<span>` with no ": " separator. Make sure the visual layout (block or flex gap) separates them, so neither the rendered text nor the copy-paste text runs together. Check this in 3.3.
7. **Stacking past the toast cap (carried from round 1).** Persistent all-viewer N>=2 toasts are eviction-exempt and can stack past `MAX_VISIBLE_TOASTS`. This is accepted under Q1; note it in the PR.
