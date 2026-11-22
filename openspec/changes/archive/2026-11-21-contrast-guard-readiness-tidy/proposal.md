## Why

The HEL-866 state-surface contrast guard's 1440 px `pipeline-detail` cell stamps the page before the spine card's
"Refresh sample of <source>" button is visible and enabled (the button is absent until access resolves and disabled
while the sample loads, and the stamp skips disabled elements). Whether that button is measured is therefore a race,
which is how HEL-1628's invisible (1.03:1, dark) refresh hover got past CI. HEL-1649 added the readiness wait to the
narrow cells only. Two smaller defects were left behind: a comment naming a spec file that the split removed, and the
narrow part files choosing their widths by array position.

## What Changes

- The 1440 `pipeline-detail` cell waits for the refresh button to be visible and enabled before stamping, and asserts
  the button was actually measured (hovered and focused) in that cell, so a lost race fails loudly instead of passing.
- Mutation evidence: HEL-1628's pre-fix spine-card refresh hover (the two `.spine-card .source-sample-label
  .ui-icon-btn:hover:not(:disabled)` rule blocks removed) makes the 1440 dark cell fail naming the button; the
  unmutated tree passes. The mutation is never committed.
- The guard support file's header comment names the current narrow part files.
- `state-surface-contrast-guard-narrow-1100-768.spec.ts` and `-390.spec.ts` select their widths by width value, and
  fail loudly if a named width is missing from the matrix.
- No application code or CSS changes. No change to the set of cells (test titles) or to any exemption.

## Capabilities

### New Capabilities

### Modified Capabilities
- `state-surface-contrast-guard`: the 1440 pipeline-detail cell waits for and must measure the spine card's
  sample-refresh control.

## Impact

e2e only: `e2e/support/state-surface-contrast-guard.ts`, `e2e/support/state-surface-contrast-guard-narrow.ts` (if a
shared readiness helper is extracted or a width-lookup helper is added), the two narrow part spec files. CI: the
1440 `pipeline-detail` cells may take slightly longer (one more wait on an already-rendered page).
