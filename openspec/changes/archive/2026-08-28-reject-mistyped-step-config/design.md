# Design — HEL-860 Reject mistyped step config

## Context

`PipelineService.addStep` (`PipelineService.scala:460`) uses the **read-path** decoder as its **only**
write-path config check:

```scala
PipelineStepConfigCodec.decode(req.`type`, req.config.compactPrint) match {
  case Failure(ex)         => Left(ServiceError.BadRequest(s"Invalid '${req.`type`}' config"))
  case Success(typedConfig) => /* persist */
}
```

`PipelineStepConfigCodec.decode` dispatches to `PipelineStep.Companion.decodeConfig`, whose trait
documentation (`domain/model/PipelineStep.scala:93-97`) states it **must be tolerant**: "missing keys yield
typed defaults so partial / legacy rows survive the read path." `CastConfig.decode` honours that contract
and returns `CastConfig(Map.empty)` for a list-shaped `casts`. So the decode **succeeds**, the no-op step is
persisted, and the route returns 201.

`updateStep` (`PipelineService.scala:591`, decode at ~631) has the identical shape and the identical defect.

The read-path tolerance is correct and must not change (AC3: existing stored configs unaffected, no
migration regression). The defect is that the write path has no strict check of its own.

## Goals / Non-goals

**Goals.** Reject a supplied-but-unintelligible `cast`/`rename` config at create and update with a 422 that
names the offending key and the expected shape; keep the read path byte-for-byte unchanged; close HEL-859's
inherited analyze-surface coverage debt; prove HEL-859 Decision 7's raw-config contract by test.

**Non-goals.** Changing `*Config.decode` tolerance. Extending strict rejection beyond `cast`/`rename`.
Validating `cast` target-type *values*. Closing HEL-859's `MatchError` seam. Fixing the `groupby`/`join`
analyze dispatch gap. The last three are assessed in Decisions 5-7 and deliberately deferred.

## Decision 1 — Validate on the write path, via a new opt-in `Companion` method

Add one concrete, defaulted method to `PipelineStep.Companion`:

```scala
/** Strict WRITE-path check of a caller-supplied raw config. `None` means accept.
 *  Distinct from `decodeConfig`, which is contractually tolerant for the READ path.
 *  Defaults to `None` so existing kinds are unaffected. */
def validateRawConfig(raw: String): Option[String] = None
```

Only `CastStep.companion` and `RenameStep.companion` override it.

