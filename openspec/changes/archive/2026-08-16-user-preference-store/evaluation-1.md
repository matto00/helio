## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verified against ticket.md, proposal.md, design.md, tasks.md, and both spec deltas
(`agent-preferences-api`, `agent-preferences-persistence`):

- All 5 acceptance criteria addressed explicitly:
  - `agent_preferences` table (renamed from the ticket's literal `user_preferences` per the
    ticket's own human-approved "Escalation Resolution" section — not a reinterpretation, a
    documented, pre-authorized rename) created via V81 with `user_id UUID PRIMARY KEY`,
    `preferences JSONB NOT NULL DEFAULT '{}'`, `updated_at`, `ENABLE`+`FORCE` RLS, single
    owner policy — matches V42/V54 pattern exactly.
  - `GET/PUT /api/preferences` implemented on the authenticated route tree
    (`ApiRoutes.scala:554`, gated behind `authDirectives.authenticate`), returns
    default/empty object when unset, upserts and returns the persisted object on PUT.
  - RLS isolation proven by a real ScalaTest: `RlsOwnerTablesSpec`'s new `agent_preferences`
    section seeds via the real repository's `put` (not raw SQL), asserts
    `withUserContext(ownerA)` cannot see `ownerB`'s row, a genuine cross-user overwrite
    attempt via the app pool is rejected/has-no-effect, and `withSystemContext` sees both —
    exercised and passing (see Phase 2).
  - Round-trip of `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions`/`extras`
    covered at repository, service, and route levels (all three new spec files).
  - JSON Schema added (`schemas/agent-preferences.schema.json`), validated clean by
    `check-schema-drift.mjs`; `sbt test` passes (2871/2871); `check-scala-quality.mjs`
    reports no FQN violations.
