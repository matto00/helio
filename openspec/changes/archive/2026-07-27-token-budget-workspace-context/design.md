## Context

`WorkspaceContextService.assemble` (HEL-371/372/373/374) already bounds everything it fetches:
`sampleRows` ≤5 rows, `columnStats` ≤40 Structured columns computed over a ≤500-row fetch,
`exampleValues` ≤5 per column, `joinHints` ≤50 (candidate pool itself capped via the `columnStats`
membership restriction). What is NOT bounded is the *combination*: a workspace with up to
`Page.Default` (200) DataTypes, each carrying its own `sampleRows`/`columnStats`/`columns[]`, plus
up to 50 `joinHints`, has no ceiling on total response size. This ticket adds that ceiling as a
final, deterministic pass over the already-assembled, already-bounded in-memory structure — it
never triggers a new query and never re-fetches anything.

## Goals / Non-Goals

**Goals:**
- A pure, deterministic budgeting pass, applied once after `assemble` builds the full response,
  that shrinks `sampleRows`/`exampleValues`/`joinHints` in a fixed, documented priority order until
  the serialized size fits a byte budget — never touching resource-identity fields.
- A `truncation` object reporting whether/how the response was shrunk, self-describing enough that
  a downstream consumer (HEL-341's Claude call) can note the context is partial.
- Backend and MCP apply the identical priority order and caps, each independently implemented and
  independently tested (matching HEL-372/373/374's established parity discipline).
- Make the existing `Page.Default` (200-item) list-truncation self-describing via the same
  `truncation` object — the carried finding this ticket owns.

**Non-Goals:**
- Real token counting via a model-specific tokenizer (adds a dependency, ties the budget to one
  model's tokenizer, and isn't needed for determinism — see D1).
- True cross-request pagination/streaming for workspaces over 200 resources of a kind (D-Pagination
  states why this ticket does not attempt it).
- The Claude call itself (HEL-341).
- Refactoring `WorkspaceContextService.scala`'s existing 705 lines (HEL-631, explicitly deferred).

## Decisions

**D1 — Budget unit: UTF-16 code-unit length of the compact JSON serialization
(`String.length` in Scala, `.length` in JS), not a real token count and not measured UTF-8 bytes.**
Both the JVM and JavaScript represent strings internally as UTF-16 and both runtimes' `.length`
count UTF-16 code units (surrogate pairs count as 2 on both sides) — this is a language-specified
guarantee, not an assumption, so measuring size this way gives the backend and MCP a naturally
identical unit with zero encoding step on either side. This is deliberately NOT exact UTF-8 byte
length: for the ASCII-dominated content this payload mostly holds (ids, numbers, short English
identifiers/values) code-unit count closely tracks UTF-8 byte count, but a payload with
substantial multi-byte-UTF-8 (non-ASCII) text will under-count relative to true UTF-8 size. Stated
explicitly here (per the epic's carried finding #5 — no unqualified claims) rather than calling
the field a precise byte count. It is also not a real LLM token count — no tokenizer dependency is
added; the field is documented as "an approximate, model-independent proxy for prompt cost," which
is what the ticket's "token/byte budget" language itself allows ("token/byte", not "token").
`WorkspaceContextTruncation.budgetBytes`/`estimatedSizeBytes` and their schema descriptions state
this precisely.

**D2 — The pass operates on the already-assembled, already-bounded in-memory `WorkspaceContextResponse`
— never a new query, never a re-fetch. This is itself "bounded by construction," not "assemble a
huge payload and cut it down."** Every large input this ticket could have touched (raw ≤500-row
fetches, per-DataType `rawRows`) is already consumed and released before `assemble` finishes
building `dataTypes` (HEL-373 design.md D1a's binding memory-retention requirement) — the budget
pass's own input is the FINAL small structure per DataType (`sampleRows` ≤5 rows, `columnStats` a
≤40-entry map of small scalars). There is no meaningful "fetch fewer rows if the budget is tight"
lever available upstream without re-opening D1's own "500 rows needed for `distinctCount`/`nullRate`
to be statistically useful regardless of how many `sampleRows` are ultimately shown" argument — so
this ticket does not attempt to thread the budget down into the fetch layer.

**D3 — Fixed priority order, tiered, structure is NEVER touched. Stated unambiguously: this is the
SHED order — the order in which tiers are cut, first-cut to last-cut. `sampleRows` is cut FIRST
(shrinks/empties before anything else); `joinHints` is cut LAST (the last thing to lose anything, so
it survives longest among the three shrinkable tiers).** Applied only when the initial serialized
size exceeds the budget:
1. **Structure (never shrunk at any budget — retained at every budget, including `budgetBytes=0`)**:
   `counts`, `dataSources[]`, every `dataTypes[]` entry's `id`/`name`/`sourceId`/`pipelineOutput`/
   `columns[]` (`name`/`dataType`/`nullable`/`semanticRole`)/`computedColumns[]`/`version`/`tag`,
   every `columnStats[column]`'s `nullRate`/`distinctCount`/`distinctCountCapped`/`min`/`max`/`mean`
   (scalars — cheap, and the exact signal an agent needs to pick a measure/dimension, per the
   design-gate brief's "an agent needs enough signal to pick a measure and a shape"), `pipelines[]`
   with `steps[]`, `dashboards[]`. This directly satisfies the ticket's "Structural identity of
   resources... preserved even at the tightest budget; only value-level enrichment is shed"
   acceptance criterion — it is enforced by the tiering itself (tier 0 is never a shrink target), not
   by a post-hoc check.
2. **Cut 1st (tier 1) — `sampleRows` row count**: a single global cap, applied uniformly across
   every DataType's `sampleRows` array (never per-DataType-selective — see D4 for why uniform, not
   selective), reduced from its natural (untouched) value toward 0. The natural value is derived
   from the data itself — the MAX `sampleRows` length observed across all DataTypes (`maxOption`/
   `Math.max` reduction) — not a re-read of the `SampleRowLimit` (5) constant `assemble` already
   enforced upstream: a `max` reduction is commutative/associative (order-independent, no
   Map/Set-iteration-order risk) and equals `SampleRowLimit` in practice since no DataType's
   `sampleRows` can exceed it, but avoids duplicating that literal in a second file (DRY).
3. **Cut 2nd (tier 2) — `columnStats[*].exampleValues` length**: a single global cap, applied
   uniformly across every column of every DataType, reduced from its natural (untouched) value
   toward 0 — only once tier 1 is fully exhausted (at 0) and the response is still over budget.
   The natural value is likewise derived from the data (the MAX `exampleValues` length observed
   across every column of every DataType), not a re-read of `ExampleValueLimit` (5), for the same
   DRY/order-independence reasoning as tier 1's natural cap above.
4. **Cut 3rd/last (tier 3) — `joinHints` count**: the array is already sorted deterministically
   (confidence descending, id/column tie-break — HEL-374 design.md D2); truncated to a shorter
   prefix, reduced from its current (already ≤`MaxJoinHints`=50) length toward 0 — only once tiers 1
   and 2 are both fully exhausted and the response is still over budget.

**Why `sampleRows` is cut first, not last (the design-gate brief's specific challenge — HEL-372's
whole purpose is letting an agent "tell a boolean flag from a category from an identifier" by
seeing real values; cutting that first looks backwards on its face).** It is NOT backwards, because
that specific job is not `sampleRows`'s job in the current (post-HEL-374) payload — it is
`semanticRole`'s job, and `semanticRole` lives in tier 0 (`columns[].semanticRole`, never touched at
any budget). `classifySemanticRole` and `computeColumnStats` both run once, during `assemble`, over
the FULL untrimmed `rawRows` fetch — strictly BEFORE this ticket's budget pass ever runs (D2:
budgeting is the LAST step). Trimming `sampleRows`/`exampleValues` afterward cannot retroactively
change `semanticRole`, `nullRate`, `distinctCount`, `distinctCountCapped`, `min`, `max`, or `mean` —
those are already finalized and are all tier-0-protected. So even at `budgetBytes=0`, an agent still
has, per column: its declared type, its inferred role (boolean/dimension/measure/identifier/
temporal/text), its null rate, its (capped) distinct count, and its numeric range/mean where
applicable — everything HEL-372's classification purpose needs is intact. What `sampleRows`
specifically adds ON TOP of that is a literal, cross-column, same-row snapshot (seeing that row 3's
`status` is `"active"` alongside row 3's `amount` and `created_at` together) — real value for
spot-checking format/shape, but not the boolean/category/identifier distinction itself, which
`semanticRole` already carries independent of any row surviving. `exampleValues` (tier 2, cut
second) is the intermediate case: per-column (not cross-column) value evidence that already fed into
`distinctCount`/`dimension`-classification (tier 0) before trimming, so cutting its *display* list
loses the illustrative values but not the derived signal. Given that framing, `sampleRows` is
legitimately the least load-bearing of the three shrinkable tiers once `columnStats`+`semanticRole`
exist, so it is also — not coincidentally — the cheapest tier to cut for the most budget recovered
per DataType (D4: the largest single per-DataType contributor). Both the grounding-quality argument
and the cost argument point the same direction; this order is not "cost convenience over quality,"
it is the tier that costs the most also being the tier that was already the least uniquely
load-bearing. This matches the ticket's own illustrative "e.g." order literally (sample-row count
shrinks before example-value lists, which shrink before join-hints) and is confirmed independently
sound by the round-1 design-gate skeptic. `joinHints` is cut LAST: it is cross-DataType structural
insight ("these two DataTypes are probably joinable") that nothing else in the payload replaces —
`columnStats`/`semanticRole` are per-column/per-DataType, never cross-DataType — and it is already
the smallest total contributor at scale (≤50 short entries workspace-wide vs. per-DataType/
per-column costs that scale with DataType count), so it is cheapest to keep and correspondingly
protected the longest.

