## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); the only exception is scripts/concertino/.concertino.env which scripts may read but never print. Do not copy .env files or any tree containing one (cp -a, rsync, hardlinks).
- [C2] Quoted heredocs only (<<'EOF'), even when the body looks harmless.
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; delete test residue with buildUserDeleteSql by exact id; plain emails.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit the timeout if needed, never a background run past the tool timeout.
- [C6] Red first with mutations; run full spec files; record and COMMIT the red run before writing implementation code.
- [C7] Scratch in .concertino/scratch/HEL-1661/; anything a follow-up must reference goes to .concertino/runs/HEL-1661/evidence/.
- [C8] Lane-private DB helio_hel1661 (createdb); DATABASE_URL for start-servers.sh AND Playwright; DB_USER when the URL has no credentials. Backend started with ANTHROPIC_API_KEY exported empty. No live model call.
- [C9] No migration. Server change limited to PipelineAnalyzeReads (D1 resolveRoot, D2 owner-view validity, D3 non-owner detail); no change to PipelineService.scala (siblings HEL-1720/HEL-1722), RunConfigGate, the auto-run trigger or PipelineCostInputGathering's signature.
- [C10] Nothing of a source may newly reach a grantee: sourceSchemas, step schemas and warnings stay caller-view; owner-view schemas are used only inside server-side validation; prove on NOBYPASSRLS helio_app_test, including stranger 404 and analyze/auto-run-trigger agreement for an editor. If accuracy would require sending more schema to a grantee, STOP and raise ESCALATION.
- [C11] No prod, release, concertino sync, or MCP deploy. Grep e2e/ for any selector changed; match known flakes by test title.
- [C12] Owner ruling Q1: grantee step validity comes from the owner's root schema (design D2); non-owner validationError text is the config-only message or one neutral sentence.
- [C13] Owner ruling Q2: hide every run entry from a viewer (header, phone pills, Output sheet Run pipeline, save-toast Run now); keep Discard; show "View only". No other read-only gating (follow-up ticket).
- [C14] Owner ruling Q3: non-owner estimator reason detail is a fixed neutral sentence per code; owners unchanged; wire shape unchanged.

## 1. Red tests (commit before implementation)

- [x] 1.1 Create lane DB `helio_hel1661`, start lane servers on ports 7093/10000 with ANTHROPIC_API_KEY exported empty; write `e2e/hel1661-viewer-run-controls.spec.ts` and `e2e/hel1661-grantee-source-banner.spec.ts` (design D6); run both full files on unchanged code and record red output in `.concertino/scratch/HEL-1661/red-e2e.txt`.
- [x] 1.2 Write the NOBYPASSRLS ScalaTest spec (design D6, pipelines a-e, owner/editor/viewer/stranger, trigger agreement, never-run estimatedRows, literal caller-view expected values); run it and record red in `.concertino/scratch/HEL-1661/red-scala.txt`.
- [x] 1.3 Write the jest tests (design D6 jest list); record red in `.concertino/scratch/HEL-1661/red-jest.txt`.
- [x] 1.4 Copy the red transcripts to `.concertino/runs/HEL-1661/evidence/` and commit tests + transcripts before any implementation; verify with `git log -1 --stat`.

## 2. Server

- [x] 2.1 D1: cost-input `resolveRoot = findByIdInternal`; verify the estimator assertions of 1.2 pass.
- [x] 2.2 D2: owner-view validation pass for non-owners and the non-owner validationError text rule; verify the validity and message assertions of 1.2 pass and the grantee caller-view fields equal the literal expected values.
- [x] 2.3 D3: neutral per-code detail for non-owners; verify the detail assertions pass and owner detail is unchanged.
- [x] 2.4 Run the affected backend suites (analyze, cost, auto-run trigger, HEL-1516/HEL-1648/HEL-1503 grantee specs, `AnalyzeSchemaSharedDefsSpec`) with sbt -J-Xmx3g in shards within the timeout; verify green.

## 3. Client

- [x] 3.1 D4: `usePipelineRunRole` from `isOwner` + `selectPipelineCallerRole`, with the deep-link first-paint check; verify its jest cases pass.
- [x] 3.2 D4: audit every run entry into `.concertino/scratch/HEL-1661/run-entry-audit.md`; gate header, phone pills, Output sheet card, save toast; handler early returns; run-history viewer copy; verify jest green.
- [x] 3.3 D5: "View only" indicator on desktop and phone; verify on the running app in light and dark: no shift for owner/editor, and for a viewer at most one shift on resolve with before/after screenshots in scratch; phone tab body padding-bottom equals the no-bar value for a viewer without a draft; screenshots in scratch.
- [x] 3.4 Run both hel1661 e2e specs full-file green; run the D6 mutations and record each red in scratch.

## 4. Gates

- [x] 4.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, frontend jest for `features/pipelines`, `features/sources` and `app/dashboardMeta` (3 workers), and the existing e2e specs that reference "Run pipeline", "Dry run", "mobile-pill" or the run-history empty copy (grep `e2e/`); verify green.
- [x] 4.2 Write `files-modified.md` and commit.