- No AC silently reinterpreted. The only naming deviation (`AgentPreferences` vs. the
  ticket's literal `UserPreferences`) is documented as a pre-approved escalation resolution
  in `ticket.md` itself, carried through consistently in every file (domain class, repo,
  service, table, doc comments) — not an executor decision.
- All 12 `tasks.md` items marked done and match the implementation 1:1 against the diff
  (verified file-by-file: domain model, migration, repository, service, `Main.scala` wiring,
  protocol/formatters, routes, `ApiRoutes.scala` wiring, schema, and all 4 test additions).
  One minor granularity note (non-blocking): task 4.3 calls for "401 when unauthenticated" in
  the route-level test; the executor placed that specific assertion in `ApiRoutesSpec`
  (composed-route-tree layer) rather than the isolated `AgentPreferencesRoutesSpec`, with an
  inline comment explaining why (proves the request is rejected by `AuthDirectives` before
  ever reaching the route class, consistent with how other recent optional-wired routes —
  e.g. `metricServiceOpt` — are tested). Coverage is real and passing either way.
- No unnecessary changes outside ticket scope. `files-modified.md` matches
  `git diff --name-only main...HEAD` exactly; no unrelated refactors.
- No regressions: full `sbt test` run is 2871/2871 green, including all pre-existing suites.
- API contracts: `schemas/agent-preferences.schema.json` added, in sync with
  `AgentPreferencesProtocol.scala` per `check-schema-drift.mjs`.
- Planning artifacts (proposal.md/design.md/tasks.md) accurately reflect the final
  implementation — no drift found between documented decisions (Decisions 1–5, 4a) and the
  actual code.

### Phase 2: Code Review — PASS

Issues: none.

**Gates re-run fresh (not trusted from executor's report), in `WORKTREE_PATH`** (no
`CLEAN_WORKTREE` — not `slow` speed) — only `backend/**` files changed, no `frontend/**`:

- `cd backend && sbt test` → `Total number of tests run: 2871`, `Suites: completed 186,
  aborted 0`, `Tests: succeeded 2871, failed 0, canceled 0, ignored 0, pending 0`,
  `All tests passed.` (126s).
- Targeted re-run of the new/modified specs in isolation for extra confidence:
  `AgentPreferencesRepositorySpec`, `AgentPreferencesServiceSpec`,
  `AgentPreferencesRoutesSpec`, `RlsOwnerTablesSpec`, `RlsPolicyGuardSpec` →
  93/93 passed, including the new `agent_preferences` RLS section and the
  `agent_preferences` entry in the `rlsTables` allowlist.
- `node scripts/check-scala-quality.mjs` → clean (0 FQN violations; only pre-existing,
  unrelated file-size informational warnings on other files).
- `node scripts/check-schema-drift.mjs` → in sync (56 schemas checked across 44 protocol
  files, including the new `AgentPreferencesProtocol.scala`/`agent-preferences.schema.json`
  pair).

**Canonical standards compliance** (`CONTRIBUTING.md` — `DESIGN.md` not applicable, no
`frontend/**` changes):

- Imports & Qualifiers: no inline FQNs anywhere in the diff (mechanically confirmed by
  `check-scala-quality.mjs`); all new files use top-of-file imports.
- Per-domain protocol pattern followed correctly:
  `AgentPreferencesProtocol.scala` holds the DTOs + formatters, `JsonProtocols.scala` only
  mixes it into the `extends` chain (`JsonProtocols.scala:107`) — no formatter added to the
  aggregator directly, per CONTRIBUTING.md's explicit rule.
  `INSERT ... ON CONFLICT (user_id) DO UPDATE` via Slick `insertOrUpdate`
  (`AgentPreferencesRepository.scala:29`), always under `ctx.withUserContext(userId.value)` —
  never `withSystemContext` for a caller-scoped write, matching the
  `ApiTokenRepository`/`ImageUploadRepository` precedent CONTRIBUTING.md's "Database
  transactions & RLS context" section describes.
- "Adding a new ACL'd table" checklist (CONTRIBUTING.md, RLS section) followed exactly:
  `ENABLE`+`FORCE` RLS in the migration (V81), owner policy present, table added to
  `RlsPolicyGuardSpec`'s `rlsTables` allowlist (`RlsPolicyGuardSpec.scala:87`) — confirmed by
  the guard spec itself passing.
- File-size soft budgets: all new files well under the ~250-line budget
  (repository 100, service 38, protocol 45, routes 42, and the three new test files
  125/135/161 lines). `RlsOwnerTablesSpec.scala` (extended, not new) grows from 383→472
  lines, crossing the informational ~400-line "propose a split" guidance — flagged below as
  a non-blocking suggestion only, since (a) this is an informational-only soft budget per
  `check-scala-quality.mjs`'s own output, (b) extending this specific file rather than adding
  a new spec file was an explicit, justified design.md Decision 5 (reuse the existing
  EmbeddedPostgres/Flyway/`helio_app_test` harness rather than duplicate it).
- DRY: reuses `RlsOwnerTablesSpec`'s harness (Decision 5) instead of a new spec file; reuses
  the `jsonbStringType` pattern from `AlertRuleRepository`/`DataSourceRepository`/
  `ApiTokenRepository`; reuses the nullable-optional-repo wiring pattern
  (`agentPreferencesRepo: AgentPreferencesRepository = null` → `Option(...).map(...)` →
  `.fold(reject: Route)(...)`) already established by `metricRepo`/`alertRuleRepo`/etc. in
  `ApiRoutes.scala`.
- Readable: clear naming throughout, no magic values; the `updated_at`-is-repository-only
  design choice (Decision 4a) and the `extras`-absent-vs-explicit-`{}` normalization
  (Decision 4) are both well-documented at the point of implementation
  (`AgentPreferencesProtocol.scala`, `AgentPreferencesService.scala`).
- Modular: thin route shell delegates to service, service delegates to repository — proper
  separation, small composable units.
- Type safety: no untyped escape hatches; `JsObject`/`Option[JsObject]` used deliberately for
  the intentionally-schema-flexible fields (per ticket scope), not as a shortcut.
  `UUID.fromString(userId.value)`/`UUID.fromString(prefs.userId.value)` can throw on a
  malformed `UserId`, but `UserId` is only ever constructed from an already-validated
  authenticated session or path segment elsewhere in the codebase — consistent with how
  every other repository in this codebase handles `UserId`/`DashboardId` UUID conversion
  (no repository in the codebase guards this conversion defensively); not a new gap
  introduced by this change.
- Security: RLS is real (owner-only, `ENABLE`+`FORCE`, verified by a genuine
  non-superuser-role test, not just a policy-exists check); `userId` is always sourced from
  `AuthenticatedUser`, never trusted from the request body
  (`AgentPreferencesService.put` — `PutAgentPreferencesRequest` carries no `userId` field at
  all, so there is no injection surface for writing another user's row via the request).
- Error handling: appropriate for the endpoint's actual failure surface — neither `get` nor
  `put` can fail in a caller-visible way (no target-resource ownership check exists, unlike
  `PipelineScheduleService`), so the bare `onSuccess` (rather than `ServiceResponse.run`) is
  correct and matches existing precedent elsewhere (`AlertRuleRoutes.findAll`,
  `DashboardRoutes.findAll`) for non-failable service calls.
- Tests meaningful: real code-path coverage, not shallow — the RLS test performs a genuine
  cross-user raw-SQL overwrite attempt from the app pool (not just an assertion that the
  policy exists), the replace-not-merge behavior is tested at repository, service, and route
  layers independently, and the `extras`-absent-vs-explicit normalization has a dedicated
  test. These tests would catch a real regression (e.g. accidentally switching `put` to a
  merge, or accidentally routing `get`/`put` through `withSystemContext`).
- No dead code: no unused imports, no leftover TODO/FIXME anywhere in the diff.
- No over-engineering: no premature abstraction: introduced exactly what's needed
  (case class, repo, service, protocol, routes) with no speculative extension points beyond
  the ticket-specified `extras` escape hatch.
- Behavior-preserving where expected: this is a purely additive change; the existing
  unrelated `UserPreferences`/`UserPreferenceRepository`/`users.preferences`/
  `user_dashboard_zoom`/`PATCH /api/users/me/update` UI-theming feature is untouched (verified
  by diff — no lines touch `AuthProtocol.scala`, `UserPreferenceRepository.scala`, or any
  existing migration).

### Phase 3: UI Review — N/A

This ticket is backend-only per its own "Out of scope" section (management UI is the
separate downstream ticket 420-D). No `frontend/**` files changed
(`git diff --name-only main...HEAD | grep '^frontend/'` → empty). The mechanical trigger
list technically fires on the new `schemas/agent-preferences.schema.json` file, but there is
no UI anywhere in this ticket's scope that consumes `GET/PUT /api/preferences` — the only
future consumers are the agent-authoring context (420-C) and the management UI (420-D),
both explicitly out of scope here. Standing up dev servers and Playwright to exercise a
"happy path" through a UI that doesn't exist would not exercise anything this ticket
actually changed. The HTTP-layer behavior itself (happy path, default-object response,
round-trip, 401 unauthenticated) is already exercised end-to-end against a real embedded
Postgres via `AgentPreferencesRoutesSpec`/`ApiRoutesSpec` (Phase 2) — the equivalent
API-level coverage for a route with no UI surface.

### Overall: PASS

### Non-blocking Suggestions

- `RlsOwnerTablesSpec.scala` grew from 383 to 472 lines (informational soft-budget guidance
  is ~250/consider-split-above-~400). This was a deliberate, justified reuse decision
  (design.md Decision 5) rather than an oversight, and `check-scala-quality.mjs` treats this
  as informational-only — no action required now, but worth keeping in mind if this file
  keeps growing with future RLS-table additions.