**D4 — Round-1 design-gate finding, closed: NOT a downward scan that reserializes the FULL response
per candidate cap (the original draft of this decision) — that reopens exactly the "per-request
aggregate cost, computed and defended, not left implicit" standard HEL-373 design.md D1a set, and
this design did not meet it on the first pass. Fixed by an EXACT arithmetic decomposition over
independently-measured, disjoint JSON subtrees — cheap, still anchored to the real serializer for
every individual measurement, no hand-rolled JSON-length modeling anywhere.**

**Why decomposition is exact, not an approximation.** `sampleRows`/`exampleValues`/`joinHints` are
each always-present fields (never `Option` — D6), so trimming their array CONTENTS never adds or
removes a JSON key, never changes any sibling field's presence, and never changes the punctuation
between DIFFERENT fields (the comma between `"sampleRows":[...]` and the next sibling key is fixed
regardless of what's inside the array). The three trimmed subtrees are pairwise disjoint (a
DataType's `sampleRows` array, a column's `exampleValues` array within `columnStats`, and the
top-level `joinHints` array never share a byte of serialized text). Given a fixed JSON tree, the
serialized length of the WHOLE tree therefore equals a FIXED overhead (every byte outside these
three kinds of arrays) plus the sum of each individual trimmed array's OWN serialized length — so
`totalSize(c1, c2, c3) = fixedOverhead + Σ_dt len(sampleRowsArray(dt, c1)) + Σ_col
len(exampleValuesArray(col, c2)) + len(joinHintsArray(c3))`, where each `len(...)` term is measured
by calling the REAL serializer on just that one small array (never estimated). This is a provable
identity of tree serialization, not a heuristic — the "combination" step is plain addition/
subtraction of real, independently-measured numbers, so it cannot silently diverge from the true
serializer's output the way a hand-rolled JSON-length estimate could (the exact "confidently-wrong
number" failure class the epic's carried finding #5 warns about, and the failure mode this
decomposition is specifically designed to avoid while still being cheap).

