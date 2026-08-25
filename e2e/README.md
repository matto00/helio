# E2E

Playwright end-to-end specs, one file per scenario. Most are named after the
ticket that added them (e.g. `hel716-panel-creation-focus-trap.spec.ts`),
but not all — `auth-cookie-migration.spec.ts` is named for the scenario
instead. Consistent naming is not enforced.

**Belongs here:** browser-driven, full-stack test scenarios.
**Does not belong here:** unit/component tests. Frontend unit/component
tests are `*.test.ts(x)` files co-located with the source they test (e.g.
`frontend/src/app/App.test.tsx`). Backend unit tests are ScalaTest suites in
a separate, mirrored tree at `backend/src/test/scala/` (e.g.
`backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala`) — not
co-located, and not `.test.ts(x)` files.

## HEL-813 mobile touch-target floor guard

`hel813-mobile-touch-target-floor.spec.ts` measures RENDERED geometry
(`getBoundingClientRect()`, never `getComputedStyle`/CSS source text) for
the DESIGN.md 44px mobile tap-target floor, at 430px and 768px, across six
named surfaces (see the file's own comments and `openspec/changes/
mobile-touch-target-guard/design.md` D3). It's the one HEL-813 spec that
runs in CI (`.github/workflows/ci.yml`'s `e2e` job) and as part of a bare
`npm run e2e`. Shared measurement logic lives in `e2e/support/
touchTargetProbe.ts`.

`hel813-mobile-touch-target-floor.regression.spec.ts` is a separate,
**one-shot, NOT-CI-gated** harness that proves the guard is actually
sensitive to the two known-bad shapes that motivated this ticket (HEL-535's
above-base-rule `@media` inert floor, and a height-only floor on a
fixed-width control): it temporarily patches real component source into
each bad shape, re-measures with the SAME shared helper, asserts the guard
goes red, then reverts the file and confirms it goes green again. It is
excluded from both a bare `npm run e2e` and CI by two independent layers —
`playwright.config.ts`'s `testIgnore: ["**/*.regression.spec.ts"]`, and the
file's own `test.skip(!process.env.HEL813_REGRESSION, ...)` guard — so
either one alone is enough to keep it inert by default.

To re-run it on demand (e.g. after touching `touchTargetProbe.ts` or either
mutated file), from the repo root with dev servers up:

```bash
HEL813_REGRESSION=1 npx playwright test --config=playwright.regression.config.ts \
  e2e/hel813-mobile-touch-target-floor.regression.spec.ts
```

`playwright.regression.config.ts` is a thin override that clears
`testIgnore` for this one invocation only — `playwright.config.ts`'s
`testIgnore` excludes matching files from Playwright's test discovery
entirely (including explicit file arguments, not just glob auto-discovery),
so the harness cannot be reached through the default config at all. Nothing
else references `playwright.regression.config.ts`.

Always confirm `git status --short` is clean after a run — each case wraps
its mutation in `try/finally` so the revert runs even if an assertion
fails mid-case, but this is the final belt-and-suspenders check.
