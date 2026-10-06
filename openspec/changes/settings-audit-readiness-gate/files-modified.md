- `e2e/support/settingsReady.ts` — new `waitForSettingsAuditTable(page)` helper (Audit history section's table + first sort button, default timeout, no literal)
- `e2e/hel813-mobile-touch-target-floor.spec.ts` — import + helper call after each `page.goto("/settings")` (surfaces 2 and 3); no assertion/timeout change
- `openspec/changes/settings-audit-readiness-gate/*` — change artifacts, tasks ticked

## Evidence (persisted; ref= paths)
- inventory grep: ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-inventory.txt (confirms design table; no additional hits)
- probe source: ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe.spec.ts, ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-mutant-helper.ts, ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe-playwright.config.ts, ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe-run.sh
- natural RED (20 iter, assert at-heading==settled): ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe-natural-red.log — 2/20 iterations saw sort=0 at heading (population 14 vs 28 settled), 18/20 saw 5/28; helper-after count was 5/28 in all 20
- natural GREEN (10 iter, helper): ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe-natural-green-helper.log — 10 passed
- deterministic RED (1500 ms delay < 5 s): ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe-delayed-red.log — 10/10 failed, at-heading sort=0, pop 14 vs 28
- deterministic GREEN with helper: ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe-delayed-green-helper.log — 10 passed, after-helper 5/28 == settled
- MUTATION (helper waits removed): ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-probe-delayed-mutant-red.log — 10/10 failed (after-helper sort=0); real helper restored -> green (the green log above, and the repeat run)
- repeat: ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-repeat-hel813.log — `--repeat-each 10 --workers 2`, 140 passed, 0 failed, exit=0
- Finding (C1, not fixed): in the delayed runs the interactive-element population at heading/after a no-op helper varied (14, 23) vs 28 settled — other /settings sections also load late; helper intentionally not widened.
- Regression harness (hel813 .regression.spec.ts) inventoried and excluded per D3.

## Residue (shared dev DB), all deleted by exact id
- 200 throwaway users (60 probe + 140 repeat-run), ids: ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-user-ids.csv
- 40 dashboards owned by those users (no-action FK; deleted first), ids: ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-dashboard-ids.txt
- Verified after delete: 0 of the 200 ids remain; matt@helio.dev untouched (still present).

## Residue addendum (cycle 2)
- 20 `data_sources` rows ("HEL-813 Source", created by the repeat run; `owner_id` has no FK so the users delete did not cascade), deleted by exact id. Ids re-derived by `select id from data_sources where owner_id in (<the 200 recorded user ids>)` and diffed identical to the evaluator's list: ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-ds-ids-rederived.txt. Dependents checked first: FKs from `pipeline_roots` and `dataset_rows` are ON DELETE CASCADE, and a scan of every uuid column for those 20 ids found no other references.
- Post-delete sweep covered every `uuid` column of every public base table (49 columns, ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-uuidcols.txt) plus text columns named owner/user/actor/created_by/principal (3), against the 200 user ids. Only hits (ref=/home/matt/Development/helio/.concertino/runs/HEL-1336/evidence/.evidence-stage/hel1336-sweep.txt): `data_sources.owner_id` 20 (now 0) and `audit_events.actor_user_id` 480.
- Un-deletable: 480 `audit_events` rows by those actors remain (HEL-471 append-only trigger; DELETE raises). The evaluator's own spec run left a further 36 for the same reason.
- The 300 ms `waitForTimeout` in the probe's "settled" definition is probe-only and was never committed.