**The algorithm:**
1. Serialize the FULL, untrimmed response ONCE (`naturalSize`) — this is the fast/common path: if
   `naturalSize <= budgetBytes`, return the response completely unchanged, `truncation.applied =
   false`. No further work. (Matches D8's "small workspace, one serialization" claim — now actually
   true, not merely asserted.)
2. Otherwise, precompute, per DataType, `sampleRowsLenAtCap(dt, c)` for `c` in
   `0..naturalSampleRowsCap` (naturalSampleRowsCap = the MAX `sampleRows` length observed across all
   DataTypes, a data-derived value rather than a re-read of the `SampleRowLimit` (5) constant —
   D3's tier-1 note; at most 6 values in practice, since no DataType's `sampleRows` can exceed
   `SampleRowLimit`) — each a serialization of ONLY that DataType's own ≤5-row array, independent of
   every other DataType and independent of total response size. Sum across DataTypes to get
   `totalSampleRowsLenAtCap(c)`. Find the LARGEST `c1` such that `naturalSize -
   (totalSampleRowsLenAtCap(naturalSampleRowsCap) - totalSampleRowsLenAtCap(c1)) <= budgetBytes` — a
   small table lookup, no further serialization needed for the decision itself. If found, done:
   `sampleRowsCap = c1`, tiers 2/3 stay at their natural values.
