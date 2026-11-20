# HEL-1790: e2e flake: hel1675-shared-hover "a mouse hover paints the recorded values (light)" — Select trigger reads rest paint on hover

## Description

The e2e test `e2e/hel1675-shared-hover.spec.ts:358`, "HEL-1675 desktop: hover unchanged › a mouse hover paints the
recorded values (light)", has started failing in CI. The error is `3 Select trigger must differ from rest on hover`:
after `control.hover()`, the Select trigger's paint still equals its rest paint. The dark case passes in the same runs.

Where it failed: main CI at beb94adfe (run 44667845106, job `e2e (2)`, job id 136061418813); PR #1188 (HEL-1777, no CSS
change) against the merge ref with main at 94a8ef292, twice (jobs 136051891236, 136059703604).

Where it passed: main CI at 94a8ef292 (run 44660016746, e2e (2) job 136035670876) and at cfb6041bf (run 44655001204).
So it is not a deterministic single-commit regression; it is a timing or ordering flake that now fires often, and main
is red until it is fixed.

Expected: find the root cause first, with a probe that confirms it. Then fix the test or the product, whichever is
wrong. No retries, no `test.fixme`/skip, no longer timeouts unless the probe proves timing is the cause. Use the
HEL-1778 weighted shards (`scripts/e2e-shard.mjs`) to reproduce the CI shard order.

## Acceptance Criteria

- A named, probe-confirmed root cause.
- The test is stable: repeated local runs (e.g. `--repeat-each`), run with the same shard neighbours as CI, all pass.
  Report the count.
- No weaker assertion: the hover must still be proven to differ from rest, and to match the recorded `DESKTOP_HOVER`
  values.
- CI on main is green.

## Driver Notes (claims to verify, not facts)

- Leads: the describe blocks toggle a module-level `touchMode` in `beforeAll`/`afterAll`; instance 3 (Select trigger)
  depends on hover alone after blur; focus- or animation-timing.
- If the root cause is product CSS, fix it there with a red-first test; if that widens into HEL-1735's scope (hover
  gating across feature stylesheets), escalate instead of deciding.
- CI logs already captured: `.concertino/scratch/HEL-1777/` (main checkout) — `e2e2-fail.log`, `e2e2-rerun.log`,
  `main-e2e2.log` (failing), and `.concertino/scratch/HEL-1790/pass-main-94a8.log` (passing).
