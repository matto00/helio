## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

All checks run in the worktree unless stated; read-only probes only.

1. **Round-2 CR1 (`IGNORED_TOP_LEVEL` set).** `cat -n .gitignore` confirms the six unanchored directory
   patterns are exactly at the lines Decision 1b's table claims: `node_modules/`:6, `dist/`:8, `build/`:10,
   `coverage/`:17, `playwright-report/`:18, `test-results/`:19. `grep -n 'target\|out' .gitignore` returns only
   line 11 `backend/target/` (anchored) and a comment; `out` is absent. The exclusion of `target`/`out` and the
   safety rationale ("each of the six is an unanchored entry") are both true as written. RESOLVED.
2. **Top-level enumeration.** Worktree: `backend docs e2e frontend helio-mcp infra notes openspec schemas
   scripts`. Main checkout (`ls -d /home/matt/Development/helio/*/`): the same plus `node_modules/` and
   `test-results/` — exactly the delta Decision 1b/1c and the checklist claim, both in `IGNORED_TOP_LEVEL`.
   `PARTIAL_COVERAGE` (`frontend`, `backend`) + `ACKNOWLEDGED_UNSCANNED` (7 names) together with `helio-mcp`
   partition the list with nothing left over.
3. **Round-2 CR2 (the 7-hit measurement).** `grep -rnEi '(key|secret|token|password)"?\s*[:=]\s*"[^"]{8,}"'
   over `helio-mcp/` minus `node_modules`/`dist` returns exactly 7 hits: the six `sk-should-never-be-accepted`
   values at `restDataSourceSchema.test.ts:41,54,69,83,97` and `connectorSchema.test.ts:146`, plus
   `e2e/connector-authoring.ts:109` `password: "correct horse battery staple 1!"`. Line numbers, values and
   file paths in Decision 4 and task 3.4a are all correct. I read `connector-authoring.ts:100-115`: the literal
   is consumed only by that function's own `POST /api/auth/register` for a `randomUUID()`-unique
   `@example.invalid` user, so the reword is safe exactly as task 3.4a says. RESOLVED.
4. **Decision 4a's "must not fire" table.** `grep -rn helio_pat_ helio-mcp/` returns the production constant
   `src/config.ts:17` (`"helio_pat_"`, suffix 0), `queryParamsOrdering.test.ts:74` (`helio_pat_test`, suffix 4),
   `README.md` placeholders (`helio_pat_xxxxxxxx`, suffix 8; `helio_pat_…`, suffix 0) and
   `e2e/sleeper-rebuild.ts:44` (`helio_pat_...`, `.` not in the class). I ran the Decision 4a vendor-prefix rule
   (`(helio_pat_|sk-ant-)[A-Za-z0-9_-]{20,}`) over all 66 MCP-surface files: **zero matches.** The entropy floor
   is correctly derived and correctly excludes every live value. (One value the design does not list —
   `src/config.ts:28` `"  export HELIO_PAT=helio_pat_xxxxxxxx"` — is likewise a non-match; harmless omission.)
5. **First-run expectation.** Walking `helio-mcp/` under the stated include rule (minus `node_modules`, `dist`,
   binary extensions) yields **66 files**, matching design.md's figure; `16 + 66 = 82` matches the "roughly 82,
   to be confirmed" estimate. Running the existing bcrypt and email regexes over those 66 files with the current
   `ALLOWED_EMAIL_DOMAINS`: **zero bcrypt hits, zero non-allowlisted email hits** — the residual-false-positive
   claim in Risks is measured-true, not asserted.
6. **Round-2 CR3 (vacuity-case mechanism).** Decision 5 now specifies the mechanism concretely (rename
   `helio-mcp/` → `helio-mcp-hel956-selftest-moved/`, `finally` + idempotent startup restore, no env var, no
   self-test-only branch), names the drift/vacuity message collision it creates, orders the three cases, and
   requires message-text assertions; tasks 4.2/4.2a/4.2b mirror all of it. The collision it flags is real: the
   moved directory is an unacknowledged top-level name, so exit-status-only assertion would prove the wrong
   thing. RESOLVED.
7. **Existing script vs. plan.** Read `scripts/check-no-credential-in-agent-surface.mjs` (334 lines): the two
   hardcoded roots, `FIXTURE_ROOTS`, `ALLOWED_BCRYPT_HASHES`, `ALLOWED_EMAIL_DOMAINS`, the binary-extension set
   and the three checks are as the Context section describes; task 1.2's port is faithful and task 1.4's
   byte-identical-baseline checkpoint is a real behavior-preservation control. The header's existing HEL-846
   scope note ("generic token-shaped secret strings ... are HEL-846's guard, not this one") is contradicted by
   the new `mcp` secret-literal check — task 1.3 rewrites the header, which is where that must be reconciled;
   noted below rather than blocking.
8. **Spec deltas / AC trace.** Every ticket AC maps to a requirement + scenario in
   `specs/agent-surface-credential-gate/spec.md` and to a numbered task, including the AC that a widened glob
   without a self-test case does not satisfy the criterion (tasks 4.1, 4.5 mutation check) and the PR
   before/after count (tasks 1.1, 5.4). No `TODO`/`TBD`/deferred decision remains in any artifact.

### Verdict: REFUTE

One defect, and it is a soundness defect rather than polish: the plan's own verification step for the
round-1 CR1 property is specified in a way that provably cannot measure what it claims to measure, in a ticket
whose subject is checks that report green over things they never examined. Everything else above is verified
sound and I found nothing further.

### Change Requests

1. **Task 2.6 (and task 5.5, which repeats it) prescribe a main-checkout verification method that measures the
   worktree instead.** Task 2.6 says to verify green from the main checkout "reading the worktree's script via
   its absolute path if needed". The script sets `const repoRoot = join(dirname(fileURLToPath(import.meta.url)),
   "..")` (`scripts/check-no-credential-in-agent-surface.mjs:57`), and design.md's Gate-Chain checklist states
   this explicitly: "paths are derived from `import.meta.url`, not from `cwd`". So invoking the worktree's
   script from the main checkout re-scans the **worktree**, regardless of cwd — a green that proves nothing
   about the main checkout's `node_modules/`/`test-results/` top level. The alternative reading (run the main
   checkout's own `scripts/check-no-credential-in-agent-surface.mjs`) is worse: that is the unmodified
   pre-change script, which has no drift guard at all. The ticket constraint forbids modifying the main
   checkout, so there is no way to satisfy 2.6 as written. Revise 2.6/5.5 to name a mechanism that actually
   exercises the shipped classification against the main checkout's real top-level listing without writing to
   it — e.g. have the guard expose its classifier as an exported pure function taking the directory list (or the
   repo root) as an argument, and verify by invoking that export from the worktree over
   `readdirSync("/home/matt/Development/helio")` with the result printed per directory. Any replacement must
   state, in the task, *why* the chosen mechanism reads the main checkout's listing rather than the worktree's;
   "run it from over there" is exactly the assumption that fails here.

### Non-blocking notes

- Task 1.3 should explicitly reconcile the header's existing HEL-846 boundary sentence (finding 7) with the new
  `mcp` secret-literal check, so the script does not ship two contradictory scope statements.
- Decision 4a's table omits `helio-mcp/src/config.ts:28` (`export HELIO_PAT=helio_pat_xxxxxxxx` inside a help
  string). It is a non-match under the entropy rule; worth adding to the table task 3.2a checks so the
  enumeration is complete.
- Neither artifact says what happens if `.gitignore` gains a new unanchored root directory pattern; Risks covers
  the consequence (spurious red with an actionable message) but the script header table should say it must be
  updated in the same commit.
