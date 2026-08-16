## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Scope, per the orchestrator's framing: review the fold-in **revision** only (a new AC + a new
`tasks.md` section 6, approved post-review to close the evaluator's non-blocking suggestion
about missing coverage for design D5's malformed-baseline tolerant-parse branch). Cycle-1
scope (sections 1-5 of tasks.md, the shipped `bdec2540` implementation) is out of scope for
re-litigation and was not re-reviewed here except where needed to verify the revision's
soundness against the real implementation.

### What I verified (with evidence)

1. **Diff of the revision itself.** `git diff` on the five touched files
   (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`) shows only the
   claimed additions: ticket.md gained one new AC bullet, proposal.md one "What Changes"
   bullet, design.md one "Planner Notes" bullet, tasks.md a new "## 6." section (tasks 6.1/6.2).
   `git status --porcelain` confirms no backend/frontend source is touched — this is a
   docs-only plan revision, consistent with "test-only, no behavior change."

2. **The behavior under test already exists in the shipped implementation.** Read
   `backend/src/main/scala/com/helio/services/PipelineService.scala:243-256`:
   `parseBaselineSchema` already does `Try(json.parseJson.convertTo[Vector[SchemaField]])`,
   mapping `Failure` → `None` + `log.warn(...)`. This confirms the fold-in is genuinely
   test-only — no production code change is implied or needed, matching tasks.md 6.1's own
   "no production-code change expected."

3. **No existing test covers this branch.** `grep` across
   `PipelineAnalyzeRoutesSpec.scala` / `PipelineRunServiceSpec.scala` for
   `malformed|not-json` found nothing — confirms this is a real, currently-uncovered gap, not
   already-satisfied scope.

4. **No spec-requirement change needed.** Read
   `specs/pipeline-analyze-api/spec.md:13`: "A malformed persisted baseline SHALL be treated
   as no baseline (no drift reported, no error)" — the behavior is already normatively
   required by the merged spec delta. Adding a test for it is coverage-only; design.md's
   claim that re-archive can use `--skip-specs` is correct.

5. **`openspec validate pipeline-schema-drift-detection --strict` → `Change
   'pipeline-schema-drift-detection' is valid`.** Ran fresh, in-worktree.

6. **AC traceability.** New ticket.md AC → design.md D5 (already implemented) → tasks.md 6.1
   (the test to be written) → will close via `PipelineAnalyzeRoutesSpec` or
   `PipelineRunServiceSpec`. Chain is coherent.

7. **PR/workflow-state cross-check.** `gh pr view 364` confirms PR #364 is OPEN on
   `feature/pipeline-schema-drift-detection/HEL-462`, matching workflow-state.md's claim.
   `git log --follow -- '*files-modified.md'` confirms that file is dropped at archive time
   for this repo generally (same pattern on HEL-279/234/283/etc.), so its absence after
   un-archiving is expected, not a regression.

8. **The evaluator's original suggestion (evaluation-1.md:138-143) references a
   `PipelineServiceSpec` file and a "mocked return" that do not exist/match this codebase.**
   `find backend/src/test -iname "*PipelineService*"` → no results. The revised tasks.md 6.1
   wisely does *not* transcribe the evaluator's suggestion verbatim — it redirects to the
   two files that actually exist and hold the cycle-1 drift tests. Good instinct, but see
   Change Request 1 below: it doesn't fully close the gap it's trying to avoid.

9. **Empirically verified a concrete infeasibility in the literal "not-json" example**, using
   a disposable, throwaway local Postgres 18 instance (`/tmp/pgtest_hel462`, torn down after
   the check — never touched the shared dev Postgres, no dev server started):
   ```
   CREATE TABLE t (col jsonb);
   INSERT INTO t VALUES ('not-json');          -- ERROR: invalid input syntax for type json
   INSERT INTO t VALUES ('"not-json"');        -- INSERT 0 1 (succeeds; round-trips as "not-json")
   ```
   `pipelines.last_source_schema` is a real `JSONB` column (`V85__pipeline_last_source_schema.sql`),
   and `PipelineRepository.updateLastSourceSchema`/`findLastSourceSchema` write/read it as a raw
   Scala `String` with no application-side validation
   (`PipelineRepository.scala:342-364`). Postgres enforces JSON syntax validity on the
   column itself, independent of how the client types the bind parameter — a truly
   non-JSON string (the literal 8 characters `not-json`, unquoted) **cannot be persisted**
   to this column at all; the write itself throws. Only a syntactically-valid-but-wrong-shape
   JSON value (e.g. the JSON string `"not-json"`, i.e. the Scala literal `"\"not-json\""`)
   can reach `parseBaselineSchema`'s `.convertTo[Vector[SchemaField]]` failure branch via a
   real DB round-trip — which is in fact the correct scenario per ticket.md's own AC wording
   ("not valid **schema** JSON", not "not valid JSON").

10. **The existing cycle-1 tests in the two files task 6.1 names never use mocking.**
    `PipelineAnalyzeRoutesSpec.scala` (lines 26-101) and `PipelineRunServiceSpec.scala`
    (lines 1-60) both use a real `EmbeddedPostgres` + `Flyway` fixture exclusively — no
    Mockito/ScalaMock import in either file. The adjacent baseline-seeding tests at
    `PipelineAnalyzeRoutesSpec.scala:241-256` and `:258-279` seed the baseline via
    `await(pipelineRepo.updateLastSourceSchema(PipelineId(pid), <rawJson>, dummyUser))` — a
    real DB write, not a mock. (Mockito *is* a backend dependency and *is* used elsewhere,
    e.g. `PanelServiceResolveBindingsSpec.scala` — so "stub/mock" isn't nonsensical in this
    codebase in general, just inconsistent with the specific files task 6.1 points at.)

### Verdict: REFUTE

The revision's AC/proposal/design/tasks additions are traceable, genuinely test-only, and
require no spec-requirement change — the core of the fold-in is sound. But `design.md`'s
Planner Notes bullet and `tasks.md` task 6.1 both describe the test in terms that are
internally inconsistent and, on the most literal reading of the given example, factually
infeasible against the real database this test suite uses. This is exactly the class of
ambiguity worth closing before execution rather than after: the "cheap fix now vs. wasted
debug cycle later" trade this gate exists for.

### Change Requests

1. **Fix the malformed-baseline seed-value wording in `design.md` (Planner Notes, the
   "Fold-in" bullet) and `tasks.md` (task 6.1) — both currently say "non-JSON string"/"feed a
   non-JSON value" and "stub/mock the baseline read."** Neither survives contact with the
   real implementation:
   - `pipelines.last_source_schema` is a real `JSONB` column; Postgres rejects a literal
     unquoted `not-json` at write time (verified above) — that exact example, taken
     literally through the established real-DB seeding pattern already in
     `PipelineAnalyzeRoutesSpec` (lines 241-256/264-268), will throw at test setup, not
     reach `parseBaselineSchema`'s tolerant-parse branch at all.
   - `PipelineAnalyzeRoutesSpec` and `PipelineRunServiceSpec` — the two files task 6.1 itself
     names as the style to follow — use **zero mocking**; both are real-`EmbeddedPostgres`
     fixtures. "Stub/mock the baseline read" contradicts the very convention the task tells
     the executor to follow, and would produce a test that's stylistically inconsistent with
     every other test in whichever file it lands in.

   Replace with something unambiguous, e.g.: *"Extend `PipelineAnalyzeRoutesSpec` with a new
   case alongside the existing (a)/(b)(c) baseline tests: seed via
   `pipelineRepo.updateLastSourceSchema(pid, "\"not-json\"", dummyUser)` — a JSON value that
   is syntactically valid (a bare JSON string) but not schema-array-shaped, matching
   ticket.md's AC wording ('not valid **schema** JSON') — then assert `GET
   /pipelines/:id/analyze` returns 200 with no `sourceSchemaDrift` member. Do not introduce
   mocking; this suite is real-DB throughout."* ticket.md's own AC text ("not valid schema
   JSON") already gets this right — align design.md/tasks.md to it rather than the other way
   around.

### Non-blocking notes

- Once Change Request 1 is applied, the fold-in is otherwise ready: AC ⇄ design ⇄ tasks are
  consistent, the behavior is already implemented and already normatively specified (no spec
  delta needed, `--skip-specs` re-archive plan is correct), and `openspec validate` is clean.
- `tasks.md` 6.2's gate list (`sbt test`, `npm run check:schemas`) is a real, existing script
  (`package.json:12`) — fine as scoped.
