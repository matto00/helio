# HEL-671: Verify/fix silently-tolerant config decode for join/pivot/window/unpivot pipeline steps (same class as the aggregate/groupBy silent-corruption bug)

## Description

HEL-411's final gate (round 1) found and fixed a severe, live-reproduced silent-corruption bug: refining an existing pipeline's `aggregate`/`groupby` step via `POST /api/refinements` could return a `200` "already proven valid" `PatchSet` whose edit used the wrong wire shape for that step's config. Root cause: `AggregateConfig.decode`/`GroupByConfig.decode` build their vectors via `items.flatMap(it => Try(it.convertTo[...]).toOption)` — a shape-mismatched item is silently DROPPED rather than raised as a decode error — and `PatchSetApplyResolvers.validateEmbeddedStepReferences` (which `PatchSetPreviewService.preview` reuses verbatim) only checks for decode `Success`/`Failure`, never whether the successfully-decoded config is semantically complete. A wrong-shape aggregate/groupBy edit would have silently collapsed a pipeline's output to a single, columnless row if accepted.

The fix (HEL-411 final-gate round 2, commit `a978984e`) closed this for `aggregate`/`groupby` specifically via a general "config must match current shape" prompt rule plus concrete worked examples, verified with a real end-to-end apply-and-recompute round-trip.

**What's unverified:** the final-gate skeptic confirmed via a code read (not exhaustive live testing) that `join`/`pivot`/`window`/`unpivot` pipeline steps share the same silently-tolerant `flatMap`-drop-on-mismatch decode pattern. The general prompt rule is believed to cover them structurally (the rule is phrased generically, not per-step-kind), and this was spot-checked live for `window` only (one trial, correct) — the other three step kinds have no live verification at all.

**PREMISE CORRECTION (found during this run's Setup premise-validation, see `.concertino/runs/HEL-671/evidence/premise-validation.md`):** code-read confirms the literal `flatMap`-drop-on-item-mismatch pattern only in `WindowConfig.decode`'s `orderBy` field (`WindowStep.scala:42`). `JoinConfig`/`PivotConfig`/`UnpivotConfig` decoders instead silently default missing/mismatched **top-level** fields to empty/`""` (e.g. `PivotConfig.decode`'s `index` defaults to `Vector.empty` if not a `JsArray`; `column`/`values`/`agg` default to `""` if absent) — a distinct but same-class silent-degradation mechanism: still `Success` on decode, still semantically incomplete/wrong. `validateEmbeddedStepReferences` (`PatchSetApplyResolvers.scala`) falls through to `case Success(_) => Right(())` for pivot/window/unpivot with no semantic-completeness check either way — confirming the underlying risk (a wrong-shape edit for any of these 4 kinds can pass preview and silently degrade the pipeline) is real regardless of which exact mechanism causes it.

## Why this is higher priority than a typical follow-up

The underlying defect class is silent data corruption — a wrong-shape config that `preview` accepts as valid but that silently collapses or corrupts a pipeline's real output when applied, with no error, warning, or visible signal in the diff-preview UI pointing at the problem. This is categorically more severe than an ordinary UX/cosmetic follow-up.

## Acceptance Criteria

- [ ] For each of `join`, `pivot`, `window`, `unpivot`: confirm (code read, already done in Setup — see premise correction above) whether that step kind's config decoder shares a silently-tolerant (drop-on-mismatch, either per-item or per-field) pattern with `AggregateConfig`/`GroupByConfig`. (All four do, via one of the two mechanisms above.)
- [ ] For each of the 4 step kinds: LIVE-verify (real Claude-call trials against `POST /api/refinements` on this worktree's own backend, using `ANTHROPIC_API_KEY` from `backend/.env`, mirroring HEL-411's own aggregate/groupby reproduction method — a purpose-built test pipeline+step, cleaned up afterward) whether the existing general "config must match current shape" prompt rule genuinely prevents a wrong-shape edit for that step kind too, the same way it now does for aggregate/groupby.
- [ ] If any step kind's coverage gap is confirmed LIVE (not just theoretical): fix it the same way aggregate/groupby was fixed — add a worked UPDATE example for that step kind to `RefinementEditShape`, and extend `RefinementEditShapeSpec` to decode it through the real config decoder with a non-empty/correct assertion (a merely-decodes-without-throwing assertion does NOT catch this defect class — assert the actual decoded values, not just absence of an exception).
- [ ] Scope item 4 from the original ticket (making the affected decoders RAISE on shape mismatch instead of silently defaulting, so `PatchSetPreviewService.preview`'s structural check would catch this for ANY caller) is a SCOPE DECISION, not committed default scope: evaluate feasibility/blast-radius during Planning and ESCALATE to the human with a recommendation rather than silently including or excluding it.

## Context

Filed as a standalone, higher-priority follow-up from HEL-411 ("Multi-turn conversational refinement over live state (in-app chat + MCP)", PR #336, merged 2026-08-14). Non-blocking finding from `skeptic-final-2.md` (final-gate round 2).

This is ticket 1 of a 4-ticket sequential data-integrity batch (HEL-671 → HEL-639 → HEL-630 → HEL-651).

## Coordinator Premise Correction (second pass, verified)

Two distinct silent-tolerance mechanisms exist, not one:
- (1) `items.flatMap(it => Try(it.convertTo[X]).toOption)` — item-level drop. Present in `WindowStep.decode`
  (`orderBy`), plus `FilterStep.decode` (`conditions`) and `SortStep.decode` (`sortBy`) — the latter two are
  OUT OF SCOPE for this ticket (reported separately for a follow-up ticket).
- (2) `items.collect { case JsString(s) => s }` (silently drops non-string items) combined with
  `StepCodecUtil.stringOr` (silently defaults missing/wrong-typed scalars) — field-level default. Present in
  `PivotStep.decode`, `UnpivotStep.decode`, `WindowStep.decode` (`partitionBy`), and `JoinStep.decode` (all
  three fields, most severe: `rightDataSourceId` defaults to `""`).

`join`/`pivot`/`unpivot` are in scope via mechanism (2), not the flatMap pattern originally described.
`window` carries both mechanisms. Live trials must probe both mechanisms per step kind, not just the
flatMap pattern. Note: `join`'s real silent-degradation surface is `joinKey`/`joinType`, NOT
`rightDataSourceId` — the latter is backstopped by `PatchSetApplyResolvers`'s own referential-integrity
check (`dataSourceRepo.findByIdOwned`), so an empty value there is caught and surfaced as an error, not
silently accepted.

Scope item 4 (decoder hardening) — RESOLVED by coordinator: `defer-to-followup`. Not part of this change.
