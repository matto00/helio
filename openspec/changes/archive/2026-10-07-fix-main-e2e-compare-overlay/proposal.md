## Why

Main CI e2e is red on two specs (hel1350 deterministically; hel1351 since 2026-10-08T00:00Z), blocking HEL-1370 (PR #833) and HEL-1361's measurement. Every merge to main is blocked until both are green again for the right reason.

## What Changes

- Root-cause hel1350's 150s timeout. Evidence already in hand from CI run 37703155327 (e2e (3), playwright-report-shard-3 trace): the test hangs on `getByRole('option', { name: '7 days' }).click()` — the option resolves, is visible/enabled/stable, but Playwright reports "element is outside of the viewport" on every retry (~270 retries). This is a layout problem with the Compare dropdown listbox in the Output editor sheet, not an SSE/run-timing problem. Commits absent from PR #829's head but present on main include b14e622ee (HEL-1366) **and** f268edf8f (HEL-1331, which added a History-payloads toggle to the same Output editor sheet). The executor must reproduce locally and confirm which change (or interaction) puts the option out of the viewport.
- Fix the cause. If a real user would also be unable to reach the option (listbox rendered/positioned off-screen or not scrollable), fix the product component; if only the test's viewport/scroll interaction is wrong, fix the test without loosening what it proves.
- Root-cause hel1351's post-midnight failure: verify the date dependence with a faked clock on both sides of 00:00 UTC, explain it, and fix the cause (product tooltip formatting or a genuinely wrong regex, justified).
- Classify the PanelCard.test.tsx 3-vs-2 re-render observation (relation to this vs HEL-1215 known flake).

## Capabilities

### New Capabilities

### Modified Capabilities

None anticipated at planning time. If the root cause of either failure turns out to be a user-visible product defect (e.g. an unreachable dropdown option, a date-dependent tooltip), the executor adds a spec delta for the affected existing capability and removes `skip_specs`.

## Impact

- `e2e/hel1350-chart-compare-picker.spec.ts`, `e2e/hel1351-aggregated-chart-overlay.spec.ts`
- Possibly `frontend/src/features/pipelines/ui/outputEditor/*` (OutputEditorSheet, compare picker / ui-select listbox) and the chart overlay tooltip formatter under `frontend/src/features/panels/`.
- No backend, schema, or migration changes expected.