*Why a defaulted method on the existing registry seam rather than a new dispatcher:* the registry is already
the documented single source of truth ("adding a new step kind means one line to `Registry` — no edits in
the codec, protocol, or engine"). A default of `None` means the other 21 anonymous `Companion` instances
compile untouched. A future step opts into strictness in its own file, next to its decoder.

*Why not make `decode` strict:* it would violate the trait contract and break legacy-row reads — a direct
AC3 violation.

*Why not inline the check in `PipelineService`:* it would put per-step config knowledge back in the central
service, which cycle 3 of the CS2c refactor deliberately distributed out.

## Decision 2 — Call it in `addStep` and `updateStep`, mapped to 422

In both methods, run `validateRawConfig` on the raw supplied config **before** the existing
`PipelineStepConfigCodec.decode` call, and on `Some(msg)` return `ServiceError.UnprocessableEntity(msg)`.

- `ServiceError.UnprocessableEntity` already exists (`ServiceError.scala:27`) and already maps to
  `StatusCodes.UnprocessableEntity` in `ServiceResponse.scala:82`.
- The body is the uniform `ErrorResponse(message)` every `ServiceError` produces
  (`ServiceResponse.completeError`), which `helio-mcp`'s `httpClient.describeError` renders to the agent
  caller as `422 Unprocessable Entity: <message>`. This is what satisfies standing requirement 3 — the
  rejection is verified at the surface a caller actually sees, not as a `Left` in isolation.
- This is the same seam `create_pipeline_from_shape` uses (`PipelineShapeService.expand` maps shape-param
  failures to `ServiceError.UnprocessableEntity`), which is the precedent the ticket names.

**Ordering matters and is deliberate:** the existing `PipelineStepKind.All` unknown-type check stays first
(unknown *type* remains 400), then `validateRawConfig` (mistyped *config* → 422), then `decode`. A malformed
non-JSON body still yields today's 400 via the decode `Failure` branch — unchanged.

**Non-object top-level config.** `req.config` arrives already parsed as a `JsValue`, and
`StepCodecUtil.asObject` (`StepCodecUtil.scala:20-23`) returns `JsObject.empty` for a non-object top level
rather than throwing. `requireStringMap` reuses those same `asObject` semantics, so a top-level array config
cannot throw out of `validateRawConfig` and become a 500 — it is treated as "key absent → accept", exactly
matching today's behaviour.

**Status-code note.** Today a decode `Failure` returns **400**; this change does not alter that. 422 is used
only for the new "well-formed JSON, unrepresentable shape" case, which is exactly what 422 means and what
the ticket asks for. No existing status code changes.

## Decision 3 — The rejection rule: present-but-unrepresentable, not absent

`validateRawConfig` rejects only when the key is **present** and cannot be represented as
`Map[String, String]`. An **absent** key is accepted and keeps its empty default.

This is required, not a softening: the picker seeds a new step with `{}`, and previously-stored rows may
legitimately omit the key. Rejecting absence would break both. Rejecting a present-but-wrong value is
precisely the field-report bug.

Concretely, for `cast`/`casts` and `rename`/`renames`, reject when the value is:
- not a JSON object (array, string, number, boolean, null), or
- an object with any non-string value.

Implementation goes in `StepCodecUtil` (already `private[steps]`, and both step files are in that package)
as a shared `requireStringMap(obj, key, kind): Option[String]`, so the two call sites cannot drift.

The *rejection rule* is identical for both keys — both are `Map[String, String]` at the type level. The
**message wording is deliberately NOT identical**, and must not be: `casts` maps a field name to a *type
name*, while `renames` maps a *from-field-name* to a *to-field-name*. A single shared wording is actively
wrong for one of them. Shipping cast's wording for `rename` would tell a caller to send
`{"renames": {"amount": "double"}}` — a config this validator **accepts**, and which silently renames the
column to `double`: the exact green-run/wrong-result shape this ticket exists to prevent, reintroduced
through its own guidance text. (This was caught at evaluation cycle 1 as CR-1 and fixed in `a97431e4`.)

`StepCodecUtil.requireStringMap` therefore takes `shapeDescription` and `example` **from the calling step**,
with no defaults — so a future third caller cannot compile without supplying its own wording rather than
silently inheriting a misleading one. Both examples are themselves valid configs for their own step kind, so
neither message can guide a caller into an accepted-but-wrong config.

Message shapes, each naming both the offending key and the expected shape:

```
Invalid 'cast' config: 'casts' must be an object mapping field name to type name,
e.g. {"casts": {"amount": "double"}} — got an array.

Invalid 'rename' config: 'renames' must be an object mapping from-field-name to to-field-name,
e.g. {"renames": {"amount": "total_amount"}} — got an array.
```

## Decision 4 — Close HEL-859's coverage debt at the real analyze surface, first

Enumerated (not estimated) from commit `a8ea26ae`. HEL-859 added 8 validators; the spec added 5 test cases
covering `window`, `stringops` (×2) and `fillnull` (×2).

**Covered:** `validateStringOps`, `validateFillNull`, `validateWindow`.
(`union`'s *pass* path IS covered at `PipelineAnalyzeServiceSpec.scala:138`, asserting no `validationError`
for `mode:"byName"`; "uncovered" below refers throughout to the **failure** path — the "Unsupported value"
rejection message — which no test exercises for these five.)

**Uncovered — exactly five:** `validateAggregate`, `validateGroupBy`, `validatePivot`, `validateUnion`,
`validateJoin`. Plus `validateStepConfig`'s multi-failure join (`problems.mkString("; ")`,
`PipelineAnalyzeService.scala:126`), which has no test at all.

