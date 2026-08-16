## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verified against ticket.md/proposal.md/design.md/tasks.md/specs deltas:

- AC1 (opt-out: `add` no-op, grounding surfaces no memory, existing entries preserved) — fully
  implemented and proven by ScalaTest: `AgentMemoryServiceSpec` ("be a no-op when memoryEnabled
  is false", "behave normally when memoryEnabled is true"), `WorkspaceContextServiceAgentContextSpec`
  ("7.3 memoryEnabled opt-out" — inserts an entry directly via the repository, bypassing `add`'s
  own no-op, to prove `buildAgentContext` skips the `list`/`touch` call entirely rather than the
  entry merely being absent), `AgentMemoryRoutesSpec` (GET/DELETE/clear-all all unaffected by
  `memoryEnabled = false`). Also independently confirmed live (see Phase 3) — a second `add` while
  disabled returns 201 but the entry never appears in a subsequent `list`.
- AC2 (retention: excluded from reads + pruned) — `AgentMemoryRepositorySpec`'s new "HEL-531
  (420-E) — retention" block covers over-age-excluded-and-deleted (with a direct follow-up
  `SELECT count(*)` proving physical deletion, not just filtering), within-window-unaffected,
  prune-runs-before-cap-and-evict (a deliberately adversarial fixture: an over-age but recently
  *touched* entry vs. a within-window but never-touched entry, to catch exactly the
  prune-after-cap ordering bug the spec's own comment calls out), and touch-does-not-extend-
  retention.
- AC3 (opt-out flag readable/writable via preferences API, documented default) — `GET /api/preferences`
  always returns `memoryEnabled`; new `PUT /api/preferences/memory-enabled` is dedicated and
  separate from the full-replace endpoint per design.md Decision 1; default `true` is
  env-var-overridable (`AGENT_MEMORY_DEFAULT_ENABLED`) and documented in-code and in design.md
  Decision 3.
- AC4 (retention window documented + coordinated with HEL-438) — `RetentionDays` (default 90,
  `AGENT_MEMORY_RETENTION_DAYS`) is documented in `AgentMemoryService.scala`'s doc comment,
  design.md Decision 6, and the retention spec delta, explicitly flagged as a placeholder pending
  HEL-438 (which the design-gate skeptic independently confirmed via Linear has no concrete value
  of its own yet).
- AC5 (additive/backward-compatible, `sbt test` passes, no FQNs) — confirmed independently (see
  Phase 2): full `sbt test` = 3014/3014 passing; `npm run check:scala-quality` clean (no inline
  FQNs); the load-bearing correctness requirement (a general `PUT /api/preferences` save must not
  reset a previously-set `memoryEnabled`) is both unit-tested (`AgentPreferencesServiceSpec`),
  route-tested (`AgentPreferencesRoutesSpec`), and independently re-verified live over HTTP in
  Phase 3.
- All 22 tasks.md items map 1:1 to diff hunks; nothing marked done is unimplemented, nothing
  implemented is undocumented.
- No AC silently reinterpreted. No scope creep — every changed file is either a direct target of
  the ticket's Impact section or a compile-forced test-literal update the executor explicitly
  called out in files-modified.md (`DashboardAuthoringPromptSpec.scala`, `RlsOwnerTablesSpec.scala`
  gaining `memoryEnabled`/`retentionDays` args — purely mechanical, no behavior change).
- No regressions to existing behavior: `AgentMemoryService.list`/`AgentMemoryRepository` reads for
  the already-shipped 420-D management UI are genuinely unaffected by the opt-out flag (design.md
  Decision 4, confirmed both by the diff — `list` never touches `preferences` — and live in Phase
  3). The existing four-field `PUT /api/preferences` full-replace/clear-on-omission semantics are
  untouched (only the added read-then-carry-forward for `memoryEnabled`).
- API contracts updated: `schemas/agent-preferences.schema.json` (new field), new
  `schemas/put-memory-enabled-request.schema.json`, and — caught correctly by the executor —
  `schemas/workspace-context.schema.json`'s self-contained duplicate `AgentPreferences` `$def`.
  `npm run check:schemas` passes (58 protocols in sync).
- Planning artifacts (design.md, spec deltas) accurately describe the final implementation; no
  drift found between design.md's Decisions 1–6 and the actual diff.

### Phase 2: Code Review — PASS

Issues: none.

Gates re-run fresh in `WORKTREE_PATH` (not `CLEAN_WORKTREE`, so no throwaway worktree needed —
`EVALUATOR_CLEAN_WORKTREE=false` per workflow-state.md):

- `cd backend && sbt test` → **3014 tests, 0 failed, 193 suites, all passed** (132s). Also ran the
  ticket-relevant subset individually first (301 tests across the 10 touched/added specs) — all
  green.
- `npm run check:scala-quality` → clean, 0 FQN violations (111 pre-existing informational
  file-size soft-warnings, none newly introduced by files this ticket touches crossing the ~400
  line "propose a split" threshold — largest touched file is `AgentMemoryRepositorySpec.scala` at
  331 lines).
- `npm run check:schemas` → in sync (58 protocols checked).
- `npm run check:openspec` → only flags "complete but not archived," expected pre-archival state,
  not an evaluator concern.
- Frontend gates (`npm run lint`/`format:check`/`test`/`build`) not applicable — no `frontend/**`
  files changed (confirmed via `git diff --name-only main...HEAD`).

Standards compliance (CONTRIBUTING.md, read fresh):

- **Imports & Qualifiers** — no inline FQNs anywhere in the diff; `AgentPreferencesRepository.scala`
  correctly uses the existing `import spray.json._` wildcard for `JsBoolean` rather than inlining it.
- **File-size budgets** — no touched file crosses the ~400-line "propose a split" threshold.
- **ACL triad / DbContext discipline** — no new per-id read method added; `pruneExpired` runs under
  the same `withUserContext` the caller (`list`/`add`) already established, not a new bare `db.run`.
- **DRY** — retention/opt-out logic threaded through the existing service-layer-owns-constants
  precedent (`cap: Int`/`MaxEntriesPerUser`) rather than duplicating it; `put`/`setMemoryEnabled`
  share the same `AgentPreferencesRepository.put` primitive with no new repository method needed.
- **Readable** — `RetentionDays`/`DefaultMemoryEnabled` are named constants with doc comments
  explaining the env-var override and the HEL-438 placeholder framing; no magic numbers.
- **Modular** — opt-out check and retention pruning are each a single, small, well-isolated
  addition to their respective layers; `AgentMemoryService`'s new `AgentPreferencesService`
  dependency is an internal composition, not a new external coupling.
- **Type safety** — no untyped escape hatches introduced; `PutMemoryEnabledRequest` is a proper
  minimal case class, not a loosely-typed JSON blob.
- **Security** — `PUT /api/preferences/memory-enabled` sits behind the same `AuthDirectives`
  pipeline (auth + CSRF) as every other mutating route (independently confirmed live in Phase 3:
  both the 401-without-auth composed-route test and a live CSRF-header requirement were exercised).
- **Error handling** — `add`'s no-op-when-disabled deliberately returns a normal success per
  design.md Decision 5 (documented, not a silent failure — it's an intentional, spec'd no-op, and
  the ticket's own AC1 language "writes nothing" matches this framing exactly).
- **Tests meaningful** — every new test asserts on a real observable (row counts via direct SQL,
  not just service-layer return values; adversarial fixtures for the prune-before-cap ordering
  case). These would catch a real regression — verified by temporarily inspecting the
  prune-before-cap test's own comment describing exactly the bug a naive implementation would hit.
- **No dead code** — no unused imports or leftover TODO/FIXME found in the diff.
- **No over-engineering** — the two-endpoint split (design.md Decision 1) is justified by a real,
  mechanically-certain hazard (confirmed independently in Phase 3, live), not a hypothetical.
- **Self-reported bug fix verified real**: the executor's files-modified.md claims pre-existing
  hardcoded `2026-01-01`/`2026-02-01` calendar-date anchors in
  `WorkspaceContextServiceAgentContextSpec.scala`'s ranking/touch tests would fall outside the new
  90-day retention default relative to the current date, and fixed them to `Instant.now()`-relative.
  Confirmed real and correctly scoped: the diff shows exactly this substitution, isolated to the
  two pre-existing tests that call `agentMemoryRepo.add`/`list` without `NoPruning`'s escape hatch,
  while the *new* retention-specific tests in the same file and in `AgentMemoryRepositorySpec`
  correctly use `Instant.now()`-relative anchors (`retentionBase`) from the start, and the
  *unrelated* cap-and-evict tests in `AgentMemoryRepositorySpec` keep their original fixed
  `2026-01-01` anchor (`base`) unchanged precisely because those all pass `NoPruning` and are
  therefore genuinely retention-immune — a targeted, correctly-scoped, behavior-preserving test
  fix, not a hidden production-code change. Full re-run confirms all these tests pass now.

### Phase 3: UI Review — PASS

No `frontend/**` files changed, but this ticket's diff touches `ApiRoutes.scala` and `schemas/**`,
which match the stated Phase 3 triggers, so this phase was run for real rather than marked N/A —
scoped to (a) direct verification of the new backend surface and (b) a regression check of the
one already-shipped UI consumer whose response contract changed (420-D's Settings page, via
`GET`/`PUT /api/preferences`). No new frontend entry point exists (the UI toggle is explicitly out
of scope per the ticket).

Servers started via `scripts/concertino/start-servers.sh`/`assert-phase.sh` → both `PASS servers`.

- **Happy path end-to-end (live HTTP, backend)**: opted out via `PUT /api/preferences/memory-enabled`
  → `GET /api/preferences` reflects `memoryEnabled: false`; opted back in → reflects `true`.
  **The load-bearing correctness requirement re-verified live**: opted out, then `PUT
  /api/preferences` with only `defaultSeriesColors` (no `memoryEnabled` in the body, exactly
  matching what the shipped Settings UI actually sends) → response and a subsequent `GET` both
  still show `memoryEnabled: false` — the general full-replace endpoint does NOT reset the flag.
  `POST /api/agent/memory` while disabled returns 201 with the constructed entry but a subsequent
  `GET /api/agent/memory` shows it was never persisted, while an entry added before opt-out
  remains visible — confirms AC1's "previously-stored entries remain until cleared" live, not just
  in ScalaTest.
- **Management UI unaffected by opt-out (live)**: with `memoryEnabled: false`, `GET
  /api/agent/memory` still returns the pre-opt-out entry — matches design.md Decision 4 exactly.
- **Settings page regression check (browser)**: navigated to `/settings`, confirmed the existing
  Preferences form (series colors, panel style, naming conventions) renders and loads its stored
  values correctly with the new `memoryEnabled` field present on the wire (which
  `settingsService.ts`'s `normalizePreferences` correctly drops when reshaping into the typed
  `AgentPreferences` object — no crash, no type error). Clicked "Save preferences" — `PUT
  /api/preferences` returns 200, page updates normally.
- **No console errors**: 0 errors across every tested interaction (page load, user-menu open,
  settings navigation, save-preferences click) and across all four required breakpoints
  (1440/1100/768, plus default).
- **Loading/empty states**: the pre-existing "No memory stored yet" shared empty-state component
  renders correctly on the Agent memory section — unaffected by this ticket (confirms `list` truly
  wasn't touched).
- **Entry points**: the only entry point for this ticket's new surface is the API itself (by
  design — the UI toggle is out of scope); both new/changed endpoints were exercised directly.
  Existing entry points (`GET/PUT /api/preferences`, `GET/DELETE /api/agent/memory[/:id]`) verified
  unaffected both live and by the pre-existing/extended test suites.
- **Accessible names / keyboard support**: N/A for this ticket — no new interactive UI elements
  were added (no `frontend/**` changes); pre-existing Settings page controls retain their existing
  accessible names, unaffected by the backend-only diff.
- **Breakpoints**: 1440/1100/768 all checked on the pre-existing Settings page — zero console
  errors, no layout break introduced (none expected, since no CSS/layout code changed).

### Overall: PASS

### Non-blocking Suggestions

- `AgentMemoryRepositorySpec.scala` grew to 331 lines (informational soft-budget warning only, well
  under the ~400-line "propose a split" threshold) — no action needed now, but worth keeping in
  mind if a future ticket adds more retention/cap-and-evict coverage to this file.
