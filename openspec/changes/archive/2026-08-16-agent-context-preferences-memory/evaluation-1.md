## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `b129f025` on `feature/agent-context-preferences-memory/HEL-521`.

### Phase 1: Spec Review — PASS

Checked against `ticket.md`, `proposal.md`, `design.md`, `tasks.md` (all 19 items marked `[x]`), and
both spec deltas (`specs/workspace-context-agent-section/spec.md`,
`specs/mcp-context-agent-block/spec.md`).

- All 5 ticket ACs addressed explicitly:
  - AC1 (agentContext = preferences + top-N memory) — `WorkspaceContextService.buildAgentContext`
    (`WorkspaceContextService.scala:207-220`) composes `AgentPreferencesResponse` +
    `rankMemoryEntries(...).take(AgentMemoryTopN)`; wired into `assemble`'s
    for-comprehension and the constructed `WorkspaceContextResponse`.
  - AC2 (touch-on-surface) — `buildAgentContext` calls `memoryService.touch(entry.id, user)` for
    every entry in `surfaced` (the already-`.take(20)`'d set), never for the rest. Verified with a
    dedicated DB-backed test (`WorkspaceContextServiceAgentContextSpec`, "7.2 touch side effect")
    that inserts 25 never-used entries, asserts the top-20-by-createdAt are touched
    (`lastUsedAt` becomes defined) and the other 5 are left `None`.
  - AC3 (`get_workspace_context` returns the block) — `helio-mcp/src/context.ts`'s
    `buildAgentContext`/`buildWorkspaceContext` wiring, covered by
    `context.test.ts`'s new "agentContext wiring" describe block (population, empty-default cases).
  - AC4 (compact, documented cap; additive) — `AgentMemoryTopN = 20` documented on both the Scala
    (`WorkspaceContextService.scala:140-145`) and TS (`AGENT_MEMORY_TOP_N`, `context.ts:52-53`)
    sides; `agentContext` is a new, always-present field on both wire shapes — no existing field
    changed shape or was removed.
  - AC5 (`sbt test` + `npm test` pass; no FQNs) — reverified independently below (Phase 2); both
    green.
- No AC silently reinterpreted. The two most consequential judgment calls (N=20 cap, touch on the
  backend path only / never on MCP reads) are both `design.md` Decisions 3/4, independently verified
  against real code by the design-gate skeptic (`skeptic-design-1.md`, verdict CONFIRM) before
  implementation began, and the diff matches those decisions exactly.
- No task item marked done that isn't actually implemented — spot-checked 1.1/1.2, 2.1-2.3, 3.1-3.3,
  4.1, 5.1-5.2, 6.1-6.3, 7.1-7.5 against the diff; each has a corresponding code or test change.
- No scope creep — `git diff --stat` touches exactly the files `proposal.md`'s Impact section lists,
  plus the two new test files and the two required existing-fixture updates
  (`WorkspaceContextServiceApplyBudgetSpec.scala`, `context.test.ts`'s `makeFakeApi`/fixture
  updates for the new required field). No unrelated refactors.
- No regressions to existing behavior: `agentContext` is additive on both wire shapes (new,
  always-present field; no removed/renamed field). Full `sbt test` (2926 tests) and the full
  `helio-mcp` jest suite (164 tests) pass with zero failures (see Phase 2). `WorkspaceContextBudget`
  needed no change (confirmed by the skeptic's design-gate note and confirmed here: it wasn't
  touched, and the byte-budget mechanism already reflects/counts every response field generically).
- Schema updated in the same change: `schemas/workspace-context.schema.json` gained `agentContext`
  in `required`/`properties` plus self-contained `$defs.AgentContext`/`AgentPreferences`/
  `AgentMemoryEntry` mirroring the backend wire shapes, matching this schema's existing
  don't-cross-file-`$ref` convention.
- Planning artifacts reflect the final implementation — `files-modified.md`'s per-file descriptions
  match the actual diff line-for-line (verified against `git diff main...HEAD` for every listed
  file).

No issues found in Phase 1.

### Phase 2: Code Review — PASS

**Gates (fresh run, this session, not the executor's report):**
- `cd backend && sbt test` → **2926 tests, 0 failed, 0 canceled** ("All tests passed", 128s).
- Root `npx jest --testPathPatterns=helio-mcp` (the mechanism by which `npm test` actually executes
  helio-mcp's `*.test.ts` files — `helio-mcp/package.json` has no local `test`/jest devDependency;
  the root `jest.config.cjs`'s `testMatch`/`testPathIgnorePatterns` includes `helio-mcp/**` and
  excludes only `node_modules`/`openspec`/`.cursor`/`frontend`/`e2e`) → **8 suites, 164 tests, all
  passed**, including `context.test.ts`'s new `agentContext` coverage.
- `npm run check:scala-quality` → clean (0 hard FQN violations; the 106 soft file-size warnings
  reported are pre-existing, none newly introduced by this diff — the two new spec files
  (`WorkspaceContextServiceAgentContextSpec.scala` 228 lines, `DashboardAuthoringPromptSpec.scala`
  105 lines) are both under the 250-line soft budget).
- `npx eslint` + `npx prettier --check` on all 6 modified `helio-mcp/**` files → clean.
- `cd helio-mcp && npx tsc --noEmit` → clean.
- No `frontend/**` files changed, so `npm run lint` / `npm run format:check` / `npm test` /
  `npm --prefix frontend run build` are not applicable per the standard's own file-match gating
  (confirmed via `git diff --name-only main...HEAD` — zero `frontend/**` paths).

**CONTRIBUTING.md compliance:**
- Imports & Qualifiers rule: verified via `check:scala-quality` (mechanical) — no inline
  `com.helio.X`/`spray.json.X`/etc. All new imports (`WorkspaceContextService.scala`,
  `WorkspaceContextProtocol.scala`, `DashboardAuthoringPrompt.scala`, `ApiRoutes.scala`) are
  top-of-file.
- "Per-domain JSON formatters live under `com.helio.api.protocols`; the aggregator `JsonProtocols`
  only mixes them in" — `workspaceContextAgentSectionFormat` is added to `WorkspaceContextProtocol`
  itself (a per-domain protocol file), not to the `JsonProtocols` aggregator, which continues to
  only `with WorkspaceContextProtocol` (already true pre-change). Correct.
- File-size soft budgets: no touched file crosses the ~400-line "propose a split" threshold;
  `WorkspaceContextService.scala`'s net addition is ~65 lines to an already-existing, larger file
  (informational-only budget, not a hard gate).

**DRY / Readable / Modular:**
- `rankMemoryEntries` (Scala, `private[services]`) and `rankMemoryEntries` (TS, exported) are each
  small, pure, independently unit-tested functions — not duplicated logic within their own file,
  and the necessary backend/MCP duplication is a pre-existing, deliberate, documented pattern in
  this codebase (`WorkspaceContextService.scala`'s own header comment; `context.ts`'s header
  comment above the new code explicitly cross-references the Scala constant).
- `buildAgentContext` (both sides) is a single-purpose, separately named function, not inlined into
  `assemble`/`buildWorkspaceContext`'s already-large bodies.
- `DashboardAuthoringPrompt.agentContextSection`/`preferencesSummary` are small, composable,
  independently testable helpers per design.md Decision 5 — not interleaved with the existing,
  already-tested `groundingSection`.

**Type safety:** No new `any`/untyped escape hatches on the TS side (`AgentPreferencesResponse`/
`AgentMemoryEntryResponse` are properly typed interfaces); no `.asInstanceOf`/`null` introduced on
the Scala side.

**Security / input validation:** No new user input surface — `agentContext` is a read composed from
already-authenticated-user-scoped services (`AgentPreferencesService.get(user)`,
`AgentMemoryService.list(user)`), both already ACL'd from 420-A/420-B. No new route added.

**Error handling:** Backend — `Option`-guarded services degrade to `WorkspaceContextAgentSection.empty`
rather than failing (design.md Decision 2), verified by test. MCP — each of the two new fetches is
independently `.catch`-guarded (not folded into the existing fail-fast `Promise.all`, exactly as the
design-gate skeptic flagged as the correct, non-obvious reading of tasks.md 6.2), verified by two
dedicated degrade-on-failure tests plus a "rest of the snapshot intact" assertion.

**Tests meaningful — would catch a real regression:**
- The ranking test (`WorkspaceContextServiceAgentContextSpec`, "7.1 top-20 ranking") uses 15 touched
  + 10 never-used entries with deliberately non-monotonic timestamps and asserts the exact ordered
  id sequence — a wrong sort direction, a wrong nulls-first/last choice, or an off-by-one on the
  cap would all fail this test.
- The touch test independently re-queries the repository (`agentMemoryRepo.list`) rather than
  trusting the same `assemble` call's response, so it would catch a no-op `touch` implementation.
- The MCP no-write test constructs a real `HelioApi` against a fake `HelioHttpClient` whose
  `post`/`put`/`patch`/`delete` all throw, and asserts only `GET` calls reach
  `/api/preferences`/`/api/agent/memory` — this is a genuine behavioral proof of the "MCP never
  touches" requirement, not just an assertion against a mock's call log.
- Prompt tests cover all four presence/absence combinations (both empty / preferences-only /
  memory-only / both) plus placement (`userMessage`'s section falls between grounding and goal).

**No dead code:** No unused imports/leftover TODO/FIXME introduced (grep confirms none in the diff).

**No over-engineering:** No new endpoint added where none was needed (design.md Decision 1's
"extend the existing shared assembler" call was verified against the single-construction-site claim
by the skeptic, and this diff acts on exactly that decision).

**Behavior-preserving:** This is a purely additive change; no signature of `assemble` changed
(only new, defaulted trailing constructor params on `WorkspaceContextService`), and every existing
caller (`DashboardAuthoringService`, `RefinementGrounding`, `WorkspaceRoutes`) continues to compile
and pass without modification, other than `DashboardAuthoringService`'s one intentional
`userMessage` call-site update. Confirmed no other `WorkspaceContextResponse(...)` construction site
exists outside the three files that were actually touched (`grep -rln "WorkspaceContextResponse("` →
exactly `WorkspaceContextProtocol.scala`, `WorkspaceContextService.scala`,
`WorkspaceContextServiceApplyBudgetSpec.scala`).

No issues found in Phase 2.

### Phase 3: UI Review — BLOCKER

Trigger matched (`ApiRoutes.scala`, `schemas/workspace-context.schema.json`), so Phase 3 is
mandatory. No `frontend/**` files are touched by this change (confirmed), and no frontend code
consumes `GET /api/workspace/context` (`grep -rn "workspace/context" frontend/src` → no hits), so
there is genuinely no rendered UI surface this ticket's diff affects — but the phase is still
mandatory per protocol, so I ran the canonical dev-server setup to confirm the backend at least
still serves correctly with the new field on the wire.

**What happened:** `scripts/concertino/start-servers.sh "$WORKTREE_PATH" 5953 8860 HEL-521` never
reached `READY` — the backend process crashed 2 seconds after starting with a Flyway validation
exception, and the script's `curl` health-poll loop against `http://localhost:8860/health` then ran
until I killed it (it has no retry logic; a dead backend process just times out at 300s).

**Log excerpt** (`.concertino-backend.log`):
```
[info] 20:02:20.198 ERROR [...] o.a.pekko.actor.OneForOneStrategy - Validate failed: Migrations have failed validation
[info] Migration checksum mismatch for migration version 82
[info] -> Applied to database : -750252575
[info] -> Resolved locally    : 1371310627
[info] org.flywaydb.core.api.exception.FlywayValidateException: Validate failed: Migrations have failed validation
...
[success] Total time: 2 s, completed Aug 15, 2026, 8:02:20 PM
```

**Diagnosis (environmental, not a code defect in this diff):** `backend/.env`'s `DATABASE_URL`
points every worktree at the same shared local Postgres database (`helio` on `localhost:5432`) —
confirmed identical in this worktree and in the concurrently-running
`.claude/worktrees/feature/assert-pipeline-step-model/HEL-454` worktree. Querying
`flyway_schema_history` directly:

```
version |    description    |  checksum   |        installed_on
--------+-------------------+-------------+---------------------------
81      | agent preferences | -1466613925 | 2026-08-15 19:07:47.631549
82      | add assert op     |  -750252575 | 2026-08-15 19:07:47.657084
```

Some other, already-gone worktree/session previously ran a migration numbered `V82` with the
description "add assert op" against this shared database. That does not match either this
worktree's `V82__agent_memory.sql` (checksum `1371310627`, inherited unmodified from
`main`/HEL-478, not touched by this diff) or `HEL-454`'s own migration for that feature, which is
numbered `V83__add_assert_op.sql` there — so the colliding `V82` row is a leftover artifact of a
third, no-longer-present branch state, not something either currently-active worktree's own
migration files can explain. This diff adds zero new Flyway migrations, so it cannot be the cause;
it is purely a victim of the shared-database version-number collision. `setup-worktree.sh` has no
per-worktree database provisioning step (confirmed — it only copies `backend/.env` verbatim via
`CONCERTINO_ENV_FILES`), so every concurrently-running worktree's dev backend is exposed to this
same hazard.

Per protocol, this is tagged BLOCKER rather than attempted as a workaround: repairing or mutating
`flyway_schema_history` on the shared database risks corrupting the state the concurrently-running
HEL-454 worktree's own dev backend depends on, and is explicitly out of scope ("do not debug the
dev environment as a code change request").

**Required: human intervention** — either (a) resolve the shared dev database's `flyway_schema_history`
collision (`flyway repair`, or manually correcting/removing the stale `V82` row) once no other
worktree's dev backend is relying on its current state, or (b) provision each concurrently-running
worktree an isolated Postgres database/`DATABASE_URL` so this class of collision can't recur. Once
resolved, Phase 3 needs a fresh run — nothing in this ticket's own diff needs to change for it.

### Overall: BLOCKER

Phases 1 and 2 are both clean PASSes on their own merits — this is not a code-quality verdict
against the implementation. Phase 3 could not be completed due to a pre-existing, cross-worktree
shared-database environment hazard unrelated to this diff (which introduces no migrations at all).
Re-run once the environment issue above is resolved.