This matches the ticket's "five" exactly. Note an earlier automated sweep of this file claimed *six*
uncovered by grepping for the literal word `Unsupported`; that heuristic is wrong — the `window` test
(`PipelineAnalyzeServiceSpec.scala:695`) asserts `include("median")` instead. The five above are derived by
diffing the commit's added validators against the commit's added test names, per standing requirement 5.

**"Real analyze surface" (AC6) means the HTTP route**, not the service unit. Coverage therefore goes in
`backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` (the existing
embedded-Postgres route spec for `GET /api/pipelines/:id/analyze`), asserting each validator's message and
the joined multi-failure message in the response JSON's `validationError`. Unit-level additions to
`PipelineAnalyzeServiceSpec` are permitted as a supplement but do **not** by themselves satisfy AC6.

Per the ticket, this lands **before** the new `cast`/`rename` work builds on the join.

## Decision 5 — CORRECTED: the raw-config contract holds on the PROPOSAL analyze path only

**This supersedes an earlier claim in this document, and an orchestrator premise-validation finding, that
the contract holds on the analyze route generally. It does not. Both are retracted.** The design gate traced
the caller; the earlier claim had read `PipelineAnalyzeService.analyze`'s signature without following how its
input is built. Stating this loudly is a ticket requirement, not a formality.

There are two analyze surfaces, and they differ in exactly the way that matters:

**`GET /api/pipelines/:id/analyze` (stored pipeline) — the contract does NOT hold.**
`PipelineService.analyze` (`PipelineService.scala:162-168`) builds each step input with
`config = PipelineStepConfigCodec.encode(s)` — a **re-encoding of an already-decoded step**, not the stored
text. `s` came from `pipelineStepRepo.listByPipelineInternal`, whose `rowToDomain`
(`PipelineStepRepository.scala:258-261`) already ran the **tolerant** `CastConfig.decode`. Traced end to end:
a row stored as `{"casts":[{"field":"x","to":"float"}]}` decodes to `CastConfig(Map.empty)` and re-encodes to
`{"casts":{}}`. `inferCast` then evaluates `convertTo[Map[String, String]]` on a **valid empty object**,
succeeds, and returns **no `validationError`**. The step reports clean. The dropped key is destroyed by the
read round-trip before inference ever runs, and no seeding method — raw SQL included — can avoid it, because
the round-trip happens on read.

**`POST /api/pipelines/analyze-proposal` — the contract DOES hold.**
`PipelineService.analyzeProposal` (`PipelineService.scala:251-257`) builds step inputs with
`config = req.config.compactPrint`: the caller-supplied JSON, never round-tripped. A `cast` step with a
list-shaped `casts` reaches `inferCast` unmodified and surfaces as `validationError == "cast config error"`.

So HEL-859 Decision 7's raw-config property is a property of the **proposal** analyze path. AC7, the spec
scenario, and task 2.1 are bound to that surface (existing route spec:
`PipelineAnalyzeProposalRoutesSpec.scala`). `validateStepConfig` remains irrelevant to it either way: it has
no `cast`/`rename` case and returns `Vector.empty`, and its eight validators each re-apply their own tolerant
decoder, so it observes nothing raw for any kind today.

**Consequence for this ticket's argument — stronger than first stated.** The earlier text said analyze being
advisory "does not make the write-path fix redundant." The truth is sharper: for a **persisted** step,
analyze cannot detect a mistyped `cast`/`rename` config *at all*. The write-path 422 is therefore not merely
better-placed than the analyze advisory — it is the **only** point at which this defect is detectable for a
stored step. The reverse dependency the ticket assumed (that HEL-859's hook would report what this ticket
rejects) does not exist for stored pipelines. This raises the value of the fix; it does not undermine it.

