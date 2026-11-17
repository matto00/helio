## Why

`e2e/hel1685-draft-polish.spec.ts` "Save & run that removes an Output requests no preview of it (item 7)" fails
intermittently in CI. The CI trace (run 43949524653) shows the test's "Remove step" click hit the default-selected
Step 1 (Filter) card before the click on "Step 3:" had moved the selection, so the wrong step and the wrong Output were
removed and the watched Output was legitimately previewed. Unless a local reproduction proves otherwise, this is a test
race, not a product race, and it hides whether the product behaves correctly (HEL-1711).

## What Changes

- Reproduce the failure locally with `--repeat-each` and `--trace retain-on-failure`, and confirm the root cause from
  the local trace (which step the Remove step click removed, and why the selection had not yet moved).
- Make the spec wait deterministically for the selection: after clicking `Step 3:`, wait until the focused step card
  is Step 3 (the `section` named `Step 3 Compute column`) and click "Remove step" scoped to that card.
- Make the test self-checking: assert the "Confirm removals" dialog names the Output the test watches ("Avg minutes"),
  so a wrong-step removal fails with a clear message instead of a misleading "preview requested" one.
- Apply the same scoped wait to the identical `Step 3:` → `Remove step` pattern in `e2e/hel1631-draft-mode.spec.ts`.
- No timeout is widened and no retry is added.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — e2e test determinism only; no product behavior changes (`skip_specs: true`). If the local probe instead finds
a product defect (a selection that reverts, or a preview requested for an Output that the save really removed), the
plan changes and the executor escalates rather than widening scope silently.

## Impact

- `e2e/hel1685-draft-polish.spec.ts`, `e2e/hel1631-draft-mode.spec.ts`.
- No frontend source, backend, schema or migration changes.
