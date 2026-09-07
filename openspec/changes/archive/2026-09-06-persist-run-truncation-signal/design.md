# Design — Persist the run truncation signal

## Context

`PipelineRunService.truncationFields` (PipelineRunService.scala:120-141) already computes everything this ticket
needs — `(sourceTruncated, sourceAvailableRowCount, truncationNotice, truncatedReads)` — and spreads it into
`RunResultResponse` at the run call site (:898-905). It is discarded there. Two persistence sites exist:
`pipeline_runs` (V24, per-run history behind `GET /api/pipelines/:id/run-history`) and the denormalised
`pipelines.last_run_row_count` (V30, behind `GET /api/pipelines` and the detail footer). Neither has a truncation
column; no migration contains the string `truncat`.

## Decision 1 — Persist the reads; recompose the notice on read

**Decision:** persist the structured truncated-read detail and recompose the notice with the existing
`PipelineRunService.composeTruncationNotice`, rather than persisting the rendered notice string.

**Why:** the ticket requires reusing HEL-861's wording and forbids a second phrasing. A stored string is a second
phrasing the moment the composer changes — the persisted rows would keep the old sentence forever while live runs
emit the new one, and nothing would flag the divergence. The composer already interpolates the cap from
`InProcessPipelineEngine.MaxRunRows` precisely so the message cannot desynchronise from behaviour; storing its output
would defeat that. Recomposition also keeps the persisted representation minimal and machine-readable, which is what
an agent reading history actually needs.

