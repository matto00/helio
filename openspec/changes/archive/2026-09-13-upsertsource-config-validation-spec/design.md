## Context

`PipelineStep.Registry` maps a step kind string to a `PipelineStep.Companion`, and every
`Companion` entry requires a full `PipelineStep` subtype implementing `evaluate` (real engine
behavior). `PipelineStepKind.All` is derived from that registry, and it is the exact allow-list
`PipelineService.create`/`addStep` check before persisting a step (`PipelineCreateTransactionalSpec`
pins a 400 for `upsertsource` "until wired"; `PipelineStepsOpCheckSeededRowsSpec` proves the DB
constraint alone already accepts the four new write-back op strings after HEL-1104's V107).
HEL-1100 (engine), HEL-1101 (cycle detection, Urgent priority — "a pipeline must not write to a
source it reads"), and HEL-1102 (step-card UI / MCP) are separate, not-yet-started tickets under
the same epic (HEL-1098).

## Goals / Non-Goals

**Goals:**
- Ship the `upsertsource` config model (`target`/`mode`) and its strict write-path validator now,
  reusable by every later ticket in the epic.
- Keep read-path decoding tolerant, per `PipelineStepRepository.rowToDomain`'s existing contract
  (any decode failure there becomes an `IllegalStateException` on every read of that step).
- Ship the openspec capability spec this ticket's own AC requires.

**Non-Goals:**
- Implementing `evaluate` (engine behavior) — HEL-1100.
- Cycle detection — HEL-1101.
- Step-card UI or MCP tool wiring — HEL-1102.
- Registering `upsertsource` in `PipelineStep.Registry` / `PipelineStepKind.All` — see Decision 1.

## Decisions

### Decision 1 — do not register `upsertsource` in `PipelineStep.Registry` yet

Registering a kind in the registry is what makes `PipelineService.create`/`addStep` accept it
(`PipelineStepKind.All.contains`), and every registry entry requires an `evaluate` implementation.
Adding one now, without HEL-1100's engine work, would mean either (a) `evaluate` throws or is a
stub, so a persisted step fails at run time with no clear signal until then, or (b) `evaluate` is
implemented here, silently absorbing HEL-1100's scope into this ticket, contradicting the ticket's
own stated boundary ("Do not implement the engine"). Worse, HEL-1101's cycle detection (a pipeline
must not write to a source it reads) has not landed either — a runnable-but-cycle-unchecked write
step is a correctness hazard, not just an unfinished feature.

`PipelineCreateTransactionalSpec`'s existing "reject `upsertsource` until wired" case is
therefore left standing. This ticket ships `UpsertSourceConfig`/`validateRawConfig`/
`validateTargetOwnership` as free-standing, fully-tested building blocks; whichever of
HEL-1100/1101/1102 does the actual registration wires them into a `PipelineStep.Companion`
directly (the method bodies are copy-paste-ready — see the file's own scaladoc).

**Alternative considered**: implement a `PipelineStep.Companion` now with `evaluate` throwing
`NotImplementedError` and NOT add it to `Registry` (so it stays unreachable). Rejected as pure
overhead — a `Companion` with no `Registry` entry is unreachable through every real code path;
the free-standing object achieves the identical reachability with less code to maintain.

### Decision 2 — target discriminated union mirrors `SecondaryInput`

`join`/`union`/`lookup` already use a `{"kind": ..., ...}` discriminated object for a two-case
config reference (`SecondaryInput`). `UpsertTarget` follows the identical shape and error-message
conventions (`StepConfigTypeMismatch`, "requires a string 'x'" wording) rather than inventing a
new discriminator convention.

### Decision 3 — ownership check is a separate async function, not part of `validateRawConfig`

`Companion.validateRawConfig` is synchronous; checking whether a `dataSourceId` is owned by the
caller requires a DB round-trip. Every other op with a second-source reference (`join`/`union`/
`lookup`) does this the same way: a synchronous shape/type check in `validateRawConfig`/decode,
plus a separate async ACL pre-flight in `PipelineService.addStep`'s `aclCheckF`, keyed off
`PipelineStepConfigCodec.secondaryDataSourceId`. `validateTargetOwnership` is written to the same
contract (`findByIdOwned`, uniform "not found" for both absent and other-tenant ids) so wiring it
into that exact call site is direct.

## Risks / Trade-offs

- **Unreachable code until wired.** Nothing in this ticket's new file is called by any running
  route yet — it is proven correct by direct unit tests only. Accepted: the alternative (partial
  registration) is the exact hazard Decision 1 rejects.
- **Wire-shape lock-in.** The `{"kind": ...}` target shape and `append`/`replace` mode strings
  become load-bearing for HEL-1100/1101/1102 the moment this merges. Mitigated by mirroring the
  already-proven `SecondaryInput` convention rather than inventing one.
