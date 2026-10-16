## Why

HEL-1606 showed the app's web fonts swap in 100-250ms after first paint (non-blocking Google Fonts stylesheet,
`media="print"` -> `all` on load) and re-flow layout by 2-34px, and added `e2e/support/webFonts.ts`
`waitForWebFonts(target)` for the row double-click specs only. During HEL-1606's full-suite runs `hel1510` (a card
overflowed by 0.1px) and `hel813` (Connectors at 768px) each failed once and passed 75/75 in isolation. CI runs with
`retries: 0`, so any spec that measures layout during the swap is a latent flake.

## What Changes

- Probe (forced font delay, HEL-1606 method) whether the font swap explains the `hel1510` and `hel813` failures.
- A recorded grep sweep of every e2e spec that asserts pixel geometry or overflow, each classified.
- `waitForWebFonts` generalised (backward-compatible for the row case) so it can scope to a non-row target, and
  adopted in every spec where the font swap can affect an asserted measurement; each conversion proven red under a
  forced font delay and green after.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-harness only; no product behaviour change (`skip_specs: true`).

## Impact

- `e2e/support/webFonts.ts`, possibly `e2e/support/touchTargetProbe.ts`, and the converted `e2e/*.spec.ts` files.
- No frontend/backend product code, no Playwright config, no CI change.

## Non-goals

- Product font loading changes (preload, metric-matched fallbacks).
- Retries, raised test/expect timeouts, skip/fixme as a fix.
- Converting specs whose measurement the forced delay cannot affect (they are recorded in the sweep, not changed).
