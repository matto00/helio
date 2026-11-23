## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file, not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); never open scripts/concertino/.concertino.env; never copy .env files or a tree containing one.
- [C2] Quoted heredocs only (<<'EOF'), or Write/Edit.
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; stop any sbt server you start by exact PID.
- [C4] sbt -J-Xmx3g and nice -n 19; jest 3 workers; Playwright 2 workers total.
- [C5] Bash timeout 600000; keep every sbt call and polling loop well under it; no background run past the tool timeout.
- [C6] Budget exhausted means escalate.
- [C8] No prod, no release, no concertino sync, no MCP deploy.
- [C9] No claude.ai session link in PR bodies or commits.
- [C12] Commit the before shard plan/balance (as .txt) before regenerating the tsv.
- [C13] All scratch and tool output in /home/matt/Development/helio/.concertino/scratch/HEL-1821/ (never /tmp, never the worktree); TMPDIR=/tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1821 only for git-hook runs and test-gate-in-isolation.sh.
- [C15] No live model call: any backend started with ANTHROPIC_API_KEY exported empty. Backend test config + comments only; no app code, no migration.

### Backend

## 1. Comments

- [x] 1.1 Fix ClaudeClient.scala:26 to name ClaudeRequestBuilder.guardrailReject (verify callers); verify by grep
- [x] 1.2 Fix AssistantConversationRoutesFixture.scala :131/:214/:225/:237 per design D7; verify each target by grep
- [x] 1.3 Grep the 8 new specs + ClaudeClientTestSupport/AssistantServiceTestSupport/fixture for other split-broken above/below refs; fix and list
- [x] 1.4 sbt compile Test/compile green (-J-Xmx3g, nice -n 19)

## 2. Before plan

- [x] 2.1 Read the before partition from sbt testGrouping for shards 0..3 with main's tsv and HEL924_TEST_GROUP_COUNT=4 (D3); save in scratch
- [x] 2.2 Read the 45023531045 leg-1 thread dump (artifact 14755031576): load vs hang, running suites. Write evidence/before-shard-plan.txt (leg membership incl. the 11 assistant suites, loads under old weights); commit with section 1

## 3. Regenerate

- [x] 3.1 Download the 3 input runs' shard artifacts by id; extract-fresh-junit.py per leg with its step window; kept sums == discovered suites (D1)
- [x] 3.2 Run gen-test-suite-weights.py into the tsv (D2); verify all 8 classes have rows and no discovered suite lacks one
- [x] 3.3 Read the after partition from sbt testGrouping for shards 0..3 with HEL924_TEST_GROUP_COUNT=4 (exact-partition check passes)
- [x] 3.4 Write evidence/regeneration.txt and evidence/after-shard-plan.txt with the D4 same-source table (before vs after: per-leg sum and makespan, longest, mean) and D5 budget check; append before-plan loads under S

### Tests

## 4. Verification

- [ ] 4.1 (commit half done; CI half pending PR CI, measured durations in the PR body) Commit tsv + evidence (hooks green); the PR's 4 backend-leg "Compile and test" durations (all < 660 s) are recorded by the orchestrator at Delivery, in the PR body
