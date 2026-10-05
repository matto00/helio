## Why

`e2e/hel1260-orphan-owner-repair.spec.ts` fails about half the time (10/20 locally, three CI sightings). A probe
(`probe-root-cause.md`) confirmed this is a test-isolation defect, not a product race. After `registerAndLogin` the page stays
live on `/`, and the API seeding races the app's own mount fetches. When `/` observes the orphaned board, the owner-open repair
fires there, before the spec attaches its request listener, so the explicit open sends no POST. The product repairs exactly
once, as HEL-1233 design D4 intends.

## What Changes

- In both tests of `e2e/hel1260-orphan-owner-repair.spec.ts`, idle the page (`about:blank`) after login and before seeding,
  so no app code runs while the API seeds.
- Attach the repair/PATCH request listener before login, so the whole page lifetime is counted. "Exactly one repair POST"
  then holds over the entire test, not just after the goto.
- Keep every existing assertion unchanged in strength: exactly one repair POST, its body carrying all four breakpoints, every
  breakpoint stored, a reload-stable position, no layout PATCH, no "Unsaved changes".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Product behaviour is unchanged (`skip_specs: true`).

## Non-goals

- No product change. The auto-select-and-repair on `/` is intended (HEL-1233 D4, trigger lives in `PanelGrid`).
- No quarantine and no loosened assertion. No `playwright.config.ts` or `ci.yml` edit (HEL-1288 owns them).
- `hel958-join-step-editor` (HEL-1294). Other specs with the same `registerAndLogin`-then-seed shape (noted as a follow-up).

## Impact

- `e2e/hel1260-orphan-owner-repair.spec.ts` only.
