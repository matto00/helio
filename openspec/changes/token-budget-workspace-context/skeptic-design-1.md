## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/workspace-context-assembly/spec.md` in full.
- Read the current implementation these artifacts propose to extend:
  `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` (706 lines),
  `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala`,
  `schemas/workspace-context.schema.json`, `backend/src/main/scala/com/helio/domain/pagination.scala`
  (confirmed `Page.Default = Page(0, 200)`, `Page.MaxLimit = 500`), `backend/src/main/scala/com/helio/api/routes/WorkspaceRoutes.scala`,
  and the query-param convention in `DataTypeRoutes.scala`/`DataSourceRoutes.scala` (confirmed
  `parameters("x".as[Int]...)` + explicit `if (x < 0) complete(BadRequest, ...)` — matches D7's claim).
- Read `helio-mcp/src/context.ts` (813 lines) to confirm the `Record<string, ColumnStats>`
  construction pattern the MCP mirror will extend, and that its determinism properties match the
  Scala side's (insertion-order-built objects, not iteration-order-dependent).
- Cross-checked the epic's carried "per-request aggregate cost" precedent by reading
  `openspec/changes/archive/2026-07-27-column-statistics-workspace-context/design.md` D1a (lines
  132–172), which computed concrete worst-case figures (840 MB cumulative egress, 21 MB peak
  concurrent, both defended numerically) rather than asserting the cost away.

### Answering the seven pressure-test questions

**1. UTF-16 code-unit claim (D1).** Verified true and correctly scoped: `String.length` in Java/Scala
and `.length` in JS are both spec-guaranteed UTF-16-code-unit counts (surrogate pairs count as 2 on
both sides). D9 explicitly disclaims byte-identical cross-runtime output ("not byte-identical
serialized output... which the ticket does not ask for"), so the narrower claim actually load-bearing
here — "each side's own measurement is an honest UTF-16-code-unit count of its own serializer's
output" — holds. Not a "confidently-wrong" instance. Minor wording nit only (non-blocking): D1's
"gives the backend and MCP a naturally identical unit" oversells a benefit that D9 itself says isn't
tested/required — the two serializers can still escape non-ASCII/control characters differently, so
the *numeric* `estimatedSizeBytes` values are not claimed (nor need be) equal across runtimes. Soften
the phrasing so a future reader doesn't assume more than D9 promises.

**2. Tiered order (D3).** Matches the ticket's own illustrative order (structure → sampleRows →
exampleValues → joinHints) and is defended on a real basis (columnStats scalars are the cheapest,
most load-bearing measure/shape signal; sampleRows is the most expensive per unit of marginal value
once columnStats exists; joinHints is cross-DataType structural insight nothing else replaces and is
the smallest total contributor). Sound — no better order stands out and none is required by the AC
beyond matching the ticket's own suggested order.

**3. Cost bound on the search (D4) — this is the substantive finding. See Change Request 1.**

**4. Structural floor (D5) vs. the AC.** The AC's literal wording ("Structural identity of
resources... preserved even at the tightest budget; only value-level enrichment is shed") does not
require the response to ever error or refuse to return — it requires structure to survive. D5's
"return as-is, flag `structuralFloorExceedsBudget: true`" is the correct, literal reading; an error
response would actually violate "preserved... even at the tightest budget" (there'd be no response at
all). Confirmed sound, matches the spec.md scenario ("budgetBytes of zero... response is 200").

**5. Determinism / map-iteration-order interaction.** Traced this concretely: `sampleRows` is built
via `JsObject(projected.toMap)` and `columnStats` via `structuredFields.map(...).toMap` — both
produce a Scala immutable `Map` whose iteration order is a deterministic (hash-based, not
insertion-order) function of the key set, stable across repeated calls in the same JVM given the same
keys (`java.lang.String.hashCode()` is a pure, spec-guaranteed function of content). A budget-pass
operation like `columnStats.map { case (k, v) => k -> v.copy(exampleValues = v.exampleValues.take(cap)) }`
produces a new Map over the *same key set*, so its iteration order — and therefore
`compactPrint`'s field order — is unchanged and still deterministic. I do not find a real
non-determinism risk here; this is a pre-existing, already-deterministic pattern the new pass
inherits safely. `tasks.md` 5.1's explicit "byte-identical twice" test is the right verification and
should catch a regression if I'm wrong. No design change required.

**6. Pagination decision (D-Pagination).** Sound and well-defended: raising the limit to `Page.MaxLimit`
(500) would directly enlarge the untouchable structural floor (D5), working against this ticket's own
goal for exactly the workspaces it protects against; true pagination is a materially bigger,
out-of-scope feature. The chosen fix (`paginationTruncatedResources`, computed from data `assemble`
already fetches, no new query) satisfies the ticket's literal ask ("keep the truncation but make it
explicit"). No revision required — but see Change Request 1's interaction with this decision below.

**7. Other implementation-adjacent risks.** `WorkspaceContextTruncation` (D6) correctly avoids
`Option` entirely (per carried finding #8) — no spray-json omission risk. `budgetBytes` query-param
validation (D7) matches the existing `DataTypeRoutes`/`DataSourceRoutes` convention exactly (verified
by reading `DataTypeRoutes.scala:34-39`). Schema plan (add `Truncation` to `$defs`, add `truncation`
to top-level `required`) matches the existing schema's `additionalProperties: false` /
`required`-array discipline. No gaps found here.

### Verdict: REFUTE

### Change Requests

1. **D4's cost bound is understated and the "only paid when already over budget" framing is not
   substantiated against realistic (not just pathological) workspace sizes — this reopens exactly
   the "per-request aggregate cost, computed and defended, not left implicit" standard HEL-373 D1a
   set (design.md:132-172 of the archived column-statistics change) and this design does not meet
   it.**
   - The concrete numbers: `design.md`'s own D8 cites "sampleRows ≤5×40×~210B≈42KB ceiling"
     *per DataType*. D4 says each candidate cap in the linear scan is tested by "constructing the
     trimmed response and calling the REAL serializer... to measure size" (design.md:106-108) — i.e.
     a full `WorkspaceContextResponse.compactPrint` call over the *entire* response (all DataTypes,
     pipelines, dashboards, joinHints), not just the sub-collection being trimmed at that tier. For a
     workspace anywhere near the `Page.Default` ceiling (200 DataTypes) this response is up to ~8.4 MB
     of `sampleRows` alone (200 × 42KB, the same figure HEL-372/373 cited). The worst-case tier-1 scan
     alone (6 candidates, cap 5→0) reserializes a response whose size ranges from ~8.4 MB down to
     ~0 MB — call it a rough ~25 MB of string-building just for tier 1; tier 3's 51-candidate scan
     over the (by then sampleRows/exampleValues-emptied but still full-`columnStats`-and-`columns[]`)
     structure adds tens of MB more at scale. This is a materially different, and materially larger,
     number than "63 reserializations" (design.md:201) conveys on its own — the Risk section states
     the *count* but never computes the *volume*, unlike D1a's explicit 840 MB/21 MB figures for the
     sibling ticket's analogous risk.
   - More importantly: **the "over budget" branch is very plausibly the *common* case, not the rare
     one the Risk section's mitigation implies** ("only paid when the response is already over
     budget (the common/small-workspace case is one serialization, D8)", design.md:203-204). The
     chosen default (`WORKSPACE_CONTEXT_DEFAULT_BUDGET_BYTES = 200,000` UTF-16 code units, ≈200 KB,
     D8) is *smaller* than the sampleRows contribution of just ~5 populated, reasonably-wide
     pipeline-output DataTypes (5 × 42 KB ≈ 210 KB) — a workspace far short of the 200-DataType
     "extreme" case D8 and the Risk section treat as the trigger condition. Any workspace with a
     handful of real, populated, wide DataTypes will hit the expensive multi-tier reserialization
     path on *every single request*, not as a worst-case tail event.
   - **Required revision**: pick one and defend it with D1a-level rigor (concrete KB/MB figures, not
     just candidate counts):
     (a) Replace full-response reserialization-per-candidate with a cheaper measurement: serialize
     the response ONCE to capture a baseline size *and* the individually-measured serialized length
     of each trimmable unit (each DataType's own `sampleRows` entries, each column's `exampleValues`
     entries, each `joinHint`), then compute each tier's cap arithmetically by subtracting
     precomputed lengths — no repeated full-tree `compactPrint` calls at all (beyond one final
     verification pass). This is still exactly as deterministic (same precomputed lengths for the
     same input every time) and avoids the "hand-rolled size estimate that silently diverges from the
     real serializer" failure class the current design worries about, because the *component*
     lengths still come from the real serializer — only the *combination* is arithmetic.
     (b) At minimum, switch each tier's linear downward scan to a binary search (the "fits within
     budget" property is monotonic in cap, verified: fewer rows/values/hints strictly cannot increase
     serialized size) — cuts worst case from 63 to ~12 reserializations, a real, not cosmetic,
     reduction, and is a much smaller design delta if (a) is judged too big a change for this ticket.
     (c) Re-justify D8's default (or explicitly re-derive it) against the corrected understanding that
     the trim path will trigger for realistically-sized (not just 200-DataType) production workspaces
     — either the default should be raised with reasoning, or the cost-per-trigger must be shown
     acceptable at the realistic trigger frequency, not just the pathological one.
   - Also flag whether this CPU-bound work runs on the same dispatcher Pekko uses for request routing
     (`WorkspaceContextService`/`WorkspaceContextBudget` currently show no dispatcher indirection) —
     if it does, a handful of concurrent large-workspace requests doing tens-of-MB of string building
     each could add real latency to *unrelated* concurrent requests on the same actor system, which
     the design doesn't currently address at all.

### Non-blocking notes

- D1's "naturally identical unit" phrasing (design.md:39) slightly oversells cross-runtime parity
  that D9 explicitly disclaims (byte-identical output isn't required or tested) — soften to avoid a
  future reader assuming numeric equality across Scala/TS outputs for the same logical content.
- Once Change Request 1 is resolved, re-verify the `structuralFloorExceedsBudget` scenario's own cost
  (it's still tier 3's worst case) is covered by whatever cheaper approach is adopted.
