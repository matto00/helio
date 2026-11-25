## Why

Four layout-measuring e2e waits in `hel1579-pipeline-spine-layout` and `hel1572-appearance-preferences` still use
`document.fonts.ready`, which can resolve while the page still renders in the fallback face (vacuously true before
the web-font stylesheet applies). HEL-1613's `waitForWebFonts(target)` waits for the faces the measured text uses.
The owner ruled (HEL-1622 escalation) to convert exactly these four, robustness-first: convert even where a forced
font delay cannot turn the old wait red, and record that honestly.

## What Changes

- Replace the `document.fonts.ready` wait at `e2e/hel1579-pipeline-spine-layout.spec.ts:296` and `:465` and
  `e2e/hel1572-appearance-preferences.spec.ts:672` and `:764` with `waitForWebFonts(<narrowest measured container>)`.
- Commit forced-font-delay red/green evidence per site (a red, or a run labelled "no red possible"), plus 20x
  repeat runs of both files, under this change's `evidence/`.
- No tolerance, timeout, retry or assertion changes; no product code; no other spec or helper touched.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none) - test-only robustness change, `skip_specs: true`.

## Impact

Two e2e spec files only. No app code, backend, migration, API or dependency change. The other ~41 `fonts.ready`
waits in `e2e/` are follow-up HEL-1884 and are out of scope.
