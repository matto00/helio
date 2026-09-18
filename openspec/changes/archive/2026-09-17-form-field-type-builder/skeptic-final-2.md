## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cwd guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/form-field-type-builder/HEL-1084` — proceeded normally.

HEAD reviewed: `14a7292c1dccc2bf9dc2041c5cf0b9b4044eb4a2` (verified via `git rev-parse HEAD` immediately after finishing the diff read below). Diff base: `ab4cad57` (`git diff ab4cad57...HEAD`).

### What I verified (with evidence)

**Round-1 defect fix — re-measured live, not just re-read.**
- `git diff ab4cad57...HEAD -- frontend/src/shared/ui/FormField.tsx frontend/src/shared/ui/Select.tsx` shows both changes are additive/optional props (`errorId?`, `ariaInvalid?`, `ariaDescribedBy?`) with internal `useId()` fallback in `FormField`, so no pre-existing call site's rendered output changes. Confirmed with the full existing `FormField.test.tsx` (8 tests) and `Select.test.tsx` (10 tests) both green (`npx jest --testPathPatterns=...`, 43 tests total across 5 suites incl. `FormFieldRow.test.tsx` and `FormEditor.test.tsx`).
- `FormFieldRow.tsx`: `sourceFieldErrorId = useId()` threaded as both `FormField`'s `errorId` and the sourceField `Select`'s `ariaDescribedBy`, plus `ariaInvalid={Boolean(error)}` — matches the executor's claim exactly (file read in full, lines 55-83).
- **Live DOM measurement** (servers reused, verified via `readlink /proc/<pid>/cwd` on both the frontend (6516) and backend (9423) listener PIDs — both resolve inside this worktree, not a stray reused server): opened the "Skeptic Form" panel's editor on dashboard "Skeptic AC Probe HEL-1083", added a field bound to the dataset's `id` field with control `number`, set `Step` to `-1` to force the `computeFormIssues` "Step must be positive" error. `browser_evaluate` against the live DOM:
  ```
  { ariaInvalid: "true", ariaDescribedBy: "_r_g_", descText: "Step must be positive", descRole: "alert" }
  ```
  and the accessibility snapshot showed the combobox marked `[invalid]` immediately followed by `alert "Step must be positive"`. This is the exact defect round-1's skeptic found (empty `[aria-invalid="true"]` NodeList) — now populated and correctly associated. Reverted the test edit via Cancel (no persisted state change).

**"Any other control that can carry a per-field error" (round-1 CR's fuller scope) — verified as N/A, not missed.**
- Read `frontend/src/features/panels/state/formConfigValidation.ts::computeFormIssues` in full: every issue type (duplicate field, orphaned field, control-doesn't-fit, step-not-positive, step-on-non-number, options invalid, initial-value invalid) is pushed with `field: field.sourceField` — i.e. **every** issue in this app's architecture is keyed to, and surfaced against, only the sourceField, never a distinct per-control issue.
- `FormEditor.tsx` line 238: `error={issuesByField.get(field.sourceField)}` — the `Map` is built from `issues.map((i) => [i.field, i.message])`, one entry per sourceField, passed only to the row's sourceField `FormFieldRow` prop. `git log -p` on `FormEditor.tsx` shows this `issuesByField` construction and single-attachment-point predates this ticket entirely (round-1's fix didn't touch it).
- Consequence: `FormFieldRow.tsx` never receives an `error` prop for the Control/Label/Placeholder/Help/Required/Initial-value/Step/Options sub-`FormField`s — confirmed by reading the full component (only the first `<FormField>` at line 73 is ever passed `error`). There is no "other control that can carry a per-field error" left unwired; the round-1 CR is fully satisfied given this app's actual data flow. (Whether errors like "Step must be positive" *should* surface on the Step control instead of the sourceField control is a pre-existing design choice, not something round 1's ticket touched or regressed — out of scope for this gate.)

**Regression test added, mutation-proved.**
- `FormFieldRow.test.tsx` new tests (read in full): "marks the sourceField control aria-invalid and describes it by the error text (C8)" plus the negative case "does not mark ... when there is no error" — matches the promoted C8 standing constraint (assert computed ARIA state, never `role="alert"` presence alone).
- `mutation-evidence.md`: mutating `ariaInvalid={Boolean(error)}` → `ariaInvalid={false}` produces a RED failure isolated to the new C8 assertion (`Received: null`); restored → GREEN, 10/10. Re-ran this suite myself: 43 tests green across the 5 related files, no discrepancy from the claimed evidence.

**Gates re-run myself, not trusted from the evaluator's report:**
- `npx eslint FormFieldRow.tsx FormEditor.tsx FormField.tsx Select.tsx --max-warnings=0` — clean, no output.
- `npx tsc --noEmit -p tsconfig.json` — clean, no output.
- `npx jest --testPathPatterns=features/panels` — 60 suites / 655 tests, all green (broader panels-feature regression sweep, not just the touched files).
- Live browser console: `browser_console_messages` level=error → 0 errors after all the above interaction.

**Round-1's other verified items** — not independently re-run in full this round (no code changed in those areas since round 1: write-API consistency check `7b104e84`, focus-after-Remove fix `d1fc4fc1` are untouched by `14a7292c`, confirmed via `git diff d1fc4fc1...14a7292c --stat` showing only `FormField.tsx`, `Select.tsx`, `FormFieldRow.tsx`, `FormFieldRow.test.tsx`, `mutation-evidence.md` changed). The `features/panels` jest sweep above (655 tests) covers this regression surface mechanically; I did not re-drive the picker/keyboard-reorder/theme-toggle UI flows a second time since nothing in this commit touches that code path.

### Gate defect check (per instructions)
No mtime-ordering claim was relied upon in this round's evidence — the live DOM measurement and jest mutation evidence are both self-authenticating (content-based). No gate defect to record.

### Verdict: CONFIRM

Round-1's REFUTE is resolved: the sourceField control now carries a real, live-measured `aria-invalid`/`aria-describedby` association to its error text, the fix is additive to shared components (no regression to 7 pre-existing `FormField` callers or `Select`), and the "any other control" scope in the CR is satisfied by demonstrating no other control in this component ever carries a per-field error given the app's own validation architecture. All gates (lint, typecheck, targeted + broad jest, live console) pass on fresh re-run.

### Non-blocking notes
- `computeFormIssues` attaches every issue type (including step/options/initial-value issues) to the sourceField row rather than the specific offending sub-control. This is pre-existing behavior, out of scope for HEL-1084, but is worth a follow-up ticket if a future accessibility pass wants per-control error placement matching the semantic source of each issue (e.g. "Step must be positive" surfacing on the Step field, not the field-name chooser).
