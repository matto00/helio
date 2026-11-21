## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare; no env-dumping commands (env, printenv, set, export -p, /proc/*/environ); only scripts/concertino/.concertino.env may be read by scripts, never printed; never copy .env files or trees containing them (cp -a, rsync, hardlinks).
- [C2] Quoted heredocs only (<<'EOF'), even when the body looks harmless.
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue with buildUserDeleteSql by exact id; plain emails.
- [C4] jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards small enough to finish under it; no background run past the tool timeout.
- [C6] Red first with mutations; run full spec files; record and commit the red run (as .txt) before implementation code.
- [C7] Scratch in /home/matt/Development/helio/.concertino/scratch/HEL-1811/ (main checkout); follow-up-relevant evidence in /home/matt/Development/helio/.concertino/runs/HEL-1811/evidence/.
- [C8] Lane-private DB helio_hel1811 (DATABASE_URL) for any server/e2e/jest-touching-DB run, commit hooks included; any lane backend started with ANTHROPIC_API_KEY exported empty.
- [C9] No prod, release, concertino sync or MCP deploy; no claude.ai session link in commits or PRs.
- [C10] Keep PatchSetUndoService changes minimal (HEL-1797 owns its tidy/split); extend PatchSetUndoLaterChildren / PatchSetUndoBoundPanels, no parallel mechanism.

## 1. Probe and red

- [x] 1.1 Confirm a patch set has no alert-rule or schedule target kind, whether a pipeline create can make more than one root, and which reads exist for roots with `created_at` and source id.
- [x] 1.2 Write `PatchSetUndoLaterAlertRulesSpec` on `helio_app_test` (assert `rolbypassrls = false`): alert rule on a created pipeline's Output, schedule, editor-added root, alert rule on an `output`-create Output, alert rule under a `pipelineStep` create. Each asserts the fixed behaviour (409, nothing changes); run it, record which path each case takes today (undo succeeds, rule/schedule/root gone), and commit the red run as `.txt` before any implementation code.

## 2. Implementation

- [x] 2.1 `JournaledCreatedChildren.rootIds: Option[Vector[String]] = None`; `captureCreatedChildren` fills it.
- [x] 2.2 Shared doomed-Output accessor in `PatchSetUndoBoundPanels` covering the `output` arm (design D1).
- [x] 2.3 Extract the alert-rule naming clause from `DraftRestore` into a shared function; `DraftRestore` uses it with byte-identical output.
- [x] 2.4 Extend `PatchSetUndoLaterChildren` (`Later`, `blocking`, `blockers`, guards, `addedDuringUndo`) for alert rules, schedule and roots (design D2-D4); wire the `output` arm into Phase 1.
- [x] 2.5 Phase 2: `ifStillUnbound` covers the new kinds through `Later`; `deleteIfUnboundInternal` counts alert rules in its transaction; counts-only phrases.

## 3. Coverage, mutations, surfaces

- [x] 3.1 Green: the new spec plus excusal (create-made roots), legacy `rootIds`-absent fallback, non-owned rule counted, no-id assertions, Phase-2 re-check, route-level 409 (not `PATCH_SET_STALE`).
- [x] 3.2 Mutations from design D6, each recorded red.
- [x] 3.3 Re-run the full existing undo/apply/draft-restore spec files (PatchSetUndo*, DraftRestore*, PatchSetApply*) in shards; record results.
- [x] 3.4 Re-verify REST / helio-mcp ("the whole undo is refused") / client toast wording still holds; no change expected.
