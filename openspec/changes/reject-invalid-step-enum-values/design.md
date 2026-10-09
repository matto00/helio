## Context

`FillNullStep`, `WindowStep` and `PivotStep` (`backend/src/main/scala/com/helio/domain/steps/`) do not override
`validateRawConfig`, so only the shared shape check (`PipelineStep.scala:198`, `strictDecodeProblem`) runs on write.
Their enum rules live twice: in `apply` (`FillNullStep.scala:84-93`, `WindowStep.scala:99-118`,
`PivotStep.scala:80-83`, all `StepConfigError`) and in `PipelineAnalyzeService.validateFillNull`/`validateWindow`/
`validatePivot` (`PipelineAnalyzeService.scala:407-449`). `validateStepConfig` (`:352-397`) short-circuits on a
non-empty `validateRawConfig` result (`shapeRejection`, `:370-373`), and `AutoRunTriggerService.scala:93` reads the
same function via `stepConfigProblem`.

Write surfaces calling `validateRawConfig` today (verified on 3d63a175): `PipelineService.scala:561` (single-call
create, HEL-1402), `:1853` (step create), `:2207` (step update), `PipelineProposalService.scala:296`,
`PatchSetApplyResolvers.scala:205` (step-update edit) and `:578` (pipeline-create edit, HEL-1402). One override per
kind therefore reaches all of them with no service change — the HEL-1310 aggregate precedent
(`AggregateStep.scala:182-186`, `super.validateRawConfig(raw).orElse { ... }`).

Decoders default absent `strategy`/`function`/`agg` to `""` (`FillNullStep.scala:29`, `WindowStep.scala:39`,
`PivotStep.scala:28`). The editor's new-step defaults are `strategy: "constant", value: null`, `function:
"row_number"`, `agg: "sum"` (`frontend/src/features/pipelines/state/stepNarrowing.ts:310-328`) — the editor never
sends `""`, but agents/API callers may omit the key.

Frontend: the three editors' dropdowns offer only supported values and `WindowConfig.handleOffsetChange` only emits
`parsed > 0`. But `useStepCardState.persist` (`hooks/useStepCardState.ts:265-310`) swallows a rejected PATCH for every
kind except `upsertsource` (`captureErrors`), so a server 422 is invisible today.

helio-news (read-only grep): uses no fillnull/window/pivot step. `CreateStepConfigNonRegressionSpec`'s `pivot-matrix`
shape expands to `agg: "sum"`/`"first"` — valid.

## Goals / Non-Goals

**Goals:** write-time 422 for a non-empty unknown fillnull strategy / window function / pivot agg and a non-positive
explicit lag/lead offset; one rule function per kind shared by write, analyze and run; drafts stay saveable; editors
show the server message.

**Non-Goals:** the HEL-1417 helper extraction; read-time validation; HEL-1408's fill semantics; other kinds' enums;
patch-set step-CREATE edits (resolve late — HEL-1417 scope).

## Decisions

1. **One problem function per kind, three callers.** Add on each companion object (public, like
   `AggregateStep.aggregationProblem`):
   - `FillNullStep.strategyProblem(cfg): Option[String]` — `cfg.strategy` non-empty and not in `SupportedStrategies`
     → the existing `Unsupported fillnull strategy: '<s>'. Supported: ...` text.
   - `WindowStep.enumProblems(cfg): Vector[String]` — non-empty unknown `function` (existing message); else for
     `lag`/`lead`, `offset.exists(_ <= 0)` → existing `window function '<fn>' requires a positive 'offset', got <o>`.
   - `PivotStep.aggProblem(cfg): Option[String]` — non-empty unknown `agg` (existing message).
   Each companion overrides `validateRawConfig` as `super.validateRawConfig(raw).orElse(<Try(decode).toOption ...>)`
   (decode failure → `None`, left to the existing malformed-config category). The analyze validators and `apply` call
   the same functions; the empty-value case (draft) stays reported by analyze and refused by `apply` via the remaining
   empty-specific branch (message unchanged: `Unsupported ...: ''`).
2. **Empty means draft, non-empty unknown means invalid.** `""` is what an omitted key decodes to and is
   indistinguishable from "not chosen yet", so rejecting it would break HEL-814 D2. A non-empty value outside the set
   can only be a mistake. Matching is exact/case-sensitive, as `apply` already is (`forwardFill`).
3. **Offset is checked only for `lag`/`lead`, and only when present.** Run ignores `offset` for other functions
   (`WindowStep.scala:111-119`) and defaults an absent offset to 1; rejecting at save what runs fine would be a new
   contract, not "clearly invalid". `field` requirements stay analyze/run-only (drafts).
4. **Exactly-once in analyze.** Because `validateStepConfig` short-circuits on `validateRawConfig`, a non-empty
   unknown value is now reported from the override alone; the per-kind validators keep reporting the draft cases. A
   test asserts one message (no `"; "` duplication) per invalid value.
5. **Status codes unchanged.** Each surface keeps the status it already returns for a `validateRawConfig` problem
   (422 REST/patch-set/proposal-apply; proposal validate's existing shape). No new error type.
6. **Legacy rows.** No read-path change: `rowToDomain` decodes tolerantly; listing and analyze continue to work and
   analyze reports the problem (via the override, once). An UPDATE of such a step with its invalid enum unchanged now
   422s — accepted, same consequence HEL-1310 accepted.
7. **Frontend surfacing.** Pass `captureErrors = true` from the fillnull/window/pivot change handlers in
   `useStepCardState` and render `saveError` for those editors exactly where `upsertsource` renders it (reuse the
   existing element/class — no new styling; executor verifies where that is). Red-first: a test mocking
   `updatePipelineStep` to reject with a 422 message asserts the message is shown, failing before the wiring. The
   existing "only supported values selectable" behavior is pinned with guard tests (labelled guards, shown failable by
   mutation of the option lists / `parsed > 0` check), since it is pre-existing.

## Risks / Trade-offs

- [Agent-written configs with near-miss casing, e.g. `"forwardfill"`, now 422] → intended; message lists the valid set.
- [Fillnull edits in flight under HEL-1408] → this change touches only the companion/validation, not fill logic; the
  executor rebases on origin/main before delivery and reports any overlap.
- [`captureErrors` widened to three more kinds] → error shown only for a rejected save; staleness token guard unchanged.

- [Analyze now shows only the enum problem for such a step, hiding siblings like an empty `outputColumn`] → same
  trade-off HEL-1310 accepted; siblings reappear once the enum is fixed.

## Planner Notes

- Self-approved: empty-is-draft (D2), offset only for lag/lead (D3), frontend surfacing via the existing
  `captureErrors` mechanism rather than a new one (D7). None is an architectural change, dependency or API break.
- Driver claim "all write paths now call validateRawConfig" verified, except patch-set step-CREATE edits (resolved late,
  named in HEL-1417) — out of scope here and stated in the spec's surface list.
