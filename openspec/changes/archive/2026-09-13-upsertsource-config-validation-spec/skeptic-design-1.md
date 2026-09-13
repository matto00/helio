## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Retroactive run: the change was implemented and archived before any gate ran. I reviewed the
archived artifacts at `openspec/changes/archive/2026-09-13-upsertsource-config-validation-spec/`
against the ticket, the Linear sibling tickets, and the code at HEAD `8d8f622b`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/upsertsource-config-validation-spec/HEL-1099`.
- **Ticket AC (openspec spec exists):** the archived delta is present, and it matches the body of
  `openspec/specs/pipeline-upsertsource-config/spec.md` exactly (`diff` of the requirement bodies
  gave no output -> `SPEC_SYNCED`). Met.
- **Decision 1 (do not register), checked against the code. The reasoning is SOUND:**
  - `PipelineStep.scala:274` `def All: Set[String] = PipelineStep.Registry.keySet`. The allow-list is
    derived from the registry, so registering a kind is exactly what makes it creatable.
  - `PipelineService.scala:521` (transactional create), `:1496` (the allow-list check shared with
    `addStep`) and `PipelineProposalService.scala:272` all check `PipelineStepKind.All.contains`. Leaving the
    kind unregistered keeps it rejected on every write surface, including agent proposals.
  - A registry entry is a `Companion` whose `readFromWire` must produce a `PipelineStep`, and
    `PipelineStep` declares `evaluate`. `InProcessPipelineEngine.scala:493` dispatches on
    `companionFor`. Registering without an engine means a stub `evaluate`.
  - HEL-1101 (Urgent, Backlog) says "Reject at validation time, not at run time". A registered,
    runnable `upsertsource` before that lands would allow a write-to-own-source cycle.
  - The pinned test `PipelineCreateTransactionalSpec.scala:167-188` expects
    `BadRequest("Invalid step type 'upsertsource'")`. Leaving it unflipped is consistent.
  - The rejected alternative (an unregistered `Companion`) really would be unreachable. Choosing
    free-standing functions is reasonable.
- **Ticket's read-path trap (strict on write, never on read), checked in the code:**
  - `UpsertSourceConfig.validateRawConfig` reuses the same `UpsertTarget.format.read` that `decode`
    uses. The only extra check on the write side is `modeError`, which is stricter than the read path.
    The unsafe direction (write accepts, read throws) does not occur.
  - `null` is handled the same way on both paths. `StepCodecUtil.present` (line 56-57) treats `JsNull`
    as absent, and `decodeErrorFor` does the same.
  - `{"target":"ds-1"}` fails `decode`, but `validateRawConfig` rejects it too, so it can never be
    persisted. This matches the existing `strictDecodeProblem` (HEL-814 D2) parity contract.
- **Decision 2/3:** the `SecondaryInput`-style discriminator and the separate async ownership check
  match existing `join`/`union`/`lookup` conventions. `findByIdOwned` returns `None` uniformly, so
  the spec's "no cross-tenant oracle" scenario holds.
- **Scope:** no engine, route, migration, or registry change. Nothing goes beyond the ticket.

### Verdict: REFUTE

The core design call (Decision 1) is correct and I would defend it. REFUTE is for two artifact
defects. Both would mislead the tickets that build on this one, and both are cheap to fix.

### Change Requests

1. **The registration step has no owner, which re-opens the hazard Decision 1 exists to prevent.**
   `design.md` Decision 1 ("whichever of HEL-1100/1101/1102 does the actual registration") and the
   top scaladoc of `UpsertSourceConfig.scala` (lines ~50-53) leave the registration step without an
   owner. I checked all three tickets in Linear: none of their descriptions mentions registering the
   kind in `PipelineStep.Registry` or flipping the pinned test. There is also no blocking relation
   saying registration must wait for HEL-1101. HEL-1100's AC ("append preserves existing rows ...")
   effectively needs a runnable, registered step. So the likeliest path is that HEL-1100 registers it
   while HEL-1101 is still unstarted. That is exactly the "runnable but no cycle check" state Decision 1
   calls a correctness hazard.
   A deferral must name a real task. Name the owning ticket in `design.md` and the scaladoc: register
   in HEL-1100, or add a new ticket. Also state the ordering constraint: registration is blocked until
   HEL-1101's validation-time cycle check exists. Then record that constraint in Linear, as a
   `blockedBy` relation or a note on the owning ticket, so it is not just prose in an archived
   change. Stating the ordering in the capability spec's "not yet creatable" requirement would also
   make it binding on whoever flips the test.

2. **The proposal's "Why" states something false about the codebase.** `proposal.md`: "No step
   kind currently validates its config on write — today a mistyped value silently decodes to a
   typed default." In fact `PipelineStep.Companion.validateRawConfig` (`PipelineStep.scala:156`)
   already applies `strictDecodeProblem` to every registered kind. It is called on write at
   `PipelineService.scala:1718` and `:2001`, `PipelineProposalService.scala:282`, and
   `PatchSetApplyResolvers.scala:190`. `CastStep`, `ComputeStep` and `RenameStep` override it with
   stricter checks. The sentence copies the ticket's stale premise (from before HEL-814).
   Correct it to what is actually new: a strict *enum-value* check (`mode` outside
   `append|replace`) for this kind, not the first write-path validation. Otherwise the follow-up
   tickets inherit a wrong model of where validation lives.

### Non-blocking notes

- tasks.md 3.1 says "legacy/malformed-absent row still decodes". A *present* wrong-typed value
  still fails `decode`, and the spec says so correctly. Make the task wording match the spec.
- `ExistingSource("")` as the absent-target default means `validateRawConfig` accepts
  `{"target":{"kind":"existingSource","dataSourceId":""}}`. That fits the incomplete-draft
  contract, but HEL-1100's `requiredConfigProblems` must reject it at run/analyze time. Worth one
  sentence in the design so the engine ticket doesn't miss it.
- Process: `next-report-number.sh` was pointed at the archive directory, because the active change
  directory no longer exists after the premature archive. Numbering there is still collision-safe.
