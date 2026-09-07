# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `ff79ebe2`. All gates re-run by me in the worktree (not trusted from the
executor's report).

## Phase 1: Spec Review — PASS

- AC1/AC2 (truncation survives a reload, persisted not session-only): met. `pipeline_runs
  .truncated_reads` + `pipelines.last_run_truncated`; `PipelineDetailPage.tsx:177-190` falls back to
  the persisted signal, and run history is fetched on mount
  (`usePipelineDetailPage.ts:430-434`), so the fallback is actually reachable on a cold load —
  verified, not assumed.
- AC3 (no false positives, including historically): met at the code level — `truncated` is derived
  `reads.nonEmpty` everywhere, never independently stored, and no surface renders anything for
  `false`/`null`. The *test* for the at-cap boundary is not real evidence — see CR2.
- AC4 (a truncated persisted count is visually distinguishable): met in all three surfaces
  (footer, run history modal, list table), icon + text, never colour alone.
- AC5 (schemas/openspec in the same change): met; `node scripts/check-schema-drift.mjs` passes.
- Three-state model holds end to end. I enumerated every write against `pipeline_runs`
  independently (`grep updateRunTerminal|insertDryRun|runsTable +=` across `backend/src/main`):
  `recordUnrunnable` (:231), the run-failure path (:925), the blocked path (:1064), success
  (:1222), dry run (:1001), and both `SparkJobSubmitter` sites (:90, :107) all pass a non-NULL
  value. `insertRunInternal`'s queued row is the one permitted NULL, and it persists no row count.
  No read path collapses not-recorded into complete: `history` maps the column with `.map(...)`, so
  NULL never constructs a `RunTruncationRecord`.
- Notice is recomposed, not stored — `parseTruncationRecord` calls the same
  `PipelineRunService.composeTruncationNotice` with the same `InProcessPipelineEngine.MaxRunRows`,
  and the byte-identity is asserted against the live result in `PipelineRunServiceSpec`.
- Migration: V104 is the correct next free number (shared dev DB shows V103 applied by the
  concurrent HEL-955 run); `git diff --name-only main...HEAD -- .../db/migration` shows exactly one
  added file and zero edits to applied migrations. `ADD COLUMN ... NULL`, no DEFAULT, no backfill —
  as designed.
- Forbidden files: none touched (`ApiRoutes.scala`, `Connector*`, `RestApiConnectorDriver`,
  `ConnectorRepository`, `helio-mcp/src/{types,helioApi}.ts`, `frontend/src/shared/chrome/**`,
  `DashboardList.css` — grep over the changed-file list returns nothing).
- Tasks all marked done and matching what shipped. No scope creep observed.

## Phase 2: Code Review — FAIL

Gates, all run by me in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 261 suites / 2683 tests (frontend), 25 / 248 (helio-mcp) |
| `npm --prefix frontend run build` | PASS |
| `node scripts/check-schema-drift.mjs` | PASS |
| `cd backend && sbt -batch test` | PASS — 3962 tests, 266 suites, 0 failed (334s) |

Issues: CR1–CR4 below.

## Phase 3: UI Review — BLOCKER

`scripts/concertino/start-servers.sh` FAILed: the backend never became healthy.

```
FATAL: helio backend failed to start
org.flywaydb.core.api.exception.FlywayValidateException: Validate failed: Migrations have failed validation
Detected applied migration not resolved locally: 103.
```

(`.concertino-backend.log`). This is the documented shared-dev-DB Flyway collision: the concurrent
HEL-955 worktree has already applied `V103__pending_connectors.sql` to the single shared `helio`
database, and that file does not exist on this branch, so Flyway's validate fails before any
migration is applied. **It is not caused by this change** — V104 is correctly numbered and no
applied migration was edited. I deliberately did not run `flyway repair` or otherwise mutate the
shared database, since that would break the concurrent run.

Required: human intervention (or re-run Phase 3 once HEL-955's V103 is on a branch this worktree
can resolve). Browser-level verification of the three rendered surfaces is therefore **not done**;
the frontend evidence in this report is code + Jest only.

**Shared-DB hygiene:** my run created nothing. The backend exited before applying any migration;
`sbt test` uses embedded Postgres. Confirmed by query: `flyway_schema_history` top rank is still
103 (V104 not applied) and `pipeline_runs` count is unchanged at 853. Nothing to delete.

## Overall: FAIL

## Change Requests

1. **`primaryAvailableRowCount` can report a value that is not the primary source's.**
   `PipelineRunService.scala:785` recovers it as `reads.headOption.flatMap(_.availableRowCount)`.
   In `truncationFields` (:126-132) the primary's entry is prepended *only when the primary itself
   was truncated*; when the primary was complete and a `join`/`union`/`lookup` secondary was
   truncated, `reads.head` is that **secondary**, and its available count is then published on the
   wire under a primary-scoped name. The live path (`RunResultResponse.sourceAvailableRowCount`)
   uses `primaryStats.availableRowCount` and is correct, so the same run reports two different
   numbers depending on which surface reads it — the exact "plausible number with nothing to
   distrust it" this ticket exists to remove. The doc comment on `RunTruncationRecord`
   (`PipelineProtocol.scala:200-206`) already claims recovery happens only "when the primary
   source's own read is present among `reads`", but the code does not enforce that, so the comment
   is currently false. Fix either by persisting the primary's own available count explicitly (e.g.
   store `{"primaryAvailableRowCount": …, "reads": [...]}` instead of a bare array — the column is
   new, so there is no legacy shape to preserve) or by emitting `None` unless the head entry is
   provably the primary. Update the doc comment to match whichever is implemented.