## Decision 6 — Sweep result: the pattern is pervasive by design; scope is bounded by the field report

**The earlier claim that this pattern exists in "exactly two files" was false, and is retracted.** The
design gate re-ran the enumeration and refuted it. Enumerating the `decode(raw: String)` body of all 24
`.scala` files in `domain/steps/` (23 step files plus the `StepCodecUtil` helper) gives the real picture:

| Fallback shape in a config decoder | Files |
|---|---|
| `case _ => Map.empty` after a `Try(...).getOrElse(Map.empty)` | `CastStep`, `RenameStep` |
| `case _ => Vector.empty` after `items.collect { case JsString(s) => s }` (drops non-string elements, and a non-array value entirely) | `SelectStep`, `GroupByStep`, `DedupeStep`, `FillNullStep`, `LookupStep`, `PivotStep`, `UnpivotStep` (×2), `WindowStep` |
| `case _ => Vector.empty` after `items.flatMap(it => Try(it.convertTo[...]).toOption)` (per-element `Try` swallow) | `AggregateStep` (×2), `FilterStep`, `SortStep`, `WindowStep` |
| Wrong-typed optional scalar degrading to `None` via `collect { case JsString(s) => s }` | `StringOpsStep:42-43` (`pattern`, `separator`), `FillNullStep:33` (`value`), `WindowStep:41` (`field`) |
| `StepCodecUtil.stringOr` / `intOr` silently substituting a default for a wrong-typed value | `ChunkByTokenCountStep`, `ComputeStep`, `DateBucketStep`, `DedupeStep`, `ExtractHeadingsStep`, `FillNullStep`, `FilterStep:35` (`combinator`), `GroupByStep`, `JoinStep`, `LookupStep`, `PivotStep`, `SplitTextStep`, `StringOpsStep`, `UnionStep`, `UnpivotStep`, `WindowStep` |
| `case _ => 0` / `=> None` for scalar keys | `LimitStep`, `ComputeStep`, `DateBucketStep`, `StringOpsStep`, `WindowStep` |
| Non-array value degrading to `None` for an optional list key | `StringOpsStep:49` (`fields`) |
| Non-object element degrading to an **all-defaults** rule (a distinct shape: not dropped, silently invented) plus `case _ => Vector.empty` for a non-array `rules` | `AssertStep:50-73` |

The table classifies every one of the 23 decoders, but it is a summary: task 5.1's raw unabridged
re-enumeration at delivery is the binding artifact, not this table. Only `StepCodecUtil.scala` (the helper
itself) has no decoder of its own; all 23 step files do.

Some of these are as dangerous as the ticket's own example. `GroupByStep.scala:22-27` is the clearest:
`{"groupBy":"region"}` (a string where an array is expected) decodes to `Vector.empty`, silently collapsing
every row into a single group, and `stringOr(obj, "aggFunction", "sum")` silently substitutes `"sum"` for a
wrong-typed aggregation. That is precisely the green-run/wrong-numbers shape this ticket opens with.

**So the honest finding is not "two files are broken."** It is that read-path tolerance is a *documented,
deliberate, system-wide contract* (`PipelineStep.Companion.decodeConfig` requires it), and the real defect is
that **no step kind has a strict write-path check** — the tolerant decoder is the only gate on create for all
23. Two files are not special; they are simply the two the field report caught.

**Scoping criterion (stated explicitly, replacing the false factual claim).** This change fixes `cast` and
`rename` because — and only because — the ticket bounds breadth to them and the field report verifies
caller-facing harm there. The criterion is *field-verified harm plus an explicit ticket bound*, not
*"nowhere else has the pattern."* Decision 1's defaulted `validateRawConfig` is deliberately shaped so each
remaining kind can opt in later in its own file, one at a time, without touching the service.

Every other hit above is recorded as **known-remaining**, with `groupby` called out as the highest-severity
follow-up candidate. A follow-up ticket is filed at delivery covering the systemic gap.

