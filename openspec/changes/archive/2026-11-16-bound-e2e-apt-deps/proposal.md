## Why

The shared e2e setup (`.github/actions/e2e-setup`) runs `npx playwright install --with-deps chromium`. Its apt part
fails two ways on GitHub runners: the `.deb` download from the Azure Ubuntu mirror stalls at 20-30 kB/s for 7-14
minutes (cancelling e2e-prod-build at its 8-minute timeout and e2e legs at 25), and `apt-get update` exits 1 when the
runner image's preinstalled `packages.microsoft.com` source returns 403. Both hit all 8 e2e jobs per CI run plus
e2e-slow (see ticket.md, Premise validation).

## What Changes

- The setup action installs Playwright's chromium system dependencies itself instead of via `--with-deps`, using the
  package list Playwright itself prints (`install-deps --dry-run chromium`), so the set stays in step with Playwright.
- `apt-get update` for that install ignores the runner's third-party `packages.microsoft.com` source.
- The downloaded `.deb` archives are cached; a restored cache means the install fetches only packages whose version
  changed since the cache was saved, so the ~20 MB of fonts is not fetched from the mirror.
- Any package fetch that is still needed is time-bounded and retried once against a different Ubuntu mirror; if both
  attempts fail the step fails with a named error instead of running into the job timeout.
- The apt cache is written only from a `main` push by one job, and the cache janitor keeps only its newest entry.
- The browser download itself (`npx playwright install chromium`) is unchanged.

## Capabilities

### New Capabilities
- `e2e-browser-deps-install`: how the e2e setup installs chromium's system packages, including the cache, the
  third-party source exclusion and the bounded, retried fetch.

### Modified Capabilities
- `ci-actions-cache-budget`: the main-only writer rule and the janitor allowlist gain the e2e apt archive cache.

## Non-goals

- Raising any job `timeout-minutes` (owner call; not done).
- Changing the runner image or running the jobs in a container (owner call; not done).
- Dropping any package Playwright lists for chromium (e.g. fonts): layout-sensitive specs such as
  `e2e/hel1512-category-axis-labels.spec.ts` may depend on font metrics.
- Caching the Playwright browser download (15 s today, not implicated).
- The unrelated dependabot-run setup failures (npm ERESOLVE, sbt fork).

## Impact

- `.github/actions/e2e-setup/action.yml` (and possibly a helper script under `scripts/`).
- `scripts/cache-janitor.mjs` allowlist (and its test, if any).
- ci.yml `e2e` leg 1 already passes `save-node-modules-cache: true`; the same job saves the apt cache.
- Applies to ci.yml `e2e` (6 legs), `e2e-prod-build` and `e2e-slow.yml`. ~26 MB Actions cache entry.
