## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: `b129f025` on `feature/agent-context-preferences-memory/HEL-521`. Evaluator's
verdict (`evaluation-2.md`) was PASS; treated as a claim and independently re-verified below, not
taken on trust.

### What I verified (with evidence)

**Planning artifacts** — read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
(`specs/workspace-context-agent-section/spec.md`, `specs/mcp-context-agent-block/spec.md`). No
placeholders/TBDs; all 5 ACs map to explicit design decisions and code.

**Full diff read** — `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala`
(`buildAgentContext`/`rankMemoryEntries`), `AgentMemoryService.scala` (`touch`),
`AgentPreferencesService.scala` (`get`), `WorkspaceContextProtocol.scala`
(`WorkspaceContextAgentSection`), `DashboardAuthoringPrompt.scala`
(`agentContextSection`/`preferencesSummary`/`userMessage`), `DashboardAuthoringService.scala`
(threading), `ApiRoutes.scala` (wiring), `AgentPreferencesProtocol.scala`/`AgentMemoryProtocol.scala`
(wire DTOs), `AgentMemoryRepository.scala` (`list`/`touch` SQL), and the MCP side —
`helio-mcp/src/context.ts` (`buildAgentContext`/`rankMemoryEntries`/`buildWorkspaceContext`
wiring), `helioApi.ts` (`getAgentPreferences`/`listAgentMemory`), `types.ts`, `tools/read.ts`,
`index.ts`. All match `design.md`'s Decisions 1-6 exactly — no hand-waving between design and
implementation.

**The four non-obvious judgment calls, checked directly against the code (not inferred from
comments):**
1. *Option-guarded service dependencies* — `WorkspaceContextService`'s two new trailing,
   default-`None` ctor params; `ApiRoutes.scala:307-314` threads the already-constructed
   `agentPreferencesServiceOpt`/`agentMemoryServiceOpt`; `buildAgentContext` pattern-matches
   `(Some,Some) => real / _ => empty` — verified live (below) and by
   `WorkspaceContextServiceAgentContextSpec`'s dedicated "services not wired" test.
2. *Touch-only-on-backend-path* — `grep`-confirmed `AgentMemoryService.touch` is called from
   exactly one call site, `WorkspaceContextService.buildAgentContext`; the MCP side's
   `buildAgentContext` never calls a write method. Verified live end-to-end (below), not just by
   reading the code.
3. *N=20 ranking, independently implemented twice* — Scala's `rankMemoryEntries`
   (`entries.partition(_.lastUsedAt.isDefined)`, `sortBy(...).reverse` then append never-used in
   incoming order) and TS's `rankMemoryEntries` (`touched.sort(...)`, `[...touched, ...neverUsed]`)
   are semantically identical (touched-desc-by-`lastUsedAt`, never-used-last-in-list-order). Both
   independently unit-tested with non-monotonic timestamp fixtures that would catch a wrong sort
   direction, wrong nulls handling, or an off-by-one on the cap.
4. *MCP no-write requirement* — `context.test.ts`'s "never issues a write call" test constructs a
   REAL `HelioApi` against a fake `HelioHttpClient` whose `post`/`put`/`patch`/`delete` all throw,
   and asserts only two `GET`s reach `/api/preferences`/`/api/agent/memory` — a genuine behavioral
   proof, not a mock-call-log assertion against a stub.