**AC4 corrected inline** (standing requirement 4 permits this; the original wording is unsignable).
Original: *"a re-run of the silent-drop sweep across `domain/steps/` finds no remaining instances."* That can
only be signed by mis-stating the sweep, since the change deliberately does not fix the other kinds.
Corrected: *"the sweep is re-run by enumeration over all files in `domain/steps/`, every hit is classified,
and the hits this change does not address are recorded in the PR as known-remaining with a follow-up
ticket."*

## Decision 7 — Two adjacent defects: documented, deferred, not silently absorbed

**(a) `groupby` and `join` have no `inferOutputSchema` dispatch case.** Found while enumerating for
Decision 4. `inferOutputSchema` (lines 196-227) handles 21 kinds; `"groupby"` and `"join"` appear in
neither the identity group nor any dedicated case, so both fall to
`case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`. The source comment at line 86 already
half-admits this ("unlike JoinStep, which has no case here at all"). **A valid `groupby` or `join` step
therefore reports a spurious `validationError` on every analyze.**

*Impact on this ticket:* none on the five validators. `validateStepConfig` runs **before** dispatch
(line 71), so an invalid enum is reported by the validator and never reaches the fallback — the new
`validateGroupBy`/`validateJoin` coverage is fully honest. Only the *negative* case (valid config ⇒ no
error) is unreachable for these two kinds, so the new tests deliberately do not assert it for
`groupby`/`join`, and say why inline.

*Decision:* **do not fix here.** Correct output-schema inference for `groupby` (group keys + aggregate
aliases) and `join` (merged two-source schema, which this layer cannot resolve — it has no repo access) is
real design work with its own semantics, not a line of plumbing. Absorbing it would be exactly the silent
scope expansion the ticket forbids. File a follow-up; note it in the PR.

**(b) HEL-859's `MatchError` seam.** All 8 step kinds guard their enum `match` with a preceding
`if (!SupportedX.contains(x)) throw new IllegalArgumentException(...)`, so `MatchError` is **unreachable
today**; the exposure is a future enum value added to a `SupportedX` set without a matching arm.

*Decision:* **do not close here.** This change touches none of those match sites, and the ticket's own
instruction is to decide explicitly rather than expand. HEL-859's closing comment already proposes the
one-line guard test; it belongs with that seam's owner, not bolted onto a config-rejection ticket.

Both are surfaced to the human at delivery rather than buried.

## Risks

- **Behaviour change on a previously-accepted input.** A caller sending a mistyped `cast`/`rename` config
  now gets 422 where it got 201. That is the entire point of the ticket, and the previously-"successful"
  outcome was a silent no-op. Correctly-shaped configs are unaffected; the read path is untouched, so no
  stored row changes meaning.
- **A stored row that would now be rejected on write still decodes on read.** Intentional (AC3). Such a row
  is already a no-op; this change stops *new* ones being created without rewriting history.
- **Indirect callers of `addStep`.** Four paths reach it besides the HTTP route: `PipelineProposalService`
  (proposal-apply), `PipelineShapeService`-driven creation, and the patch-set apply/preview resolvers. All
  propagate the new `Left` safely rather than ignoring it, so an agent-facing `create_bound_panel` or
  proposal-apply now fails loudly with rollback where it previously produced a silently-no-op pipeline. That
  is an improvement, but an intended and stated one rather than an accident.
- **Test-evidence staleness.** Standing requirement 1 applies: the red-on-revert transcript must be captured
  against the *final* committed tests, and recaptured if any test changes afterwards.

## Gate-Chain Implications Checklist

Not applicable — this change touches no `.husky/**` hook and no script invoked by a commit hook. It is
confined to backend Scala sources and their tests. Answering the five questions for completeness:
**What does it execute?** Nothing new at commit time. **What environment does it inherit, and from where?**
None. **Does it write anything outside its own sandbox?** No. **Does it behave differently from a linked
worktree than from a main checkout?** No. **What happens on its first run?** No first-run behaviour exists.
