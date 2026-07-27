## Context

`WorkspaceContextService.toDataTypeEntry` (HEL-372/373) already computes, per pipeline-output DataType,
`columnStats: Map[String, WorkspaceContextColumnStats]` (nullRate/distinctCount/distinctCountCapped/
exampleValues/min/max/mean) from ONE bounded (`StatsRowLimit`=500 rows, `SampleColumnLimit`=40
Structured columns) fetch. This ticket adds no new query path: `semanticRole` and `joinHints` are both
derived purely from data `assemble` already holds — declared `DataField`s and the already-computed
`columnStats` — after `Future.traverse(typesPage.items)(toDataTypeEntry(_, user))` completes.

## Goals / Non-Goals

**Goals:**
- Deterministic `semanticRole` per column (`temporal`/`dimension`/`measure`/`identifier`/`boolean`/
  `text`) from declared `dataType` + name heuristics + already-computed `columnStats` — zero new queries.
- Bounded, precision-favoring `joinHints`: only `identifier`-role column pairs across the caller's own
  pipeline-output DataTypes, computed entirely in-memory from data `assemble` already fetched.
- Cost bound stated as a closed-form worst-case number, not asserted.
- Backend/MCP parity, tested on both sides (carried finding #4).

**Non-Goals:** authoring a join step (HEL-342); token budgeting; exhaustive/high-recall join detection
(explicitly a precision-favoring heuristic — a missed hint is safer than a wrong one).

## Decisions

**D1 — `semanticRole` classification is a single deterministic, ordered function of `(DataField,
Option[WorkspaceContextColumnStats])`, evaluated in `toDataTypeEntry`'s existing `statsF.map` step
(columnStats already in scope there — no new fetch, no new step).** Precedence, first match wins:
1. Content-category field (`fieldCategory(f) == Content`) → `text` (carried finding #6: content values,
   and by extension any inference *about* them, are never touched — this is a name-only, unconditional
   short-circuit, no value inspection).
2. Declared `boolean` → `boolean`.
3. Declared `timestamp` → `temporal`.
4. Name matches a temporal-token heuristic → `temporal`. Normalize name to snake_case-lowercase
   (`([a-z0-9])([A-Z]) → $1_$2`, then lowercase, split on `_`); match if tokens contain `date`, `time`,
   `timestamp`, `dob`, or the last token is `at` with >1 token (`created_at`, `updatedAt`). Token-exact,
   not substring — avoids `validated`/`estimated` false positives that a raw `.contains("date")` would
   produce.
5. Name matches an identifier-token heuristic → `identifier`. Same normalization/tokenization as step 4
   (token-exact, not substring, throughout): match if the token set contains `id`, `uuid`, or `guid` as a
   WHOLE token. `"id"` → tokens `[id]` ✓; `"user_id"`/`"userId"` → tokens `[user, id]` ✓; `"external_uuid"`
   → tokens `[external, uuid]` ✓. `valid`/`paid`/`avoid` do not match (no `_`/camelCase boundary before
   `id`), and — unlike an earlier draft of this rule that checked `uuid`/`guid` as a raw substring —
   `guidance`/`guideline`/`misguided` do NOT match either, since none of those normalize to a lone `guid`
   token (design-gate round 1 finding: a substring check would have misclassified them `identifier`).
6. Declared `integer`/`float` → `measure`.
7. Declared `string` with real evidence (`stats.exists(s => s.distinctCount > 0)` — excludes the
   all-empty-snapshot case, D8 of HEL-373, from being misread as "confirmed low cardinality") and
   `!distinctCountCapped` and `distinctCount <= DimensionCardinalityThreshold` (50) → `dimension`.
   Otherwise → `text`.
8. Unparseable `dataType` (fails `DataFieldType.fromString`) → `text` (mirrors the existing
   conservative-exclusion convention `fieldCategory` already uses).

**Accepted, stated limitations (not fixed, per finding #5 — no confident overclaiming):** a numeric
column with genuinely low cardinality (e.g. an HTTP-status-code column) is classified `measure`, not
`dimension` — declared type wins over inferred cardinality for numerics, kept simple/deterministic since
no ticket test scenario requires the reverse. An abbreviated identifier name (`sid`, `cust`) without a
`_id`/`Id`/`uuid`/`guid` token is not detected — precision over recall, matching the "wrong role is worse
than no hint" directive.

**D2 — `joinHints` candidates are restricted to `identifier`-role columns THAT ALSO HAVE a `columnStats`
entry, computed as one pure post-processing step (`computeJoinHints(dataTypes:
Vector[WorkspaceContextDataType])`) after the `Future.traverse` in `assemble` completes — no new DB
access, and cost is bounded independently of DataType/column count by construction, not by hope.**
- **Design-gate round 1 finding, closed: an earlier draft of this decision cited `SampleColumnLimit` (40)
  as bounding the candidate pool, but `WorkspaceContextDataType.columns` (`computeJoinHints`'s only
  input) is built from the DataType's ENTIRE declared `dt.fields` list — unbounded, no field-count cap
  anywhere in the codebase (`RequestValidation.scala`/`DataTypeService.scala`/`SchemaInferenceEngine.scala`
  all checked). Since D1's identifier classification is name-only (needs no `columnStats`), every declared
  field could enter the candidate pool on a wide DataType, invalidating the stated bound — the classic
  "bound inherited from an unrelated mechanism" mistake, not a bound enforced at the enumeration step
  itself (carried finding #2).**
  **Fix, enforced at the candidate-gathering step itself, not inherited**: a column is a join-hint
  candidate iff `semanticRole == identifier` AND `dt.columnStats.contains(column.name)`.
  `columnStats` is independently capped at `SampleColumnLimit` (40) by `computeColumnStats`'s OWN
  enumeration (HEL-373 design.md D2's round-3 fix, `WorkspaceContextService.scala:317`) — reusing that
  membership check (not reusing the number 40 by citation) genuinely bounds candidates to ≤40 per
  DataType, verified by construction rather than assumed. This has two beneficial side effects, not just a
  bug fix: (1) it automatically restricts join-hint candidates to pipeline-output DataTypes only — a
  source-companion DataType's `columnStats` is always `Map.empty` (no snapshot fetch is ever made for
  one, HEL-372 design.md D2), so it contributes zero candidates without a separate `pipelineOutput` filter;
  (2) every candidate is guaranteed to have `exampleValues` available (possibly empty) for the
  value-overlap confidence term below, with no `Map.get` miss to handle.
- Restricting to `identifier`-role columns (D1) is ALSO a precision choice (join hints on a measure/
  dimension pair would be noise) independent of the cost fix above.
- **Worst-case cost, now genuinely enforced, not merely asserted**: up to `Page.Default` (200) DataTypes ×
  `SampleColumnLimit` (40) candidates each (via the `columnStats`-membership restriction above) = 8,000
  candidate columns worst case. Group by normalized name (`toLowerCase`, strip non-alphanumerics —
  `"user_id"`/`"userId"`/`"UserID"` collapse to one bucket) in O(candidates). Each bucket is capped at
  `MaxColumnsPerNameBucket` (50, stable-sorted by `(dataTypeId, column)` before truncation — deterministic,
  not iteration-order-dependent); a column is compared against at most 49 same-bucket peers. **Total
  pairwise comparisons ≤ 8,000 × 49 ≈ 392,000 worst case**, each a Jaccard overlap over ≤5-element
  `exampleValues` sets (O(1)-ish, no DB I/O) — sub-second CPU, independent of how many buckets exist. Skip
  same-DataType pairs (a column never joins against itself); only compare columns whose declared-type
  buckets match (numeric-ish vs. numeric-ish, string-ish vs. string-ish, timestamp vs. timestamp) —
  cross-type identifier joins (e.g. a string-typed id in one DataType vs. integer-typed in another) are a
  stated, accepted miss, not silently dropped.
- **Confidence, revised post-design-gate (human review caught what neither skeptic round did — see
  below): `0.5 + 0.5 * jaccard * evidenceWeight`, NOT raw `0.5 + 0.5 * jaccard`.**
  **The problem with the original formula, stated precisely**: `jaccard` over ≤5 example values saturates
  trivially. Two UNRELATED identifier columns that happen to hold small sequential integers (`1,2,3,4,5`
  — an overwhelmingly common shape for surface ids in small/demo/test data, which is exactly what this
  workspace's own `DemoData` and fixtures look like) produce `jaccard = 1.0` and therefore `confidence =
  1.0` — the maximum the scale can express — on pure coincidence, not evidence. That inverts this ticket's
  own "a wrong hint is worse than no hint" framing (ticket.md): a hint stamped `1.0` is the single most
  misleading value the field can carry, and an agent consuming it has no way to discount it.
  **Fix — damp the value-overlap boost by cardinality evidence, reusing `distinctCount` (`columnStats`
  already computes it, HEL-373 — no new computation, no new fetch, same "reuse an existing signal, don't
  invent one" discipline as D1/D2's other decisions)**: `evidenceWeight = min(1.0, min(leftDistinctCount,
  rightDistinctCount).toDouble / MinDistinctForFullConfidence)`, `MinDistinctForFullConfidence = 20` (new
  tunable constant, self-approved below). A column whose sampled `distinctCount` is small (e.g. `5`, the
  sequential-integer coincidence case) can contribute at most `5/20 = 0.25` evidence weight regardless of
  how completely its ≤5 example values overlap — capping worst-case confidence at `0.5 + 0.5 * 1.0 * 0.25
  = 0.625`, nowhere near the `1.0` "certainty" reading. A genuine identifier column (typically
  `distinctCountCapped: true`, i.e. `distinctCount` at or near the `100` cap) reaches `evidenceWeight =
  1.0` quickly, so a real, well-evidenced match can still reach the top of the scale — the damping targets
  exactly the coincidental-small-cardinality case, not every match.
  `jaccard(leftExampleValues, rightExampleValues)` (both already-truncated `compactPrint` string sets from
  `columnStats`, ≤5 entries each — no new fetch) guards its own divide-by-zero explicitly (carried finding
  #3 — ask before the guard, not just at it): `if (union.isEmpty) 0.0 else intersection.size.toDouble /
  union.size.toDouble` — an empty-vs-empty `exampleValues` pair (e.g. two all-null identifier columns)
  yields `jaccard = 0.0` (and therefore confidence `0.5` regardless of `evidenceWeight`), not a fabricated
  `NaN`. Rounded via the EXISTING `roundToFourDecimals` (reused verbatim, not a second rounding
  implementation, per carried finding #1 — safe by inspection here since the domain is bounded `[0.5,
  1.0]`, nowhere near `BigDecimal.setScale`'s overflow surface).
  **Schema semantics, stated explicitly (per the epic's repeated "confidently-worded documentation was
  false" lesson, carried finding #5 — do not leave a number's meaning implicit)**: the
  `joinHints[].confidence` schema description must say, verbatim in substance: "`0.5` = name and type
  match with weak or no value/cardinality evidence; approaches `1.0` as sampled values overlap AND both
  columns show enough distinct values (>= `MinDistinctForFullConfidence`, 20) to make coincidental overlap
  unlikely. This is a bounded heuristic over a small sample, not certainty — always advisory, never a
  substitute for verifying the join." Task 1.4 updated accordingly.
- **Output cap**: sorted by confidence descending, `(leftDataTypeId, leftColumn, rightDataTypeId,
  rightColumn)` ascending tie-break, truncated to `MaxJoinHints` (50). Every same-name/same-type-bucket
  pair qualifies (min confidence 0.5) — value overlap is a ranking boost, not a hard gate, matching the
  ticket's "name + type + value-overlap heuristic" (three combined signals, not overlap-as-gate).
  Canonical `(left, right)` assignment: the lexicographically smaller `dataTypeId` is always `left` — one
  hint per unordered pair, not two.

**D3 — RLS/ownership: zero new surface, verified by tracing the call graph, not inferred.**
`computeJoinHints` never touches the database — its only inputs are `dataTypes: Vector[WorkspaceContextDataType]`,
the exact structures `assemble` already built from `typesPage.items` (`dataTypeService.findAll(user,
Page.Default)` → `DataTypeRepository.findAll(ownerId, ...)`, filtered by `user.id` at the query itself —
confirmed by reading the signature, not the privileged-pool `listRows` path) and each DataType's own
`columnStats` (owner-gated per-DataType via `listRows`'s `findByIdOwned`, HEL-372/373 design.md D4/D8).
Because `assemble` never holds more than one caller's `typesPage` at a time, cross-DataType comparison in
`computeJoinHints` can never mix two different callers' data — there is only ever one caller's data in
scope for the whole request. No new repository method, no new route, no new call site.

## Risks / Trade-offs

- [Risk] `dimension` vs. `text` cardinality threshold (50) is a judgment call, untested against production
  distributions. → Mitigation: documented explicitly here; both branches produce a valid, non-misleading
  enum value (worst case, a low-cardinality-but-mislabeled `text` column is merely less specific, not
  wrong in the "actively misleading" sense the design-gate concern targets).
- [Risk] Restricting join candidates to `identifier`-role columns misses joins on non-`_id`-named keys
  (e.g. `sku`, `code`). → Mitigation: accepted precision-over-recall trade-off, stated in D1/D2, not
  silently absorbed; HEL-342's combined-proposal step can still fall back to manual join authoring.
- [Risk] Value-overlap evidence is only ≤5 example values per side (HEL-373's existing cap) — a weak
  statistical sample for large DataTypes. → Mitigation: overlap is a confidence *boost*, not a gate (name+
  type alone already qualifies at 0.5); no new query is introduced to get a larger sample, keeping this
  ticket's cost bound (D2) intact; the `evidenceWeight` damping (D2, post-design-gate revision) specifically
  addresses the sharpest form of this risk — a small-sample coincidental full-overlap no longer reads as
  `1.0` certainty.
- [Risk] `MinDistinctForFullConfidence` (20) is itself a judgment call, like the other new tunables in
  Planner Notes. → Mitigation: documented rationale (damp exactly the low-cardinality-coincidence case,
  not every match) rather than an arbitrary number; a genuine high-cardinality identifier still reaches
  full evidence weight quickly.
- [Risk] Cross-type identifier joins (string id vs. integer id) are never detected. → Mitigation: stated
  limitation, not a silent gap; a mixed-type id is already an unusual schema smell.

## Planner Notes

Self-approved: cardinality threshold (50), confidence weights (0.5/0.5), bucket cap (50), output cap (50),
`MinDistinctForFullConfidence` (20) are new tunable constants with no existing codebase precedent to match
(unlike `StatsRowLimit`'s reuse of `DataSourceService.staticMaxRows`) — chosen for round numbers and
documented rationale, not derived from an existing constant. Flagged here rather than presented as a
discovered value.

**Post-design-gate revision note**: the `evidenceWeight` damping term (D2 Confidence) was added after both
design-gate skeptic rounds already CONFIRMed — a human review caught a real coincidental-saturation defect
neither round surfaced (small-sample Jaccard trivially hits `1.0` for two unrelated low-cardinality
columns). Folded into the current implementation cycle rather than treated as a separate change request,
since the executor had not yet started cycle 1. Flagged explicitly for the final-gate skeptic as an area to
attack — specifically, whether the damping is applied at the correct terminal boundary and whether the
`MinDistinctForFullConfidence` threshold is actually exercised by a test that would fail without it.
