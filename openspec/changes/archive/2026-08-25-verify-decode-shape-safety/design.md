## Context

HEL-411's final gate found and fixed a live-reproduced silent-corruption bug in `AggregateConfig.decode`/
`GroupByConfig.decode` (`items.flatMap(it => Try(it.convertTo[...]).toOption)` silently drops a
shape-mismatched item). The fix was a general prompt rule + worked examples in `RefinementEditShape.scala`,
verified via a real apply-and-recompute round-trip.

This run's Setup premise-validation (code read, `.concertino/runs/HEL-671/evidence/premise-validation.md`)
confirmed the underlying risk is real for all 4 remaining step kinds, via one of two mechanisms:

- `WindowConfig.decode`'s `orderBy` (`WindowStep.scala:42`) — the literal same per-item
  `flatMap(...).toOption` drop pattern.
- `JoinConfig`/`PivotConfig`/`UnpivotConfig` decoders (`JoinStep.scala`, `PivotStep.scala`,
  `UnpivotStep.scala`) — silently default missing/mismatched **top-level** fields to empty/`""` via
  `StepCodecUtil` helpers (e.g. `PivotConfig.decode`'s `index` defaults to `Vector.empty` if not a
  `JsArray`; `column`/`values`/`agg` default to `""` if absent).

Either way, `PatchSetApplyResolvers.validateEmbeddedStepReferences` falls through to
`case Success(_) => Right(())` for pivot/window/unpivot with no semantic-completeness check (join/union/
lookup get an additional referential-integrity check on the referenced data source id, but still no
config-shape completeness check).

## Goals / Non-Goals

**Goals:**
- Determine, per step kind, whether the existing generic "config must match current shape" prompt rule in
  `RefinementEditShape`/`RefinementPrompt` actually prevents the LLM from emitting a wrong-shape edit for
  that kind, via real `POST /api/refinements` trials (not another code read).
- For any step kind where a live trial reproduces a wrong-shape edit slipping through, close the gap the
  same way aggregate/groupby was closed: a worked UPDATE example + a decode-and-assert-actual-values test.

**Non-Goals:**
- Decoder hardening (raise-on-shape-mismatch) — see Open Questions; this is a scope decision, not
  default-included.
- Any UI-facing change — this is entirely backend prompt-grounding + backend test coverage.

## Decisions

**D1 — Live-trial method.** Reuse HEL-411's own reproduction method: create one throwaway pipeline (a
static data source + one step of the kind under test) via the worktree's own backend
(`http://localhost:$BACKEND_PORT`), then issue a real `POST /api/refinements` message asking for an edit
whose natural phrasing is most likely to invite the WRONG shape for that step kind (e.g. for `pivot`, ask
to "add another group-by column" in a way that could tempt a flat string list vs. the correct `Vector[String]`
`index` field — for `window`, ask to add an `orderBy` entry with an ambiguous key name close to but not
exactly `SortKey`'s shape — for `join`, ask to "change which column joins the two sources" in a way that
could tempt a wrong key for `joinKey`, since `joinKey`/`joinType` are the fields with NO downstream check;
`rightDataSourceId` is not a useful probe — see the Premise Correction section). Inspect the returned `PatchSet`'s edit
`patch.config` directly against the real decoder's expected shape. Clean up (delete) the throwaway
pipeline/data source afterward — shared dev DB.

**D2 — Assertion discipline (carried over from HEL-411 D2a).** Any new `RefinementEditShapeSpec` test must
decode the example through the REAL decoder (`JoinConfig.decode`/`PivotConfig.decode`/`WindowConfig.decode`/
`UnpivotConfig.decode`) and assert the actual field VALUES (non-empty vectors, correct counts/contents) —
never a bare "decodes without throwing" assertion, since that is exactly the assertion shape that would
NOT catch this defect class (a wrong-shape edit decodes successfully with degraded/empty content).

