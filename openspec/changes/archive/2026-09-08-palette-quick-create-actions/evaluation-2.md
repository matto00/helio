## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed: `f0b9dc09` on `a9107096`, based on origin/main @ `36a9c1cc`.
Scope: the cycle-2 delta (`git diff a9107096..f0b9dc09` — 9 files) plus regression exposure from
the two rebases. Cycle-1 PASS findings are not re-litigated; I found no evidence of regression in
them (the delta touches nothing in `PanelList`/`panelsSlice`/`CommandPalette`/`KeyCap`, and the
new base's HEL-448 table-sort / HEL-1015 flattening work shares no file with this branch).

### Gates I re-ran myself, from `frontend/`

- `npm run lint` (`eslint src --max-warnings=0`) — clean
- `npm run typecheck` (`tsc --noEmit`) — clean
- `npm run format:check` — clean
- `npm test` (`jest --config jest.config.cjs`) — **280 suites / 2855 tests passed**
- `npx playwright test e2e/hel516-palette-quick-create.spec.ts` (DEV_PORT=5948, BACKEND_PORT=8855)
  — **10/10 passed**
- `npx playwright test e2e/hel516-screenshots.spec.ts` — 2/2, evidence refreshed

### Phase 1: Spec Review — PASS

No AC or spec-delta drift. `buildCreateActions`'s parameter type widened from `CreateActionResult`
to `Pick<CreateActionResult, "cta">`, which is a loosening (all existing callers still satisfy it)
and does not change the `CommandAction` shape HEL-519/HEL-503 inherit. `files-modified.md` was
updated to describe the final implemented behavior.

### Phase 2: Code Review — PASS

**CR1 (section-order nondeterminism) — FIXED, and I verified both halves myself.**
- Mechanism is sound: refs hold each seam's latest `CreateActionResult` (assigned during render,
  no effect), and the `useMemo` deps are the primitives that actually determine the array's shape.
  I checked the deps are *complete*: `useCreatePanelAction.tsx:30-36` is the only seam that ever
  sets `disabled`; the other three never do (`useCreateDashboardAction.tsx:49` explicitly documents
  that it never disables while pending). So `[4 labels, panel.disabled]` covers every shape-
  determining value — this is not an under-specified dep list dressed up as an optimization.
- **Render-level guard mutation, run by me**, not accepted from the report: reverting the deps to
  the pre-fix `[createDashboardAction, addSourceAction, createPipelineAction, createPanelAction]`
  turns `CreateCommandActions.test.tsx` **red — `Received: 10`, `Expected: <= 5`**; restored, green
  (4/4). The executor's stated concern about its own first draft is real and the shipped guard does
  not have that weakness: it counts `notify()`-driven observer renders (a direct measurement of
  register/dispose cycles), not final ID order, which is exactly the quantity that stabilizes after
  one churn event and made the first draft false-pass.
- **Independent measurement**: I ran my own 12-boot probe (fresh cookies + fresh account per boot,
  reading `.command-palette__group-label`): **12/12 identical `Create,Navigation,General`**. Before
  the fix my equivalent probe measured 5/6 vs 1/6. The symptom is gone.
- **On the 5-boot e2e, plainly**: as a *standalone* detector it is weak, not adequate. At the ~1-in-6
  divergence rate I measured pre-fix, five boots would catch the bug roughly half the time
  (`1 - (5/6)^4 ≈ 0.52`), so on its own it would be a coin flip and a future flake source in the
  "passes while broken" direction. It is acceptable **only** because it is explicitly the secondary,
  symptom-level cross-check and the deterministic render-level guard carries the load — which is what
  the file itself claims, and which I verified is true. I would not accept it as the sole guard.

