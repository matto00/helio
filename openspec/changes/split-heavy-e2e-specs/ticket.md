# HEL-1778: CI e2e: heavy, variable specs still push the slowest leg past 1200 s at 7 legs

## Description

HEL-1772 regenerated the e2e shard weights and moved the `e2e` matrix to 7 legs. The slowest leg still went over 1200 s on 3 of 5 counting CI attempts (1236, 1441, 1399 s; limit 1500 s). Leg 3 was the slowest in 3 of the 5.

Within a leg the two Playwright workers finish close together, so a leg's wall time follows its summed test time. What still pushes one leg over is run-to-run swings in a few heavy specs, plus one stale weight row:

- `hel1665-home-phone-stability`: 672-952 s summed across attempts (table 674).
- `hel1733-draft-outputs-shapes`: 324-579 s (table 358).
- `hel1583-glass-nav`: 190-303 s (table 160). Its test at line 554 is also a known flake.
- `hel1608-spine-count-overlap`: 84-123 s against a table row of 8 s. HEL-1671 grew this spec after the weights were taken, so its row is stale rather than the spec being variable.

**Expected:** the slowest e2e leg stays at or under 1200 s on normal runs without raising `timeout-minutes`.

## Acceptance Criteria

- Find out why each of the three heavy specs varies by 30-60 % between runs, and either cut its cost or split it into files that can be balanced separately.
- Regenerate `e2e/shard-weights.tsv` from 7-leg main runs, which also fixes the `hel1608` row.
- Show the slowest and mean leg on at least 5 counting CI runs, with headroom under 1500 s.

## Agent notes (from the ticket)

- Measurements: PR matto00/helio#1172, run 44428229791 attempts 1-6 (7 legs), run 44410691147 attempts 1-3 (6 legs). The ticket says the scripts and reports are in `.concertino/scratch/HEL-1772/` in the main checkout. Premise check (2026-11-19): that directory no longer exists (swept after merge); the archived change `openspec/changes/archive/2026-11-18-rebalance-e2e-shard-weights/` holds the design and reports. Measurement scripts are re-derived in `.concertino/scratch/HEL-1778/`.
- In attempts 4 and 5, leg 3's two workers finished about 190 s apart: a heavy file started late. Splitting the heavy specs would also help here.
- Weight regeneration from 6-leg runs needs `node scripts/e2e-shard.mjs weights --legs 6`. Runs after HEL-1772 have 7 legs, the default.

## Driver constraints for this run

- Measure from real GitHub job timings of 7-leg runs, never local timings. Name each heavy spec's variance cause before cutting or splitting it.
- Specs merged since HEL-1772 with no or stale rows: hel1743-insight-refresh, hel1773-viewer-grantee-dashboard, hel1780-shared-dashboard-panel-features, hel1786-shared-dashboard-freshness (and hel1781/hel1784 if merged by then); hel1608 stale.
- Changes touch `.github/workflows/ci.yml`, the Playwright config, `e2e/**` and `scripts/e2e-shard*.mjs` only; never CD or release workflows.
- Splitting a spec keeps every test and every assertion (no test deleted or weakened), proven by a before/after test-title list.
- Do not edit the in-flight sibling lanes' specs (HEL-1784, HEL-1781 `e2e/hel1781-ask-shared-dashboard.spec.ts`).
- The e2e-setup apt mirror timeouts are out of scope unless shown to change leg wall time; describe, do not fix.
