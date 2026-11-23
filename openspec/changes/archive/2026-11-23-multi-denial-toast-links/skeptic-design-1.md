## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 1b3c309e01080bbca65e246036694dc24b19328d (planning artifacts uncommitted in the change dir).
Owner rulings Q1 (per-row link + inline run where canRun) and Q2 (list all, scroll, no truncation) taken as given.

### What I verified (with evidence)
- design.md "Context" claims checked against the live tree:
  - `deniedPipelinesToast.ts:24-43`: N>=2 returns `{variant, message}` only (default 4 s). Confirmed.
  - `toastsSlice.ts`: one optional `action`, variant+message coalescing in `pushToast`, `isEvictionExempt` = `duration === 0 || action`. Confirmed.
  - `Toast.tsx`: message `<p aria-hidden>` used as `aria-describedby` target; announcement only via the viewport live regions, which render `toast.message`. Confirmed.
  - Only caller: `FormPanelView.tsx:86-92` (`pushDenialToastIfAny`, also reached from `useCompactCounterSubmit.ts:145`). Confirmed; the `toastId` closure pattern is already used there, and the builder never calls the callback synchronously, so there is no TDZ risk.
  - `store.ts` serializableCheck: `ignoredPaths: ["toasts"]` covers the whole subtree (so `items[].action.onClick` in state is already covered); `ignoredActionPaths: ["payload.action.onClick"]` does NOT cover `payload.items.N.action.onClick` in the `pushToast` action. Risk R1 / task 2.5 are therefore real: a dev-mode warning will appear unless the path is extended. The task covers it, so I am not raising it as a required change.
- Toast storm (AC1): `denyReasonCopy.ts` maps each code to a fixed sentence, with no counts or details interpolated. So the N>=2 message is a pure function of (sorted ids, names, reason codes), and the existing coalesce dedups repeats. D7 holds.
- Spec delta vs. design vs. tasks: consistent. The MODIFIED requirement keeps the N=1 text, adds N>=2 rows, link-only viewer rows, consume/dismiss, scroll and non-auto-dismiss, plus a distinguishable-ARIA scenario. Tasks 1.1-1.3 and 3.2 cover each scenario. The existing test "N>1 ... carry no action" (`deniedPipelinesToast.test.ts:47`) stays true: the toast-level `action` is still undefined.
- AC coverage: AC1 link + per-row run + no storm is covered by D1/D3/D5/D7 and tasks 1.1/1.2/3.2. AC2 persistence + keyboard + computed ARIA is covered by D3 (`duration: 0`), D5 (names and descriptions) and tasks 1.3/3.2. One gap, below.
- Focus styling: a global `:focus-visible { outline: var(--app-focus-ring); outline-offset: 2px }` exists (`theme/theme.css:659`). `toast.css` has no control-specific ring, so D6's "the same focus-ring recipe the other toast controls use" means the global rule.
- No placeholders/TBDs found; no backend/schema contract touched (frontend-only, correctly no delta beyond the capability spec).

### Verdict: REFUTE

### Change Requests
1. **Focus is lost when a row's "Run to update" is consumed (D2/D5). This breaks AC2's keyboard reachability for the multi-row case the ticket exists for.** `consumeToastItemAction` unmounts the button the keyboard user just activated. The last consume removes the whole toast. In both cases focus falls to `<body>`. `ToastItem`'s existing focus hand-off (`Toast.tsx` useLayoutEffect) only applies when the viewport is inside a modal `dialog`. A keyboard user who runs row 1 cannot then reach row 2's button with Tab in row order. They have to re-traverse the page. With N=1 the toast dismisses anyway, so this never mattered before; per-row consume is new behaviour, so this design has to own it. Required revisions:
   - design.md D5 (or D2): state where focus goes after a row action is consumed. Suggested: the same row's link, which survives. Also state where it goes when the last action is consumed and the toast is removed, outside a modal. Suggested: the trigger the user came from is unknown, so either keep the toast and focus a remaining control, or document an explicit landing target. Silently dropping focus to `<body>` is not acceptable.
   - spec.md: add a scenario under the computed-ARIA requirement saying that after activating a row's "Run to update" by keyboard, focus is on a control in that toast, not `<body>`, while any row remains.
   - tasks.md 1.3 and 3.2: assert `document.activeElement` / `page.evaluate(() => document.activeElement)` after Enter on a row button. Add a mutation in 3.1 that removes the focus move and watches that test go red.

### Non-blocking notes
- D6: the list is `overflow-y: auto` with zero padding, and the global ring is `outline-offset: 2px`. A focused link or button at the list's left or top edge will have its ring clipped by the scroll container. Give `.toast__list` a small inline/block padding (a `--space-*` token) or a compensating negative margin, and check it in the 3.3 screenshots. D6 should also say it relies on the global `:focus-visible` rule rather than adding a toast-local ring. A bare `:focus` rule here would violate DESIGN.md's focus-ring section.
- Task 2.5: extend `ignoredActionPaths` to cover `payload.items` (for example a regex or `payload.items`), and add a case to `store/store.test.ts` mirroring the existing one. Without that, "confirm it does not warn" has no failable check.
- D4 wiring (run + consume against the right `toastId`) is covered only by the e2e in 3.2. A `FormPanelView.test.tsx` case pushing a 2-pipeline response and clicking one row would catch a wrong-toastId or wrong-key bug on the fast gate. Recommended.
- The persistent link-only (all-viewer) N>=2 toast is eviction-exempt. Distinct denials from different panels can therefore stack past `MAX_VISIBLE_TOASTS` (the reducer admits when everything is exempt). This is acknowledged in Risks and acceptable per the Q1 ruling. Note it in the PR.
