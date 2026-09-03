# Design — guard the join op's right-source ACL check against the picker's empty seed id

## Context

Three ops carry a second data-source picker: `join` (`rightDataSourceId`), `union`
(`otherDataSourceId`), `lookup` (`referenceDataSourceId`). Two surfaces run an ownership pre-flight
over them: `PipelineService` (addStep + updateStep) and `PatchSetApplyResolvers`
(pipelineStep-update pre-validation). That is six hand-written ACL blocks. Four of the six are
currently wrong.

| Surface | join | union | lookup |
| --- | --- | --- | --- |
| `PipelineService.addStep` (L857-895) | UNGUARDED | guarded (HEL-620) | guarded (HEL-386) |
| `PipelineService.updateStep` (L1096-1128) | UNGUARDED | guarded (HEL-620) | guarded (HEL-386) |
| `PatchSetApplyResolvers` (L193-205) | UNGUARDED | UNGUARDED | guarded |

The ticket knew about the top two cells. Premise validation found the bottom row: HEL-620's union
fix never reached `PatchSetApplyResolvers`. This is the direct evidence for the ticket's own Scope
item 2 — copy-paste is how a two-instance bug became a four-instance bug.

## Goals / Non-Goals

**Goals.** Make an empty second-source id skip the ownership lookup at every one of the six blocks.
Make it structurally hard for a seventh block to get it wrong. Keep the non-empty behavior
byte-identical.

**Non-Goals.** Changing execute-time behavior, changing the frontend seed shapes, adding frontend
validation, or refactoring the ACL triad beyond these call sites.

## Decision 1 — one shared extractor, not three guarded copies

Introduce a single helper in **`com.helio.api.protocols.pipelines`**, alongside
`PipelineStepConfigCodec` (`backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala`):

```scala
/** The second, separately-owned DataSource a decoded step config references, if it references one at
 *  all. Returns None for a config kind with no second source AND for a config whose second-source id
 *  is empty — the pipeline op picker's own seed value (`defaultConfigFor`), an incomplete draft
 *  rather than a reference to an inaccessible resource. HEL-386/HEL-620/HEL-950.
 *
 *  Takes `Any` because `PipelineStepConfigCodec.decode` returns `Try[Any]`: the 23 `*Config` case
 *  classes share no sealed parent. See Decision 7 for the guard test that substitutes for the
 *  compile-time exhaustiveness this therefore cannot have. */
def secondaryDataSourceId(config: Any): Option[String]
```

**Why next to the codec — and why the two earlier placements were both wrong.** Round 1 of the design
gate refuted the original "pipelines service package" home: `PatchSetApplyResolvers` lives in
`com.helio.services.patchsets` and does NOT import `com.helio.services.pipelines`, so that placement
would add a services→services dependency for one function. Round 2 then refuted the replacement
(`com.helio.domain`) for a more basic reason: the signature named `PipelineStepConfig`, **a type that
does not exist in Scala** — it is a frontend TypeScript type. There is no sealed trait over the 23
config case classes, and `com.helio.domain.package.scala` documents itself as an alias-only
re-export shim, so it is the wrong place for the first behavioral function in the codebase.

`PipelineStepConfigCodec`'s package is the correct home on every axis: it already imports all 23
configs from `com.helio.domain`, it is the object that PRODUCES the untyped `Try[Any]` this helper
consumes (decode-then-ask-for-its-second-source is one cohesive story), and BOTH surfaces already
import it — `PatchSetApplyResolvers.scala:6` and `PipelineService.scala:6`. No new dependency edge in
either direction.

**Why a pure extractor rather than a helper that also performs the lookup.** The two surfaces need
different error strings (`s"Data source not found: $id"` vs `s"edit $index: data source not found:
$id"`) and different result types. A pure `Option[String]` extractor is the largest piece that is
genuinely common; pushing the lookup in too would force an awkward error-formatting parameter and
buy nothing. The bug being closed lives entirely in the extraction step, so that is exactly the
part worth sharing.

**Why this is in scope rather than a follow-up ticket.** The ticket's Scope item 2 invites it, the
mechanical change is small (one function, six mechanical rewrites, no behavior change for non-empty
ids), and the alternative is shipping a fourth hand-written copy into a file that already proved the
copy-paste failure mode twice. If the design gate judges the shared helper too large, the fallback
is the scoped two-line join fix plus a filed class-closing ticket — stated in the proposal, decided
here in favor of the helper.

## Decision 2 — empty is skipped, not rejected

An empty id yields `201`/`200` with the source left unset, NOT a `400`. This matches the two ops
already fixed and keeps a half-filled step editable, which is the whole point of the picker flow.
Execute-time still fails descriptively on an unset source (`pipeline-union-op`,
`pipeline-lookup-op`) — that is where "you never chose a source" is correctly reported.

## Decision 3 — the ACL leg and the empty leg are tested independently

HEL-949's lesson: a test made red only by mutating two things at once guards neither. For each
op at each surface the tests SHALL be arranged so that:

- reverting the `.nonEmpty` filter alone turns the empty-id test red, and
- deleting the `findByIdOwned` call alone turns the cross-user test red.

Both mutations are to be exercised singly during execution and the result recorded, not asserted
from the shape of the test names.

## Decision 4 — trimming is deliberately NOT introduced

`.nonEmpty` on the raw string, not `.trim.nonEmpty`. The frontend seed is exactly `""`; a
whitespace-only id is not a state the picker can produce, and treating `" "` as absent would be
"looser than asked" (AC lesson 2) and would silently diverge from the union/lookup guards this
change is meant to make uniform. `PipelineService.create` does trim `sourceDataSourceId`, but that
is a different field on a different path and is not being made uniform here.