**CR2 (unverified DOM check on a shared seam) — FIXED.**
- `useAddSourceAction.tsx`'s diff vs main is now comment-only; `onClick` is back to the bare
  `dispatch(setAddSourceModalOpen(true))`. The other consumers (`usePickerSelection`, the sources
  empty state, `SourcesPage`'s button) are genuinely untouched.
- The guard now lives at the palette call site and reads `ADD_SOURCE_MODAL_ARIA_LABEL`, exported
  from `AddSourceModal.tsx:44` and consumed by its own `ariaLabel` prop — so the label and the
  selector cannot drift apart. That closes cycle 1's silent-no-op hazard.
- Unit coverage exercises both directions of `isAddSourceModalAlreadyOpen` and both branches of the
  wired action, asserting through the Redux store rather than re-deriving the same DOM check.
- **The steady-state e2e assertion genuinely discriminates — I removed the guard and ran it**:
  `Error: expected exactly 1 dialog, saw 2`, test failed. The executor's account of the earlier
  `toHaveCount(1)` false-pass is credible and the `toPass`-held-for-1s replacement is the right
  shape (it fails on the *settled* state, not the first observed frame).

**CR3 (unguarded empty-dashboard fallback + missing parity assertion) — FIXED.**
- **Mutation run by me**: deleting the `items.length === 0 && loadedDashboardId === … && status ===
  "succeeded"` arm turns the new `App.test.tsx` guard red; restored, green. The guard is also better
  than the throwaway probe I used in cycle 1 — it does not preload `status`/`loadedDashboardId`, it
  lets the mount effect's own `fetchPanels` resolve them, so it exercises the real path into the
  fallback rather than hand-placing its precondition.
- The parity e2e does what task 1.2a asked: it establishes the `/` flow's own post-fetch baseline
  ("Parity Output … already on this board" in `/`'s reopened picker) and then asserts the *same*
  marking off-route via the palette. That is a comparison of the two markings, not an
  "off-route result is non-empty" assertion.

**CR4 (`as never`) — FIXED, with no substitute escape hatch.** `preloadedState` slices are fully
materialized and `configureStore` is called untyped-cast-free. Repo-wide check of the delta: the
only remaining suppression is the `eslint-disable-next-line react-hooks/exhaustive-deps` in
`CreateCommandActions.tsx`, which is the standard idiom for a ref-read memo, is narrowly scoped to
one line, and carries an in-file justification. Acceptable; not a substitute for the removed cast.

**Precondition wait** — confirmed in the helper itself
(`e2e/hel516-palette-quick-create.spec.ts:35`), *after* `page.waitForURL("/")` and before
`registerAndLogin` returns, so every test's first `keyboard.press` is on the right side of it.

Every new guard states what it proves and what it cannot, and all four I mutated were failable.

### Phase 3: UI Review — PASS

Judged against the running app (dev 5948 / backend 8855, both healthy via `start-servers.sh`),
both themes, plus refreshed evidence in `.concertino/runs/HEL-516/evidence/`.

- 10/10 e2e green, including the new nested-collision, determinism and parity cases.
- Palette renders correctly in light and dark; the Create group's rows, icons and spacing match the
  Navigation/General rows; the `KeyCap` on "Open assistant" still reads identically to the help
  overlay's caps (same atom — `KeyCap.tsx` and its CSS remain untouched by this branch).
- Hover and focus states show no light-theme token collision (HEL-866 class not reproduced).
- No console errors observed during any flow driven.

### Overall: PASS

### Non-blocking Suggestions

- The section order is now *deterministic* but *incidental* — it happens to be
  `Create, Navigation, General` because of registration order, not because anything declares it.
  Whether Create should precede Navigation in the default list is a judgment/IA call I am
  deliberately not ruling on; if it matters, it belongs to the skeptic or the owner, and the durable
  fix would be an explicit section-order declaration rather than relying on mount order. Not a
  blocker: the user-visible defect (order changing between boots) is closed.
- The five-boot determinism e2e would be strictly stronger measured against a fixed expected order
  (`["Create","Navigation","General"]`) rather than "all five agree with the first", which by
  construction cannot fail when a run happens to be internally consistent. Cheap to tighten if the
  order is ever declared per the point above.
- Carried forward from cycle 1, still non-blocking: the four `as ReactNode` icon casts in
  `builtInActions.ts`, and the absence of a committed focus-handoff assertion (behavior itself
  verified live in cycle 1 and unchanged here).
