## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Detail:
- Ticket AC #1 (definite rejection rolls back with field-associated `aria-invalid`/
  `aria-describedby`), AC #2 (indeterminate outcome does not roll back, reconciles against the
  aggregate, announces "couldn't confirm" if the refetch also fails), and AC #3 (a lost-ack test
  proving the fix, red against pre-fix behavior) are all addressed explicitly — verified directly
  in `FormPanelView.tsx`'s diff and in `FormPanelView.test.tsx`'s `HEL-1169 1.1`/`1.2` tests.
- No AC reinterpreted. D1's classification (`err.response !== undefined`) matches the ticket's own
  "4xx/5xx with a body is definite" wording and the orchestrator's premise-validation note verbatim.
- Every tasks.md item is checked and matches the diff: 2.0 (`reconcileValue`), 2.1 (unconditional
  shared `reconciliationTail` helper), 2.2 (classification), 2.3–2.5 (per-branch wiring), 2.6
  (mixed-burst test), 2.7 (HEL-1096 denial-toast regression — full suite green, including
  `PipelineDetailFooter.denial.test.tsx` and friends), 2.8 (primary-path regression test). Section
  3a's "do not implement" instruction was honored — no new cross-branch tracking ref was added
  (`grep -n "useRef" FormPanelView.tsx` shows only the pre-existing refs). Section 4 (Linear
  follow-up filing) is correctly left to the orchestrator's Delivery phase, per files-modified.md's
  own note.
- No scope creep: diff touches exactly `FormPanelView.tsx`'s `handleImmediateStep`,
  `useFormPanelValues.ts` (new `reconcileValue` only, `setValue` untouched), a new
  `classifySubmitFailure.ts` helper, tests, and one new e2e spec. No backend/schema files touched.
  `git diff --stat -- backend/ schemas/` is empty. HEL-1170's broader refactor was not folded in
  (C2 honored) and no idempotency key was added (C3 honored — `grep -in idempot` on the diff hits
  only prose in openspec docs).
- No regressions to other specs: `form-panel-submit`'s other requirements (validation, file
  storage, pending-state, accumulation) are untouched in the base spec and their existing tests
  (accumulation/staleness-guard scenarios, e.g. 3.3–3.6) pass unmodified.
- Spec delta's two MODIFIED requirement headers are byte-identical to
  `openspec/specs/form-panel-submit/spec.md`'s existing headers (`A counter's optimistic rollback is
  scoped to its own submit-request failure only` and `A counter's displayed value reconciles to the
  dataset's authoritative aggregate after a successful submit`) — confirmed by diffing the two
  files' `### Requirement:` lines; this is exactly the archive-time hazard design.md D0 exists to
  prevent, and it's honored.
- CONSTRAINTS C1/C2/C3 (workflow-state.md) all honored — see above.

### Phase 2: Code Review — PASS

Issues: none blocking.

Gates (fresh run, this session, in `WORKTREE_PATH` — `EVALUATOR_CLEAN_WORKTREE=false` so no
clean-worktree re-run applies):
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 28+340 suites, 271+3706 tests, all green (includes helio-mcp and frontend). Ran the
  narrower `FormPanelView|classifySubmitFailure|useFormPanelValues` pattern separately too (48/48
  green) to directly confirm the ticket's own new/updated tests pass for real, not just via the
  executor's pasted transcript.
- `npm --prefix frontend run typecheck` — clean.
- `npm --prefix frontend run build` — succeeds (pre-existing chunk-size warning, unrelated to this
  diff).

Targeted verification of the three flagged risk areas:
1. **Unconditional reconcile-tail call from all three branches** — confirmed directly in the diff:
   `reconciliationTail()` is called from the success branch (no callback), the definite-rejection
   branch (no callback), and the indeterminate branch (`onReconcileFailed` callback), each
   unconditionally on that branch's own path — `FormPanelView.tsx` lines ~216–260 (post-diff).
2. **`reconcileValue` vs `setValue`** — `useFormPanelValues.ts`'s `reconcileValue` (new) only calls
   `setValues(...)`, never touching `externalErrorsState`; `setValue` (unchanged) still
   unconditionally clears `externalErrorsState` for that field. `reconciliationTail` calls
   `values.reconcileValue(...)`, never `values.setValue(...)`. Confirmed by direct read of both
   functions.
3. **A definite rejection's error surviving its own successful trailing reconciliation** —
   task 2.8's test (`HEL-1169 2.8`) genuinely exercises this: rejects with a field error, mocks the
   aggregate fetch to *succeed* with a different value (20, distinguishable from both the
   pre-rollback and post-rollback local values), and asserts both `aria-valuenow="20"` (proving
   reconciliation actually applied) AND `aria-invalid="true"` / accessible description still intact
   afterward. This is not a stubbed assertion — I ran it directly (`npx jest ... 48/48 passed`) and
   also proved it live in the browser (see Phase 3).
4. **"Couldn't confirm" only from the indeterminate branch's own failed fetch** — confirmed: only
   the indeterminate branch's call to `reconciliationTail` passes a non-empty `onReconcileFailed`;
   success and definite-rejection calls pass none. Test 2.5 explicitly proves a failed trailing
   fetch on the success branch stays silent (no "couldn't confirm"), and test 2.3's counterpart
   proves the same for a rejection branch by not asserting any such text after 1.2/2.3's own
   fetch-failure setup.