3. If `c1 = 0` still doesn't fit, precompute `exampleValuesLenAtCap(col, c)` for `c` in
   `0..naturalExampleValuesCap` (the analogous data-derived MAX over every column of every DataType,
   at most 6 values in practice) per Structured column across all DataTypes (each a serialization
   of ONLY that one column's ≤5-value array) — sum, find the largest `c2` fitting the remaining
   budget the same way. If found, done: `sampleRowsCap = 0`, `exampleValuesCap = c2`, tier 3 stays
   natural.
4. If `c2 = 0` still doesn't fit, precompute `joinHintsLenAtCap(c)` for `c` in `0..len(joinHints)`
   (≤51 values, ONE serialization each of a short prefix of the already-small top-level array,
   independent of DataType count) — find the largest `c3` fitting the remaining budget.
5. If `c3 = 0` still doesn't fit: D5's structural floor.
6. The final `estimatedSizeBytes` is computed ARITHMETICALLY from the same precomputed numbers
   (`naturalSize` minus the three tiers' realized savings) — exact, per the identity above, so no
   final full-response reserialization is needed purely to report this field. (Building the actual
   trimmed `WorkspaceContextResponse` object to return over HTTP still costs O(response size), but
   that cost exists regardless of whether budgeting exists at all — the route was always going to
   serialize *some* response.)

**Cost, computed concretely (D1a-level rigor, not just a step count):** the ONLY per-candidate
serializations are over small, DataType-count-independent structures — a ≤5-row array, a ≤5-value
array, or a ≤50-entry array of short records — never the full multi-DataType tree. Worst case (a
`Page.Default`-width, 200-DataType, 40-Structured-column workspace): `200 × 6` (tier-1 precompute) +
`200 × 40 × 6` (tier-2 precompute, one per column per candidate) + `51` (tier-3 precompute) = `1,200
+ 48,000 + 51 ≈ 49,251` small serializations, each over a structure of at most a few hundred bytes
(a handful of microseconds each) — on the order of a few hundred milliseconds of CPU total in the
most extreme case, a different complexity class entirely from the original draft's up-to-63
FULL-response (multi-megabyte) reserializations. Tier 2's precompute only runs at all if tier 1 is
fully exhausted and still insufficient — for the common "sampleRows alone is enough" case, only
tier 1's `200 × 6 = 1,200` tiny serializations run. A single GLOBAL cap per tier (not a
per-DataType-selective budget split) keeps this tractable (`O(DataTypes × constant)`, not
`O(cap range ^ DataType count)`) and, critically, is what makes the result deterministic and fair:
every DataType's `sampleRows` shrinks by the same rule, so the same input always produces the same
per-DataType outcome regardless of DataType iteration order — no DataType is arbitrarily privileged
by appearing earlier in the response.

**Dispatcher placement, addressed explicitly (round-1 design-gate finding, flagged even though not
requiring a code change).** This work is CPU-bound, not I/O-bound, and today runs on whatever
execution context `WorkspaceContextService.assemble`'s `Future`-chain already uses (no separate
dispatcher today, per the current `WorkspaceRoutes`/`WorkspaceContextService` source). Given the
cost figure above (bounded at roughly a few hundred milliseconds even at the most extreme,
200-DataType/40-column, pathological workspace size — and near-instant for realistic workspace
sizes), this is judged NOT to warrant a dedicated CPU-bound dispatcher for this ticket; a genuinely
pathological workspace would already be paying comparable or greater cost in the DB-fetch fan-out
that precedes this step (HEL-373 design.md D1a's own accepted latency trade-off for the same
extreme case). Stated here as a considered, bounded trade-off — not silently unaddressed — and
revisitable if production profiling ever shows otherwise.

