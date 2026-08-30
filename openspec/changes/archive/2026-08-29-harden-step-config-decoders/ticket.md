# HEL-814: Harden pipeline step config decoders to raise on shape mismatch (closes the silent-corruption class for all callers, not just refinements)

## Description

Pipeline step config decoders are **silently tolerant**: a wrong-shape config decodes "successfully" into a degraded value rather than raising. `PatchSetApplyResolvers.validateEmbeddedStepReferences` (reused verbatim by `PatchSetPreviewService.preview`) only checks decode `Success`/`Failure`, never whether the decoded config is semantically complete — so a wrong-shape edit returns `200` "already proven valid" and silently collapses or corrupts the pipeline's real output when applied. No error, no warning, nothing visible in the diff-preview UI.

HEL-411 fixed this for `aggregate`/`groupby`, and HEL-671 extended the same fix to `join`/`pivot`/`window`/`unpivot`. **Both fixes are prompt-engineering on the refinement path only.** They make the model less likely to emit a wrong-shape config; they do not make a wrong-shape config fail. Every other caller of `decodeConfig` — MCP apply, `PipelineService.updateStep`/`addStep`, direct API step edits, and any future caller — remains fully exposed.

This ticket is the durable fix: make the decoders raise, so `preview`'s existing structural check catches the class for *any* caller.

## Ground truth (from the ticket, verified during this run's premise validation)

`decodeConfig` is a shared SPI implemented by ~20 step kinds in `backend/src/main/scala/com/helio/domain/steps/`. Two distinct silent-tolerance mechanisms are known:

**Mechanism 1** — `items.flatMap(it => Try(it.convertTo[X]).toOption)` drops mismatched *items*: `AggregateStep` (`aggregations`), `WindowStep.scala:42` (`orderBy`), `FilterStep.scala:36` (`conditions`), `SortStep.scala:30` (`sortBy`).

**Mechanism 2** — `obj.fields.get(k) match { case Some(JsArray(items)) => items.collect { case JsString(s) => s }; case _ => Vector.empty }`, plus `StepCodecUtil.stringOr(obj, k, default)`, drops non-string items *and* silently defaults missing or wrong-typed scalars: `GroupByStep`, `PivotStep` (`index`; `stringOr` on `column`/`values`/`agg`), `UnpivotStep` (`idVars`, `valueVars`; `stringOr` on `varName`/`valueName`), `WindowStep` (`partitionBy` — `WindowStep` carries BOTH mechanisms), `JoinStep.scala:20` (all three fields via `stringOr`, including `rightDataSourceId` defaulting to `""`).

`JoinStep` looks like the most severe instance: a wrong-shape join config decodes to an empty right-side data source id rather than failing.

**These lists are a starting point, not the answer.** This run's premise validation confirmed every cited line number exact AND found the affected surface materially wider: `stringOr`/`intOr` has 41 call sites across 17 step files; the `collect { case JsString }` array-drop appears in `DedupeStep:28`, `SelectStep:20`, `FillNullStep:29`, `GroupByStep:23`, `WindowStep:38`, `UnpivotStep:30/34`, `LookupStep:31`, `StringOpsStep:49`, `PivotStep:26`. `LookupStep` (`referenceDataSourceId` -> `""`), `UnionStep` (`otherDataSourceId` -> `""`) and `ComputeStep` (`column`/`expression` -> `""`) are the same severity class as `JoinStep`'s `rightDataSourceId` and are absent from the ticket's list. A candidate THIRD mechanism exists: numeric narrowing (`Try(n.toIntExact).getOrElse(default)` in `StepCodecUtil.intOr`; `Try(n.toIntExact).toOption` at `WindowStep:49` and `StringOpsStep:45`), plus `StepCodecUtil.asObject` falling back to `JsObject.empty` for a non-object top-level JSON value.

## Prior art in-repo

HEL-860 (merged `83e99a0e`) shipped `StepCodecUtil.requireStringMap` — a strict-WRITE-path validator for `cast`/`rename` that rejects a *present* but wrong-shape key while accepting absence so previously-stored rows and the picker's `{}` seed still work. That is precisely the tolerant-read/strict-write split this ticket's design pass contemplates, already established in-repo with a stated rationale. Extend it; do not redo it.

## Scope

* Enumerate **every** `decodeConfig` implementation and classify its tolerance mechanism — do not work from the partial lists above; re-derive them. Two mechanisms are known; check for a third.
* Make shape mismatch **raise** rather than silently drop or default. Distinguish deliberately-optional fields with real defaults from fields that are silently defaulting a *required* value — these are not the same thing and the audit must say which is which per field.
* **Design pass on the callers first.** Some may rely on the current defaulting (e.g. partially-specified configs written before a field existed, or rows already persisted in the shared dev/prod DB). Establish what breaks before changing behavior; migration or a tolerant-read/strict-write split may be needed.
* Confirm `PatchSetPreviewService.preview` genuinely rejects a wrong-shape config once decoders raise — the whole point of the change.

