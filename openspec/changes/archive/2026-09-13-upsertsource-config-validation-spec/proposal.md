## Why

The `upsertsource` write-back step (epic HEL-1098) needs a config model and a strict
write-path validator before its engine (HEL-1100), cycle detection (HEL-1101), or UI/MCP
(HEL-1102) can be built on top of it. No step kind currently validates its config on write —
today a mistyped value silently decodes to a typed default (the HEL-871 class of bug). This
change ships the reusable config model and its write-path check now, without registering the
step into the runtime.

## What Changes

- New `UpsertSourceConfig`/`UpsertTarget`/`UpsertMode` domain types: target is either a new
  source name or an existing `dataSourceId`; mode is `append` or `replace`.
- `UpsertSourceConfig.validateRawConfig`: strict write-path check rejecting malformed shape,
  wrong-typed fields, an unrecognised `target.kind`, or an unsupported `mode` — named,
  typed errors, never a silent default.
- `UpsertSourceConfig.decode`: tolerant read-path decode (absent `target`/`mode` default to an
  incomplete-draft / `append`), so a legacy or unconfigured row keeps reading.
- `UpsertSourceConfig.validateTargetOwnership`: async ownership pre-flight for an existing-source
  target, returning a uniform "not found" for both an unknown id and another tenant's id.
- **Not included**: `upsertsource` is deliberately **not** added to `PipelineStep.Registry` /
  `PipelineStepKind.All` — see the code's own scaladoc. Registering it requires the engine's
  `evaluate` implementation (HEL-1100) and cycle detection (HEL-1101); doing so now would let a
  caller persist a step that fails at run time. `PipelineCreateTransactionalSpec`'s existing
  "reject `upsertsource` until wired" case is left standing, not flipped.

## Capabilities

### New Capabilities
- `pipeline-upsertsource-config`: the `upsertsource` step's config model and write-path
  validation contract (not yet a runnable step).

### Modified Capabilities
(none — no existing capability's requirements change)

## Impact

- New file: `backend/src/main/scala/com/helio/domain/steps/UpsertSourceConfig.scala`.
- New test: `backend/src/test/scala/com/helio/domain/steps/UpsertSourceConfigSpec.scala`.
- No route, engine, migration, or registry change. No behavior change to any existing step.