**D5 — Structural floor: if all three tiers are fully exhausted (sampleRows=[] everywhere,
exampleValues=[] everywhere, joinHints=[]) and the response STILL exceeds budget, the response is
returned as-is at that (now-minimal) size — resources are never dropped to chase the budget
further.** This is the direct, explicit answer to the acceptance criterion "Structural identity of
resources... preserved even at the tightest budget": once tier 0 is all that's left, the budget
becomes best-effort, not a hard ceiling — `truncation.structuralFloorExceedsBudget: true` flags
this case so a consumer (HEL-341) knows the budget could not be fully honored, rather than silently
returning an over-budget payload that LOOKS successfully budgeted. This is the one place this
design deliberately does NOT hit the requested budget — stated here, not discovered by a caller
later.

**D6 — `WorkspaceContextTruncation`, always present (never `Option`), one new required top-level
field — mirrors `joinHints`'s own precedent for a new required response field (HEL-374).**
```
final case class WorkspaceContextTruncation(
    applied: Boolean,                        // true iff any tier actually shrank something
    budgetBytes: Int,                         // the budget used for this response (post-clamp/default)
    estimatedSizeBytes: Int,                  // measured post-trim size (D1's UTF-16 code-unit count)
    sampleRowsCap: Int,                       // cap actually applied; equals each DataType's own natural
                                               // sampleRows length when untouched (at most SampleRowLimit, 5)
    exampleValuesCap: Int,                    // cap actually applied; equals each column's own natural
                                               // exampleValues length when untouched (at most ExampleValueLimit, 5)
    joinHintsKept: Int,                       // joinHints length after budget trimming
    joinHintsOmittedByBudget: Int,            // natural (pre-budget) length minus joinHintsKept
    structuralFloorExceedsBudget: Boolean,    // D5 — true iff even the fully-shrunk response exceeds budget
    paginationTruncatedResources: Vector[String] // D-Pagination — which of dataSources/dataTypes/dashboards
                                                  // were truncated by Page.Default; [] if none
)
```
All fields are simple scalars/vectors — no `Option` anywhere, so no spray-json omission risk (the
epic's carried finding #8). `schemas/workspace-context.schema.json` adds `Truncation` to `$defs`
and `truncation` to the top-level `required` array, with each field's description stating D1's
UTF-16-code-unit caveat verbatim where relevant.

**D-Pagination — the ticket's carried finding: keep `Page.Default` (200) as the fetch limit
(do NOT raise it), do NOT build true pagination; make the existing truncation explicit via
`truncation.paginationTruncatedResources` instead.** Raising the limit to `Page.MaxLimit` (500)
would directly fight this ticket's own purpose — a bigger fetched page means a bigger structural
floor (D5), which the budget pass cannot shrink (tier 0 is untouchable), making the budget LESS
effective for exactly the large workspaces it exists to protect against. True cursor pagination
across multiple `GET /api/workspace/context` calls is a materially bigger feature (multi-request
protocol, doesn't fit HEL-341's single-snapshot authoring call) and isn't needed to satisfy the
ticket's actual requirement ("must not stay silent"). The fix: `WorkspaceContextBudget` (already
computing `truncation`) also compares each of `sourcesPage`/`typesPage`/`dashboardsPage`'s
`items.size` against its `PagedResult.total` (data `assemble` already has, no new query) and lists
any kind where they differ in `paginationTruncatedResources`. `counts.*` already reports the true
total (HEL-371 design.md D3) — this makes the gap between `counts.X` and `X.length` explicit
instead of requiring a consumer to compute the diff itself.

