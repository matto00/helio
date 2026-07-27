## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `skeptic-design-1.md` in full (REFUTE, one substantive CR on D4's cost bound, one
  non-blocking wording note on D1/D9).
- Read the current `design.md` (343 lines) and `tasks.md` (73 lines) in full, focused on the
  rewritten D3/D4/D8 and the "Risks/Trade-offs" section.
- Read `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` (178 lines,
  full file) to independently verify D4's disjointness/always-present premises against the actual
  wire types, not just the design doc's assertion.
- Read `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` lines 128–330
  (`assemble` and `toDataTypeEntry`) to independently verify D3's ordering claim against the real
  `Future`-chain.
- Confirmed via `git log`/`git status` that this change dir is untracked/uncommitted — round 1 and
  round 2 are reviewing the same in-flight `design.md`, not a merged artifact.
- Re-read `ticket.md`'s acceptance criteria and traced each one against the current design (all
  seven still explicitly addressed: trim order — D3; determinism — D6 + round-1 check #5, unchanged
  and re-confirmed sound; truncation marker — `WorkspaceContextTruncation`, D6; structural identity —
  D5/tier 0; backend+MCP parity — D9 + tasks 6.2; tests green + schema — tasks 1.3/5.x/6.x/7.1/7.2;
  backward-compat default — D8).

### CR1(a): is the "exact arithmetic decomposition" actually mathematically sound?

Verified true, with no counterexample found. The proof rests on four premises, each independently
checked against the real wire types (not just design.md's prose):

1. **`sampleRows`, `exampleValues`, `joinHints` are always-present, never `Option`.** Confirmed in
   `WorkspaceContextProtocol.scala`: `sampleRows: Vector[JsObject]` and
   `columnStats: Map[String, WorkspaceContextColumnStats]` on `WorkspaceContextDataType` (lines
   96–105), `exampleValues: Vector[JsValue]` on `WorkspaceContextColumnStats` (line 71, explicitly
   documented as "always present," unlike the adjacent `min`/`max`/`mean: Option[Double]`), and
   `joinHints: Vector[WorkspaceContextJoinHint]` at the top level of `WorkspaceContextResponse`
   (never `Option`). So trimming array *contents* never removes/adds a JSON key and never changes a
   sibling field's presence — the surrounding punctuation (the comma before/after each field, the
   field's own key+colon) is fixed regardless of array length, including at length 0 (`"key":[]`
   still has the key).
2. **The three trimmed subtrees are pairwise disjoint.** True by construction — a given DataType's
   `sampleRows` array, a given column's `exampleValues` array (nested inside that DataType's
   `columnStats` map, itself nested inside that DataType), and the top-level `joinHints` array never
   overlap in the tree, and none of them nests inside another (`joinHints` is a top-level sibling of
   `dataTypes`, not inside it).
3. **Field order within an object is declaration-order-fixed (`jsonFormatN`), not
   content-dependent**, and `columnStats`'s `Map[String, ...]` — although a hash map — has a
   *fixed key set* under trimming (trimming shrinks `exampleValues` *inside* an entry, never adds
   or removes a column key), so its iteration order (and thus total serialized length contribution
   from key ordering/punctuation) is unaffected by which cap is chosen. This closes a fold I
   specifically checked for and did not find broken: nothing about trimming can perturb map key
   order in a way that would change total byte count (order affects *content ordering*, not *total
   length*, since the same keys with the same punctuation appear regardless of order).
4. **JSON serialization is context-free** — `compactPrint` on an isolated `JsArray` produces
   byte-identical text to that same array embedded inside a parent object (no whitespace/escaping
   quirk in spray-json's compact writer that depends on surrounding context). This is the load-bearing
   assumption for "measure the small subtree in isolation, get the true in-context contribution" —
   verified true for a compact (non-pretty) JSON writer, which is what `compactPrint` is.

Given all four, `totalSize(c1,c2,c3) = naturalSize − (fullTier1 − tier1AtC1) − (fullTier2 − tier2AtC2)
− (fullTier3 − tier3AtC3)` is an exact identity, not an approximation — I could not construct a case
where it fails. This is a genuine fix of round 1's CR1(a): the design no longer reserializes the full
multi-megabyte response per candidate; each candidate measurement is over a structure whose size is
independent of total DataType/pipeline/dashboard count.

**Cost arithmetic re-checked independently**: `200 × 6` (tier-1, one per DataType per candidate
0..5) `+ 200 × 40 × 6` (tier-2, one per column per candidate, worst case 40 Structured columns × 200
DataTypes) `+ 51` (tier-3, one per candidate 0..50) `= 1,200 + 48,000 + 51 = 49,251` — recomputed by
hand, matches design.md's figure exactly. This is a genuinely different complexity class from round
1's ~63 full-response reserializations (which at 200 DataTypes × ~42KB/DataType `sampleRows` alone
implied tens of MB of string-building per candidate): the new worst case is ~49K serializations, but
each is over a structure "at most a few hundred bytes" (verified plausible — a ≤5-row/≤5-value/
≤50-entry array of short scalars), a bounded, DataType-count-independent unit cost. Not a relabeling.

