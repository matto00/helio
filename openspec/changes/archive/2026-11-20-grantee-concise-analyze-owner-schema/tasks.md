## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file, never run env-dumping commands; never copy a tree containing one.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that fit; no background run past the tool timeout.
- [C12] Red first with mutations; run full spec files; commit the red run before implementation code.
- [C13] Scratch in .concertino/scratch/HEL-1799/; follow-up evidence in .concertino/runs/HEL-1799/evidence/.
- [C14] Lane DB only: DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1799 DB_USER=matt for any DB-touching run.

## 1. Red

- [x] 1.1 Add `Hel1799GranteeConciseAnalyzeSpec` (design.md Test plan 1-7) on the `helio_app_test` harness.
- [x] 1.2 Run it on unchanged main code; record the output (DEFECT cases red, PIN cases green) to
  `.concertino/runs/HEL-1799/evidence/red-run.txt`, and commit the spec plus record before any `src/main` edit.

## 2. Fix

- [x] 2.1 Extract `ownerRootSchemas` and `nonOwnerValidity` in `PipelineAnalyzeReads`; `analyze` uses them with no
  behaviour change.
- [x] 2.2 `analyzeConcise` reads owner root schemas and takes each node's `validationError` from `nonOwnerValidity`;
  `path`, `op`, `warnings` unchanged.

## 3. Verify

- [x] 3.1 New spec green; `Hel1661GranteeAnalyzeVerdictSpec`, `PipelineAnalyzeConciseByteBudgetSpec`,
  `PipelineAnalyzeSchemaWarningsSpec`, `PipelineAnalyzeRoutesSpec`, `UpsertTargetWritableRoutesSpec` green unmodified.
- [x] 3.2 Mutations m1-m4 (design.md; m3 is killed by test 6a) each turn a named test red; record to
  `.concertino/runs/HEL-1799/evidence/mutations.txt`.
- [x] 3.3 Full `sbt testFull` (sharded to fit the timeout), lint/format via the commit hook.
