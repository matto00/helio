## Evaluation Report — Cycle 2 (evaluation-2.md)

Re-evaluation of commit `15a3c93c` (fixes cycle 1's two change requests, evaluation-1.md).
Planning artifacts and Phase 1 spec review are unchanged from cycle 1 (PASS, not re-litigated
here); this cycle re-verifies the two cycle-1 Change Requests live and re-runs gates fresh, per the
driver's explicit ask not to trust self-report or code inspection alone.

### Phase 1: Spec Review — PASS
Unchanged from evaluation-1.md; no new scope-relevant changes in this diff beyond the two targeted
fixes (`git diff c0df3ade..15a3c93c` touches only `DatasetSchemaEditor.tsx` and its test file).

### Phase 2: Code Review — PASS
Fresh gate run (this worktree, HEAD = `15a3c93c`):
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm test` (full suite, not just targeted files this time) — 315 suites, 3331 tests, all pass.
- `e2e/hel1079-dataset-management-ui-live.spec.ts` (`DEV_PORT=6511 BACKEND_PORT=9418 npx
  playwright test`) — 4/4 passed against the live backend (create-with-3-fields, 409 retype
  rejection, drop-with-confirm, required-no-default block).
- `e2e/focus-presence-guard.spec.ts` — 1/1 passed, 246 focusable elements measured across 10 views
  (both themes), including `/sources/:id` with the schema-edit controls present. 0 findings.

Both cycle-1 findings independently re-verified live (not from code reading alone), against a
freshly created 3-field dataset (`a`/`b`/`c`, one row) via direct DOM manipulation + Playwright
`document.activeElement` inspection:

- **CR1 (state-resync race) — FIXED.** Removed the middle field `b` (row count > 0, confirm
  dialog shown), confirmed the drop. `PATCH .../schema` returned 200; the on-screen
  `FieldDeclarationTable` immediately showed only `a`/`c` (`existing-a`, `existing-c`) with no
  stale `b` — checked immediately after the confirm click resolved and again 2 seconds later, both
  times correct, no reload needed. `GET .../schema` independently confirmed the backend agreed
  (`fields: [a]` after the final drop below). The fix (building `rows` directly from the PATCH
  response's own `fields` via `schemaFieldsToRows`, rather than depending on a separately-dispatched
  `fetchDatasetSchemaThunk` to resolve before re-seeding) removes the race correctly — confirmed
  the root-cause narrative in the fix's own comment against actual re-tested behavior, not just
  read the comment and trusted it.
- **CR2 (Decision 6 confirm-focus) — FIXED.** Tested all three sub-cases live:
  - Removing a middle field (`b` of `a`/`b`/`c`) and confirming: focus landed on `aria-label="Field
    2 name"`, holding value `c` — the next remaining field's name input at its new position.
    Correct.
  - Removing the (now-last) remaining field of a 2-field set and confirming: focus landed on
    `aria-label="Field 1 name"` — the sole remaining field. Correct.
  - Removing the last remaining field (zero fields left) and confirming: focus landed on the "+ Add
    field" button (`document.activeElement.textContent === "+ Add field"`). Correct — matches
    design.md Decision 6's "or 'Add field' if none remain" fallback.
  No case left focus on `<body>` (the cycle-1 defect) in any of the three sub-cases tested.

No new findings from this diff. The `pendingConfirmFocusRef` approach correctly recomputes the
removed field's position from `rows` before clearing `dropConfirm`, and clears itself after
applying focus (matches the existing `FieldDeclarationTable` pending-focus pattern already used for
the plain-remove path, so this is consistent with the rest of the file rather than a new one-off
mechanism).

### Phase 3: UI Review — PASS
- Servers verified healthy via `assert-phase.sh servers` (reused from cycle 1, still healthy).
- Manual keyboard-only spot check: `Add source` (focused, `Enter` to open) → modal opens with focus
  correctly moved to the dialog title (`<h2 tabindex="-1" aria-live="polite">`) → `Tab` → dialog's
  close button → `Tab` → source-name input, all via real `Tab`/`Enter` key presses (not DOM
  scripting) — standard, correct modal focus-trap entry behavior. Combined with
  `e2e/hel1079-dataset-management-ui-live.spec.ts`'s existing full keyboard-driven create flow
  (task 3.2/4.1, independently re-run and passing above) and the three live confirm-focus checks
  above (task 3.3's confirm-drop keyboard contract), this is sufficient corroboration of the
  keyboard-only AC without re-driving every control key-by-key a second time.
- The pre-existing minor cohesion note from cycle 1 (the read-only "Field/Type/Nullable" summary
  table above the editable schema panel doesn't refresh on the same cadence as the editor below)
  is confirmed to be a separate, pre-existing component (`SchemaFieldViewer` rendering
  `source.inferredSchema`, unrelated to `datasetRowsSlice`'s schema state) — not a regression
  introduced by this ticket, and not itself an AC. Left as the same non-blocking suggestion.

### Overall: PASS

### Non-blocking Suggestions
- (carried over from cycle 1) Consider a follow-up ticket to collapse or sync the read-only
  header schema summary with the editable panel below it on `/sources/:id` for a dataset source,
  since editing one visibly can leave the other stale until the next full source refetch — a
  cohesion/UX call for the skeptic, not a mechanical defect.