**D7 — `budgetBytes` query param, optional, `Int`, validated but not upper-clamped.** Mirrors the
existing `offset`/`limit` pattern in `DataTypeRoutes`/`DataSourceRoutes` (`parameters(...).as[Int]`,
explicit negative-value rejection). A negative value is rejected with `400` ("budgetBytes must not
be negative"); no upper clamp — an arbitrarily large requested budget only skips trimming (D2: the
underlying data is already bounded by the existing per-DataType/per-request caps regardless of the
requested budget, so a huge `budgetBytes` costs nothing extra beyond today's existing bound). `0` is
a valid (extreme) request — "give me the smallest possible response" — which resolves to D5's
structural-floor case, not an error. Omitting the param uses the configured default (D8).

**D8 — Default budget: env-var override, same convention as `TEXT_MAX_FILE_SIZE_BYTES`
(`DataSourceService.scala`/`DataSourceRoutes.scala`) — not a Typesafe-Config-bound case class
(no existing precedent for that pattern in this codebase for a single tunable).**
`WORKSPACE_CONTEXT_DEFAULT_BUDGET_BYTES` env var, `sys.env.get(...).flatMap(_.toIntOption)
.getOrElse(200000)`. `200000` (≈200K UTF-16 code units) is a self-approved tunable (Planner Notes),
re-justified against a REALISTIC small-workspace figure (round-1 design-gate finding — the original
draft only cited the pathological 200-DataType ceiling, which does not establish that a realistic
workspace stays under the default): a workspace with ~8 pipeline-output DataTypes of moderate width
(~12 Structured columns, typical short values rather than the 200-char worst case) computes to
roughly `8 × (sampleRows ~1.8 KB + columnStats ~2.4 KB + columns[] structure ~1 KB) ≈ 40 KB` —
comfortably (≈5x) under the 200,000 default, so `truncation.applied: false` for a realistic small
workspace (the ticket's backward-compat acceptance criterion), not merely for a contrived
maximally-sparse one. Separately, D4's corrected cost model means the default's size no longer needs
to be tuned to avoid triggering the (now cheap, sub-second-even-at-extreme-scale) trimming path
often — the default is chosen for response-size headroom, not to dodge a cost problem. Both figures
are stated as judgment calls, not claimed as empirically measured against real production data.

**D9 — MCP mirrors D1–D5 as an independent TypeScript implementation (`applyBudget` in
`context.ts`), tested separately — no shared runtime, per the epic's established parity discipline
(HEL-372 design.md D6/HEL-373 design.md D10).** Each side's own measurement is an honest UTF-16-
code-unit count of its OWN serializer's output (`.length` on `JSON.stringify`/`compactPrint`) — this
is deliberately a narrower claim than "the backend and MCP produce numerically-equal sizes for the
same logical content": the two serializers can escape non-ASCII/control characters differently, so
cross-runtime byte-for-byte equality of `estimatedSizeBytes` is NOT claimed or tested (round-1
design-gate wording fix — the original phrasing overstated this). What IS mirrored, and IS tested,
is the algorithm: the same tiered shed order (D3), the same exact-decomposition technique (D4), and
the same `WorkspaceContextTruncation`-shaped TS interface (camelCase fields match 1:1 — no wire
round-trip on the MCP side, so no `Option`/`undefined` concern applies here at all). A parity test
(fixture-based: identical logical `WorkspaceContext` input on both sides, same `budgetBytes`)
asserts both sides reach the SAME caps (`sampleRowsCap`/`exampleValuesCap`/`joinHintsKept`) for
that equivalent input — matching the ticket's own "same ordering (parity test or shared spec)"
acceptance criterion, not a byte-identical-output one it does not ask for.

## Risks / Trade-offs

- [Risk] The precomputation still does real, if now small, CPU work per DataType/column
  (D4) — not zero-cost.
  → Mitigation: bounded and computed concretely (D4): ~49,251 small serializations worst case (200
  DataTypes × 40 columns), each over a structure of a few hundred bytes, on the order of a few
  hundred milliseconds total even at the most extreme workspace size; the common "fits within
  budget" and "tier-1-only" paths are far cheaper (one full serialization, or that plus `≤1,200`
  tiny ones). Still anchored to the real serializer for every individual measurement (never a
  hand-rolled size estimate that risks silently diverging from it — the safer choice per finding
  #5), just applied to small disjoint subtrees instead of the whole response repeatedly.
- [Risk] A workspace whose structural floor alone (tier 0, with sampleRows/exampleValues/joinHints
  all empty) still exceeds the requested budget cannot be shrunk further (D5) — the budget becomes
  best-effort in that case.
  → Mitigation: `truncation.structuralFloorExceedsBudget` makes this explicit rather than silent;
  matches the ticket's own "structural identity... preserved even at the tightest budget" acceptance
  criterion, which forbids dropping resources to chase a budget.
- [Risk] `estimatedSizeBytes`/`budgetBytes` are UTF-16 code-unit counts, not exact UTF-8 byte counts
  or real LLM token counts (D1) — a caller treating this as an exact token budget could be
  surprised for payloads with heavy non-ASCII content.
  → Mitigation: stated precisely in the schema description and this document, not asserted as
  exact; the ticket's own language ("token/byte budget") allows this approximation, and the
  ASCII-dominated content this payload holds keeps the approximation close in the common case.
  Adding a real tokenizer to close this gap is a bigger, model-specific dependency this ticket
  deliberately doesn't take on.
- [Risk] Raising `budgetBytes` arbitrarily high still leaves the existing `Page.Default`
  (200-item)/`StatsRowLimit` (500-row)/`SampleColumnLimit` (40-column) bounds in force — a caller
  cannot use a large budget to request MORE detail than those pre-existing caps allow.
  → Mitigation: intentional — this ticket only ever shrinks toward those existing caps, never
  raises them; requesting more detail than the existing bounds provide is out of scope (D-Pagination).

## Migration Plan

Purely additive: one new required top-level response field (`truncation`, always an object — no
spray-json omission risk), one new optional query param (`budgetBytes`, omitting it preserves
today's behavior for small workspaces per D8's default), one new backend file
(`WorkspaceContextBudget.scala`), mirrored TS logic in the existing `context.ts`. No database
migration, no existing field removed/renamed, no existing endpoint's success/error behavior changed
beyond the new param's validation.

## Open Questions

None outstanding.

## Planner Notes

Self-approved: the default budget (200,000 UTF-16 code units, D8), the UTF-16-code-unit budget
unit itself rather than a real tokenizer (D1), and the fixed tier order (D3) are judgment calls
with no existing codebase precedent to match — documented rationale above, not presented as
discovered values. Flagged here for the design gate per this epic's established convention.