## Decision 5 — the class-closing claim is an enumeration, not an assumption

The ticket asserted join/union/lookup are the only ops with a second-source picker "so this should be
the last one". That assertion was true about ops and false about surfaces. This change therefore
grounds the claim in two enumerations recorded in `proposal.md`: all 23 step-config case classes
(exactly three carry a `DataSourceId` field), and all 18 `PatchSetApplyResolvers.resolve*` functions
(every other id path is already guarded by `requireTargetId`'s trim/reject at L91 or
`resolvePipelineCreate`'s explicit empty-rejection at L501-503). After this change every
empty-capable second-source id in both surfaces flows through one extractor.

## Decision 6 — the corrected reachability decides where live evidence is gathered

Because join is picker-excluded, the RED must be demanded where the defect is actually reachable:
the patch-set surface (`POST /api/patch-sets/apply`), deterministically, for BOTH the union cell and
the join cell. The UI leg is retained only as a labelled regression guard on the already-guarded
union path, and is explicitly not evidence for the join fix. A UI walkthrough of the patch-set apply
path is not required, because the frontend only reaches that endpoint with an assistant-generated
payload and cannot deterministically emit an empty second-source id. See ticket.md AC6a/6b/6c.

## Decision 7 — a Registry-driven RUNTIME enumeration substitutes for the missing compile-time check

Because the parameter is `Any`, the compiler cannot tell us when a future op adds a second-source id
and forgets the extractor — exactly the risk this change exists to close. A prose risk note is not a
mitigation.

Round 3 of the design gate rejected the first form of this guard (regex-scanning
`domain/steps/*.scala` for `[A-Za-z]*DataSourceId: String`) for three real holes: it silently misses
a field declared `Option[String]`, `Seq[String]`, or as a `DataSourceId` value class; it never
specifies how a scanned field NAME becomes an actual `secondaryDataSourceId` invocation, so it risks
comparing two hardcoded lists to each other; and it can pass vacuously if a path or cwd change makes
the scan find nothing. All three are fatal to a guard whose entire job is catching drift.

**Adopted form — runtime, type-agnostic, location-agnostic.** For every `(kind, companion)` in
`PipelineStep.Registry` (the single source of truth: adding an op is one Registry line):

1. Decode a default config: `companion.decodeConfig("{}")` — decode is tolerant by design, so this
   yields a default-valued typed config for every kind.
2. Narrow the decoded `Any` to `Product` explicitly (`case p: Product => ...`). A decode that is NOT
   a `Product` MUST fail the guard loudly, never be skipped — a silent skip would reopen the vacuity
   hole for that kind, which is the one thing this guard exists to prevent.
3. Reflect its fields via `Product.productElementNames` (Scala 2.13.15, available) zipped with
   `productIterator`, selecting every field whose name ends in `DataSourceId` — regardless of its
   declared type.
4. For each such field, assert BOTH legs by actually calling the extractor: `secondaryDataSourceId`
   returns `None` for the default (empty) decode, and `Some("real-id")` for
   `companion.decodeConfig(s"""{"$fieldName":"real-id"}""")`. Let this decode fail LOUDLY if a future
   op declares the field as something a bare string cannot populate (e.g. `Seq[String]`) — that red is
   drift correctly detected. Never wrap it in a `Try` that swallows the failure.
5. Assert a POSITIVE baseline so the guard cannot pass vacuously: the enumeration visited all 23
   registered kinds and found exactly three second-source fields —
   `rightDataSourceId`, `otherDataSourceId`, `referenceDataSourceId`.

This exercises the extractor for real rather than comparing string lists, and a new op carrying a
second-source id fails it until the extractor handles that op.

**Precedent, stated accurately.** An earlier draft of this decision cited
`SchemaFieldStructuralGuardSpec`, `RlsPolicyGuardSpec` and `RestConnectorEgressGuardSpec` as
precedent for a SOURCE-SCANNING guard. That was false and was caught at the gate: none of the three
reads a source file. The correct precedents are `RlsPolicyGuardSpec` for this decision's adopted
runtime-enumeration form, and `services/assistant/CredentialSurfaceEnumerationSpec.scala` (which does
recursively read source files) had the regex form been kept. Recorded here rather than quietly
corrected, because citing a gate for a property it does not have is the same failure this change's
own review lessons warn about (lesson 4).

## Risks

- **Weakening a real ACL check.** Mitigated by Decision 3's independent mutation testing and by
  keeping the non-empty path textually unchanged.
- **The shared helper drifting as new ops are added.** Mitigated by Decision 7's Registry-driven
  runtime guard rather than by prose: `Any` gives no compile-time exhaustiveness, so the guard test
  IS the mechanism. Both of its legs are verified red-first per task 4.6.
- **`Any` weakening the call sites.** Each call site still pattern-matches its own decoded config for
  the rest of its logic; only the second-source extraction is delegated. The helper narrows
  internally and returns `Option[String]`, so no `Any` escapes into caller code.

## Verification

RED first against the real backend, at the patch-set surface, for both the union and join cells —
recorded verbatim before the fix and re-run green after. Plus the extractor unit tests, the
independent per-leg mutation checks (Decision 3), and the labelled union UI regression guard. A unit
test alone is explicitly insufficient per the ticket's evidence bar; equally, a live probe that
passes against unfixed code proves nothing, so the red is mandatory and must be recorded first.
