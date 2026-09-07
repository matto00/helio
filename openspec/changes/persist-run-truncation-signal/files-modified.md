# Files modified — persist-run-truncation-signal (HEL-873)

## Cycle 4 (skeptic-final-1.md, live-browser REFUTE)

- **Blocker** (`TruncatedRowCountBadge.tsx:19` — the badge collided with the row count,
  `1,000 rows⚠ Partial`, on the list table and run-history modal): the component's `{" "}` was a
  no-op — `display: inline-flex` on the badge's own span discards a whitespace-only text run at
  the START of a flex container's content per the CSS Flexbox spec, so the intended leading space
  never rendered. Root cause is CSS layout, not DOM content — confirmed by a throwaway probe that
  jsdom's `element.textContent` already contained the space under the OLD, buggy markup, so no
  jsdom/RTL assertion on rendered text content can actually distinguish the collided rendering
  from the fixed one (contrary to the initial suggested test shape). Fixed by removing the `{" "}`
  and adding `margin-left: var(--space-1)` to the badge's own CSS rule instead, so the visible gap
  comes from a real CSS box property, immune to flex whitespace-collapsing. Added
  `TruncatedRowCountBadge.test.tsx` asserting the badge's own `textContent` is exactly `"⚠
  Partial"` (no leading whitespace character) — a genuine, red-arm-confirmed guard against ever
  reintroducing the leading-whitespace-text-node shape that triggers the collapse, though it
  cannot itself observe CSS layout; the skeptic's real-browser screenshots remain the authoritative
  evidence for the visual fix.
- **Non-blocking 1** (TS type overstated the wire shape): `RunTruncationRecord
  .primaryAvailableRowCount`/`.notice` and `TruncatedReadRecord.availableRowCount` made optional
  (`?:`) to match spray-json's Option-omission convention (a complete run's live response is
  `{"truncated":false,"reads":[]}`, no `primaryAvailableRowCount`/`notice` keys at all).
  `RunHistoryModal.test.tsx`'s complete-run fixture no longer sets these to `null` — it omits them,
  matching the real wire shape.
- **Non-blocking 2** (a run that fails after a truncated read persists `[]`): added a sentence to
  the spec delta (`specs/pipeline-run-truncation-reporting/spec.md`) stating this explicitly and
  why it is acceptable, rather than changing the write path.

## Cycle 3 (evaluation-2.md change requests)

- **Item 1** (`TruncatedRowCountBadge.css` used a numeric `font-weight: 600` literal, a DESIGN.md
  mechanical violation): replaced with `font-weight: var(--weight-semibold)`.
