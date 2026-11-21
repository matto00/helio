## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md and specs/patch-set-undo/spec.md, against live source at HEAD
763c69f6f77be04a57e6e5d208262f86c3fb86e0 (main, worktree clean apart from the untracked change dir). Paths are under
`backend/src/main/scala/com/helio/` unless stated otherwise.

### What I verified (with evidence)

- **The hole is real.** In `PatchSetUndoBoundPanels.doomed`, the `pipeline` arm lists the pipeline's Outputs
  (`listByPipelineInternal`), uses them only to look up panels, and then drops them. `checkPipeline` compares `name`
  only. `ifStillUnbound` (PatchSetUndoService.scala:154-158) re-checks panels only. So a bare Output added after the
  apply reaches no blocker, and the pipeline delete cascades to it.
- **The doomed set in D1 matches what the delete removes.** The `pipelineStep` arm already uses the delete's real
  removal set (`removedByDeleteInternal`, PipelineStepRepository.scala:1113). Reusing that set is the right call.
- **The journaling precedent exists.** `JournaledEdit.inlineSources: Option[...] = None` with `jsonFormat8`
  (PatchSetApplicationRepository.scala:119-137) is the model for an optional field that needs no migration.
- **Round 1's change request about the legacy fallback is resolved.** D2 now uses `owner_id` == applier AND
  `created_at <= appliedAt`. That rule is consistent with the JVM-clock facts: `appliedAt` is `Instant.now()` in
  `journalSuccess` (PatchSetApplyService.scala:236), taken after every edit has applied.
- **The messages follow the HEL-1720 and HEL-1792 rules.** D3 matches the structure of `describeBlocking`: it names
  readable items up to `NameCap`, counts the overflow and the unreadable items, and never shows an id. The Phase-2
  failure is a fixed phrase with a count. Steps can be described by op and position, because `withPosition` exists
  (PatchSetPreviewProjectionSteps.scala:20).
- **Every AC is covered.** The red test on `helio_app_test` with the `rolbypassrls` assertion is in D5 and task 1.2.
  The 409 with nothing changed is in spec scenarios 1-3. Blocking same-user later additions is in scenario 2 and D2.
  Steps are brought in as the ticket asked. Scope stops at HEL-1796/HEL-1797 as instructed.
- **No placeholders, and no open product question.** The alert-rule cascade is left out explicitly and is filed as a
  follow-up.

Two defects remain. Each is a contradiction or an unbuildable acceptance signal, found by checking the design's
mechanism against source.

**Defect A: "carried on the edit's outcome" would change the `/apply` response.**
- D2 says the created child ids are read "in `PatchSetApplyForward`'s `PipelineCreate` and `PipelineStepCreate` cases
  (carried on the edit's outcome into `journalSuccess`)".
- `PatchSetApplyForward.applyOne` returns `EditOutcome`. That is the `/apply` wire type
  (api/protocols/patchsets/PatchSetApplyProtocol.scala:32-38), and it has no spare field.
- `schemas/patch-sets/patch-set-apply-response.schema.json` sets `additionalProperties: false` on the edit item
  (line 55).
- `applyResolved`'s own doc (PatchSetApplyService.scala:120-122) requires the `applied` tuple shape to be "never
  widened", because `PatchSetApplyRollback.rollback` consumes it.
- The most literal reading of D2 therefore means one of two things. Either a new `EditOutcome` field, which breaks the
  proposal's "No response-schema ... change" and leaks step/Output ids into the `/apply` response. Or a changed
  `applyOne` return type, which the rollback contract forbids.
- The precedent that fits is the separate, `edit.index`-keyed `rawConfigs` accumulator. It is filled inside the loop
  right after `applyOne` (PatchSetApplyService.scala:147-149) and read only by `journalSuccess`. The design must name
  that mechanism, or an equivalent one.

**Defect B: the "same-set later edit" excusal cannot be reached through apply, yet a test depends on it.**
- An `output` create resolves `target.parentId` against a stored pipeline at pre-validation:
  `findByIdShared` plus `schemaAtNode` over stored steps (PatchSetOutputResolvers.scala:135-143).
- A `pipelineStep` create runs `checkAdd` against a stored pipeline (PatchSetPipelineStepResolvers.scala:150-155).
- `$ref` substitution exists only for an Output id bound into a later panel create (PatchSetRefs.scala:8-10;
  PatchSetApplyService.scala:150-153 maps only `OutputCreate` refs).
- So a patch set cannot add an `output` or a `pipelineStep` to a pipeline the same set creates. Nor can it add them
  under a step the same set creates, because the step's id does not exist until apply runs and there is no step ref.
- Consequences:
  - D2 point 1, which excuses through `output`/`pipelineStep` create `newId`s, never fires for these arms through
    the real apply path.
  - D5's test "a pipeline create with inline steps/Outputs plus a set-created `output` edit succeeds (excusal)"
    cannot be built through `PatchSetApplyService`.
  - The spec's scenario "Outputs and steps the patch set itself created do not block" contains the untestable
    parenthetical "(and may also add steps and Outputs to it in later edits of the same set)".
- An implementer would either get stuck, or hand-forge a journal row and present it as end-to-end proof.

### Verdict: REFUTE

The design is sound overall. Both change requests are small edits to the artifacts.

### Change Requests

1. **design.md D2 ("Where the ids are read"):** replace "carried on the edit's outcome into `journalSuccess`" with an
   explicit mechanism that leaves `EditOutcome`, `applyOne`'s return type, the `applied` tuple and the `/apply`
   response unchanged. For example: a separate `edit.index`-keyed accumulator, filled in `applyResolved`'s loop right
   after `applyOne` succeeds for a `PipelineCreate`/`PipelineStepCreate` (the `rawConfigs` pattern,
   PatchSetApplyService.scala:147-149), and read only by `journalSuccess`. Add an acceptance signal to tasks.md 2.1:
   the `/apply` response for a pipeline create is byte-identical in shape, with no new key. The existing apply
   contract/schema test still passes.
2. **design.md D2 point 1, D5, and the spec scenario "Outputs and steps the patch set itself created do not block":**
   record that same-set `output`/`pipelineStep` creates cannot target a pipeline or step the same set creates (cite
   the resolvers above). Then:
   - Either keep point 1 as a stated defensive excusal, covered by a helper-level test that is labelled as not
     reachable through apply, or drop it.
   - Change the D5 test to an end-to-end case that apply can actually build: a pipeline create with inline steps and
     Outputs, nothing added afterwards, and the undo succeeds.
   - Remove the "(and may also add steps and Outputs to it in later edits of the same set)" parenthetical from the
     spec scenario.
   - Make the mutation in 3.2 ("drop the `createdChildren` excusal") target this inline-only success case.

### Non-blocking notes

- D2's `pipelineStep`-arm `createdChildren` is always empty, because `addStep` creates no Output. Recording it "for
  symmetry" is fine, but the executor may prefer `None` on that arm to keep the journal minimal. Either way, say which.
- D3: when a step and an Output both block, both strings plus the panel string are joined with `; `. Make sure the
  message test covers that combined case once.