**D3 — Scope item 4 (decoder hardening) is a live escalation, not a default-included task.** Making
`JoinConfig`/`PivotConfig`/`WindowConfig`/`UnpivotConfig` raise on shape mismatch instead of silently
defaulting would let `PatchSetPreviewService.preview`'s existing structural check catch this class of
defect for ANY caller (not just refinement, which is prompt-engineering-dependent). It also touches
pre-existing, non-refinement-specific decode behavior used elsewhere (pipeline-step CRUD, any future
caller of `decodeConfig`) — a strictly larger blast radius than the pure-additive
`RefinementEditShape`/`RefinementEditShapeSpec` changes in D1/D2. Recommendation (escalated to the human
separately, per the ticket's own instruction): defer to a follow-up ticket rather than include in this
change — the prompt-rule fix is narrower, independently verifiable via live trial, and does not risk
regressing any existing caller of these decoders; a decoder-hardening change deserves its own design/test
pass (what should `PipelineService.updateStep`/`addStep`'s existing callers see on a newly-raised decode
error that previously silently succeeded?) rather than being folded in under this ticket's time budget.

## Risks / Trade-offs

[Live trials are inherently probabilistic — an LLM may pass one trial and fail a re-run] → run each
step kind's trial at least once with a clearly-adversarial prompt (deliberately inviting the most likely
wrong shape for that kind, mirroring HEL-411's own worked reproduction), and treat a PASS as "this specific
adversarial framing didn't reproduce it" rather than "proven safe for all possible phrasings" — record the
exact prompt used in the evaluator/skeptic evidence trail.

[Shared dev Postgres across worktrees] → every test pipeline/data source created for a live trial is
deleted at the end of that trial, before moving to the next step kind.

## Open Questions

- RESOLVED — Scope item 4 (decoder hardening): coordinator decided `defer-to-followup`. Not included in
  this change; ship only the narrow prompt-rule + live-verification fix for join/pivot/window/unpivot.
- RESOLVED — Filter/Sort: confirmed (code read) to share mechanism (1) exactly, but explicitly out of
  scope for this ticket per coordinator direction. Findings reported back for a separate follow-up
  ticket; no live-trial or fix work done on Filter/Sort in this change.

## Premise Correction (coordinator-verified, second pass)

The coordinator independently re-read the decoders on `origin/main` and found the D1 characterization above
(and the ticket's own framing) still imprecise. Verified directly against
`backend/src/main/scala/com/helio/domain/steps/`:

There are TWO distinct silent-tolerance mechanisms in play, not one:

**(1) `items.flatMap(it => Try(it.convertTo[X]).toOption)`** — drops mismatched ITEMS, same pattern as the
already-fixed `AggregateStep`. Present in:
- `WindowStep.decode`, the `orderBy` field (`WindowStep.scala:42`)
- `FilterStep.decode`, the `conditions` field (`FilterStep.scala:36`) — **NOT in this ticket's scope**
- `SortStep.decode`, the `sortBy` field (`SortStep.scala:30`) — **NOT in this ticket's scope**

**(2) `case Some(JsArray(items)) => items.collect { case JsString(s) => s }; case _ => Vector.empty`
plus `StepCodecUtil.stringOr(obj, k, default)`** — drops non-string items AND silently defaults
missing/wrong-typed scalars. Same pattern as the already-fixed `GroupByStep`. Present in:
- `PivotStep.decode` (`index`, plus `stringOr` on `column`/`values`/`agg`)
- `UnpivotStep.decode` (`idVars`, `valueVars`, plus `stringOr` on `varName`/`valueName`)
- `WindowStep.decode`, the `partitionBy` field (WindowStep carries BOTH mechanisms)
- `JoinStep.decode` — ALL THREE fields via `stringOr`: `joinKey` defaults to `""` and `joinType` defaults
  to `"inner"` (`JoinStep.scala:20-22`) with NO downstream check — the real silent-degradation surface for
  `join`. `rightDataSourceId` ALSO defaults to `""` via the same mechanism, but is NOT silent in practice:
  `PatchSetApplyResolvers.scala:228-232` runs every decoded `JoinConfig` through
  `dataSourceRepo.findByIdOwned(DataSourceId(jc.rightDataSourceId), user)`, so an empty value is caught and
  surfaced as `NotFound` before any silent corruption — it is the LEAST severe instance in the set, not the
  most, and is not a useful live-trial probe target (see D1).

**Decision (coordinator, confirmed):** `join`/`pivot`/`unpivot` DO belong in this ticket's scope, but via
mechanism (2), not the flatMap pattern the original ticket text describes — any test or live-trial design
that looks only for the flatMap pattern would wrongly conclude they're unaffected. `window` carries BOTH
mechanisms and needs live trials against both `orderBy` and `partitionBy`.

`FilterStep`/`SortStep` are a confirmed, real instance of the same defect class but are explicitly **NOT**
added to this ticket's scope — they were never named in HEL-671's original acceptance criteria, and the
coordinator is filing them as a separate follow-up ticket. This change reports findings on Filter/Sort
(confirmed by code read only, no live trial) for that follow-up, without doing live-trial or fix work on
them here.

`JoinStep`'s `joinKey`/`joinType` (not `rightDataSourceId`, which is backstopped by a referential check —
see the Premise Correction section) get particular attention in the live trials (D1) as the real
silent-degradation surface for `join`.