- **Item 2** (the column's own doc comment described the OLD bare-array encoding, and ~12 test
  call sites still wrote the stale `"[]"` literal): `PipelineRunRepository.scala`'s
  `truncatedReads` field doc and `updateRunTerminalInternal`'s doc both rewritten to describe the
  real object encoding, `{"primaryAvailableRowCount": …, "reads": [...]}`, and to state plainly
  that a bare `"[]"` is NOT this shape and decodes to not-recorded. Every test call site in
  `PipelineRunRepositorySpec`, `OutputRoutesSpec`, and `PipelineRunRoutesSpec` that wrote a literal
  `"[]"` now writes `PipelineRunService.EmptyTruncationJson`; the three semantic assertions that
  compared against a bare `"[]"` string now compare parsed JSON against the real constant. Added a
  drift-guard test ("the real write path for a failed run persists exactly
  PipelineRunService.EmptyTruncationJson") confirming the hand-written constant matches what a
  real failed run actually persists — discovered along the way that a REST success run does NOT
  use this constant (REST always reports its own `availableRowCount`, truncated or not), so the
  drift-guard targets the failure path, the constant's real call site.
- **Item 3** (the CR1 test's own comment falsely claimed it "would not have caught the original
  defect"): corrected to state what the test actually proves — it IS genuinely red pre-fix, since
  `reads.head` is the truncated secondary in that exact scenario, confirmed by the cycle-2
  red-arm check.
- Non-blocking: `parseTruncationRecord`'s `reads` decode now uses a `case JsArray(elements)`
  pattern match instead of `asInstanceOf[JsArray]`.

## Cycle 2 (evaluation-1.md change requests)

- **CR1** (`primaryAvailableRowCount` could report a secondary source's count under a
  primary-scoped name): the persisted `pipeline_runs.truncated_reads` shape changed from a bare
  JSON array to an object, `{"primaryAvailableRowCount": …, "reads": [...]}` — the scalar is now
  written and read back verbatim, never inferred from `reads.headOption`. Threaded
  `primaryAvailableRowCount` through `onDryRunSuccess`/`onRunSuccess`/`onUnblockedRunSuccess`.
  Added `PipelineRunService.EmptyTruncationJson` (the recorded-and-complete literal in the new
  shape) and pointed every failure/blocked terminal write (including `SparkJobSubmitter`'s two
  dormant sites) at it instead of a bare `"[]"`. Updated `RunTruncationRecord`'s doc comment to
  match. New test: "a complete-primary run with a truncated secondary persists the PRIMARY's own
  availableRowCount, not the secondary's" (red-arm confirmed against the pre-fix inference).
- **CR2** (the at-cap boundary test didn't test the boundary): added `RestAtCapUrl`, a stub REST
  fixture returning exactly `InProcessPipelineEngine.MaxRunRows` rows, and replaced the duplicate
  `RestSuccessUrl`-based "at-cap" test with a real boundary test asserting both the live result and
  the persisted record report `truncated = false` at exactly the cap.
- **CR3** (three copy-pasted "Partial" markers, zero matching CSS rules): extracted
  `frontend/src/features/pipelines/ui/TruncatedRowCountBadge.{tsx,css}` — one accessible-name
  string, one stylesheet reusing the `--app-warning` token family HEL-861's sibling banner already
  establishes. `PipelineDetailFooter.tsx`, `RunHistoryModal.tsx`, `PipelineListTable.tsx` now
  render this shared component instead of duplicated inline markup.
- **CR4** (`parseTruncatedReads` threw on any malformed shape beyond non-array JSON):
  `parseTruncationRecord` now wraps its whole decode in `Try`, degrading ANY decode failure
  (unparseable/wrong-shape JSON, a non-array `reads`, a missing required field) to `None`
  (not-recorded), never to `[]` (which would assert completeness). New test: "an undecodable
  truncated_reads value degrades that row to not-recorded, never to empty-and-complete, and never
  fails the request" — three distinct malformed shapes alongside one well-formed run in the same
  `run-history` response, confirming one bad row doesn't fail the others (red-arm confirmed by
  removing the `Try` and observing the whole request fail).
- Non-blocking items addressed: `PipelineRepository.updateLastRunInternal`'s `truncated` param
  dropped its default (symmetry with `updateRunTerminalInternal`); both `SparkJobSubmitter`
  call sites pass it explicitly. `RunHistoryModal.test.tsx`'s `{truncated: true, reads: []}`
  fixture (a shape the backend cannot produce) fixed to carry a non-empty `reads`. Removed two
  assertions trivially implied by the line above them (`PipelineRunServiceSpec`). Added a one-line
  warning comment directly in `scripts/check-schema-drift.mjs` about its paren-truncation hazard
  (the regex itself is left unfixed per the orchestrator's explicit instruction — tracked as a
  pending spinoff).

## Migration

- `backend/src/main/resources/db/migration/V104__pipeline_run_truncation_signal.sql` — new
  migration (V104, derived fresh from the tree; V103 is claimed by the concurrent HEL-955
  worktree). Adds `pipeline_runs.truncated_reads JSONB NULL` and `pipelines.last_run_truncated
  BOOLEAN NULL`, no `DEFAULT`, no backfill — NULL is the deliberate "not recorded" state.

## Backend — persistence

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
  — `PipelineRunRow` gains `truncatedReads: Option[String]`; `insertRunInternal` leaves it `None`
  (queued row, facts don't exist yet); `updateRunTerminal`/`updateRunTerminalInternal` gain a
  required (no-default) `truncatedReadsJson` param, written in the same statement as
  `status`/`rowCount`; `insertDryRun`/`insertDryRunInternal` gain a required `truncatedReadsJson`
  param (a dry run is already-terminal on insert).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
  — `pipelines.last_run_truncated` added as a table-local column (mirrors `lastSourceSchema`'s
  off-`*`/off-`PipelineRow` convention, avoiding a ripple through every `PipelineRow(...)`
  construction site); `summaryQuery`/`rowToSummary`/`PipelineSummary` thread it through;
  `updateLastRun`/`updateLastRunInternal` gain a `truncated` param, written in the same statement
  as `rowCount`.

## Backend — service layer

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — the
  `truncationFields` computation is moved above the success branch in `executeRun` so
  `onDryRunSuccess`/`onRunSuccess`/`onBlockedRun`/`onUnblockedRunSuccess` all receive
  `truncatedReads` and persist it (non-empty when truncated, `[]` when complete, `[]` for every
  failure/blocked path — never NULL on a terminal write). `recordUnrunnable`'s failure path also
  writes `[]`. Added `truncatedReadsToJson`/`parseTruncatedReads`/`parseTruncationRecord` (hand-
  rolled JSON, since `PipelineProtocol`'s formatters are trait members not reachable from this
  class) and wired `history`'s per-run mapping to build `RunTruncationRecord` from the persisted
  column, recomposing the notice via the existing `composeTruncationNotice`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `toSummaryResponse`
  threads `lastRunTruncated` through to `PipelineSummaryResponse`.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` —
  `toPipelineEntry` threads `lastRunTruncated` through to `WorkspaceContextPipeline`.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — task 2.8: both
  `updateRunTerminalInternal` call sites pass `truncatedReadsJson` explicitly (`Some("[]")`) so
  this dormant path cannot silently regress a terminal row to NULL now that the parameter has no
  default.

## Backend — wire protocols

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — new
  `RunTruncationRecord(truncated, primaryAvailableRowCount, reads, notice)`;
  `PipelineRunRecord.truncation: Option[RunTruncationRecord]` (absent = not recorded);
  `PipelineSummaryResponse.lastRunTruncated: Option[Boolean]`; format bumps
  (`jsonFormat10`→`jsonFormat11` for `PipelineRunRecord`, `jsonFormat8`→`jsonFormat9` for
  `PipelineSummaryResponse`), with `runTruncationRecordFormat`/`pipelineRunRecordFormat` moved
  below `truncatedReadResponseFormat` to satisfy spray-json's implicit declaration-order
  constraint.
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` —
  `WorkspaceContextPipeline.lastRunTruncated: Option[Boolean]`, format bump
  (`jsonFormat12`→`jsonFormat13`).

## Backend — tests

- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala`
  — updated call sites for the new required params; added the three-state repository-level tests
  (queued NULL, terminal non-empty/`[]`, dry-run non-empty, a raw-inserted pre-existing NULL row).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — new
  "PipelineRunService persisted truncation signal (HEL-873)" describe block: a real truncated run
  reads back truncated with a byte-identical recomposed notice, a complete run persists `[]`, the
  at-cap/under-cap boundary persists as complete, a failed run persists `[]` not NULL, a dry run
  over a truncated source persists non-empty reads, and a raw-inserted NULL row reads back as
  not-recorded (never as complete).
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala`,
  `PipelineRunRoutesSpec.scala`, `PipelineRepositorySpec.scala` — updated existing call sites for
  the new required repository parameters (no behavior change).
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceApplyBudgetSpec.scala`
  — updated `WorkspaceContextPipeline(...)` fixture construction for the new field.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `PipelineSummary.lastRunTruncated`,
  new `TruncatedReadRecord`/`RunTruncationRecord` types, `PipelineRunRecord.truncation`.
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx` — the rows-written figure gets an
  icon+text "Partial" marker when `lastRunTruncated === true`; nothing extra for `false`/`null`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — the HEL-861 truncation banner now
  falls back to the persisted signal (`currentPipeline.lastRunTruncated` + `runs[0].truncation
  .notice`) when no live Redux run state is present, so a reload shows what the post-run page
  showed; passes `lastRunTruncated` through to the footer.
- `frontend/src/features/pipelines/ui/RunHistoryModal.tsx` — a truncated run's row count gets the
  same icon+text "Partial" marker.
- `frontend/src/features/pipelines/ui/PipelineListTable.tsx` — same marker for `lastRunRowCount`.
- `frontend/src/features/pipelines/ui/{PipelineDetailPage,PipelineListTable,RunHistoryModal}
  .test.tsx` — new tests for the truncated/complete/not-recorded three-state rendering, including
  an accessible-name (not colour-only) assertion.
- `frontend/src/test/rawElementGuardHel440.test.tsx` — added the new required
  `lastRunTruncated: null` fixture field.

## Contracts

- `frontend/src/test/rawElementGuardHel440.test.tsx` — fixture only: adds the now-required
  `lastRunTruncated: null` prop to this pre-existing guard's `PipelineDetailFooter` props object.
- `schemas/pipelines/pipeline-run-record.schema.json` — `TruncatedReadResponse`/
  `RunTruncationRecord` defs, `truncation` (optional) on `PipelineRunRecord`.
- `schemas/workspace/workspace-context.schema.json` — `lastRunTruncated` on `PipelineEntry`.

## OpenSpec

- `openspec/changes/persist-run-truncation-signal/tasks.md` — all tasks marked complete.

## Complete declared file set

Every path this change touches, one bullet each (the narrative sections above describe why;
this section exists so the delivery guard can parse them):

- `backend/src/main/resources/db/migration/V104__pipeline_run_truncation_signal.sql`
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala`
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala`
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepositorySpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceApplyBudgetSpec.scala`
- `frontend/src/features/pipelines/services/pipelineService.ts`
- `frontend/src/features/pipelines/state/pipelinesSlice.ts`
- `frontend/src/features/pipelines/types/pipelineStep.ts`
- `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineListTable.tsx`
- `frontend/src/features/pipelines/ui/PipelineListTable.test.tsx`
- `frontend/src/features/pipelines/ui/RunHistoryModal.tsx`
- `frontend/src/features/pipelines/ui/RunHistoryModal.test.tsx`
- `frontend/src/features/pipelines/ui/TruncatedRowCountBadge.tsx`
- `frontend/src/features/pipelines/ui/TruncatedRowCountBadge.css`
- `frontend/src/features/pipelines/ui/TruncatedRowCountBadge.test.tsx`
- `frontend/src/test/rawElementGuardHel440.test.tsx` — fixture only: adds the now-required
  `lastRunTruncated: null` prop to this pre-existing guard's `PipelineDetailFooter` props object.
- `schemas/pipelines/pipeline-run-record.schema.json`
- `schemas/workspace/workspace-context.schema.json`
- `scripts/check-schema-drift.mjs` — comment only: a one-line warning that its case-class regex
  truncates its field capture at a nested `)`. The regex itself is deliberately unchanged; fixing
  it is a spinoff ticket.
