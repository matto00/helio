## Why

Pipeline step config decoders silently tolerate wrong-shape configs: a mistyped config decodes "successfully"
into a degraded value rather than raising, so a wrong-shape edit returns `200` and silently corrupts the
pipeline's real output. HEL-411 and HEL-671 addressed this only by prompt-engineering the refinement path;
they make a wrong-shape config less likely, not impossible.

HEL-860 already established the durable shape four days ago: `decodeConfig` is contractually tolerant on the
READ path, and strictness lives on a write-path `validateRawConfig` hook returning 422. That hook exists and
is wired into `PipelineService.addStep`/`updateStep` — but **not** into `PatchSetApplyResolvers`
(preview + refinement apply) or `PipelineProposalService` (MCP apply). Those two unguarded surfaces are the
real defect, and they are exactly the callers the ticket names.

## What Changes

- **Read path** — `*Config.decode` raises when a key is **present but of the wrong JSON type**. Absence and
  emptiness stay tolerant. Measured safe: 0 of 233 persisted rows across dev and prod carry a wrong-type config.
- **Write path** — `validateRawConfig` is implemented for all 23 step kinds (wrong-type rejection only, so
  incomplete editor drafts stay savable) and wired into the two surfaces that lack it.
- **Run and analyze time** — missing/empty **required** fields are rejected, because "legitimate to save" is
  not "legitimate to run": a `compute` with `column: ""` silently writes a column named `""`. Run errors use
  HEL-859's step-naming shape; analyze reports through the existing `validationError` field.
- **Enum and numeric coercion** — enum-valued options case-normalize then reject unknown values, naming the
  supported set. Covers `filter.combinator` (a `5` silently becoming `AND` turns an OR filter into an AND
  filter), `dedupe.keep` (`"LAST"` becoming `"first"` inverts which row wins), `splittext.mode`,
  `chunkbytokencount.encoding`, and `limit.count` narrowing to `0` (which means unlimited).
- **BREAKING** for callers that today submit a wrong-**typed** config and receive `200`: they now receive 422.
  No persisted row changes behavior; no migration required.

## Capabilities

### New Capabilities
- `pipeline-step-config-read-strictness`: the read path raises on a present-but-wrong-type config key while
  remaining tolerant of absent and empty keys, so stored drafts continue to decode.
- `pipeline-step-config-runtime-completeness`: a step whose required configuration is missing or empty fails at
  run and analyze time with a message naming the step and the field, instead of producing degraded output.

### Modified Capabilities
- `pipeline-step-config-rejection`: extends write-path rejection from `cast`/`rename` to all 23 step kinds, and
  from the step-create/update surfaces to preview, refinement apply, and MCP apply.
- `pipeline-step-config-validation`: adds required-field completeness and enum normalization to the set of
  values validated at analyze time.

## Impact

`backend/src/main/scala/com/helio/domain/steps/` (23 step files + `StepCodecUtil`),
`PipelineStep.Companion` SPI, `PatchSetApplyResolvers`, `PipelineProposalService`, `PipelineService` analyze.
Read path via `PipelineStepRepository.rowToDomain` is deliberately unaffected for absent/empty keys.
3 of HEL-671's 5 characterization tests flip (`pivot`, `unpivot`, `window` — all wrong-**type** fixtures). The
other 2 are relabelled as guards: `PatchSetPreviewServiceSpec`'s preview test and the `join` decode test both hinge
on `joinKey` being **absent**, which the read and write paths deliberately keep tolerant; completeness is enforced
instead at run and analyze time. The lost flip is replaced by a new test asserting preview rejects a `join` edit
whose `joinKey` is present but of the wrong JSON type.
