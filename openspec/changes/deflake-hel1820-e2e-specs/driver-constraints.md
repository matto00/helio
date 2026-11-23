# Driver constraints (binding on every role in this run; restated verbatim from the driver)

- C1: NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even
  to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); the only exception is
  scripts/concertino/.concertino.env which scripts may read but never print. Agents themselves must not open
  .concertino.env either; start servers only via start-servers.sh. Do not copy .env files around either. That
  includes copying a worktree or directory tree that contains one, with cp -a, rsync or hardlinks. setup-worktree.sh
  handles worktree env.
- C2: quoted heredocs only (<<'EOF'), even when the body looks harmless.
- C3: no pkill/pgrep/killall (not even read-only pgrep); exact PIDs only; stop servers with stop-servers.sh; delete
  test residue with buildUserDeleteSql by exact id; plain emails.
- C4: jest 3 workers, Playwright 2 workers TOTAL (never two Playwright batches at once), sbt -J-Xmx3g, nice -n 19.
- C5: Bash timeout 600000; split repeat batches so each finishes under the timeout; never a background run past the
  tool timeout (bounded pollers included).
- C6: budget exhausted means escalate (one extra round only for a narrow, named defect).
- C7: the auditor merges only, with gh pr merge --squash --match-head-commit <sha>, never --auto.
- C8: no prod, no release, no concertino sync, no MCP deploy.
- C9: no claude.ai session link in PR bodies or commits.
- C10: cleanup from the main checkout, then confirm local and remote branches are gone. Stop every server any
  sub-agent started (including stray sbt servers and Playwright fixture servers) by exact PID before cleanup. Leave
  no background watcher running when you hand back.
- C11: known flakes hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184 and :217 ("item 5: a touch tap leaves
  no sticky hover fill"), hel1665-home-phone-stability:437, candidates hel1656-pull-to-refresh:340,
  hel1684-draft-structural:427, hel1668-schema-panel-copy:112, the three specs of this ticket, backend insight spec
  test containing "ER1, overlapping", backend assistant-spec stalls that hit ci-sbt's 660 s deadline with no failing
  test (match on test title). The e2e job has 8 legs. A job that hits its timeout with no failing test counts as an
  unlisted failure (one rerun); infra failures count the same. An unlisted CI failure unrelated to the diff gets ONE
  literal `gh run rerun --job <id>`, named in the PR; a second parks. Several failed jobs are rerun one at a time. A
  merge-from-main push is not a rerun. If any command is refused by the permission system, do not retry or work
  around it: park and report.
- C12: red first (reproduction under stress), with mutations; run full spec files. Record and COMMIT the red run
  before writing fixes (`*.log` is gitignored: commit red output as .txt).
- C13: ALL scratch and tool output in the MAIN checkout's /home/matt/Development/helio/.concertino/scratch/HEL-1826/ —
  never /tmp, never inside the worktree; prefer Grep/Glob/Read tools over shell redirects. ONE exception: TMPDIR for
  git-hook runs and test-gate-in-isolation.sh must be outside any git repo, so set
  TMPDIR=/tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1826 for
  those only. Anything a follow-up ticket must reference goes into
  /home/matt/Development/helio/.concertino/runs/HEL-1826/evidence/.
- C14: lane-private DB (createdb helio_hel1826; DATABASE_URL for start-servers.sh AND Playwright AND every e2e
  cleanup step and every jest/commit-hook run that touches a DB, in every sub-agent, evaluator included; DB_USER when
  the URL has no credentials). Drop the lane DB at Delivery (orchestrator does this).
- Shared Playwright MCP browser: other lanes may use it. Before any UI result, check for an open dialog and that the
  page is on YOUR dev port; never navigate a page on another lane's port; discard drafts before navigating away.
- NO live model call: any lane backend must be started with ANTHROPIC_API_KEY exported empty.
- In-flight sibling lanes HEL-1615 (frontend panel modal appearance save) and HEL-1624 (frontend dashboard selection
  on load): do not touch their files. This ticket edits e2e/ only.
- Follow-ups: do not file tickets; report candidate follow-ups (e.g. an app-side root cause) to the orchestrator.
- Anything the driver or orchestrator asserts (including the hypotheses in design.md) is a claim to verify by probe.