5. **HEL-1096 `deniedPipelines` toast unaffected** — `pushDenialToastIfAny` is still called only
   from the two success sites (`handleImmediateStep`'s success branch, unchanged position, and
   `handleSubmit`, untouched by this diff) and never from either failure branch. Full suite includes
   the HEL-1096 tests (`PipelineDetailFooter.denial.test.tsx`, `deniedPipelinesToast.test.ts`,
   `deniedPipelineToastA11y.test.tsx`), all green.
6. **The 3 updated pre-existing tests + 3.7's reconciliation-tail update are behavior-change-driven,
   not fixture hacks** — read each diff hunk: `1.3/4.3` and `3.2` switched their mock rejection from
   a response-less `Error` to a definite axios error *specifically because* a response-less error is
   now classified indeterminate and (correctly, per the fix) no longer rolls back — the tests'
   original intent ("a rejected submit reverts the tally") is preserved by keeping the rejection
   definite, not by loosening an assertion. `3.7` additionally updated its final assertions because
   D2 makes every settle (including C's rejection) dispatch its own reconciliation fetch — the test
   now captures and resolves that second fetch (F2) and asserts on it, rather than skipping the
   consequence. None of these loosen a check to make a red test green; each keeps the original guard
   intact under the new, intentionally-changed classification. This matches MISTAKES.md's "fixture
   change is a symptom" concern in the negative — these are NOT symptom-hiding edits.
7. **CONTRIBUTING.md compliance** — comments follow the hazard/contract/why discipline (each
   `HEL-1169`-tagged comment states the decision inline, not a bare ticket pointer); no inline FQNs
   (TS); the new `classifySubmitFailure.ts` module is a small, single-purpose, DRY extraction reused
   by both the implementation and its own test, avoiding a second inline classification. `error`
   prop wiring to `FormFieldControl` reuses the pre-existing shared error/ARIA component rather than
   hand-rolling new markup — no new CSS, no new DESIGN.md-relevant surface.

Non-blocking file-size note (not a Change Request): `FormPanelView.tsx` was already over
CONTRIBUTING.md's ~400-line soft-split threshold before this ticket (407 lines pre-change) and grew
to 442. The rule asks for a split to be *proposed in the PR description* when editing such a file,
which the delivery artifacts don't explicitly restate. In this case HEL-1170 already exists as the
filed, ticket's-own-scope-excluded refactor of this exact function (C2), so the split has
effectively already been proposed and deliberately deferred rather than skipped — flagging this only
so the PR description names HEL-1170 explicitly as satisfying that convention, not as a defect.

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`). Servers already healthy via
`scripts/concertino/start-servers.sh`/`assert-phase.sh` (`PASS servers`).

- **Independent fresh re-run of the executor's own e2e spec** —
  `DEV_PORT=6601 BACKEND_PORT=9508 npx playwright test e2e/hel1169-network-vs-rejection-reconcile-a11y.spec.ts`:
  4/4 passed against the real dev+backend servers, run by me, not copied from the executor's
  transcript.
- **Screenshot evidence reviewed directly** (files already present under
  `.concertino/runs/HEL-1169/evidence/`, timestamps ~15:55–15:56 today, sizes 47–54 KB each — 4
  files, dark+light × definite+indeterminate): the definite-rejection screenshot shows the control
  rolled back to `0`, visibly marked invalid, with "delta must be positive" text (both the
  field-level and shared-alert-region copies of the message); the indeterminate screenshot shows
  the value held at `5` (not rolled back), the control NOT marked invalid, and "Couldn't confirm the
  current value. It may not be up to date." — the two states are clearly visually and textually
  distinct in both themes.
- **Manual live-browser check performed independently of the e2e spec**: logged into the shared dev
  account, created a fresh counter panel via the real API, clicked "Increase Widgets by 5" for real
  (no mocking) — the value updated to `5`, status announced "The row was added.", zero console
  errors captured via `browser_console_messages`. Confirmed the button has an accessible name
  ("Increase Widgets by 5" / spinbutton "Widgets") and is keyboard-focusable/operable (native
  `<button>` element, `[active]` state on focus). Test data cleaned up afterward via the API.
- No console errors during any tested flow (both the live manual check and the Playwright run
  completed without error-level console entries).
- Loading/empty/error states: the shared `role="alert"` region and `FormFieldControl`'s
  invalid/`aria-describedby` machinery are pre-existing shared components, reused unmodified — no
  new bespoke UI state was introduced.
- Breakpoints: no new layout/CSS was introduced by this diff (`git diff --stat -- "frontend/**/*.css"`
  is empty) — the change is confined to text/ARIA-state wiring inside the existing, already
  responsive-tested `FormFieldControl`/compact-counter layout, so a full 1440/1100/768/0 resize
  sweep was not separately re-run; not expected to be breakpoint-sensitive.

### Overall: PASS

### Non-blocking Suggestions
- Name HEL-1170 explicitly in the PR description as the tracked follow-up satisfying
  CONTRIBUTING.md's "propose a split" convention for `FormPanelView.tsx`, which is now at 442 lines
  (over the ~400-line soft budget, pre-existing at 407 before this ticket).
