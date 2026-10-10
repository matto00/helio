## Why

HEL-1362 review left three nits in the CI sbt hang diagnostics (HEL-1425): the no-pattern-kill guard can be bypassed
by a blank line after a trailing pipe, the sbt-diagnostics selftest is over the ~250-line file budget, and the
"about 30 s to spare" timing comment in ci.yml ignores the steps after "Compile and test" and uses stale numbers.

## What Changes

- The static guard joins a trailing `|`, `||` or `&&` across blank / whitespace-only lines (as bash does), so
  `ps -ef |` + blank line + `grep sbt` is flagged. A trailing `\` followed by a blank line still ends the logical line.
  New selftest cases, red-first.
- `scripts/ci-sbt.selftest.mjs` becomes a thin runner over per-scenario modules in `scripts/ci-sbt-selftest/`
  (shared harness + five scenario files). Same checks, names and order; `npm run selftest:ci-sbt` is unchanged.
- The ci.yml margin comment is rewritten with freshly measured pre- and post-step timings (run ids cited).

## Capabilities

### New Capabilities

### Modified Capabilities
- `ci-sbt-invocation`: the "Static guard" scenario also covers a pipeline split by blank lines after an operator.

## Impact

`scripts/check-ci-sbt-no-pattern-kill.mjs` (+ selftest), `scripts/ci-sbt.selftest.mjs` -> `scripts/ci-sbt-selftest/*`,
`.github/workflows/ci.yml` (comment only). No product code, no workflow behaviour change.

## Non-goals

- Changing any CI timeout, deadline, step order or job.
- Changing what the guard's rules match on a single logical line.
- Changing any selftest assertion.
