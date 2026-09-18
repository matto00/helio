## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket ACs addressed: increment/decrement keyboard-operable (Tab/Enter/Space on `+`/`-`
  buttons, ArrowUp/ArrowDown on the `spinbutton` itself), current value and step exposed to AT via
  computed `aria-valuenow`/`aria-valuetext`/`aria-valuemin`/`aria-valuemax` on a `role="spinbutton"`.
- No AC reinterpreted. Same `form` panel kind, same `POST /api/panels/:id/submit` path — no new
  route/PanelKind introduced (verified in the diff: no `ApiRoutes.scala` change).
- design.md Decisions 1–5 implemented exactly, with two genuinely distinct code paths (not
  conflated) — verified by reading `FormFieldControl.tsx`'s `case "counter"` (dispatches to
  `onImmediateStep` vs `onChange` based on the `immediate` prop) and `FormPanelView.tsx`'s
  `handleImmediateStep` (compact-layout-only optimistic-tally/immediate-submit/revert) vs.
  `handleSubmit` (unmodified whole-form path used by the embedded case). Confirmed live in a real
  browser (see Phase 3) that an embedded counter's `+`/`-` never fires a network request.
- All `tasks.md` items marked `[x]` match what's actually implemented; no silent fallthrough for
  any field-count/shape boundary (zero fields → "Form not configured"; one non-counter field →
  standard layout; one counter field → compact layout; 2+ fields incl. one counter → standard
  layout with the shared, non-immediate counter control) — all four verified live, not just by
  code reading (Phase 3).
- No scope creep: diff is confined to the counter control, the compact layout, author-time step
  config, the `step`-validation mismatch fix (frontend+backend), and their tests/specs.
- No regression to existing behavior: `FormPanelView.handleSubmit`, `form-panel-submit`'s live
  regions/reset/focus behavior are untouched and reused verbatim by both the standard and compact
  layouts.
- API contract: no schema change needed and none made — `POST /api/panels/:id/submit`'s existing
  `{values: {field: value}}` shape is unchanged; the backend `validateConfig` fix is a narrow
  author-time authoring-validation correction, not a request/response contract change.
- Planning artifacts (`design.md`, `tasks.md`) match the final implementation; `files-modified.md`
  is accurate against the diff (independently re-derived and cross-checked, not trusted at face
  value).