**Cost, stated honestly:** recomposition regenerates the *whole* sentence — `truncationReadClause`
(PipelineRunService.scala:1261-1269) and `truncationConsequenceSentence` (:1256-1259), not merely the cap token — so any
future edit to the wording, and any change to the cap, rewrites every historical run's notice retroactively. A run
truncated under an old cap will be described using the current one. This is a real inaccuracy. It is accepted because the cap is a fixed memory
bound this capability explicitly may not change (`pipeline-run-truncation-reporting`: "the cap is a memory bound and
remains in force"), and because the alternative — a frozen string that silently diverges from the live wording — was
judged the worse of the two. The persisted read counts (rows read, available total) are the load-bearing facts and
they are stored verbatim; only the sentence wrapping them is regenerated.

## Decision 2 — Three states, and how they are distinguished

This is the ticket's sharpest requirement, so it is stated mechanically rather than in prose.

| State | Persisted representation | Meaning |
| --- | --- | --- |
| Truncated | `truncated_reads` JSONB non-null, non-empty array | rows were discarded; count is partial |
| Complete | `truncated_reads` JSONB non-null, empty array `[]` | recorded, and nothing was discarded |
| Not recorded | `truncated_reads` **NULL** | run predates this change; completeness is unknown |

The discriminator is **nullability of one column**, not the emptiness of a collection. This is deliberate: HEL-890's
precedent ("present-and-empty beats absent") is honoured *within* a recorded run — a recorded complete run stores
`[]`, never NULL, so a reader branching on array length never has to distinguish empty from missing. NULL is reserved
exclusively for "this row was written before the column existed", and the migration adds the column with **no
backfill and no `DEFAULT`**, so no historical row can be silently coerced into looking complete.

**Why nullability rather than a separate boolean:** a `source_truncated BOOLEAN NULL` plus a reads array would give
two columns that can disagree (`true` with an empty array, `false` with a non-empty one) and two places to get the
NULL semantics right. One nullable JSONB column is the single source of truth; the run-wide boolean is *derived*
(`reads.nonEmpty`), exactly as `truncationFields` already derives it in memory. That guarantees the persisted flag and
the persisted detail cannot contradict each other, which is the failure the live spec already forbids at the MCP
surface.

**On the wire:** `PipelineRunRecord` gains `truncation: Option[RunTruncationRecord]`, where
`RunTruncationRecord(truncated: Boolean, primaryAvailableRowCount: Option[Long], reads: Vector[TruncatedReadResponse],
notice: Option[String])`. `None` — the field absent from the JSON — means **not recorded**. Inside a present record,
`reads` is always present, empty on a complete run. So absence carries exactly one meaning at exactly one level, and
the field name `truncation` being absent is never confusable with `truncated: false`.

The primary-scoped scalar is named `primaryAvailableRowCount`, matching HEL-890's rename rather than the older
`sourceAvailableRowCount`, so a scope-unqualified name is not reintroduced on a new surface.

**What we cannot do:** historical truncation cannot be backfilled. The facts were never observed — a stored
`row_count` of 1000 is genuinely ambiguous, and any reconstruction would be a guess presented as a measurement. The
mitigation is that every surface renders the unrecorded state as its own thing (see Decision 4), so an unrecorded run
is never *asserted* to be complete. That is the strongest honest claim available.

## Decision 2a — Every run row written after this ships is non-NULL, including dry runs and failures

The invariant is scoped to **terminal** run rows: *every run row that reaches a terminal status after this ships
carries a non-null signal*. A non-terminal row (`queued`/`running`) carries NULL because its truncation facts do not
exist yet — `PipelineRunRepository.insertRunInternal` (:63-82) inserts every real run up front with
`rowCount = None`, and the row is populated later by `updateRunTerminalInternal`. Such a row is distinguished by its
`status`, not by the truncation column, and it displays no row count, so no bare number is ever rendered for it. A run
abandoned before a terminal update (process death mid-run) therefore keeps NULL, and that is correct rather than a
gap: its truncation facts genuinely were never observed.

So NULL means **either** "predates this change" **or** "never reached a terminal status", and both are read as *not
recorded* — which is the honest reading in both cases. What NULL must never mean is "a terminal write path was
missed". Two terminal write paths bypass `updateRunTerminalInternal`, and both were missed on the first pass:

- **Dry runs.** `PipelineRunRepository.insertDryRun`/`insertDryRunInternal` (:124-143) inserts a already-terminal row
  (`status = "dry_run"`, `completed_at` set, a real `row_count`) in one statement. `listByPipelineInternal` (:211-217)
  does **not** filter `dry_run`, so those rows reach `PipelineRunService.history` (:725-752) and render a row count at
  `RunHistoryModal.tsx:130`. A dry run executes through the same engine under the same `MaxRunRows` cap, so it can be
  truncated. Leaving it NULL would both falsify the invariant and re-create the exact defect on a surface the
  acceptance criteria cover.

  **Decision:** dry runs persist their truncation reads like any other run. This requires plumbing, not a one-line
  add: `truncationFields` is computed in `executeRun` at :898-899 and the value is not in scope at `onDryRunSuccess`
  (:927-949), so the reads must be threaded into that callback's signature.

- **Failure paths** (:216/:219, :868/:871, :996/:999). **Decision:** a failed run writes `[]`, never NULL — with the
  reads observed before the failure if any were computed. Justification: a failed run persists no row count, so there
  is no displayed number for the signal to qualify, and reserving NULL exclusively for pre-existing rows is worth more
  than the marginal precision of a third "failed, completeness unknown" state. **The executor must verify that failed
  runs really do persist `row_count = None`**; if any failure path persists a row count, that path needs the observed
  reads rather than `[]`, and the discrepancy is an escalation, not a judgement call.

## Decision 3 — Denormalised flag on `pipelines`

`pipelines` gains `last_run_truncated BOOLEAN NULL`, written in the same `updateLastRun` call that already writes
`last_run_row_count`, with the same three-state nullability (NULL = not recorded). The list table and detail footer
read a persisted row count from `PipelineSummaryResponse`/the pipeline resource without a run-history fetch, so
without this they would need an N+1 fetch to mark a count partial.

Only the boolean is denormalised, not the detail — the full notice and per-source breakdown remain on the run record.
A list view needs to know *that* a count is partial; a reader wanting *how* partial goes to run history. This
deliberately keeps the denormalised copy too small to drift in an interesting way: it is `reads.nonEmpty` for the same
run whose `row_count` is already stored there, written in the same statement, so the pair cannot be written apart.

## Decision 4 — Rendering the three states

`DESIGN.md` tokens, no colour-only signalling (the spec requires the distinction not rely on colour alone).

- **Truncated:** the row count is rendered with an adjacent warning affordance — icon plus text, not colour alone —
  and the detail footer additionally renders the recomposed notice, reusing HEL-861's existing banner presentation so
  a reloaded page looks the same as the page did immediately after the run.
- **Complete:** the count renders exactly as today. No new chrome, no "complete" badge — adding an affirmative marker
  would make every pre-existing screenshot and every historical row look wrong.
- **Not recorded:** the count renders as today but is **not** marked complete; where the truncation affordance would
  sit, nothing is rendered. The distinction between complete and not-recorded is therefore not visible in the default
  view, and that is a conscious limit: the alternative is decorating every historical run with an "unknown
  completeness" marker that would decay into noise as historical rows age out. What the spec forbids — *asserting*
  completeness — is not done in either case, because no surface ever affirmatively claims a run was complete.

## Decision 5 — Migration

One new migration adding both columns. **The number is derived from the tree at the moment of writing**, not from any
ticket text: the worktree is currently at V102, and the concurrent HEL-955 branch claims `V103__pending_connectors.sql`,
so this change takes **V104 or higher** — the executor must re-check `ls backend/src/main/resources/db/migration/`
across `git branch -a` immediately before creating the file. No applied migration is edited under any circumstance:
Flyway checksums the whole file including comments, and every worktree on this machine shares one
`flyway_schema_history`, so an edit is a boot failure for every concurrent run.

`ADD COLUMN ... NULL` with no `DEFAULT` and no backfill on both tables — this is what makes the not-recorded state
truthful, and it is also the cheapest possible DDL on an existing table.

## Risks

- **RLS:** both tables are under row-level security. `ADD COLUMN` does not alter policies, and no new read path is
  introduced (the columns are read through the existing `pipeline_runs` and `pipelines` selects), so no policy change
  is expected. The executor must confirm this rather than assume it — this repo has a documented history of RLS
  defects invisible to superuser-connected local and CI runs.
- **Schema contract:** `schemas/pipelines/pipeline-run-record.schema.json` sets `additionalProperties: false` with an
  explicit `required` list, so the new field is a required edit there, in this same change, or the contract check
  fails.
- **False positives:** the acceptance criteria call out no-false-positives explicitly. The derived flag is
  `reads.nonEmpty`, and the live spec already fixes the boundary case (a source landing exactly at the cap is *not*
  truncated). Tests must cover the at-cap boundary persisting as complete, not as truncated.

## Gate-Chain Implications Checklist

This change edits `scripts/check-schema-drift.mjs`, which a Husky pre-commit hook invokes, so it
touches the commit-gate chain. The edit is **comment-only** — a nine-line warning above
`parseCaseClasses` documenting that its `case class` regex is not paren-balanced and silently drops
any field declared after a nested `)`. No executable line changes.

**What does it execute?** Nothing new. `parseCaseClasses` and the regex on the following line are
byte-identical to `main`; only a comment block above the function was added. The script's behaviour
under the pre-commit hook is unchanged, which the isolation transcript below confirms empirically
rather than by inspection.

**What environment does it inherit, and from where?** Unchanged. It is invoked by
`.husky/pre-commit` and inherits that hook's environment — `repoRoot` derived from the script's own
location, no new environment variable read, no new process spawned.

**Does it write anything outside its own sandbox?** No. It reads source files and writes only to
stdout/stderr, exactly as before; no filesystem write was added.

**Does it behave differently from a linked worktree than from a main checkout?** No. The isolation
harness runs it under an environment shaped like a pre-commit hook invoked from a linked worktree
and it passes there; the comment cannot introduce a path- or worktree-dependent difference.

**What happens on its first run?** Identical to every subsequent run — the script is stateless,
holds no cache, and creates nothing on first invocation.

**Isolation evidence:**
`.concertino/runs/HEL-873/evidence/.concertino/gate-chain-isolation-evidence/scripts__check-schema-drift.mjs.md`
(`PASS scripts/check-schema-drift.mjs`).

**Deliberately not fixed here:** the regex itself. Fixing it properly (paren-balancing, or a real
tokenizer) is a behavioural change to a commit gate that every worktree on this machine depends on,
and it belongs in its own ticket with its own review rather than riding along on a persistence
change. This ticket keeps the field-ordering workaround and documents the hazard where the next
person will actually encounter it.
