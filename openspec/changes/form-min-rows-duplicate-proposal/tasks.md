## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file nor scripts/concertino/.concertino.env; no env-dumping commands; never copy a directory containing an env file; servers only via start-servers.sh.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; delete test residue by exact id.
- [C4] jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that finish under the timeout; never background past it.
- [C12] Red first with mutations; commit the red run as .txt before implementation code.
- [C13] Scratch only in /home/matt/Development/helio/.concertino/scratch/HEL-1834/ (TMPDIR for git hooks: /tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1834).
- [C14] Lane DB helio_hel1834: export DATABASE_URL (and DB_USER=$USER) in the same command as every DB-touching run, server start and commit hook.
- [C15] No live model call; ANTHROPIC_API_KEY exported empty for any backend started; proposal tests use fixtures.

## 1. Red tests (commit red run as .txt first)

- [x] 1.1 Predicate + `isSpaceBelowFree` unit tests mirroring the client cases
- [x] 1.2 `CreatePlacement.duplicateSizes` with a form min: 4-row form -> 5 every breakpoint; counter -> 4
- [x] 1.3 Panel duplicate service/integration test: 4-row multi-field form -> 5 in every breakpoint, others unchanged; compact counter -> 4
- [x] 1.4 `buildLayout` unit tests: authored form 4 free below -> 5; neighbour directly below -> 4, neighbour unchanged; counter -> 4
- [x] 1.5 Proposal apply service test (fixture proposal): form at 4 -> 5; compact counter at 4 -> 4
- [x] 1.6 PUT /contents service/route test: form at 4 -> 5; compact counter at 4 -> 4
- [x] 1.7 Record each red run and commit it as .txt evidence

## 2. Implementation

- [x] 2.1 Compact-counter predicate in the form domain (client twin noted)
- [x] 2.2 Form placement rule object (`FormMinRows`, `minRowsFor`, `isSpaceBelowFree`)
- [x] 2.3 `duplicateSizes(minH)` + thread through `PanelLifecycleWrites.duplicatePlaced` and `PanelMutationRepository.duplicate`
- [x] 2.4 `buildLayout(minRows)` lift-when-free; wire `DashboardProposalService.applyLayout` and `DashboardContentsService.buildAndReplace`; confirm combined apply routes through it
- [x] 2.5 List every caller of `buildLayout`/`duplicateSizes` in files-modified.md notes

## 3. Guards

- [x] 3.1 GUARD: dashboard import keeps a 4-row form at 4 (mutation shown red, reverted)
- [x] 3.2 GUARD: dashboard duplicate keeps a 4-row form at 4 (mutation shown red, reverted)

## 4. Verification

- [x] 4.1 Mutation evidence for each new red test (revert the fix piece, test goes red)
- [x] 4.2 Full spec files for every touched spec; backend sbt testFull in shards on the lane DB
- [x] 4.3 Pre-commit hooks pass
