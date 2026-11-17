## Why

`e2e/hel1562-landing-page.spec.ts:81` ("a stale hint bounces once through /home to /login and clears itself") is red
on main CI after the axios 1.21.1 bump, blocking every other PR. The test seeds the stale `helio.signedIn` hint from a
page that has just booted the full app at `/login`. That app's own session check (401) clears the hint through
`registerSignedInHintListener`, and when the clear lands after the seed and before `/`'s inline head script reads the
key, the landing page renders and never bounces. The test races the product's own (correct) sign-out bookkeeping.
The same dependency on the booting page is why the ticket saw it fail when the font stylesheet was intercepted.

## What Changes

- Seed the stale hint from a page that runs no Helio app code (the static landing page at `/`, read with a
  hint-free origin), then navigate to `/`; the bounce no longer races any app boot. Make the final "hint cleared"
  read wait for the clear rather than read once.
- Throwaway forced repros (not committed) prove the old test red and the new test green under the same forced
  condition, plus a font-stylesheet-held run; the test is proven 40/40 with `--repeat-each`.
- hel813 Connectors at 768px: no code. It has not recurred on main CI since 2026-10-16 (v0.9.7..v0.9.11), so it is
  closed per the ticket's own rule.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-only change (one e2e spec); no product behavior changes, so `skip_specs: true`.

## Non-goals

- No change to `signedInHint.ts`, `frontend/index.html`, auth state, or the axios version. Clearing a stale hint on a
  401 is the intended product behavior.
- No retries, no larger timeouts.
- No other spec in `e2e/hel1562-landing-page.spec.ts` changes unless the sweep in design D4 shows the same pattern.

## Impact

`e2e/hel1562-landing-page.spec.ts` only.
