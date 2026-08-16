## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly:
  - AC1 (`pipelines.last_source_schema` nullable JSONB via Flyway, populated on each successful run) —
    `V85__pipeline_last_source_schema.sql` (additive `ALTER TABLE`, matches `V53__panel_column_widths.sql`
    precedent verbatim); persisted in `PipelineRunService.onUnblockedRunSuccess` via
    `pipelineRepo.updateLastSourceSchema`.
  - AC2 (`sourceSchemaDrift` optional object on analyze response, absent when no baseline/no drift) —
    `PipelineService.analyze` computes `PipelineSchemaDrift.diff` and sets the field; spray-json omits `None`
    (verified by test: `json should not include "sourceSchemaDrift"`).
  - AC3 (ScalaTest proves no-drift-on-first-run / removed-column / type-change) — all three covered in
    `PipelineSchemaDriftSpec` (pure) and again at the route level in `PipelineAnalyzeRoutesSpec` (integration).
  - AC4 (schema updated + validated) — `schemas/pipeline-analyze-response.schema.json` gains
    `SourceSchemaDrift`/`TypeChangedColumn` `$defs`, reuses the existing `SchemaField` `$def`; validated by two
    dedicated tests using the repo's `JsonSchemaValidation` harness (present and absent cases) and independently
    by `npm run check:schemas` (protocol/schema parity), both green.
  - AC5 (additive/backward-compatible, `sbt test` green) — confirmed by fresh `sbt test` run: 3060/3060 passed,
    194 suites (see Phase 2).
- [x] No AC silently reinterpreted.
- [x] All `tasks.md` items marked `[x]` and match the diff (verified 1.1/1.2, 2.1/2.2, 3.1, 4.1-4.3, 5.1-5.4
  against the actual code).
- [x] No scope creep — `git diff --name-only main...HEAD` touches only files listed in `files-modified.md`, all
  directly load-bearing for this ticket (migration, repo, domain diff helper, run/analyze services, protocol,
  schema, tests, planning artifacts). No unrelated refactors.
- [x] No regressions to existing behavior: `PipelineAnalyzeService.deriveSourceSchema` is a verbatim extraction
  of the pre-existing inline derivation (`sourceDataTypes.headOption.toVector.flatMap(_.fields).map(...)`) — the
  `analyze` code path is behavior-preserving. `onRunSuccess`/`onUnblockedRunSuccess` gained one threaded
  parameter (`sourceDataSourceId`); both are private methods with all call sites updated, no external contract
  change. Existing analyze consumers (frontend included) don't reference the new field — confirmed no frontend
  file references `sourceSchemaDrift` or the analyze response type in a way that would break.
- [x] API contract updated: `schemas/pipeline-analyze-response.schema.json` and
  `PipelineAnalyzeProtocol.scala` (`jsonFormat7` → `jsonFormat8`) both updated together, in the same change, as
  CONTRIBUTING.md requires.
- [x] Planning artifacts reflect the final implementation — design D1-D6 all traced to the corresponding code
  (shared `deriveSourceSchema`, table-local `lastSourceSchema` column kept off `*`, pure `PipelineSchemaDrift`
  diff, best-effort `recoverWith` persist hook, analyze-only drift computation, wire shape). Spec deltas
  (`specs/pipeline-analyze-api/spec.md`, `specs/pipeline-schema-drift/spec.md`) match implemented scenarios.
  `openspec validate pipeline-schema-drift-detection --strict` → "Change ... is valid" (re-run independently).

No issues.

### Phase 2: Code Review — PASS

**Gates re-run independently in `WORKTREE_PATH`** (backend-only change; no `frontend/**` files in the diff, so
frontend gates were not applicable per the routing rule):

- `cd backend && sbt test` → **3060/3060 tests passed, 194 suites, 0 failed** (fresh run, ~134s). Confirmed the
  new suites (`PipelineSchemaDriftSpec`, `PipelineAnalyzeRoutesSpec`'s HEL-462 cases, `PipelineRunServiceSpec`'s
  HEL-462 cases) executed and passed as part of this run.
- `node scripts/check-schema-drift.mjs` (`npm run check:schemas`) → PASS, "schemas in sync with JsonProtocols
  (60 checked across 45 protocol files)".
- `node scripts/check-scala-quality.mjs` (`npm run check:scala-quality`) → exit 0, "clean (113 soft warning(s))"
  — no inline-FQN violations introduced by this diff; the 113 soft (informational-only, per CONTRIBUTING.md)
  file-size warnings are pre-existing across the repo, not newly triggered by this change.
- `node scripts/check-openspec-hygiene.mjs` (`npm run check:openspec`) → **exit 1**, sole issue: "change
  'pipeline-schema-drift-detection' is complete (12/12) but not archived". This exactly matches the executor's
  account and this repo's established pre-archive convention (archival happens at the Delivery phase, not
  Execution) — verified myself rather than trusted on faith, per `verification-before-completion`.
- `openspec validate pipeline-schema-drift-detection --strict` → "Change ... is valid".
- Migration collision re-verified independently: `git fetch origin main` + `git ls-tree origin/main --
  backend/src/main/resources/db/migration/` tops out at `V84__pipeline_run_assertions.sql` — **no V85 collision
  on origin/main**, confirmed clean at review time.

**CONTRIBUTING.md compliance** (canonical standard, backend-binding):
- Imports & Qualifiers: no inline FQNs (mechanically confirmed via `check:scala-quality` above).
- File-size soft budgets: `PipelineAnalyzeService.scala` (527→544), `PipelineRunService.scala` (652→678),
  `PipelineService.scala` (752→790) were already over the ~400-line "propose a split" threshold before this
  change and grew modestly (13-38 lines each) for a genuinely small, cohesive addition (one shared helper, one
  JSON codec, one persist hook, one analyze-time diff call). Since the check itself is informational-only and
  none of these edits meaningfully changes the shape of an already-large file, I'm not treating this as a
  blocking violation — flagged as a non-blocking suggestion below.
