## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold spawn, no memory of round 1. Independently re-read all planning artifacts
(`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both `specs/*/spec.md`) and
re-derived every load-bearing claim against the actual code, not against round 1's
report (read only as a claim to verify, per role instructions).

### What I verified (with evidence)

**Round 1's blocking gap is genuinely fixed, verified against ground truth, not just
against the round-1 report's wording.**

- `design.md` Decision 5 now states: "The query MUST filter out dry runs
  (`r.status =!= "dry_run"`, the exact precedent `deleteOldRunsInternal` already uses
  two methods away in this same file)." Read `PipelineRunRepository.scala` directly:
  `deleteOldRunsInternal` (lines 155-168) filters `r.pipelineId === pid && r.status =!=
  "dry_run"` before computing retention — confirmed byte-for-byte, this precedent is
  real and does exist in the file the new method will live in.
- Read `PipelineRunService.scala`'s `onDryRunSuccess` (lines 361-383): it always calls
  `persistAssertions(runId, assertionResults)` after `insertDryRun` succeeds — confirmed
  dry runs do persist real rows into `pipeline_run_assertions`.
- Cross-checked against the actual OpenSpec capability specs (not just the design doc's
  paraphrase): `openspec/specs/pipeline-assert-evaluation/spec.md` line 60 states results
  are persisted for "a successful real run, a failed real run, or a successful dry run,"
  with a dedicated scenario "Assertion results persist after a successful dry run" (lines
  74-78). This independently corroborates the round-1 finding from a different source
  than the code itself — the dry-run-assertion-persistence premise is spec-verified, not
  just inferred from reading `PipelineRunService.scala`.
- `tasks.md` 1.3 now requires the filter explicitly, citing the same precedent.
  `tasks.md` 3.2 and 3.3 each got a dedicated test case for "a dry run more recent than
  the last real run is excluded" / "does NOT flip `invalid` to `true`."
  `specs/panel-assertion-invalid-badge/spec.md` gained a new, unambiguous requirement
  sentence ("a dry run SHALL NEVER be considered for this determination") plus a
  dedicated Scenario ("A dry run with a failing error-severity assertion does not affect
  the status," lines 28-32). This closes the exact ambiguity round 1 flagged in the old
  "regardless of terminal status" wording — the new text is precise.
- Decision 2's "sequential" mischaracterization is also fixed: design.md now reads
  "`Future.traverse` runs its futures concurrently, not sequentially."

**Independent re-verification of round 1's central architecture bet (Decision 4 — new
dedicated route vs. piggybacking on `PanelResponse`/`dataAsOf`).** Re-ran the same grep
independently rather than trusting the round-1 count:
```
grep -rn "PanelResponse.fromDomain(" backend/src/main --include="*.scala" | wc -l
```
→ 27 lines matched; excluding 2 doc-comment mentions (`Panel.scala:31,34`) and 1
prose-comment example (`ServiceResponse.scala:19`), that is the same ~24 real call
sites round 1 found. Confirmed `PublicDashboardRoutes.scala:55/57` is still the only
site passing a real second (`dataAsOf`) argument; every other site (including
`DashboardRoutes.scala:62`, the authenticated editing route) passes zero args and
defaults to `None`. The rejection of piggybacking remains well-grounded.

**Traced every ticket AC to a concrete task/spec:**
1. Run History pass/fail-by-severity summary + expandable failing rules — covered by
   `run-history-assertion-summary` capability, tasks 1.1/1.4/2.1/2.2. Verified
   `RunHistoryModal.tsx`'s current expand-toggle condition (`run.status === "failed" &&
   run.errorLog`, line ~68) and its `PipelineRunRecord`/`RunStatus`/`triggerSource`
   union types (`pipelineStep.ts` lines 471-484) match design.md's stated before/after
   exactly — Decision 10's broadened condition is a faithful, minimal diff.
2. Panel badge for an invalid/blocked DataType — covered by `panel-assertion-invalid-badge`
   capability; the dry-run gap that would have broken this AC's correctness is now closed
   (see above).
3. `PipelineRunRecord` + schema additive/backward-compatible — verified
   `PipelineProtocol.scala:43-53,92`: `PipelineRunRecord` currently has 9 fields /
   `jsonFormat9`; only one production construction site exists
   (`PipelineRunService.scala:215`, covered by task 1.4) and no test file constructs
   `PipelineRunRecord` directly (`grep -rln "PipelineRunRecord(" backend/src/test` →
   empty) — adding a 10th non-optional field via `jsonFormat10` has exactly one call
   site to update, matching the plan's scope.
4. DESIGN.md/lint/test — verified `--app-warning`/`--app-error` (+ `-surface` variants)
   exist in both light (lines 111-118) and dark (lines 155-162) blocks of
   `frontend/src/theme/theme.css`, and that `panel-grid-card__type-badge`/
   `panel-grid-card__footer` (the chip precedent Decision 9 cites) are real, existing
   classes in `PanelGrid.css` using the same token family (`--space-3`,
   `--app-radius-pill`, `--text-micro`) the new badge would follow.

**Supporting sub-claims re-verified independently (not merely re-quoted from round 1):**
- `dataTypeService.findById`/`listRows` both gate through the identical
  `dataTypeRepo.findByIdOwned(id, user)` check (`DataTypeService.scala:27-50`) —
  confirmed by reading the file; supports Decision 7's "mirrors `/rows`'s ACL" claim.
  Also confirmed `/rows` and `/panel-capabilities` both sit before the catch-all
  `path(DataTypeIdSegment)` block in `DataTypeRoutes.scala` (lines 49-101 vs. 102+),
  so a new `/:id/assertion-status` sibling route has a direct, unambiguous ordering
  precedent to follow.
- `findLastRunAtByOutputDataTypeId` (`PipelineRepository.scala:302`) is system-context
  with a doc comment stating the ACL gate is enforced by the caller — confirmed
  verbatim; also confirmed it does not assume a 1:1 pipeline→DataType mapping (it
  aggregates `.maxOption` across all matching pipeline rows), so the new method's
  analogous join-then-latest approach inherits an already-accepted precedent rather
  than introducing a new uniqueness assumption.
- `PipelineRunRepository` holds `runsTable`/`pipelinesTable` as private vals (lines
  28-29) — confirmed, supports Decision 5's placement claim.
- `AssertionResult`/`PipelineRunAssertionRow` both carry `kind`/`field`/`severity`/
  `message` (plus `passed`) — confirmed the shape `AssertionFailureDetail(kind, field,
  severity, message)` maps directly from either source with no missing fields.
- Confirmed `openspec/specs/pipeline-run-provenance/spec.md` and
  `pipeline-run-status-ui/spec.md` (closest existing specs to this surface) only assert
  specific fields (`triggerSource`, SSE status semantics) and never enumerate
  `PipelineRunRecord`'s full field list — proposal.md's "Modified Capabilities: none" is
  accurate; nothing existing is contradicted by an additive field.

### Verdict: CONFIRM

The design is sound. Round 1's real, evidence-backed correctness gap (dry runs leaking
into the "latest run" lookup and flipping a panel's badge on a mere preview) is fixed
correctly — not just reworded — with the exact precedent it should follow
(`deleteOldRunsInternal`'s `r.status =!= "dry_run"` filter), a spec scenario precise
enough that a competent implementer can't misread "regardless of terminal status" as
including dry runs anymore, and dedicated test cases in both the repository-layer and
service-layer test plans. My own independent re-verification of the central
architecture decision (dedicated route vs. piggyback) and every AC traces cleanly to
real code and real precedent; I found no new blocking gap in either the backend or
frontend half.

### Non-blocking notes

1. **Decision 2 / proposal.md's "at most 10" bound is understated — the real bound is
   closer to ~20, not 10.** `history()` (task 1.4) calls `pipelineRunRepo
   .listByPipelineInternal(pipelineId)` (`PipelineRunRepository.scala:210-216`), which
   has no status filter and no `.take(N)` — it returns every retained row, real and dry
   both. Retention is enforced by two *independent* `keepN=10` passes:
   `deleteOldRunsInternal` (non-dry, `r.status =!= "dry_run"`, lines 155-168) and
   `deleteOldDryRunsInternal` (dry-only, `r.status === "dry_run"`, lines 181-194) — each
   caps its own subset at 10, so a pipeline can retain up to 10 real + 10 dry = ~20 rows
   simultaneously, not 10 as Decision 2 and proposal.md's "What Changes" both state.
   This doesn't change the actual conclusion (a bounded ~20-call `Future.traverse` per
   history request is still "acceptable... not a scaling risk," and `RunHistoryModal.tsx`
   already renders dry runs today via its `status === "dry_run"` badge case, so
   including them in the summary computation is correct behavior, not a bug) — it's a
   documentation-accuracy nit in the same spirit as the "sequential" wording round 1
   flagged as non-blocking. Worth tightening before an implementer copies "at most 10"
   into a code comment.
2. **Transient badge-clearing window while a new real run is in flight.** If a
   DataType's badge is `invalid: true` because its latest completed run had an
   error-severity failure, and a user then triggers a new (non-dry) run,
   `findLatestRunIdByOutputDataTypeIdInternal` will pick that new run's id the moment
   its `pipeline_runs` row is inserted (queued/running, `started_at` newer) — before any
   assertions are persisted for it. `assertionStatusForDataType` would then report
   `invalid: false` for the duration of that run (assertions are only written at
   terminal success/failure), rather than continuing to reflect the prior run's known-bad
   status. This self-corrects the moment the new run completes (blocked again, or
   clean), and "no badge while a fresh run is in flight" is a defensible interim state
   rather than a wrong one — not blocking, but worth a one-line acknowledgment in
   design.md's Risks/Trade-offs section if the team wants it documented rather than
   rediscovered later.
