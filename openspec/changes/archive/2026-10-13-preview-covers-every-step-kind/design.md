## Context

`PatchSetPreviewStepProjection.pipelineStepUpdateAfter` (split out by HEL-1498) composes the after-state of a `pipelineStep` update purely in memory: `PipelineStepConfigCodec.decode(prior.kind, …)` then `PipelineStepProjectionSupport.withDecodedConfig(prior, typed)` (config edits) and `PipelineStepProjectionSupport.withPosition(…)` (always called). Both functions in `PatchSetPreviewProjectionSteps.scala` enumerate 24 kinds; `PipelineStep.Registry` (`domain/model/PipelineStep.scala`) registers 27. Missing: `ConvertFormatStep`, `AnalyzeWithAiStep`, `GenerateTextStep` (verified by grep on ea04f2aa2; no fourth kind is missing — `AnalyzedStep` and `WorkspaceContextPipelineStep` are not `PipelineStep` registry kinds; executor re-verifies this).

Predicted failure modes (to be confirmed red, not assumed):
- Any update of those kinds reaches `withPosition` → `MatchError` → 500.
- A config update first hits `withDecodedConfig`'s `case _ => Left(...)` → 400 "config decode produced a type mismatched with step kind" — wrong, since decode is keyed by the step's own kind.

## Goals / Non-Goals

Goals: preview resolves for all 27 kinds; a test-time guard that names any future registered kind missing an arm; route-level red-first proof per missing kind; apply-path confirmation.

Non-Goals: changing preview/apply semantics for the 24 already-covered kinds; sealing `PipelineStep` (large blast radius, many files); touching panel-row lock/trigger code (HEL-1534); AI-step execution (no Claude call is made by preview or a step update).

## Decisions

**D1 — Add explicit arms, keep the per-kind enumeration style.** Mirrors `fromDomain` and the repository's `rowToDomain`. A generic reflective `.copy` is rejected (unsafe, unidiomatic).

**D2 — `withPosition` gets no wildcard default.** A default arm that returns the step unchanged would silently drop a position change; a default that throws is the status quo. Instead the guard spec (D3) makes the gap a test failure. `withDecodedConfig` keeps its existing defensive `Left` default for genuinely mismatched (kind, config) pairs.

**D3 — Registry-driven structural guard spec** (unit level, `backend/src/test/scala/com/helio/services/patchsets/`), following the established `PipelineStepSecondSourceGuardSpec` / `PipelineStepRegistryCatalogSpec` pattern. For every `kind` in `PipelineStep.Registry.keySet`: build a domain step of that kind (config from the companion's tolerant `decodeConfig` of a minimal raw config, or a per-kind fixture where tolerant decode cannot produce one), assert `withPosition` returns a step of the same kind with the new position, and `withDecodedConfig(step, decodedConfig)` returns `Right` of the same kind. The guard must also assert the iterated set has size >= 27 and contains the three kinds, so it cannot pass vacuously over an empty/short registry. Construction of a domain step from (kind, config) should reuse an existing production constructor if one is reachable (e.g. the repository's row→domain mapping); if a test-local per-kind factory is needed, that factory itself must fail loudly (not skip) for an unknown kind, so the guard still fails on a new kind.
  The guard's ability to go red is proven by mutation: temporarily delete one arm (e.g. the `GenerateTextStep` `withPosition` arm), observe the guard fail naming `generatetext`, restore. Record the red transcript.

**D4 — Route-level red-first specs** in `backend/src/test/scala/com/helio/api/routes/patchsets/` using the same route test base as `PatchSetPreviewRoutesSpec` / `PatchSetPreviewCumulativeSpec`. For each of the three kinds: create a pipeline with a step of that kind via the real create route/service, then preview (a) a position-only update and (b) a valid same-kind config update. Assert 200 and that `after` has the right `type`, `position`, and `config`. Run against unfixed code first and record the red (expected: 500 for both, or 400 for (b)) — the actual observed status is recorded, not the prediction. Then apply the same patch set through the real apply route and assert the persisted step reflects it (apply-path confirmation). AI step kinds have no create/update tier gate (gating is run-time only, in `ClaudeAiStepClient.complete`; verified at the design gate), so any throwaway user works; preview SHALL agree with apply's accept/reject.

**D5 — Scaledoc counts.** The stale "22 step kinds" comments in `PatchSetPreviewProjectionSteps.scala` are corrected to reference the registry rather than a hardcoded count.

## Risks / Trade-offs

- AI step kinds may need a beta/owner-tier user or an `ANTHROPIC_API_KEY` at create time; tests must never make a network call. Mitigation: route specs create and update only — no run.
- A test-local kind→step factory could itself drift. Mitigated by D3's fail-loud requirement and size/contains assertions.

## Migration Plan

None. No schema change.
