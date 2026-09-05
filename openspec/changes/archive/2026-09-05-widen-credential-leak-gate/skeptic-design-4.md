## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Cold review; every claim below re-derived from the tree in this worktree (read-only probing of the main
checkout only), not from prior reports.

1. **Round-3 CR1 is genuinely resolved.** `scripts/check-no-credential-in-agent-surface.mjs:57` is
   `const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")`, so the CR's premise still holds:
   invoking the worktree's script from anywhere re-scans the worktree. Task 2.6 no longer prescribes that. It
   now (a) states that failure mode and why the two obvious methods (worktree script run from main; main's own
   copy) each measure the wrong thing, (b) requires the classifier be exported as a pure function taking the
   top-level directory-name list, with the gate's own `main` path calling that same function, and (c) verifies
   by invoking the export from the worktree over `readdirSync("/home/matt/Development/helio")`, printing the
   state per directory, and confirming `node_modules`/`test-results` are skipped by `IGNORED_TOP_LEVEL`.
   Task 5.5 points at the same mechanism and explicitly forbids substituting "run the gate from over there".
   This is a mechanism that measures what it claims to, and the shipped path and verification path are the
   same function.
2. **Round-3's three non-blocking notes are folded in.** Task 1.3 now requires reconciling the header's
   existing HEL-846 boundary sentence with the new `mcp` secret-literal check; task 2.4 requires the header
   table to state that a new unanchored root pattern in `.gitignore` must be added in the same commit; task
   3.2a now includes `helio-mcp/src/config.ts:28` (`export HELIO_PAT=helio_pat_xxxxxxxx` in a help string) in
   its must-not-fire enumeration — I read that line, it is a suffix-8 placeholder, correctly a non-match.
3. **`IGNORED_TOP_LEVEL` table re-measured.** `.gitignore` lines 6/8/10/17/18/19 are exactly `node_modules/`,
   `dist/`, `build/`, `coverage/`, `playwright-report/`, `test-results/`; line 11 is the anchored
   `backend/target/`; `out` is absent. Decision 1b's table and its exclusion of `target`/`out` are true as
   written.
4. **Top-level listings.** Worktree: `backend docs e2e frontend helio-mcp infra notes openspec schemas
   scripts`. Main checkout: the same plus `node_modules/` and `test-results/`. `helio-mcp` (covered) +
   `PARTIAL_COVERAGE` (`frontend`, `backend`) + `ACKNOWLEDGED_UNSCANNED` (7 names) partitions both lists with
   nothing unclassified.
5. **Measurements the design asserts, reproduced by me.** `find helio-mcp -type f` minus `node_modules`/`dist`
   = **66** files (design's figure; `16 + 66 = 82` matches the "roughly 82, confirm by measurement" estimate).
   `grep -rEn '(helio_pat_|sk-ant-)[A-Za-z0-9_-]{20,}'` over that surface = **zero** matches, so Decision 4a's
   entropy floor does not fire on any live value including the `PAT_PREFIX` production constant
   (`src/config.ts:17`). The identifier-literal grep returns exactly **7** hits, matching Decision 4's
   corrected count; I read `helio-mcp/e2e/connector-authoring.ts:105-112` and confirm the one unmarked
   literal is consumed only by that script's own `POST /api/auth/register` for a `randomUUID()`-unique
   `@example.invalid` user, so task 3.4a's reword is safe.
6. **Baseline is real.** `npm run check:no-credential-leak` prints
   `OK (16 files scanned: 13 assistant-surface, 3 fixture, 0 violations)` — byte-identical to the string task
   1.1/1.4 pin as the behavior-preservation checkpoint.
7. **Artifact hygiene / AC trace.** No `TODO`/`TBD`/deferred decision in proposal, design, tasks or spec. Each
   ticket AC maps to a task and a spec scenario, including the "widened glob without a self-test case does not
   satisfy the criterion" AC (tasks 4.1 + 4.5 mutation check) and the PR before/after count (1.1, 5.4). The
   self-test plan's ordering, message-text assertions, `finally` + idempotent startup cleanup, and the
   no-env-var constraint are all internally consistent between Decision 5 and tasks 4.2/4.2a/4.2b/4.3/4.4.

### Verdict: CONFIRM

Round 3's single blocking CR is resolved by a mechanism that actually measures the main checkout's listing,
and its three notes are folded in. I re-derived every load-bearing measurement in the design independently and
found no discrepancy. What remains is one wording imprecision (below) that the executor's own measurement step
in the same task would surface immediately.

### Non-blocking notes

- Task 2.6's parenthetical says the gate's `main` calls the classifier "with `readdirSync(repoRoot)`". Bare
  `readdirSync` returns files as well as directories, and design.md 1c is explicit that top-level *files* are
  out of the guard's scope. The call should filter to directories (`withFileTypes`), and the verification
  invocation over the main checkout should do the same, or `README.md`/`package.json` etc. would arrive at the
  classifier unclassified. The executor will hit this on the first run of 2.6, but making it explicit costs
  nothing.