- No non-retired `workflow-state.md` `CONSTRAINTS` entries were found to be violated in this diff.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` (never trusted from the executor's report):

- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 332 suites / 3630 tests passed.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk warning, unrelated to this
  change).
- `cd backend && sbt test` — 4703 tests, 0 failed, `All tests passed.` (294s), including the two new
  `FormPanelSpec` counter-step cases.

Code quality:

- Backend fix (`FormPanel.scala:337-343`) is narrowly scoped: extends the existing `step`-only-on
  `control: number` mismatch check to also allow `control: counter`, preserving the reject-on-every-
  other-control behavior verbatim (confirmed by reading the diff — the guard is
  `f.step.isDefined && f.control != "number" && f.control != "counter"`, i.e. `text`/`date`/`select`/
  etc. with a `step` still fail exactly as before). Root-cause probe (live e2e 400→201) is credible
  and consistent with the fix.
- `formConfigValidation.ts` mirrors the backend rule identically (client-side pre-validation), same
  scoping.
- CounterControl.tsx: clean, single-responsibility, presentational-only component; `role="spinbutton"`
  correctly carries `aria-valuenow`/`aria-valuetext`/`aria-valuemin`/`aria-valuemax`, keyboard handler
  only intercepts ArrowUp/ArrowDown (no scroll-jacking, no unrelated key capture), `tabIndex={disabled
  ? -1 : 0}` correctly removes a disabled control from the tab order.
- `FormFieldControl.tsx`'s `case "counter"` is the single dispatch point: `handleStep` cleanly
  branches on `immediate` — no duplicated increment/ARIA logic between the two layouts (design.md
  Decision 2, verified).
- `FormPanelView.tsx`'s `handleImmediateStep` correctly computes the delta as `step * direction`
  (not the field's post-update value), matching HEL-1089's delta contract; reverts the tally
  precisely by re-setting to the pre-click `previous` value on any rejection.
- `useFormEditorState.ts`'s `toConfig` forces `resetOnSuccess: false` only for the
  `fields.length===1 && control==="counter"` shape — not a blanket change, matches Decision 3
  exactly; `dropIncompatibleAttrs` correctly preserves `step` across a switch to `counter` and drops
  it for any other control.
- Tokens-only CSS (`CounterControl.css`): `--space-*`, `--app-radius-sm`, `--text-lg`/`--text-3xl`,
  `--app-focus-ring`, `--app-error`, `--font-mono` — no hardcoded colors/spacing found.
- DRY: the compact layout reuses `FormFieldControl`/`CounterControl` rather than a parallel
  implementation; `submitFormPanel` is reused unmodified for the immediate path.
- No dead code, no `any`, no TODO/FIXME left in the touched files.
- Tests are meaningful, not vacuous: `files-modified.md`'s mutation-proofs (hardcoding submit
  payload to `999`, hardcoding `aria-valuetext` to `"broken"`) are exactly the kind of proof C7/C8
  call for; independently, my own live-browser pass below reproduces the same live-ARIA behavior
  the mutation test targets, so this isn't taken on the executor's word alone.

### Phase 3: UI Review — PASS

Live pass against the running app (ports 6520/9427), independent of the executor's own e2e spec —
I built my own dashboard/panels via the API and drove them through the actual browser, not by
grepping source:

- **Computed ARIA, read from the live accessibility tree** (not attribute-presence grep, per C8):
  confirmed via both `page.accessibility`-equivalent DOM read and Playwright's own accessibility
  snapshot (`browser_snapshot`), which rendered `spinbutton "delta" [active]: "1"` after an
  ArrowUp activation — the tree itself reflects the live value, and a `status` region showed "The
  row was added." on the same activation, proving the announcement path is real, not vacuous.
- **Immediate single-field submit**: on my own seeded panel ("Widget Counter", `step: 5`), clicking
  `Increase Widgets by 5` correctly issued a submit; a separate multi-field panel's counter click
  ("Multi Field", `step: 2`) updated its local value to `2` but issued **zero** requests (row count
  verified via `GET /rows` before/after = 0 → 0), then a whole-form Submit correctly wrote exactly
  one row with `delta: 2` — this is the exact Decision 1 split working correctly live, not just in
  test code.
- **Rejected increment writes nothing and reverts**: deleted the compact panel's bound data source,
  then clicked `Increase Widgets by 5` — the `alert` region showed "Data source not found", and the
  `spinbutton`'s `aria-valuenow` visibly reverted to `"0"` in the same accessibility snapshot; the
  underlying source was gone so no row could land anywhere.
- **Field-count/shape boundaries**, all four rendered correctly live: zero fields → `status: "Form
  not configured"`; one non-counter field → ordinary stacked-field form with Submit; one counter
  field → compact centered chrome, no Submit button; 2+ fields incl. one counter → standard layout
  with the counter rendered inline (non-immediate) alongside the other field and one shared Submit.
- **Error/loading states**: a panel whose bound source was deleted mid-session showed the
  established `InlineError`-banner state ("Failed to load the dataset's declared schema." + Retry),
  not a blank screen or crash.
- **No console errors** during any of the counter flows themselves; the only console errors seen
  were the expected 404 from the deliberately-forced rejection test and stale 401s from a
  login/logout transition, neither a defect.
- **Keyboard operability**: Tab/focus reaches both `+`/`-` buttons and the `spinbutton` container;
  ArrowUp/ArrowDown on the container and Enter/click on the buttons all increment/decrement
  correctly; no focus trap observed.
- **Light/dark theme parity**: screenshotted both themes for the compact layout (grid view). Token-
  driven styling holds in both — value/`+`/`-` sizing, spacing, and focus-ring color track the
  active theme with no light/dark-specific hardcoding, consistent with `DESIGN.md`.
- PanelPacker clamp bounds independently confirmed unchanged (`PanelPacker.scala:43` —
  `PanelKind.Form -> ClampBounds(minW=3, minH=5, maxH=24)`, no diff), matching task 4.6's claim.

### Overall: PASS

No change requests.

### Non-blocking Suggestions

- None beyond what's already tracked in design.md's own Risks/Trade-offs (the future
  bypass-the-builder JSON-edit path forgetting `resetOnSuccess: false` is already flagged there as
  a delivery-triage candidate, not a defect in this diff).