## Expect 5 red tests when you start — that is the signal, not a regression

HEL-671 landed 5 **characterization** tests that deliberately lock in the current silently-tolerant behavior:

* `backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala` — 4 negative controls asserting the degraded decode values (`joinKey shouldBe ""` at :271, `index shouldBe empty` at :279, `valueVars shouldBe empty` with `varName shouldBe "variable"` at :288-289, `partitionBy`/`orderBy` `shouldBe empty` at :298-299)
* `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala` — 1 test (:564-580) asserting `preview` returns `Right` (accepts) a wrong-shape `join` edit missing `joinKey`

When this ticket's hardening lands, **all 5 of these tests should fail.** That failure is the proof the fix worked.

The correct response is to **invert** each assertion — expect a raise, expect `preview` to reject. Do **not** weaken the assertions, delete the tests, or revert the hardening to make them green. Silently "repairing" them back to green would undo this ticket entirely while leaving the suite looking healthy, which is the exact failure mode this class of bug already exploits.

## Acceptance criteria

- [ ] Every `decodeConfig` implementation is enumerated and its tolerance mechanism classified; the enumeration is verified in both directions (no step kind omitted, no step kind wrongly included)
- [ ] Shape mismatch raises for required fields across all affected step kinds; genuinely-optional fields with legitimate defaults are named and justified
- [ ] **Demonstrated red:** a wrong-shape config for each affected step kind now fails `preview`, verified against a test that FAILED before the change — not a test that merely passes after
- [ ] Existing persisted step configs still decode (or a migration/compat path is in place and tested)
- [ ] Caller impact assessed and recorded for `PipelineService.updateStep`/`addStep`, MCP apply, and refinement apply

## Why the assertion shape matters

The failure mode is *succeeding with degraded output*. An assertion that the config "decodes without throwing" cannot catch it — that is exactly the property the bug preserves. Every test must assert the decoded config's actual contents (field counts, non-empty vectors, specific values).

## Evidence standard for this run (product owner, corrected standing rule)

- Every test must be **failable**.
- A test claimed as proof that a defect is fixed must be shown **red before the fix**.
- A regression guard is failable **by mutation**, not by reverting the fix, and must be **labelled as a guard** rather than presented as proof.
- The 5 characterization tests above are pre-existing red-on-arrival proof, not tests to be written. The PR must say clearly which assertions are proof and which are guards.
- Verify by measurement, not attestation: assert on decoded config *contents*, never that decode "did not throw".
- Derive sets by enumeration, not intuition. A weak assertion is the same as no test.

## Live-data facts (product owner; verify before relying on them)

Production currently has ~50 stored DataType fields carrying a non-canonical `"double"` type, and 17 filter conditions across 11 pipelines compare numerically-named columns whose runtime values are strings. Both are evidence that persisted data in this area diverges from what the code appears to promise — relevant to the caller/compat analysis.

## Environment notes

`concertino sync` is MANUAL — do not run it and do not commit render changes. The jest gate is vacuous inside a worktree (HEL-880, open), so a green root `npm test` there is not evidence.

## Escalate rather than guess

Escalate if the caller analysis shows existing persisted configs would break, or if the enumeration turns up a step kind where "required vs optional with a legitimate default" is genuinely ambiguous. That distinction is a product decision, not a mechanical one.

## Related

