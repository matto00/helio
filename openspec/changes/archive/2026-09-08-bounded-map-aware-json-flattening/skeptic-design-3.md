## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round 2's three CRs, verified by reading the files (not by trusting the orchestrator's account):**

1. *CR1 (`flattenJsObject` outside the compile-time guarantee) — CLOSED.* `design.md` D1 now carries an explicit
   sentence: "**This applies to `flattenJsObject` too (design gate r2 CR1)**: it is how the third consumer
   (`SourceService.scala:421`, preview) calls in, so it takes `mapPaths` as a REQUIRED parameter as well, with its own
   separately-named unclassified variant for the existing test callers (`ExpressionEvaluatorSpec:432,445`,
   `JsonFlattenerSpec:144`)", plus "the guarantee must cover BOTH entry points or it is not a guarantee". `tasks.md`
   2.2a implements it and 2.2b requires named unclassified variants for BOTH entry points. I confirmed the cited call
   sites exist verbatim in the worktree: `SourceService.scala:421 case obj: JsObject => JsonFlattener.flattenJsObject(obj)`,
   `ExpressionEvaluatorSpec:432,445`, `JsonFlattenerSpec:144`. The guarantee is now whole.

2. *CR2 (MAP-direction failure of the intersection conjunct) — CLOSED.* `design.md` Risks carries a new bullet naming
   it with my measured rates (`adds` 25/630 at n=2, 9/4000 at n=3; `drops` 1/136 at n=2) and accepts it explicitly as
   the conservative direction — identical to today's behaviour, never a schema/row divergence, bounded by sample size.
   That is exactly the shape CR2 asked for.

3. *CR3 (struct-side residual restated by reachability) — CLOSED.* The first Risks bullet now says the residual is
   reached "by a SINGLE ROW MISSING THE SHARED KEY — deleting the discriminator from one row of a ten-variant payload
   flips intersection 1 -> 0 and the classification STRUCT -> MAP (coverage 0.1195)". Task 4.4c pins it as a fixture
   and requires recomputing the coverage for the fixture's real arity rather than copying 0.122/0.1195. My r2
   non-blocking notes are both actioned: 5.1 now states the `JsonFlattenerSpec` migration is a SIGNATURE MIGRATION and
   forbids changing any test's assertions to pass.

**Ground-truth re-derivation (independent of any prior report):**

- Consumer inventory re-grepped over `backend/src`: exactly `SchemaInferenceEngine.scala:113`,
  `PipelineRowJson.scala:100` (via `jsRowToRow`, reached only from `InProcessPipelineEngine.scala:647,655`), and
  `SourceService.scala:421` via `flattenJsObject`. No fourth production call site. The binding invariant is holdable.
- D4's "no new type, no new row path" claim verified in source, not assumed: `PipelineRowJson.jsValueToAny`'s
  catch-all is `case other => other.compactPrint` (line 63), and `SchemaInferenceEngine.inferJsonType`'s catch-all is
  `case _ => (DataFieldType.StringType, false) // arrays, objects at leaf` (line 207). A `JsObject` leaf therefore
  yields `StringType` in schema and compact JSON text in the row with zero new machinery — D4 is literally true.
- D5's arithmetic verified in source: `inferFromObjects` (lines 111-139) leaves `JsNull` out of the widening join and
  computes `nullable = presentNonNullCount < objects.size`, so one `drops` path with 17 object-rows of 36 gives
  `StringType`/nullable exactly as D5 states.
- D6's trap verified: `SourceService.previewRest` today does `jsRows.take(10).map { case obj: JsObject => ... }`, so
  the classify-then-take ordering task 3.3 mandates is a real, necessary change, not a restatement.
- HEL-1009 disjointness still holds in source: `SchemaInferenceEngine.scala:144` states `inferShallowFromJsObjects`
  deliberately does not call `JsonFlattener.leaves`.
- `.hel1015-realdata/` contains `matchups.json`, `tx.json`, `projections-sample-200.json` — the files D2's table cites.
  Base is `0638f749` as briefed.
- HEL-1030 read from Linear: it exists, is Backlog, and scopes exactly persisted-schema remediation (prod count first,
  owner sign-off for any migration). No migration/backfill work appears anywhere in `tasks.md`; the deferral is honest.
- Guardrails: HEL-1012/1013/868/869/891/599 named only as adjacent/untouched in `proposal.md`; nothing absorbs them.

**I looked for a new defect the first two rounds missed and did not find a blocking one.** The angles I attacked:
a truncated pipeline batch (`outcome.truncated`) classifying over a different row set than inference — falls inside
D7's already-accepted cross-fetch residual and is never worse than today; `jsRowToRow`'s own signature — it is not
under D1's letter, but it calls `leaves`, so it cannot compile without threading `mapPaths` and the guarantee survives;
preview rendering a map leaf as a nested `JsObject` while rows render compact text — key sets (the invariant's actual
subject) still agree, and it is the same asymmetry `JsArray` leaves already have today.

### Verdict: CONFIRM

The three r2 CRs are genuinely closed in the artifacts, verified by reading them rather than by the orchestrator's
account. The mechanism re-derives from source. My remaining objections are all wording/coverage-of-enumeration level,
recorded below as non-blocking per the round-3 budget instruction.

### Non-blocking notes

- Task 5.1 enumerates "`JsonFlattenerSpec` has ~10 `leaves(obj)` call sites"; the required-parameter change will also
  break `SchemaInferenceEngineSpec:68` (`JsonFlattener.leaves(json)`), and `NestedJsonFlatteningSymmetrySpec` calls
  `jsRowToRow` at five sites, which will need `mapPaths` threaded if that signature changes. Task 3.4's grep will catch
  these; the enumeration in 5.1 is just incomplete. Same evidence-discipline framing applies to them (signature
  migration, assertions unchanged).
- `PipelineRowJson.jsRowToRow`'s own signature is not named in D1 or task 3.2, only implied. Compile-safety is
  unaffected (it delegates to `leaves`), but stating it would remove the ambiguity of whether it gains `mapPaths` or
  computes internally — the latter would be wrong (Context 1: per-row classification is impossible).
- Under D2a/D4, `flattenJsObject` will return a map path's value as a nested `JsObject` while `jsRowToRow` renders the
  same path as compact JSON text. Column sets agree (the binding invariant), and `JsArray` already behaves this way,
  so this is precedent-consistent — but task 4.5's schema/row agreement test would be stronger if it also asserted the
  preview surface's KEY SET against the other two, since preview is the surface D6 calls the trap.
- Task 4.4 asks for "a synthetic case just either side of 0.25". With the compound rule, a case on the struct side of
  0.25 must also pin its intersection, or it will pass for the wrong reason (classified STRUCT by intersection rather
  than by coverage). Worth stating both conjuncts per boundary fixture.
