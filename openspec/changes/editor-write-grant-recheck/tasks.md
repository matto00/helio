## Standing Constraints

- [C1] Pipeline side only (Q1=A): Output create, Output backfill (X1), Output PATCH (X2), manual/pin insight refresh. Dashboard-editor writes are HEL-1889; do not touch panels/dashboards/form-submit code.
- [C2] X2 rule: creator AND current pipeline owner-or-editor, else 404 "Output not found", nothing written; probe first (1.1); if the probe contradicts design.md Context, STOP and report.
- [C3] Insight: re-check at render start only, before any attempt row, quota charge or model call; refused = no row, no charge, no send; automatic triggers unchanged.
- [C4] A refusal writes nothing and answers the route's existing status/body; no new status, lock, FOR SHARE or migration.

## Run constraints (driver; restate to every sub-agent)

Never read/print any .env file (incl. scripts/concertino/.concertino.env) or run env-dumping commands; quoted heredocs only; no pkill/pgrep/killall, exact PIDs, stop-servers.sh; jest 3 / Playwright 2 workers, sbt -J-Xmx3g, nice -n 19; Bash timeout 600000, sbt testFull in shards that finish under it; red first with mutations, red run committed as .txt before implementation; scratch only in the main checkout's .concertino/scratch/HEL-1882/ (TMPDIR for hook runs: /tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1882); lane DB jdbc:postgresql://localhost:5432/helio_hel1882 exported as DATABASE_URL in the SAME command as any server/test/hook run; ANTHROPIC_API_KEY empty; no prod, release, concertino sync or MCP deploy; avoid HEL-1877 (RestApiConnectorDriver/RemoteErrorText) and HEL-1587 (PublicPanelListResolver/PublicDashboardRoutes) files.

### Tests (seam and red first; test-only/neutral commits)

- [x] 0.1 Extract RaceLocks from PipelineGrantRecheckRaceSpec to testsupport; verify PipelineGrantRecheckRaceSpec still green.
- [x] 0.2 Seam commit (behaviour-neutral, before the red run): constructor-injected InsightRenderService render observer defaulting to a no-op, called with (outputId, RenderResult) when a render's done future completes; drop InsightAccess `final` only if the AccessChecker-wrapper seam does not work; verify existing insight specs green.
- [x] 1.1 X2 probe on the NOBYPASSRLS fixture, before any change touching PATCH: creator downgraded to viewer PATCHes (expect 200 today), revoked creator PATCHes (expect 404 today), and a revoke committed between findById and updateOwned (expect 404 today, RLS refuses inside the update); save output to .concertino/runs/HEL-1882/evidence/x2-probe.txt; verify: file records both outcomes; STOP and report if any of the three differs.
- [x] 1.2 D1 race spec (RaceLocks): Output create with grant revoked (404 unknown-pipeline body) and downgraded (403 "Forbidden") between check and insert; asserts no Output row; verify red on main because the Output was created.
- [x] 1.3 D2 race spec: backfill with grant revoked/downgraded (a) after findByIdShared returns, before the new start check, and (b) during evaluation before the snapshot write; asserts no node_snapshots rows and empty Output schema, and for (a) also ZERO overwriteRows calls on a spy repository; verify red on main because rows were written. Revoke before findByIdShared is a GUARD (3.1).
- [x] 1.4 D3 spec (NOBYPASSRLS only): downgraded-creator PATCH (name and empty body) -> 404 and unchanged; race downgrade between findById and updateOwned -> 404, unchanged; verify red on main (200 / changed). Race REVOKE is a GUARD (3.1), never a red.
- [x] 1.5 D4 race spec (beta pipeline owner, fake transport; awaits the injected render observer, red = Wrote(reachedModel=true), green = Refused): manual refresh admitted, grant revoked/downgraded before render start; asserts zero sends, no output_insights row, owner usage unchanged; verify red on main (a send and a row).
- [x] 1.6 Commit the red run (all of 1.2-1.5) as red-run.txt in the change dir before implementation; verify: commit exists before any production check or refusal-mapping change (only the 0.1 extraction, the 0.2 seam commit and test code precede it).

### Backend

- [x] 2.1 D1: required actor on OutputRepository.insertInternal, requireAction after lockPipelines(OutputCreate); recover in OutputService.create; restoreBoundOutputs passes user; verify 1.2 green.
- [x] 2.2 D2: access check at backfill evaluation start and guard on overwriteRows; verify 1.3 green.
- [x] 2.3 D3: requireAction inside updateOwned's transaction (both branches); refusal -> NotFound "Output not found" in OutputService.update; verify 1.4 green.
- [x] 2.4 D4: requester threaded into startRender/renderGuarded; check at render start; RenderResult.Refused; verify 1.5 green.

### Tests (guards and verification)

- [x] 3.1 GUARD: owner and current editor create, backfill, PATCH and refresh as before; non-creator editor PATCH still 404; D3 race revoke -> 404; D2 revoke before findByIdShared writes nothing; automatic (run/tick) renders unaffected; each with a recorded failing mutation.
- [x] 3.2 Mutation per fix (remove each re-check / map refusal to permitted; for D2 separately: remove the start check -> 1.3(a) red, guard = None -> 1.3(b) red) turns its red test red again; outputs saved under .concertino/scratch/HEL-1882/ and copied to .concertino/runs/HEL-1882/evidence/.
- [x] 3.3 Record what patch-set undo of a step delete (D1), patch-set forward apply and rollback of an Output update (D3) report when refused; verify none is a 500.
- [x] 3.4 Run full spec files for every touched spec plus existing Output route, OutputService, backfill, insight render/refresh, patch-set apply/undo, PipelineGrantRecheckRaceSpec, DraftSaveRlsSpec and ExistenceNotLeakedRoutesSpec, in shards under the timeout.
- [x] 3.5 files-modified.md lists every changed file and every production call site of insertInternal, updateOwned and startRender.