2. **The at-cap boundary test (task 6.4, AC "no false positives") does not test the boundary.**
   `PipelineRunServiceSpec.scala:1645-1655` ("an at-cap (non-truncated) reads vector persists and
   reads back as complete") re-runs `RestSuccessUrl` — the identical scenario as the
   "a complete run persists `[]`" test 20 lines above — and its own comment concedes the fixture is
   "well under any cap". It is a duplicate assertion presented as boundary evidence, and grep
   confirms no test anywhere in `backend/src/test` exercises a source of exactly
   `InProcessPipelineEngine.MaxRunRows` (1000) rows through this path. The stub connector already
   keys behaviour off the URL (`PipelineRunServiceSpec.scala:91-92`), so add a `RestAtCapUrl`
   returning exactly 1000 rows and assert it persists `reads` empty / `truncated = false`; or
   delete the test and state where the boundary is covered instead. Do not leave a test whose
   comment describes coverage it does not provide.

3. **The three "Partial" markers have no CSS and are duplicated three times.**
   `pipeline-detail-page__meta-bar-partial` (`PipelineDetailFooter.tsx:116`),
   `pipeline-list-table__row-count-partial` (`PipelineListTable.tsx:130`) and
   `run-history-modal__row-count-partial` (`RunHistoryModal.tsx:134`) match **zero** rules in any
   stylesheet (`grep -rn 'row-count-partial\|meta-bar-partial' frontend/src --include=*.css` →
   no hits). The marker therefore renders in inherited body colour with no spacing, while HEL-861's
   sibling banner 40 lines away uses `--app-warning`/`--app-warning-surface`/`--space-*`
   (`PipelineDetailPage.css:1776-1789`) — a visible inconsistency for the same signal, and three
   dead classNames. The same ~12-line block (identical `role`, `aria-label`, `title` and glyph) is
   copy-pasted into all three files. Extract one small component under
   `frontend/src/features/pipelines/ui/` (single source for the accessible-name string) and give it
   token-based CSS reusing the `--app-warning` family. Point the existing tests at the shared
   component.

4. **`parseTruncatedReads` handles one malformed shape and throws on the rest.**
   `PipelineRunService.scala:791-808` catches only the non-`JsArray` case. Anything else —
   unparseable text (`json.parseJson` throws `ParsingException`), a non-object array element
   (`asJsObject`), or a missing `dataSourceName`/`rowsRead` (`obj.fields(...)` →
   `NoSuchElementException`) — propagates out of `history` and fails the entire
   `GET /api/pipelines/:id/run-history` request, so one bad row hides every run. Given the executor
   chose a hand-rolled parser (a defect surface by construction), it must be total: wrap the whole
   per-record decode in a `Try`, log at the same level as the existing non-array branch, and degrade
   that record to not-recorded (`None`) rather than empty-and-complete — collapsing an
   undecodable row into `[]` would assert completeness, which this capability forbids.

## Non-blocking Suggestions

- `PipelineRepository.updateLastRunInternal`'s new `truncated: Option[Boolean] = None`
  (`PipelineRepository.scala:504`) keeps a default, while `updateRunTerminalInternal`'s parameter
  deliberately does not — so `SparkJobSubmitter.scala:83` and `:104` silently write NULL to
  `pipelines.last_run_truncated` on a terminal update. Harmless today (that path is dormant and also
  writes a NULL `last_run_row_count`, so no bare number is rendered), but it is the same
  silent-NULL hazard task 2.8 closed on the sibling table. Consider dropping the default for
  symmetry.
- `scripts/check-schema-drift.mjs`'s case-class regex (`/case class\s+(\w+)\s*\(([^)]*)\)/gs`,
  line 38) really does truncate its capture at `AssertionSummary(` — I reproduced it. The
  field-ordering workaround is therefore load-bearing, and it is documented, but only in
  `PipelineProtocol.scala`'s doc comment: the next person to add a field will be reading the script,
  not this case class. Recommend a spinoff ticket to make the regex brace/paren-balanced, plus a
  one-line warning comment in the script itself.
- `RunHistoryModal.test.tsx:154` builds `{ truncated: true, ..., reads: [] }` — a shape the backend
  cannot produce, since `truncated` is derived from `reads.nonEmpty`. Harmless (the component only
  reads `.truncated`) but it is exactly the fixture-fidelity check task 6.11 asks for.
- Two redundant assertions in `PipelineRunServiceSpec`: `truncation should not be None` immediately
  after `truncation shouldBe defined` (:1626), and `record.truncation should not be Some(...)`
  immediately after `record.truncation shouldBe None` (:1704) — the latter is labelled a "red-arm
  check" but is trivially implied by the line above it and can never independently fail.
- Comment indentation glitch at `PipelineRunServiceSpec.scala:1642-1643` (one line indented into the
  block above it).
