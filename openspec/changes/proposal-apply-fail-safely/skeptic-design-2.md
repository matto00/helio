## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, the spec delta at
  `specs/pipeline-proposal-apply/spec.md`, and round 1's `skeptic-design-1.md` (as claims to re-verify,
  not fact).
- `openspec validate proposal-apply-fail-safely --strict` → `Change 'proposal-apply-fail-safely' is
  valid`.

**Change Request 1 (false "ticket filed" claim) — verified fixed.**
- `mcp__linear__get_issue(HEL-758)` returns a real, existing issue: title "Pipeline execution doesn't
  support rest_api or sql base sources at all", status `Backlog`, created 2026-08-19, body explicitly
  scoped to "implement real pipeline execution for `rest_api`/`sql` base sources" and cross-references
  HEL-755 as the ticket that "works around the *symptom*... does **not** implement actual execution
  support" — exactly the follow-up design.md's Non-Goals/Planner Notes describe.
- `design.md`'s Non-Goals (line 50-51) and Planner Notes (line 133-136) now cite `HEL-758` by real ID and
  URL (`https://linear.app/helioapp/issue/HEL-758`), matching the actual ticket exactly. No more
  completed-past-tense claim of an unfiled ticket.

**Change Request 2 (blockedReason not durably visible) — verified fixed.**
- New Decision D3 adds `PipelineRunService.recordUnrunnable(pipelineId, reason, user):
  Future[RunResultResponse]`. Traced the exact repository methods it composes against the real files:
  - `PipelineRunRepository.insertRun` (`backend/.../PipelineRunRepository.scala:44-55`) — owner-scoped,
    silent no-op if not owned, matches D3's "insertRun (best-effort, recoverWith-guarded like every
    other call site in this file)" description; the file's existing `submit` preExec block
    (`PipelineRunService.scala:337-343`) uses the identical `.recoverWith { case _ => Future.successful(())
    }` pattern D3 says to mirror.
  - `PipelineRunRepository.updateRunTerminal` (`PipelineRunRepository.scala:85-102`) — signature
    `(runId, status, completedAt, rowCount: Option[Int], errorLog: Option[String], user)` matches D3's
    call exactly.
  - `PipelineRepository.updateLastRun` (`PipelineRepository.scala:276-290`) — signature `(id, status, at,
    rowCount: Option[Long], user)` matches D3's call exactly (writes `lastRunStatus`, `lastRunAt`,
    `lastRunRowCount`).
  - `RunResultResponse` (`PipelineProtocol.scala:97-105`) — `rows: Vector[JsObject]`, `rowCount: Int`,
    `runId: Option[String]`, `blocked: Boolean`, `blockedReason: Option[String]` all present with
    defaults; D3's literal `RunResultResponse(rows = Vector.empty, rowCount = 0, runId = ...,
    blocked = true, blockedReason = Some(reason))` compiles cleanly against the real case class.
  - This exactly mirrors the pre-existing "run execution threw" failure branch already in this file
    (`PipelineRunService.scala:356-382`: `updateRunTerminal(..., "failed", ...)` →
    `pipelineRepo.updateLastRun(..., "failed", ...)`), so D3 is not inventing a new pattern, it's reusing
    an established one with an earlier `insertRun` added (needed here because, unlike the `submit` path,
    nothing already inserted the row).
- Frontend rendering claims re-traced against the real files (not trusted from design.md prose):
  - `frontend/src/features/pipelines/ui/PipelineListTable.tsx:22-41` — `StatusBadge` renders
    `status === "failed"` as `<StatusChip intent="error">Failed</StatusChip>`, reading
    `pipeline.lastRunStatus` directly. `recordUnrunnable`'s `updateLastRun(..., "failed", ...)` writes
    exactly that column.
  - `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx:67,124-126` — same `"failed"` →
    red "Failed" `StatusChip` rendering, reading the same `lastRunStatus` prop.
  - `frontend/src/features/pipelines/ui/RunHistoryModal.tsx:119,148` — `canExpand = (run.status ===
    "failed" && Boolean(run.errorLog)) || hasFailingAssertions`, and `{run.errorLog && <pre
    className="run-history-modal__row-error">{run.errorLog}</pre>}`. `recordUnrunnable` sets
    `errorLog = Some(reason)` via `updateRunTerminal`, so the curated `blockedReason` text becomes
    visible, expandable, verbatim in Run History — this is the exact gap round 1 found empty
    (`EmptyState` "No runs recorded yet" because no row existed at all).
- Design.md's own text (D3, lines 89-106) explicitly narrates the round-1 REFUTE and how it's addressed,
  and the Planner Notes section (lines 140-147) does the same for both change requests — read both and
  independently confirmed each claim against the files above rather than accepting the narration.
- `tasks.md` 1.4 adds the `recordUnrunnable` task; 1.5 (renumbered) correctly calls it instead of
  constructing a `RunResultResponse` literal inline; test tasks 2.1/2.2 now require asserting a real
  `pipeline_runs` row exists with `status = "failed"` after apply (not just the response shape), and new
  task 2.6 tests `recordUnrunnable` updates `lastRunStatus`. This closes the loop from design claim →
  concrete, verifiable test task.
- Spec delta (`specs/pipeline-proposal-apply/spec.md`) requirement text and both scenarios now state the
  blocked state "SHALL be persisted as a real run record... so it remains visible after a page reload,"
  matching D3, not the round-1 draft's weaker "already visible in the apply response" framing.
- Re-checked the rest of the design for regressions introduced by this round's changes: D1/D2's
  mechanics, the `SparkUnsupportedKinds` companion-object task, `handleInlineCreated`'s `kind` parameter
  threading, and the untouched `static`/`csv` path are all unchanged from round 1's already-verified
  trace of `PipelineProposalService.scala`/`PipelineRunService.scala` — re-spot-checked
  `createPipeline`'s unconditional `pipelineRunService.submit` call and `handleInlineCreated`'s
  delete-and-abort behavior are still present pre-fix (i.e., the design still targets real code, not
  code that's already changed under it).
- No new placeholders (`TODO`/`TBD`), no new internal contradictions between proposal/design/tasks/spec
  introduced by this round's edits, no AC left uncovered, no scope drift beyond what round 1 already
  scoped (D4's deferral of `testConnection` pre-validation is unchanged and still reasonably justified).

### Verdict: CONFIRM

Both round-1 change requests are resolved with real, verifiable artifacts rather than restated claims:
HEL-758 exists and is correctly cited; D3's `recordUnrunnable` composes real, correctly-signatured
repository methods that write a genuine `pipeline_runs` row, and the three frontend surfaces
(`PipelineListTable`, `PipelineDetailFooter`, `RunHistoryModal`) independently confirmed to render
`status = "failed"` + `errorLog` exactly the way the design claims — the durable-visibility gap round 1
found is closed. The design is sound and specific enough to implement without further clarification.

### Non-blocking notes

- Same as round 1: `PipelineRunService` still has no companion object today (`grep -n "^object
  PipelineRunService"` → no match); tasks.md 1.2 phrasing ("add ... to `PipelineRunService`'s companion
  object") still implicitly assumes one exists. Not blocking — a competent implementer creates
  `object PipelineRunService { ... }` from scratch, same as round 1's note concluded.
- `recordUnrunnable`'s `insertRun` call depends on `pipelineOwnedAction` succeeding for the pipeline
  just created in the same call by the same user — reasonable given the pipeline was created moments
  earlier in the identical request/user context, but worth the executor double-checking no async
  visibility gap exists between the just-committed `createPipeline` insert and this immediate follow-up
  read (unlikely given both go through the same DB connection pool/transaction-per-call pattern already
  used elsewhere in this file, but not independently re-verified at the transaction-isolation level here).
