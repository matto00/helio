## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket / proposal / design / tasks / spec delta all read in full** (`ticket.md`, `proposal.md`,
  `design.md`, `tasks.md`, `specs/patch-set-undo/spec.md`) under
  `openspec/changes/patchset-undo-redo-enabled-flag/`.

- **The bug premise is real and matches the current code.** Read
  `backend/src/main/scala/com/helio/services/PatchSetUndoInverse.scala:150-165` — both
  `fullPipelineStepInverse` and `pipelineStepCreateRequestFromResponse` build their result reading
  only `type`/`config`/`position` off the raw JSON; `enabled` is genuinely absent. Confirmed both
  request types already carry `enabled: Option[Boolean]`
  (`backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala:151,156`), so no
  wire/schema change is needed, matching the proposal's "Impact" claim.

- **D6's core justification (that leaving `enabled = None` on the full-revert path would silently
  keep the LIVE step's current enabled state) is correct, not hand-waved.** Traced
  `pipelineService.updateStep` → `pipelineStepRepo.updateInternal`
  (`backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala:191-196`):
  `enabled = enabled.getOrElse(row.enabled)` — `None` really does mean "keep the row's current
  value," confirming the "alternative considered and rejected" reasoning in design.md D6 is sound
  engineering, not filler.

- **D7's asymmetry (Option pass-through for create, explicit default for update) is consistent with
  each request type's own established contract.** `CreatePipelineStepRequest.enabled: Option[Boolean]`
  already means "absent → created enabled" at the call site
  (`backend/src/main/scala/com/helio/services/PipelineService.scala:587`,
  `req.enabled.getOrElse(true)`), so `pipelineStepCreateRequestFromResponse` passing `None` through
  unmodified reaches the same "true" outcome without duplicating the default — matches the design's
  stated reasoning exactly.

- **`enabled` is genuinely present (not omitted) in the persisted JSON for every post-HEL-412
  step**, because it's a plain (non-Option) field on every `*StepResponse` case class and each is
  serialized via `jsonFormat7` (`PipelineStepProtocol.scala:235-257`) — so
  `fields.get("enabled")` will find a literal `"enabled": true/false` key, and the "absent only for
  legacy pre-HEL-412 rows" framing in ticket.md/proposal.md/design.md is accurate, not speculative.

- **Traced the actual capture site for `priorState`** — `PatchSetApplyResolvers.scala:656,683` —
  both the pipelineStep `update` and `delete` resolvers capture
  `pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(existing))` as `priorState`,
  which is exactly the JSON shape the two target helpers will read. This closes the loop end to end:
  forward-apply capture → undo-time reconstruct.

- **Both callers this fix must satisfy are exactly the two paths ticket.md/design.md name.** Read
  `PatchSetUndoService.scala:244-286`: `restorePipelineStepUpdate` calls `fullPipelineStepInverse`
  (full-revert path), `restorePipelineStepDelete` calls `pipelineStepCreateRequestFromResponse`
  (delete-and-recreate path). No third call site exists (`no create — design.md D1` is stated and
  matches: `grep` found no `("pipelineStep", "create")` undo case). The ticket title's "undo/redo"
  wording is not a literal second backend feature — grepped the whole backend for `"redo"` and found
  none; the archived `2026-08-15-undo-patch-set-apply` design.md explicitly lists "multi-level
  undo/redo" as a Non-Goal of the underlying undo feature. So "redo" in HEL-705's title is informal
  shorthand for the delete-undo/update-undo round trip this design correctly scopes to — not an
  unaddressed second code path.

- **The Non-Goal (leaving `PatchSetApplyRollback.scala`'s parallel gap unfixed) is accurately
  described, not swept under the rug.** Confirmed
  `PatchSetApplyRollback.scala:322,329` (`fullPipelineStepInverse`/`pipelineStepCreateRequestFromPrior`)
  has the analogous gap, reading a domain `PipelineStep` without threading `enabled` — the design
  correctly names this as out-of-scope-but-real and commits to a delivery-time follow-up triage
  rather than silently ignoring it.

- **Test plan is concrete and grounded in the actual file structure**, not aspirational. Read
  `PatchSetUndoInverseSpec.scala` in full — it currently has no pipelineStep block at all, so tasks
  2.1-2.3's proposed new blocks are additive, not conflicting with existing coverage. Read
  `PatchSetUndoServiceSpec.scala` and confirmed both DB-backed pipeline-step paths task 2.4 asks the
  executor to check for already exist: the full-revert case (`"restore panel/dashboard/dataSource/
  dataType/pipeline/pipelineStep update edits..." `, line 200) and the delete-and-recreate case
  (`"restore a pipelineStep delete edit by recreating it..."`, line 307) — so task 2.4 is a real,
  actionable extension point, not a task that will silently no-op.

- **Acceptance criteria trace cleanly to tasks**: AC1 (round-trip both paths) → tasks 1.1/1.2 +
  2.1-2.4; AC2 (absent → true) → D6/D7 + tasks 2.2/2.3; AC3 (test coverage + `sbt test` clean) →
  tasks 2.1-2.5. No AC is left uncovered by any task, and no task exceeds the ticket's stated scope.

- **No placeholders, TBDs, or deferred decisions** found anywhere in the four artifacts — every
  decision (D6, D7) states its alternative and its rejection rationale; the Migration Plan and Open
  Questions sections are explicitly "None" with justification, not silently blank.

### Verdict: CONFIRM

The design is small, precisely scoped to the two named helpers, and every factual claim it makes
about the surrounding code (request contracts, repository update semantics, JSON shape, existing
test coverage, the sibling gap in `PatchSetApplyRollback`) checks out against the actual source.
D6/D7's reasoning is not just plausible but independently re-derivable from the code paths I traced.
Tasks map 1:1 to acceptance criteria with no gaps and no scope drift. Sound enough to implement as
written.

### Non-blocking notes

- Task 2.4's phrasing ("if so, extend... otherwise this task is a no-op") is conditional, but I
  confirmed during this review that the DB-backed cases it refers to already exist in
  `PatchSetUndoServiceSpec.scala` (lines 200, 307) — so in practice this will not be a no-op. Worth
  the executor double-checking it lands on the closest-matching case cleanly, but this is
  implementation detail, not a design flaw.
- `workflow-state.md` lists `TICKET_TYPE: feature` for what is a bug-fix ticket (HEL-705's own title:
  "silently recreates disabled pipeline steps as enabled"). Cosmetic — does not affect the design
  artifacts under review — but worth a glance at delivery time in case it affects branch-naming
  conventions (`bug/...` vs `feature/...`); the branch name itself (`bug/patchset-undo-enabled-flag/
  HEL-705`) is already correctly `bug/`, so this looks like a stale/unused field rather than an
  actual misclassification.