### CR1: dispatcher placement — addressed

D4's new "Dispatcher placement" paragraph explicitly reasons through it (CPU-bound work, no
dedicated dispatcher today, judged acceptable given the corrected bounded cost, revisitable via
profiling) rather than leaving it unaddressed as round 1 flagged. This satisfies the CR's requirement
to "address CPU-dispatcher placement" — it doesn't have to result in a code change, just a stated,
reasoned decision, which it now has.

### CR1(c): D8's default re-justified against realistic (not just pathological) frequency

Verified: D8 now computes an explicit ~40KB estimate for a realistic small workspace ("~8
pipeline-output DataTypes, ~12 Structured columns... `8 × (1.8KB + 2.4KB + 1KB) ≈ 40KB`") against
the 200KB default — hand-checked the arithmetic (5.2KB/DataType × 8 = 41.6KB ≈ 40KB, ~5x headroom),
consistent and not overstated; explicitly labeled "judgment calls, not empirically measured," which
is the right honesty level for a self-approved tunable with no production data. This is materially
different from round 1's version, which cited only the 200-DataType pathological ceiling. It no
longer needs to argue the trim path is *rare* (which was the weaker, harder-to-defend claim) — since
CR1(a)'s fix made triggering the trim path cheap regardless of frequency, D8 correctly pivots to
justifying the default on response-size headroom rather than cost-avoidance. This is a coherent,
mutually-reinforcing revision, not two independent patches.

### D3's shed-order claim, checked against the real `assemble`/`toDataTypeEntry` code

D3 (and D4's "why sampleRows first" section) claims `classifySemanticRole`/`computeColumnStats` run
over the FULL untrimmed `rawRows` fetch and complete strictly before any budget-pass step. Verified
directly against `WorkspaceContextService.scala`:
- `toDataTypeEntry` (line 236) computes `computeColumnStats(dt.fields, rawRows)` and
  `sanitizeSampleRows(dt.fields, rawRows)` from the SAME `rawRows` in the same `.map` step (line
  252) — `columnStats` is computed from the full ≤500-row fetch, not from the already-5-row-capped
  `sampleRows`.
- `classifySemanticRole(f, columnStats.get(f.name))` (line 263) runs inside `statsF.map { case
  (sampleRows, columnStats) => ... }` — i.e. strictly after `columnStats` for that DataType is fully
  computed.
- `assemble` (lines 133–163): `dataTypes <- Future.traverse(typesPage.items)(toDataTypeEntry(_,
  user))` is a `for`-comprehension step — by Scala's `flatMap` desugaring, the `yield` block (which
  constructs the final `WorkspaceContextResponse`) cannot execute until this `Future` resolves, i.e.
  until every `toDataTypeEntry` call (and therefore every `computeColumnStats`/`classifySemanticRole`
  call) has completed.
- `tasks.md` 2.8 plans to wire the budget pass as "the last step before returning" from `assemble` —
  consistent with (and no more fragile than) the existing ordering guarantee, which is structural
  (monadic sequencing), not incidental. I agree with the design's own caveat that a *future* refactor
  could silently break this if someone moved the budget call earlier or ran it inside
  `toDataTypeEntry` per-DataType — but that is a review-time concern for the *implementation* PR
  (traceable via the tasks.md 5.1 "tier 0 fields never altered" test and the arithmetic-exactness
  test), not a design-soundness gap in this artifact. The design correctly identifies the ordering
  guarantee's actual source (Future-chain sequencing, not convention) rather than asserting it without
  grounding.

### Verdict: CONFIRM

Round 1's Change Request 1 is fully resolved via route (a) as anticipated: the reserialize-per-candidate
approach was replaced with an exact arithmetic decomposition over disjoint, always-present JSON
subtrees. I independently verified the mathematical soundness of that decomposition against the real
wire types (not just the design's prose), recomputed the worst-case cost figure by hand and confirmed
it matches, confirmed the dispatcher-placement question is now explicitly reasoned about, confirmed
D8's default is re-justified against a realistic (not just pathological) workspace estimate, and
confirmed D3's ordering claim against the actual `assemble`/`toDataTypeEntry` source. No new
soundness gap introduced by the revision. Design is sound enough to implement.

### Non-blocking notes

- D1's "gives the backend and MCP a naturally identical unit" phrasing (design.md:39) still slightly
  oversells cross-runtime parity relative to what D9 explicitly disclaims a few sections later
  (byte-identical `estimatedSizeBytes` across Scala/TS is NOT claimed or tested). Round 1 flagged
  this as non-blocking and it remains non-blocking — D9's own correction nearby is sufficient
  context for an implementer, but tightening D1's wording directly would remove the redundancy of
  needing D9 to walk it back.
- Tasks.md 5.1's arithmetic-exactness test and tier-0-immutability-at-`budgetBytes=0` test are good,
  specific regression pins for CR1(a)'s decomposition identity and D3's shed-order claim respectively
  — worth keeping exactly as scoped through implementation, since they're what would actually catch
  a future refactor silently breaking the ordering guarantee flagged above.
