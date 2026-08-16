## Evaluation Report — Cycle 2 (evaluation-2.md)

Scope note: this is a resumed review. Cycle 1 (`evaluation-1.md`) already PASSed the full implementation
(commit `bdec2540`); this cycle re-scopes to what changed since — the approved post-delivery-review fold-in
(a direct test for the malformed-`last_source_schema` tolerant-parse branch), the un-archive mechanics that
carried it, and the revised planning artifacts. Reviewed via `git diff 808f4d68..395f0f84` (the archive commit
→ the fold-in commit) plus a fresh full gate re-run; cycle-1 findings are not re-litigated.

### Phase 1: Spec Review — PASS

- [x] New AC addressed explicitly: `ticket.md` gained one AC ("A direct unit test covers the malformed-baseline
  tolerant-parse branch ... analyze returns 200 with no `sourceSchemaDrift` member and no error"), matched
  1:1 by the new `PipelineAnalyzeRoutesSpec` case ("(HEL-462 fold-in) omit sourceSchemaDrift and surface no
  error when the persisted baseline is syntactically-valid but not schema-array-shaped JSON").
- [x] No AC reinterpreted — the fold-in AC's language ("not valid schema JSON (e.g. `"not-json"`)") matches
  what the test actually seeds (`pipelineRepo.updateLastSourceSchema(pid, "\"not-json\"", dummyUser)` — a bare
  JSON string, which is syntactically valid JSON but not `[{name,type}]`-shaped, i.e. exactly the "not valid
  schema JSON" the AC describes).
- [x] `tasks.md` section 6 (6.1/6.2) marked `[x]`, matching the implemented test and the gates the executor ran.
- [x] No scope creep: `git diff 808f4d68..395f0f84 --name-only` touches exactly one test file plus the
  un-archive/planning-doc moves (`.openspec.yaml`, `design.md`, `evaluation-1.md`, `proposal.md`,
  `skeptic-design-1/2/3.md`, `skeptic-final-1.md`, `specs/*.md`, `tasks.md`, `ticket.md`, `workflow-state.md`) —
  **zero files under `backend/src/main/**` or `backend/src/main/resources/db/migration/**`** changed. Confirmed
  with `grep -E "^backend/src/main|migration"` against the name-only diff → no matches. This is test-only, as
  both the executor's commit message and the orchestrator's summary claimed — verified, not trusted.
- [x] No regressions: the new test only adds a case; the three pre-existing HEL-462 test cases in the same
  file are untouched (diff is a pure addition at the end of the `describe` block).
- [x] No API-contract change needed or made — the fold-in is test-only per design (`--skip-specs` re-archive is
  correctly planned since no spec-requirement text changed; `specs/pipeline-analyze-api/spec.md`'s existing
  "A malformed persisted baseline SHALL be treated as no baseline" scenario already covers this behavior,
  confirmed unchanged in the diff).
- [x] Planning artifacts (`ticket.md` AC, `proposal.md` "What Changes" bullet, `design.md` Planner Notes +
  D5 cross-reference, `tasks.md` section 6) are mutually consistent with each other and with the implemented
  test — re-read all four in full, plus `skeptic-design-2.md`/`skeptic-design-3.md`, which document the
  round-2→round-3 design-gate cycle that produced the current (feasible, DB-round-trip, no-mocking) phrasing.
  `openspec validate pipeline-schema-drift-detection --strict` → "Change ... is valid" (re-run independently,
  fresh).

No issues.

### Phase 2: Code Review — PASS

**New test is real and non-vacuous** — independently traced the failure path, not just read the assertion:
- `PipelineRepository.updateLastSourceSchema(id, schemaJson: String, user)` writes `schemaJson` verbatim into
  the `last_source_schema JSONB` column with no application-side validation (`PipelineRepository.scala:342-350`
  read directly) — Postgres is the sole JSON-syntax gate, which is why a truly malformed string (e.g. bare
  `not-json` without quotes) can never reach the column, and why the test instead seeds the Scala string literal
  `"\"not-json\""` (the 10-character JSON string `"not-json"`) — syntactically valid JSON, semantically wrong
  shape.
- `PipelineService.parseBaselineSchema` (`PipelineService.scala:243-256`, read in full) does
  `Try(json.parseJson.convertTo[Vector[SchemaField]])`. Parsing `"\"not-json\""` yields `JsString("not-json")`;
  `.convertTo[Vector[SchemaField]]` via the standard spray-json list format requires a `JsArray` and throws
  `DeserializationException` on a `JsString` — caught by `Try`, routed to the `Failure(ex) => log.warn(...); None`
  branch. This is exactly the branch the fold-in exists to exercise, confirmed by code inspection rather than by
  trusting the commit message's claim that "the warn + DeserializationException branch actually fires."
- The test seeds via the real `pipelineRepo.updateLastSourceSchema` against the file's existing
  `EmbeddedPostgres` + `Flyway` fixture (same pattern as the three sibling HEL-462 tests immediately above it in
  the file) — no mocking, confirmed by `grep -in "mock|stub"` over the file returning zero matches.
- Assertion (`status shouldBe StatusCodes.OK`, `resp.sourceSchemaDrift shouldBe None`) matches the AC and the
  spec delta's existing "no baseline, no error" scenario.

**Gates re-run independently, fresh, in `WORKTREE_PATH`** (still backend-only; no `frontend/**` files touched):
- `cd backend && sbt test` → **3061/3061 tests passed, 194 suites, 0 failed** (+1 vs cycle 1's 3060, matching
  exactly one new test case). Confirmed the new case
  `"- should (HEL-462 fold-in) omit sourceSchemaDrift and surface no error when the persisted baseline is
  syntactically-valid but not schema-array-shaped JSON"` executed and is counted among the passes.
- `npm run check:schemas` → PASS, unchanged from cycle 1 ("schemas in sync ... 60 checked across 45 protocol
  files") — expected, since no protocol/schema file changed this cycle.
- `npm run check:scala-quality` → exit 0, clean (113 informational soft warnings, same pre-existing set as
  cycle 1 — no new file-size or inline-FQN issues from a test-only addition).
- `npm run check:openspec` → **exit 1**, sole issue: "change 'pipeline-schema-drift-detection' is complete
  (14/14) but not archived" (task count moved from 12/12 → 14/14 reflecting the two new task-6 items, all
  checked). Same expected pre-archive convention as cycle 1 — verified myself, not taken on the executor's word.
- `openspec validate pipeline-schema-drift-detection --strict` → valid.
- Commit `395f0f84`'s `-n` bypass rationale in the commit body matches this independently-verified gate
  breakdown exactly (fresh `sbt test` 3061/3061, `check:schemas` clean, sole failure `check:openspec`
  pre-archive) — CONTRIBUTING.md's "any bypassed checks must be called out explicitly" is satisfied, same as
  cycle 1's precedent it cites (`bdec2540`).

**CONTRIBUTING.md compliance**: test-only diff, no inline FQNs (mechanically confirmed above), no dead code, no
new abstractions. Nothing to flag.

No blocking issues.

### Phase 3: UI Review — N/A

Same reasoning as cycle 1: zero `frontend/**` files in this cycle's diff, `ApiRoutes.scala` untouched,
`openspec/specs/**` untouched by this cycle's diff (the `openspec/specs/pipeline-analyze-api` and
`pipeline-schema-drift` sync happened at the *prior* archive commit `808f4d68`, not in the reviewed
`808f4d68..395f0f84` range), and `schemas/**` was not touched this cycle either (only touched in cycle 1, already
reviewed). No dev server started; per the orchestrator's environment note and the shared-Postgres hazard from
cycle 1, none was needed.

### Overall: PASS

No change requests. Both cycle-1 non-blocking suggestions have already been actioned outside this change: the
malformed-baseline test gap is closed by this fold-in, and the file-size follow-up was spun off as HEL-689 per
`workflow-state.md`'s triage record (not part of this change's scope).
