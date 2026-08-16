## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (ticket.md, proposal.md, design.md, tasks.md,
specs/agent-memory-{opt-out,retention}/spec.md, `git diff main...HEAD`) — not derived from the
evaluator's narrative.

1. **Decision 1/2 — dedicated `PUT /api/preferences/memory-enabled` endpoint + carry-forward on
   the general `PUT /api/preferences`.** Read `AgentPreferencesService.scala`,
   `AgentPreferencesRoutes.scala`, `AgentPreferencesProtocol.scala` diffs directly: `put` now does
   `get(user).flatMap { current => ... memoryEnabled = current.memoryEnabled ... repo.put(...) }`
   — a genuine read-then-write, not a cosmetic comment. `PutAgentPreferencesRequest` carries no
   `memoryEnabled` field at all (confirmed in the wire type). **Independently re-verified live over
   HTTP** (not just trusting the evaluator's claim of doing so): logged in as `matt@helio.dev`,
   opted out via `PUT /api/preferences/memory-enabled {memoryEnabled:false}` → 200, `memoryEnabled:
   false`; then `PUT /api/preferences` with only `{"defaultSeriesColors":["#123123"]}` (no
   `memoryEnabled` field, exactly what the unaware Settings UI sends) → response and a subsequent
   `GET /api/preferences` both still show `memoryEnabled: false` while `defaultSeriesColors`
   updated. This is the ticket's single load-bearing correctness requirement and it holds under a
   fresh, independently-driven HTTP session.

2. **`AgentMemoryService.add` no-op when disabled (Decision 5) — verified live.** With
   `memoryEnabled: false`, `POST /api/agent/memory` → `201` with the constructed entry in the
   response body, but a subsequent `GET /api/agent/memory` → `[]` (nothing persisted). Re-enabled,
   added a real entry (201, persisted), opted out again — `GET /api/agent/memory` still showed the
   pre-opt-out entry (management UI unaffected, Decision 4). `DELETE /api/agent/memory` (clear all)
   → 204 and cleared it. All matches design.md Decision 4/5 exactly, exercised live, not just in
   ScalaTest.

3. **Retention (Decision 6) — read `AgentMemoryRepository.scala`'s `pruneExpired`/`add`/`list`
   diffs directly.** `pruneExpired` is a private `DELETE ... WHERE created_at < cutoff`, invoked as
   the first step of both `add`'s and `list`'s action chain, under the same `withUserContext`.
   `retentionDays`/`cap` are both threaded as explicit parameters from the service layer, never
   `sys.env`-read or hardcoded in the repository. Read the new tests in
   `AgentMemoryRepositorySpec.scala`: the prune-before-cap test uses a deliberately adversarial
   fixture (an over-age but recently-*touched* entry vs. a within-window but never-touched entry)
   specifically constructed so a naive prune-after-cap bug would evict the wrong one — this is a
   real regression-catching test, not a tautology. The touch-doesn't-extend-retention test confirms
   via a direct follow-up `SELECT count(*)` that the row is physically gone, not merely filtered.

4. **Grounding opt-out (Decision 4) — read `WorkspaceContextService.scala`'s `buildAgentContext`
   diff directly.** When `preferences.memoryEnabled` is `false`, the `memoryService.list`/`touch`
   calls are skipped entirely (an `if/else` branch on the already-fetched `preferences`, no new
   dependency). `WorkspaceContextServiceAgentContextSpec`'s new "7.3" test inserts an entry
   *directly via the repository* (bypassing `add`'s own no-op) specifically to prove `list`/`touch`
   are never called, not merely that the entry happens to be absent — a real test of the branch,
   not the visible symptom.

5. **Default-true (Decision 3) + backward-compat decode fallback.** `AgentPreferences.empty` takes
   `memoryEnabled` as an explicit parameter (domain stays pure); `AgentPreferencesService.
   DefaultMemoryEnabled` is the env-var-overridable default for *no row at all*.
   `AgentPreferencesRepository.rowToDomain` separately, deliberately hardcodes `true` (not the
   env-var default) when decoding a **pre-existing stored row** that predates this ticket and has
   no `memoryEnabled` key in its JSONB — correctly reasoned in the code comment (a stored row's
   absence must mean "no opt-out ever existed," which is always `true`, independent of any later
   ops-config change to the new-user default). This distinction is real and is explicitly
   regression-tested (`AgentPreferencesRepositorySpec`: raw-SQL-inserted `{"extras":{}}` row decodes
   to `memoryEnabled: true`).

6. **Tests re-run fresh, not trusted from the evaluator's paste.**
   - Ticket-relevant subset (8 specs I selected independently, not copied from evaluation-1.md):
     `AgentPreferencesServiceSpec`, `AgentMemoryServiceSpec`, `AgentMemoryRepositorySpec`,
     `AgentPreferencesRepositorySpec`, `AgentPreferencesRoutesSpec`, `AgentMemoryRoutesSpec`,
     `WorkspaceContextServiceAgentContextSpec`, `ApiRoutesSpec` → **273 tests, 0 failed, 8 suites,
     all passed** (23.8s).
   - `RlsOwnerTablesSpec` + `DashboardAuthoringPromptSpec` (the two "mechanical compile-fix only"
     files per files-modified.md) → **28 tests, 0 failed**, confirming those really are
     behavior-preserving.
   - Full `sbt test` → **3014 tests, 0 failed, 193 suites, all passed** (133s) — matches
     evaluation-1.md's claimed count exactly, reproduced independently rather than trusted.
   - `npm run check:scala-quality` → clean, 0 FQN violations. Manually grepped the diff for
     `com.helio.` occurrences outside `import` statements — none found; every hit is a legitimate
     import.
   - `npm run check:schemas` → 58 protocols in sync; read `schemas/agent-preferences.schema.json`,
     `schemas/put-memory-enabled-request.schema.json`, `schemas/workspace-context.schema.json`
     directly — all three correctly carry `memoryEnabled`, including the workspace-context file's
     self-contained duplicate `AgentPreferences` `$def` (an easy one to miss; the executor caught it
     and it's genuinely there in the diff).

7. **UI regression (Settings page, 420-D) — verified live in-browser**, not just via evaluator
   claim, since the response contract of an already-shipped consumer changed. Servers started/
   verified via `scripts/concertino/{start-servers,assert-phase}.sh` → `PASS servers`. Navigated to
   `/settings`: Preferences form renders and loads real stored values (series colors, panel style,
   naming conventions); `fetch('/api/preferences')` from within the page confirmed `memoryEnabled:
   true` is present on the wire without breaking anything. Clicked "Save preferences" → `PUT
   /api/preferences` returned 200, no console errors (0 errors across the session), page updated
   normally. Toggled light theme — no visual break (pre-existing UI, unaffected by this backend-only
   diff, confirmed rather than assumed). No new frontend surface exists (out of scope per the
   ticket), so no new DESIGN.md token/parity judgment applies here.

### Verdict: CONFIRM

All five acceptance criteria trace to real, independently-verified code and passing tests. The
ticket's single load-bearing correctness requirement (general `PUT /api/preferences` must never
reset `memoryEnabled`) was re-verified live over a fresh HTTP session I drove myself, not merely
re-read from the evaluator's report. The retention and opt-out judgment calls (Decisions 1–6) all
match their stated rationale in the actual diff, and the tests that claim to prove them are
substantively adversarial (prune-before-cap ordering, touch-doesn't-extend, list/delete-unaffected,
decode-fallback-on-legacy-row) rather than tautological. Full `sbt test` (3014/3014) and the
ticket-scoped subset were both reproduced fresh by me with the same result the evaluator reported.
No regressions found in the already-shipped 420-D Settings UI, exercised live in-browser.

### Non-blocking notes

- `AgentMemoryRepositorySpec.scala` is now 331 lines (soft budget 250, informational only, not a
  hard gate) — same observation the evaluator made; no action needed now.
- The two-endpoint split (Decision 1) does add permanent API surface. The design.md Risks section
  already flags this with a stated future-migration path (move `memoryEnabled` into the general
  body once 420-D's UI becomes aware of it); acceptable as scoped.
