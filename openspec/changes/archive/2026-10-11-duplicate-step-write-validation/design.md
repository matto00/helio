## Context

See proposal.md - Why. Current state on main (39ff63546):

- `PipelineService.duplicateStep` (PipelineService.scala:246) delegates to `PipelineStepWrites.duplicateStep`
  (PipelineStepWrites.scala:234). It round-trips `PipelineStepConfigCodec.decode(kind, encode(existing))` and calls
  `pipelineStepRepo.spliceInsertAtInternal(..., typedConfig, ...)`, which persists `encodeConfig(kind, typedConfig)`.
  It never calls `PipelineStep.rawConfigProblem`.
- Create (`PipelineStepCreate.addStepReporting`) and update (`PipelineStepWrites.updateStep`) both call
  `PipelineStep.rawConfigProblem(kind, raw)` before the tolerant decode and map `Some(msg)` to
  `ServiceError.UnprocessableEntity(msg)` (422). `rawConfigProblem` = `validateRawConfig` (strict type/enum/parse checks,
  overridden by 11 kinds) `orElse writeConfigProblem` (write-only extras; today only cast's unsupported-target check,
  HEL-1436 D4). It does NOT include `requiredConfigProblems`, which is why incomplete drafts are saveable (HEL-1416).
- `CastStep.SupportedTargets` (CastStep.scala:72) = string, integer, long, float, double, number, boolean, date, timestamp.
  Frontend `CAST_TARGET_TYPES` (CastFieldsConfig.tsx:8) = string, integer, long, double, boolean. The shared `Select`
  (frontend/src/shared/ui/Select.tsx:66) resolves `selected = options.find(o => o.value === value) ?? null`, so a stored
  target missing from the options renders with nothing selected. `SelectOption` supports `disabled`.
- `CastPipelineRunSpec` (backend/src/test/scala/com/helio/services/pipelines/) already drives `PipelineRunService.submit`
  for supported targets, but not for a stored legacy target.

## Goals / Non-Goals

**Goals:** close the duplicate bypass for every kind with one call to the existing shared check; picker list equal to the
backend list with a mutation-failable guard; stored unsupported targets displayed honestly; Purpose filled; submit-path
proof of legacy passthrough.

**Non-Goals:** changing what `rawConfigProblem` accepts; touching analyze/run gates (`RunConfigGate`,
`PipelineAnalyzeService.checkEnabledStep` — HEL-1504 owns the run gate concurrently); a runtime API exposing targets.

## Decisions

**D1 — Validate the encoded stored config (the round trip's input, equal to what is persisted).** In `PipelineStepWrites.duplicateStep`, after the editor check and
before the round-trip decode, compute `raw = PipelineStepConfigCodec.encode(existing)` (the same encoder the repository
uses to persist) and call `PipelineStep.rawConfigProblem(existing.kind, raw)`; `Some(msg)` → `Left(UnprocessableEntity(msg))`,
mirroring create/update verbatim (same message, same status). Alternative considered: validate the raw DB row text — it
is not available on the domain `PipelineStep`, and what matters is what would be written, which is the encoded typed
config. Ordering after the ACL check preserves 404/403 masking (a viewer must never learn a config is invalid).
An encode failure keeps today's 500-classified behaviour (Decision 5 of HEL-412).

**D2 — Drafts stay duplicable; one kind needs an encoder fix.** `rawConfigProblem` excludes `requiredConfigProblems`, so
most create-accepted drafts pass D1 after the round trip — but NOT all (design-gate round 1): the frontend `convertformat`
seed is `{"field":""}` (from/to absent; `ConvertFormatConfig.pairError` only fires when both keys are present), yet the
tolerant decode fills `from`/`to` with `""` and `ConvertFormatConfig.format.write` always emits them, so the stored row and
`encode(existing)` carry `"from":"","to":""`, which `pairError` rejects. Resolution: `ConvertFormatConfig`'s writer omits
`from`/`to` when they are empty (decode already reads an absent key as `""`, so the typed value is unchanged). This makes the
persisted/encoded shape equal the draft create accepted, fixes duplicate for existing stored drafts without a migration
(duplicate re-encodes from the typed config), and does NOT change what create accepts (an explicit present `""`/`""` pair
in a request is still a 422). The executor verifies the frontend convertformat editor and any wire consumer treat an
absent `from`/`to` as empty (it reads the step response through the same writer). Duplicate becomes exactly as strict as
create, never stricter.

**D3 — Per-kind red evidence.** The executor enumerates, per registered kind, whether a stored row can carry a config that
`rawConfigProblem` rejects AFTER the typed decode/encode round trip (stored rows are inserted directly via the repository
or SQL, since the write surfaces reject them). Kinds where a reachable stored-invalid shape exists get a red-first route
test through `POST /api/pipeline-steps/:id/duplicate` (cast legacy target at minimum). Kinds where the round trip
normalises every rejectable shape away (or decode fails first, already 500) are listed in the evidence with the reason.
One table-driven route spec is preferred over one test per kind. Draft-safety half: for EVERY registered kind, a
table-driven unit check that each create-accepted draft shape (the frontend seed from `defaultConfigFor`/stepNarrowing and
the HEL-1416 draft shapes; generatetext and analyze_with_ai covered explicitly) still passes `rawConfigProblem` after
`encode(decode(draft))` — this is what caught convertformat and pins it for future kinds.

**D4 — One list per side, a guard pins them (HEL-1311 / HEL-1459 pattern).** `CAST_TARGET_TYPES` becomes the backend
list in the backend's order. A jest GUARD test reads `backend/src/main/scala/com/helio/domain/steps/CastStep.scala`,
extracts the `SupportedTargets` `Vector(...)` literal, asserts the extraction found at least one value (fail-loud if the
literal moves) and that it equals `CAST_TARGET_TYPES`. Labelled GUARD; mutation evidence (drop one value from each side,
see red) recorded in the run evidence dir. Alternative: a JSON schema enum as a meeting point — rejected: there is no
cast-config schema today, and adding contract surface for a UI list is larger than the problem.

**D5 — Stored unsupported targets render as themselves.** When `casts[col]` is a non-empty string not in `CAST_TARGET_TYPES` (a stored `""` is excluded: it would collide with
keep-as-is's value and React key), that
row's options gain one extra option `{value: stored, label: "<stored> (unsupported)", disabled: true}` so the trigger shows
the stored value; it is not selectable and not offered on other rows. Choosing a supported target or "keep as is"
replaces it via the existing `onChange`. This is the "show stored values read-only" option the ticket names, applied only
to genuinely unsupported values; it reveals existing state, so it is self-approved rather than escalated.

**D6 — Spec Purpose.** Edit `openspec/specs/pipeline-cast-op/spec.md`'s `## Purpose` directly (archive ignores a delta
Purpose for an existing capability).

## Risks / Trade-offs

- [Guard regex couples to Scala formatting] → fail-loud on zero matches; scalafmt reflow would surface as red, not pass.
- [A stored invalid step can no longer be duplicated] → intended; the 422 message names the fix, and the frontend
  duplicate action already surfaces a visible error on failure (pipeline-step-lifecycle spec) — executor verifies the
  422 message actually reaches the UI.
- [Offering three numeric synonyms (float/double/number)] → mandated by "exactly the backend list"; collapsing is a
  separate product call (non-goal).

## Planner Notes

- Self-approved: D2 (convertformat writer omits empty from/to; no product trade-off), D5 (display-only), D4 test mechanism.
- Driver directive adopted: picker list equals backend list exactly (includes `number`, which the ticket did not name).
