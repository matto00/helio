## Standing Constraints

- [C1] Owner ruling Q1 (HEL-1172 Planning escalation): in a 2+ denial toast each row's pipeline name links to /pipelines/<id>; only where canRun, the row also has its own inline "Run to update"; a viewer row gets the link only.
- [C2] Owner ruling Q2: list every denied pipeline, no truncation; rows scroll inside the toast past a max height.
- [C3] Do not touch pipeline page components (HEL-1794 in flight); frontend only, no migration.
- [C4] No live model call: any backend is started with ANTHROPIC_API_KEY exported empty; e2e uses non-AI denial reasons.

## 1. Red first (commit before implementation)

- [x] 1.1 Extend `deniedPipelinesToast.test.ts`: N>=2 returns `duration: 0` and `items` in id order with `linkTo` `/pipelines/<id>`, row `text` equal to the reason copy, `action` only for `canRun` rows whose onClick calls `onRunToUpdate(<that id>)`; N=1 output unchanged (callback receives the id); message unchanged and deterministic.
- [x] 1.2 Extend `toastsSlice.test.ts`: `consumeToastItemAction` removes only that row's action; dismisses the toast when the last row action is consumed; leaves a never-actioned (link-only) toast alone; unknown id/key no-op; a toast with non-empty `items` is eviction-exempt; identical N>=2 pushes coalesce to one.
- [x] 1.3 Extend `Toast.test.tsx` (inside a MemoryRouter): rows render links with name = pipeline name and correct href; run buttons have accessible name "Run to update: <name>" and description = row reason; viewer row has no button; Tab order link -> button -> next row -> dismiss; clicking a row button calls its onClick; no `items` renders exactly as before.
- [x] 1.3a `Toast.test.tsx` focus (D8): after a keyboard-style activation of a row button (focus on it, click), `document.activeElement` is that row's link while rows remain; when the last action is consumed and the toast unmounts outside a modal, `document.activeElement` is the pre-viewport element (a button rendered outside the viewport and focused before tabbing in), falls back to another toast's control, then to `#app-main-content`; never `document.body`.
- [x] 1.3b `store.test.ts`: a `pushToast` with `items[].action.onClick` produces no serializability warning (mirrors the existing case; red before `ignoredActionPaths` is extended).
- [x] 1.3c `FormPanelView` test: a 2-pipeline denial response pushes one toast; clicking row 2's button calls the run for pipeline 2 only and removes only row 2's action from THAT toast (catches a wrong toastId/key).
- [x] 1.4 Run the full spec files, save the red output as `.txt` under the change dir (or evidence), mutation notes included, and commit it before implementation (C12).

## 2. Implementation

- [x] 2.1 `toastsSlice.ts`: `ToastListItem`, `Toast.items?`, `consumeToastItemAction`, eviction exemption for non-empty `items` (design D1/D2).
- [x] 2.2 `deniedPipelinesToast.ts`: new callback signature and N>=2 rows (D3); update doc comment.
- [x] 2.3 `FormPanelView.tsx`: wire N>=2 callback to run + consume (D4), minimal change.
- [x] 2.4 `Toast.tsx` + `toast.css`: list rendering, hidden message, link + action, scroll region, focus-visible ring, tokens only (D5/D6).
- [x] 2.5 Extend `store.ts` `ignoredActionPaths` to cover `payload.items` (risk R1).
- [x] 2.6 Focus hand-off (D8): `ToastViewport` records the pre-entry element via `focusin` `relatedTarget`; `ToastItem` focuses the row link after a consume and, on unmount outside a modal, hands focus off per D8.

## 3. Verification

- [x] 3.1 Mutation checks: (a) drop the `canRun` guard -> viewer-row test fails; (b) drop `duration: 0` for N>=2 -> persistence test fails; (c) dismiss-on-last-consume removed -> reducer test fails; (d) aria-label removed -> ARIA test fails; (e) the D8 focus move removed -> focus tests fail; (f) `payload.items` removed from ignoredActionPaths -> store test fails. Record each red.
- [x] 3.2 New e2e `e2e/hel1172-multi-denial-toast.spec.ts` (lane DB, Playwright 2 workers): a form submit denying two pipelines (`steps-above-bound`, no AI step) shows one toast; it persists past 5 s; computed ARIA (accessibility snapshot / `getByRole`) shows two pipeline links and two "Run to update: <name>" buttons; keyboard Tab reaches each; Enter on one row's button submits that pipeline's run (assert the run POST for that id only) and removes that row's button, with `document.activeElement` asserted to be that row's link (and, after the last row action, the Submit button or main, never body); the link navigates to `/pipelines/<id>`; rapid identical submits leave one toast.
- [x] 3.3 Screenshots (check the focus ring is not clipped at the list edge) of the multi-denial toast in light and dark themes, desktop and 390 px, compared against the running app's existing toasts.
- [x] 3.4 Full frontend gates: lint, typecheck, format:check, full jest (3 workers).
- [x] 3.5 Update `frontend/src/features/toasts/README.md` if it documents the Toast shape.

## 4. Evaluation cycle 1 change requests

- [x] 4.1 CR1: 44px touch floor for `.toast__link` and `.toast__action` (multi-row and single-pipeline), tiling gap, `expectTapExpander` unit guard, 390px `bisectHitExtent` e2e; mutations g/h recorded.
- [x] 4.2 CR2: split `Toast.tsx` into `ToastRowList.tsx` + `toastFocusHandOff.ts`, existing tests unchanged and green.
- [x] 4.3 Re-record mutation e2 against the shipped code.