* HEL-671 (narrow refinement-path fix; this is its deferred scope item 4)
* HEL-411 (origin, PR #336, fix commit `a978984e`)
* HEL-860 (strict-write precedent for cast/rename), HEL-888, HEL-894, HEL-859, HEL-860

---

## RESOLVED DESIGN DECISIONS (product owner, 2026-08-30) — these supersede the ticket's original framing

An escalation was raised during Planning and answered. **Follow these, not the "make the decoders raise" framing above.**

### Measurement that drove the decisions

Two independent populations, 233 rows total — dev (78 rows / 21 kinds) and prod (155 steps / 65 pipelines / 11 kinds):

* Configs with a **wrong JSON type**: **0 of 233**. Read-path wrong-type strictness is safe, not merely plausible.
* Configs with a **missing/empty required field**: 12 dev + 8 prod. Every prod instance is a step added and not yet configured — one is in a pipeline literally named "new pipeline", and one is a `compute` with BOTH `column` and `expression` empty (an untouched freshly-added step). This is the editor's add-then-configure flow **in production right now**, not corruption.

`PipelineStepRepository.rowToDomain:261` throws `IllegalStateException` on any decode `Failure`, and it backs **every** read — run, preview, and `listSteps`. Absence-strictness on the read path would turn silent corruption into a **500 when a user merely opens the pipeline editor**. Off the table.

### D1 — Read path (`*Config.decode`): raise on WRONG JSON TYPE only

A key that is **present but of the wrong JSON type** raises. A key that is **absent**, or present-but-empty, keeps today's tolerant default. 0 of 233 rows affected.

### D2 — Write path (`validateRawConfig`, extended to all 23 step kinds): reject wrong-type only

Incomplete drafts stay savable — `drafts-are-legitimate`. `LookupStep` already blesses empty ids in code as "an incomplete draft, not a security violation"; someone already reasoned this through and reached the same place.

**Wire the existing hook into the two surfaces that lack it** — this is the ticket's real defect:
* `PatchSetApplyResolvers.validateEmbeddedStepReferences:223` (preview + refinement apply)
* `PipelineProposalService.validateStep:179` (MCP apply)
(`PipelineService.addStep:466` / `updateStep:642` are already wired — do not redo them.)

### D3 — Run AND analyze time: reject missing/empty REQUIRED fields

**"Legitimate to save" is not "legitimate to run."** A `compute` with `column: ""` silently writes a column named `""` into the output DataType — that is HEL-888's bug. The draft must be savable and must NOT silently produce wrong results.

Use HEL-859's established shape: a run error naming the failing step and its reason. At analyze time, report through the existing `validationError` field (the `pipeline-step-config-validation` capability already does exactly this for enum-valued options — extend it, do not build new machinery).

### D4 — Enums: case-normalize, then reject unknown values

Normalize case first (`"LAST"` is unambiguous intent, and this is an agent-authored surface where case drift is routine), then reject anything that does not normalize to a known member, with a message **naming the supported set**. `StringOpsStep`'s existing error is the model.

* `filter.combinator: 5` silently becoming `AND` — an OR filter turning into an AND filter — is the worst single finding in the enumeration, worse than the `groupBy` collapse, because it changes **which rows survive** rather than how they are grouped.
* `dedupe.keep: "LAST"` becoming `"first"` **inverts which row wins**.
* **`limit.count`, narrowly** — reject only a value that cannot be represented as the field's numeric type, which
  currently becomes `0` and therefore silently means *unlimited*, **widening** a result set. A **missing, zero or
  negative** `count` is explicitly blessed by `pipeline-limit-op:9` as a "safe no-op" with a named scenario, so it
  stays. See design.md D8.

### D5 — Characterization tests: 3 of 5 flip, and say so plainly

`pivot` / `unpivot` / `window` use wrong-**type** shapes and flip at the decode level. **Proof.**

**Two tests do NOT flip, both for the same approved reason.** `PatchSetPreviewServiceSpec`'s preview test and the
`join` decode-level test both hinge on `joinKey` being **absent**, not mistyped — and absence stays tolerant by D1
on read and is deliberately not rejected by D2 on write. (Design-gate round 1 caught an earlier draft of this
document claiming the preview test would flip at the `validateRawConfig` level; it would not, because
`validateRawConfig` rejects wrong-type only. Corrected here.)

Both keep their existing assertions — `joinKey shouldBe ""` and preview returning `Right` — and both have their
comments rewritten to state that this is deliberate read/write tolerance for an incomplete draft, with completeness
enforced at run and analyze time by D3 instead. **Guards.** Without that relabelling a future reader would
reasonably conclude the hardening was reverted.

What replaces the lost flip is a **new** test: preview rejects a `join` edit whose `joinKey` is *present but of the
wrong JSON type*. That is the proof, sited next to the guard it replaces.

Do not contrive a fourth or fifth flip. Three honest flips and two correctly-labelled guards is the accurate outcome.

### D6 — Follow HEL-860's contract, and say so in the PR

`decodeConfig` is contractually tolerant on read; strictness lives on `validateRawConfig`. State in the PR that the ticket's original framing was superseded and why. The reframing has already been written into the Linear ticket description.

### Evidence rule for this run

* The 3 flipping characterization tests are **proof**, as is the new wrong-type preview rejection test.
* New assertions covering the two unguarded write surfaces are **proof** and must be shown **red first**.
* The relabelled `join` decode test, and anything else green-before-and-green-after, is a **guard** — failable by mutation, labelled as such, never counted as proof.
* Assert on decoded config **contents**, never that decode "did not throw".
