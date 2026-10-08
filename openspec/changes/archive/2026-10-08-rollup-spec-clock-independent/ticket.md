# HEL-1247: ProductEventRollupServiceSpec is date-dependent (hard-coded 2026-10-03, shared users-row count)

## Description

Observed during HEL-1216 delivery: one full `sbt testFull` run (evaluator, ~03:10 UTC on 2026-10-03) failed `ProductEventRollupServiceSpec` (HEL-1244 / V114) with `403 was not equal to 402` at line 85. The spec hard-codes the date 2026-10-03 and counts rows in the shared `users` table, so it is sensitive to wall-clock date and to residue from other specs. The skeptic's run of the same head passed. Make the spec clock-independent and scope its count to its own fixture users.

Unverified diagnosis (evaluator's read): clock or shared-row-count flake. Reproduce before fixing.

origin_kind: followup
origin_ticket: HEL-1216

## Premise validation (2026-10-08, orchestrator)

Evidence: `.concertino/runs/HEL-1247/evidence/premise-validation.md` (main checkout). Verdict `minor-staleness`.

- The observed `403 was not equal to 402` sighting was NOT a clock/row-count flake: it was the random-UUID `bf` prefix colliding with the backfill email selector, diagnosed and fixed by HEL-1360 (#821, 33dcf8fd2). That ticket cites this exact 03:10 UTC sighting. Not re-fixed here.
- "Residue from other specs" is not possible: `ProductTelemetryDbHarness` runs a per-suite EmbeddedPostgres.
- The unmodified spec passes today (2026-10-08, five days past the literal) and under `TZ=Pacific/Kiritimati`: every fixture user's `created_at` is pinned by `UPDATE users SET created_at = 2026-09-23`, every `tickAt` instant is a literal, and the service/repository read no wall clock.
- BUT the date dependence is real and latent. The V114 tests' expected signup count is `400 + otherUsers`, where `otherUsers` counts every non-`@backfill.invalid` row in `users` (whole table, not the spec's own fixture users), while the rollup assertions only cover days up to the hard-coded `BackfillNow` (2026-10-03). Any `users` row whose `created_at` comes from `now()` after the pin (e.g. a `newUser()` call inside `withHistoricalUsers`'s body) is counted by `otherUsers` and backfilled by V114 on the wall-clock day, which lies after 2026-10-03, so the rollup never sees it. Probe (3 `newUser()` rows at the top of the "roll up in ONE tick" body, run 2026-10-08): `404 was not equal to 407 (ProductEventRollupServiceSpec.scala:113)`. The same probe would pass with a wall clock on or before 2026-10-03.

## Acceptance Criteria (restated scope; the observed flake itself is already fixed by HEL-1360)

- The V114 tests' expected counts are scoped to the spec's own fixture users (identified by exact id or the reserved fixture domain), not to every row of `users`, and no user created at wall-clock `now()` can enter or skew them.
- No assertion in the spec depends on the wall-clock date: the spec stays green whatever the current date (before, on, or after 2026-10-03) and timezone, including with an extra unpinned `users` row present.
- Red first: the probe above (extra wall-clock-dated `users` row(s) inside the body, wall clock after 2026-10-03) fails on the unmodified spec and passes after the fix; the transcript is kept in the change directory. If practical, a permanent guard in the spec makes this case run on every execution (failable by mutation), mirroring HEL-1360's decoy.
- No assertion tolerance is loosened; equalities stay exact. No production code, migration, or V114 change.
