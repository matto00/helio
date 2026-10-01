- `concertino.config.json` — backend-test gate: `sbt test` -> `sbt testFull`
- `.claude/agents/concertino-executor.md` — rendered by `concertino sync` (gate string only)
- `.claude/agents/concertino-evaluator.md` — rendered by `concertino sync` (gate string only)
- `CLAUDE.md` — Commands block `sbt test` -> `sbt testFull` with one-line why
- `.cursor/skills/linear-ticket-delivery/SKILL.md` — hand-written backend gate `sbt test` -> `sbt testFull`
- `CONTRIBUTING.md` — lines 241/244/247/250 -> `testFull`, plus a why line

## Per-hit decisions (repo-wide `sbt test` grep)
- Changed: CLAUDE.md:32, CONTRIBUTING.md:241,244,247,250.
- Left (intentional): MISTAKES.md:246-248 (describes the trap); backend source/migration/test comments (historical); openspec/specs/* WHEN clauses; docs/superpowers historical spec; openspec/changes/sbt-testfull-gates/*.
- Changed: `.cursor/skills/linear-ticket-delivery/SKILL.md:129` -> `sbt testFull`. Verified hand-written (no render header, not a concertino emit target, unchanged by sync), so C2 does not apply. `grep -rn sbt .cursor .claude/commands .claude/skills` shows no other hits.
- docs/cloud-dev-setup.md: no `sbt test` hit (only `sbt run`). Observation: installs sbt 1.10.7 (stale vs 2.0.9), possible follow-up.
- Rendered-churn note: sync's 2 "new" files (report-cost.sh, pricing-table.json) are gitignored (.gitignore:90-91); verified, not in git status.

## Evidence
- Red (base): `sbt test` x2 -> "Passed: Total 0 ... No tests to run for Test / testQuick ... cache 100%", exit 0 both.
- Green: `sbt testFull` run 1: "Tests: succeeded 5108, failed 0", exit 0 (340s). Run 2 (repeat): succeeded 5107, failed 1 (ApiRoutesPipelineRunGuardSpec "rejects the (limit+1)th test with 429": "Request was neither completed nor rejected within 1 second", a 1s RouteTest timeout flake under load; spec passes in isolation 4/4). Run 3 (repeat): "Tests: succeeded 5108, failed 0", exit 0 (342s).
