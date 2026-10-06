# E2E

Playwright end-to-end specs, one file per scenario. Most are named after the
ticket that added them (e.g. `hel909-output-picker-panel-sheet.spec.ts`),
but not all — `auth-cookie-migration.spec.ts` is named for the scenario
instead. Consistent naming is not enforced.

**Belongs here:** browser-driven, full-stack test scenarios.
**Does not belong here:** unit/component tests. Frontend unit/component
tests are `*.test.ts(x)` files co-located with the source they test (e.g.
`frontend/src/app/App.test.tsx`). Backend unit tests are ScalaTest suites in
a separate, mirrored tree at `backend/src/test/scala/` (e.g.
`backend/src/test/scala/com/helio/infrastructure/ai/ClaudeClientSpec.scala`) — not
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
excluded from both a bare `npm run e2e` and CI by three independent
layers — `playwright.config.ts`'s `testIgnore: ["**/*.regression.spec.ts"]`,
the file's own `test.skip(!process.env.HEL813_REGRESSION, ...)` guard, and
`playwright.regression.config.ts` (the only config that clears that
`testIgnore`, see below) — so any single layer alone is enough to keep it
inert by default. HEL-951 confirmed this three-layer exclusion is
deliberate (it mutates real, tracked component source on disk) and kept it
intact when broadening CI's e2e coverage to a glob.

**HEL-951 note on Case B's anchor.** Case B originally mutated
`.panel-list__add`; that control was removed when the panel-list header bar
was retired ("Add panel" moved to the command bar's
`.actions-menu__trigger`, an expander-mechanism control that cannot exhibit
this failure mode — see design.md D5's P1). HEL-951 searched the finite set
of controls the steady-state guard actually measures at 430px via
`assertFloor`/`sweepSurface`, confirmed by RUNTIME measurement (not string
search) against all four D5 preconditions, and found one surviving
replacement: `.mobile-nav-sheet__item` (`MobileNavSheet.css`) — a full-width
sheet row whose mobile-only `min-height: 44px` floor is declared on its own
rule, with no width floor (width is driven entirely by the sheet's own
width). See
`openspec/changes/wire-orphaned-e2e-specs/caseb-search-and-mutation-proof.md`
for the full search and the per-assertion mutation proof.

**HEL-951 note on Case A's marker.** Case A's base-rule anchor used to key
on the `/* Close button */` comment immediately above `.toast__close {` in
`toast.css`; an unrelated later comment sweep (HEL-851) deleted that
comment, which silently broke the marker (it just stopped matching — no
loud failure). The anchor is now keyed on the RULE itself
(`"\n.toast__close {"`, disambiguated from the mobile media block's own
indented copy by the leading newline plus zero indentation), with a runtime
uniqueness assertion that throws a clear "source drifted" error if that
count is ever not exactly 1 — so the next comment sweep (or any other
drift) fails loudly instead of silently mutating the wrong rule. See
`openspec/changes/wire-orphaned-e2e-specs/casea-marker-repair-and-mutation-proof.md`.

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

## CI runtime: sharding and parallel-mode files (HEL-1288)

The CI `e2e` job runs `npx playwright test --shard=<i>/<N>` on a matrix of runners (`strategy.job-total` is N,
so the matrix is the single source). `--shard` partitions the set Playwright itself collects from this config
(glob + `testIgnore`, HEL-951) — it is not a hand-picked file list. Each shard has its own Postgres, backend and
Vite, so shards share no state; `ci-complete` still gates on every leg (a matrix job's result is `failure` if any
leg fails). `workers` is pinned to 2 on CI (the matrix is capped at 4 legs), and CI additionally writes `test-results/results.json` (uploaded per
shard as `playwright-json-shard-<i>`); `node scripts/e2e-profile.mjs json|list|steps ...` ranks specs/steps from
those CI artefacts. A bare local run is unchanged.

Sharding splits by **test count, in group order**, and a default-mode file is ONE group, so a file only spreads
across workers/shards if its tests are independent. Files that are, declare
`test.describe.configure({ mode: "parallel" })` — scoped to that file, never `fullyParallel: true` globally. The
rule for adding it: every test registers its own user and seeds its own data, and the file has **no
`beforeAll`/`afterAll`** (Playwright re-chunks a parallel file with those hooks back into per-worker groups). The two
contrast/focus guards (`state-surface-contrast-guard`, `focus-presence-guard`) are one test per theme x view cell for
the same reason; the per-view `[HEL-866 guard] view ...` / `[HEL-520 focus-presence guard] view ...` log lines are the
population contract (compare them to a green main run when touching a guard).
