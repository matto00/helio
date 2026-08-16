## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope, per the orchestrator's framing: verify that `skeptic-design-2.md`'s single Change
Request (fix the infeasible "non-JSON string via stub/mock" seeding description in
`design.md`'s Planner Notes fold-in bullet and `tasks.md` task 6.1) has been fully addressed,
and that the revised artifacts remain mutually consistent. Cycle-1 scope (sections 1-5 of
`tasks.md`, the shipped `bdec2540` implementation, already merged/PR'd) and the fold-in's
already-assessed-sound core (test-only, no spec-requirement change, `--skip-specs` re-archive)
are not re-litigated here except where touched by the revision.

### What I verified (with evidence)

1. **Read the round-2 report's Change Request in full**
   (`openspec/changes/pipeline-schema-drift-detection/skeptic-design-2.md:97-122`) to establish
   the exact bar for closure: replace "non-JSON string"/"stub/mock the baseline read" with
   language describing seeding via
   `pipelineRepo.updateLastSourceSchema(pid, "\"not-json\"", dummyUser)` — a syntactically
   valid bare-JSON-string value that is not schema-array-shaped — through the real-DB
   `PipelineAnalyzeRoutesSpec` convention, no mocking.

2. **Read the current `design.md` Planner Notes fold-in bullet** (lines 95-103) and **`tasks.md`
   task 6.1** (lines 53-59) fresh, in this worktree. Both now say: seed via
   `pipelineRepo.updateLastSourceSchema(pid, "\"not-json\"", user)` — "a value that is
   syntactically valid JSON (a bare JSON string ... ) but not schema-array-shaped," reaching
   `parseBaselineSchema`'s failure branch "through a real DB round-trip," with "Real
   `EmbeddedPostgres` [fixture] seeding, NO mocking (the file's convention is mock-free)."
   `grep -in "mock|stub"` over both files' relevant sections and the whole
   `PipelineAnalyzeRoutesSpec.scala` file returns zero matches — the old "stub/mock" language
   is fully gone, not just softened.

3. **Independently re-verified the JSONB-write-time-validation claim, not just trusted the
   prior report's throwaway-Postgres transcript.** Read
   `backend/src/main/resources/db/migration/V85__pipeline_last_source_schema.sql`: `pipelines.
   last_source_schema` is declared `JSONB` (Postgres validates JSON syntax on every write to
   this column type, independent of what the application sends). Read
   `PipelineRepository.scala:342-350` (`updateLastSourceSchema`): takes a raw `schemaJson:
   String` and writes it via `.update(Some(schemaJson))` with **no application-side
   validation** — Postgres is the sole gate. This corroborates, from first principles and
   fresh code reads (not the round-2 transcript), that a literal unquoted `not-json` cannot
   reach the column, while the bare JSON string `"not-json"` (Scala literal `"\"not-json\""`)
   can — exactly what the revision now specifies.

4. **Confirmed the revised value actually exercises the intended failure branch.** Read
   `PipelineService.scala:248-256` (`parseBaselineSchema`): `Try(json.parseJson.
   convertTo[Vector[SchemaField]])`. Parsing `"\"not-json\""` yields `JsString("not-json")`,
   and `.convertTo[Vector[SchemaField]]` on a `JsString` throws a `DeserializationException`
   (it's not a `JsArray`) — caught by `Try`, mapped to `Failure` → `None` + `log.warn`. The
   revised seed value reaches the exact tolerant-parse branch the fold-in exists to test.

5. **Confirmed the referenced convention/anchor is accurate.** Read
   `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala` (full file
   header + lines 108-274): the `HEL-462` baseline-seeding tests sit at lines 229-274 (design.md
   /tasks.md say "~241-268," a reasonable approximate anchor given the `~` prefix), all three
   seed baselines via `await(pipelineRepo.updateLastSourceSchema(PipelineId(pid), <json>,
   dummyUser))` against a real `EmbeddedPostgres` + `Flyway` fixture — zero Mockito/ScalaMock
   imports anywhere in the file. `updateLastSourceSchema(id: PipelineId, schemaJson: String,
   user: AuthenticatedUser)` and `findLastSourceSchema` both exist with the exact signature
   the revised prose calls out.

6. **AC ⇄ artifact consistency re-checked end to end.** `ticket.md`'s fold-in AC (lines 23-25:
   "not valid schema JSON (e.g. `\"not-json\"`)") was already correct in round 2 and is
   unchanged; `proposal.md`'s "What Changes" bullet (test-only, no behavior/spec change) is
   unchanged; `design.md` D5 + Planner Notes and `tasks.md` 6.1/6.2 now align with it word for
   word on the seed-value mechanics. No new contradiction introduced by the edit — `git diff
   HEAD -- design.md tasks.md ticket.md proposal.md` shows only the previously-described
   additions, nothing else moved.

7. **Spec/no-spec-delta claim re-confirmed.** `specs/pipeline-analyze-api/spec.md:1-11`: "A
   malformed persisted baseline SHALL be treated as no baseline (no drift reported, no
   error)" is present, unchanged by this revision — the fold-in remains test-only, no new
   requirement text needed, `--skip-specs` re-archive plan still correct.

8. **`openspec validate pipeline-schema-drift-detection --strict`** → `Change
   'pipeline-schema-drift-detection' is valid`. Ran fresh, in-worktree, this session.

9. **No unrelated drift.** `git status --porcelain` shows only the expected fold-in-related
   renames/edits (un-archive move + the five touched docs + this report); no backend/frontend
   source touched, consistent with a docs-only plan revision.

### Verdict: CONFIRM

The round-2 Change Request is fully closed: both `design.md`'s Planner Notes bullet and
`tasks.md` task 6.1 now describe a concrete, DB-verified-feasible seed value
(`pipelineRepo.updateLastSourceSchema(pid, "\"not-json\"", user)`) that reaches the intended
`parseBaselineSchema` failure branch through a real round-trip against the actual `JSONB`
column, following the file's established no-mocking `EmbeddedPostgres` convention exactly.
I independently re-derived the JSONB-validation and parse-failure mechanics from the current
migration/repository/service code rather than trusting the round-2 transcript, and they hold.
Ticket AC ⇄ proposal ⇄ design ⇄ tasks ⇄ merged spec delta are mutually consistent, `openspec
validate --strict` is clean, and no new ambiguity or infeasibility was introduced by the edit.
The fold-in is ready for execution.

### Non-blocking notes

- `tasks.md` 6.1's line anchor "~241-268" is a few lines off the real 229-274 range in the
  current file (the file has grown slightly since the anchor was written) — harmless given the
  `~` and the fact it also names the section by content ("alongside the existing
  baseline-seeding tests"), but the executor should locate the section by content, not by
  trusting the line numbers literally.
- Minor prose nit, not blocking: both revised bullets say `..., user)` where the actual local
  variable in `PipelineAnalyzeRoutesSpec.scala` is `dummyUser`; every other test in the file
  the executor is told to sit "alongside" already uses `dummyUser`, so this is unambiguous in
  context and not worth another round.