- Per-domain JSON formatters live in `PipelineAnalyzeProtocol.scala` (a per-domain protocol file, not
  `JsonProtocols` the aggregator) — correct per CONTRIBUTING.md.
- `PipelineRepository.updateLastSourceSchema`/`findLastSourceSchema` mirror `updateLastRun`'s exact
  owner-scoped (`ctx.withUserContext` + `r.ownerId === ownerUuid`) targeted-projection pattern — consistent with
  the codebase's established repository convention (not a new one-off pattern), and the new
  `last_source_schema` column is deliberately kept off `PipelinesTable.*`/`PipelineRow`/the `Pipeline` domain
  model as design D2 specifies — verified by reading the table definition and the `*` projection.
  `dataTypeRepo != null` guard in `PipelineRunService.onUnblockedRunSuccess`'s new baseline-persist block
  follows the file's own pre-existing convention for this exact field (identical guard already present at
  line 503/615 on `main` before this change) — not a new anti-pattern introduced by this diff.
- DRY: the D1 shared `deriveSourceSchema` helper eliminates what would otherwise be a second, silently-divergent
  copy of the source-schema derivation between `analyze` and the run-success path — exactly the duplication the
  design calls out avoiding.
- Type safety: no untyped escape hatches; `SchemaDrift`/`TypeChangedColumn`/`SourceSchemaDriftResponse` are all
  typed case classes; JSON parsing goes through a typed `Try[Vector[SchemaField]]`, not raw `Any`.
- Error handling: baseline persistence is wrapped in `.recoverWith` (never fails/blocks the run, matches the
  `persistAssertions` best-effort convention cited in the design); a malformed persisted baseline is
  tolerant-parsed to "no baseline" with a `log.warn` naming the pipeline, never a hard analyze failure.
- Tests meaningful: `PipelineSchemaDriftSpec` covers no-baseline/identical/reordered/added/removed/type-changed/
  mixed/duplicate-name-collapse; `PipelineAnalyzeRoutesSpec` adds HTTP-route-level coverage for the same
  scenarios plus JSON-schema validation with/without the field; `PipelineRunServiceSpec` covers
  persist-on-success / skip-on-dry-run / skip-on-blocked-run / overwrite-on-subsequent-run — these are
  DB-integration tests (embedded/real Postgres via the existing harness) that would catch a real regression in
  the persistence wiring, not just the pure-function logic.
- No dead code: no unused imports, no leftover TODO/FIXME in the diff.
- No over-engineering: `PipelineSchemaDrift` is a small pure object with one public method; no premature
  abstraction (e.g. no generic "diff engine" beyond what's needed).
- Behavior-preserving where expected: the `analyze` derivation refactor (D1) is a pure extraction with no logic
  change, confirmed by reading both the old inline expression (on `main`) and the new shared helper — identical.

No blocking issues.

### Phase 3: UI Review — N/A

Triggers checked: no `frontend/**` files in the diff; `backend/src/main/scala/routes/ApiRoutes.scala` not
touched; `openspec/specs/**` not touched (only the change-scoped `openspec/changes/.../specs/` deltas, which
are not the trigger path). `schemas/pipeline-analyze-response.schema.json` **was** touched, which literally
matches the `schemas/**` trigger — I did not take the orchestrator's "backend-only, no UI review expected" note
on faith and instead verified it independently:
- `grep -rn "sourceSchemaDrift\|pipeline-analyze-response" frontend/src` → zero matches; no frontend code reads
  the new field or the schema file.
- The ticket's own "Out of scope" section explicitly excludes "Frontend surfacing of drift ... follow-up", and
  the proposal's Impact section states "No frontend changes; no behavior change for existing analyze consumers".
- The added field is purely additive/optional (`Option[...]`, omitted when `None`), so existing frontend TS
  types/parsing of the analyze response are unaffected regardless.
- The full HTTP-route round-trip (real Pekko route, embedded Postgres, JSON-schema validation against the exact
  contract a frontend consumer would receive) is already exercised by `PipelineAnalyzeRoutesSpec`, which is
  stronger evidence for this specific field than a manual UI click-through would be, since no UI consumes it.

Given zero frontend footprint and a Phase 3 checklist that is entirely browser/UI-oriented (breakpoints,
keyboard nav, accessible names, console errors), starting `start-servers.sh` would exercise no code path this
change touches and would carry unnecessary risk against the shared dev Postgres (per the HEL-521 precedent
called out for this run). No dev server was started. Marking N/A with this evidence rather than blank
deference to the orchestrator's note.

### Overall: PASS

### Non-blocking Suggestions

- `PipelineAnalyzeService.scala`, `PipelineRunService.scala`, and `PipelineService.scala` are all now well past
  the ~400-line "propose a split" soft budget in CONTRIBUTING.md (544/678/790 lines respectively). None of this
  change's edits are the proximate cause, but since all three were touched here, a follow-up ticket to split
  `PipelineService.scala` (790 lines, largest of the three) into smaller cohesive units would be worth queuing —
  not a request for this change.
- `PipelineService.parseBaselineSchema`'s malformed-JSON tolerant-parse branch (design D5's "malformed → no
  baseline, warn") has no direct test exercising an actually-malformed `last_source_schema` string — coverage
  today only exercises well-formed present/absent baselines. Not an AC requirement and low-risk (the column is
  only ever written by this change's own serializer), but a one-line `PipelineServiceSpec` case feeding
  `"not-json"` through `findLastSourceSchema`'s mocked return would close the gap cheaply if a future editor
  touches this path.
