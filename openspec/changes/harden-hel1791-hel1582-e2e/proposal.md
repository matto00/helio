## Why

HEL-1826 (943b5dd73) fixed two e2e flakes and named two residual risks of the same kind in the same files: the
hel1791 owner theme tests still share one owner's 120-per-60 s `/api` window (reported 20-25 left at the end of the
run), and hel1582's tap (b), inside the step sheet, aims at an "N fields" trigger with no wait for the late row count
that moved tap (a)'s target. Either can turn into an unlisted CI failure on a slower runner.

## What Changes

- `e2e/hel1791-compact-counter-stack-height.spec.ts`: each owner test runs as its own owner, one principal and board per (theme, width)
  (6 tests), on its own copy of the seeded dashboard, so no two tests spend one owner's window. Each owner-role test logs the number
  of `/api` requests its principal made (the AC's "highest well under the limit"). Assertions unchanged.
- `e2e/hel1582-mobile-pipeline-motion-and-states.spec.ts`: a deterministic probe settles whether tap (b)'s trigger
  moves when the sheet's row count arrives. If it does, tap (b) gets the same bounded, messaged
  `.step-preview__count` wait as tap (a). If it does not, no wait is added and the probe evidence says so.
- Probe, red/mutation and 20x green runs committed as `.txt` evidence in the change dir.

- Fold-in (owner, follow-up triage): `e2e/hel1791-compact-counter-stack-height.spec.ts` editor theme tests (light,
  dark) each run as their own editor principal, granted `editor` on the beforeAll board, instead of sharing one editor
  whose window measured max-60s 72-80 of 120. Each logs its REQUEST-COUNT. Assertions unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (`skip_specs: true`).

## Impact

The two e2e spec files above, and shared e2e support files only if a seeding helper must be extracted. No app,
schema, backend, migration or CI config change.

## Non-goals

- App code changes.
- Other specs; HEL-1828 / HEL-1829 files (frontend product code).
- Loosening, retrying or skipping any assertion.