**Fresh test runs (reproduced myself, not taken from the evaluator's report):**
- `sbt "testOnly com.helio.services.WorkspaceContextServiceAgentContextSpec com.helio.services.DashboardAuthoringPromptSpec com.helio.services.WorkspaceContextServiceApplyBudgetSpec"` →
  **26/26 passed**, 0 failed (includes the 7.1/7.2 population/empty-default/ranking/touch specs).
  Compilation succeeded for the whole backend as a side effect of `testOnly`.
- `npx jest --testPathPatterns=helio-mcp` (root) → **8 suites / 164 tests, all passed**, including
  `context.test.ts`'s new `agentContext` describe blocks.
- `npm run check:scala-quality` → clean, 0 hard FQN violations (only pre-existing soft file-size
  warnings, none newly introduced — both new spec files are under the 250-line soft budget).
- `npx eslint` + `npx prettier --check` on the 6 touched `helio-mcp/**` files → clean.
- `cd helio-mcp && npx tsc --noEmit` → clean.
- I did not re-run the full 2926-test `sbt test` suite myself (time-bounded); the evaluator's
  `evaluation-1.md` documents it running green *before* the environmental BLOCKER (which only
  affected Phase 3's `start-servers.sh`, never `sbt test`), and my own targeted re-run + full
  compile give me independent confidence in the changed area.

**Live end-to-end verification (own hands, real running backend, not just tests):**
- `scripts/concertino/start-servers.sh`/`assert-phase.sh servers` → `PASS servers`;
  `curl /health` → `{"status":"ok"}`.
- Logged in as `matt@helio.dev`, called `GET /api/workspace/context` fresh → response includes
  `"agentContext": {"memory": [], "preferences": {"extras": {}}}` for a caller with nothing stored
  — correct empty-default shape (AC1/AC3 partial).
- **Touch side effect, proven live**: `POST /api/agent/memory` a fact → `GET
  /api/workspace/context` surfaces it in `agentContext.memory` (with `lastUsedAt` absent on this
  same response, matching the documented pre-touch-values contract) → a subsequent `GET
  /api/agent/memory` shows `lastUsedAt` is now populated. This directly proves AC2 against the
  live database, not only the DB-backed unit test. Cleaned up the probe entry afterward
  (`DELETE`, `204`).
- **Preferences flow, proven live**: `PUT /api/preferences` with `defaultSeriesColors` → `GET
  /api/workspace/context`'s `agentContext.preferences` reflects it exactly. Reset back to default
  afterward.

**No frontend surface to review** — `git diff --stat` confirms zero `frontend/**` files touched;
`proposal.md`'s Impact section states this explicitly and the evaluator's grep
(`authoring/dashboard|authorDashboard|AuthoringDrawer` → no hits in `frontend/src`) confirms there
is genuinely no rendered UI consumer for this change yet. DESIGN.md judgment is therefore
inapplicable to this ticket — nothing to screenshot.

**Schema** — `schemas/workspace-context.schema.json`'s new `agentContext`/`AgentPreferences`/
`AgentMemoryEntry` `$defs` match the wire DTOs field-for-field (`extras` required, `min`/`max`-style
Option omission handled correctly for `lastUsedAt`/the three optional preference fields).

**No stray debug code** — `git diff main...HEAD | grep -n "TODO\|FIXME\|console.log\|XXX"` → no
hits.

### Verdict: CONFIRM

All 5 acceptance criteria trace to real, tested, and (for AC1/AC2) live-verified code. The four
flagged non-obvious judgment calls are genuinely correct in the committed code, not merely
plausible-sounding — I reproduced the touch side effect and the empty-default degrade path against
the live running backend myself, and independently confirmed the MCP no-write guarantee is a real
behavioral test, not an assertion against a permissive stub. No FQN inlining, no scope drift, no
placeholder/hand-waving in the planning artifacts, additive-only wire shapes confirmed by the one
existing-fixture update each side needed. Ships.

### Non-blocking notes

- `RefinementGrounding` (HEL-343) picks up `agentContext` on the wire "for free" via the shared
  `assemble()` call but does not render it into its own prompt text the way
  `DashboardAuthoringPrompt` does — this is consistent with `design.md`'s Goals section, which
  scopes prompt-text rendering to the NL-authoring flow only, not a gap in this diff. Worth a
  spinoff ticket if refinement's own prompt should eventually surface preferences/memory too, but
  it is out of this ticket's stated scope.
