## 1. Backend — protocol + schema

- [x] 1.1 Add `semanticRole: String` to `WorkspaceContextColumn` (`WorkspaceContextProtocol.scala`); bump
      `jsonFormat3` to `jsonFormat4`.
- [x] 1.2 Add `WorkspaceContextJoinHint(leftDataTypeId, leftColumn, rightDataTypeId, rightColumn,
      confidence: Double)` case class + `jsonFormat5` format.
- [x] 1.3 Add `joinHints: Vector[WorkspaceContextJoinHint]` to `WorkspaceContextResponse`; bump
      `jsonFormat6` to `jsonFormat7`.
- [x] 1.4 Update `schemas/workspace-context.schema.json`: `semanticRole` enum
      (`temporal|dimension|measure|identifier|boolean|text`, required) on each column; top-level
      `joinHints` array (required, empty-array default), each item documented as INFERRED/advisory.
      `confidence`'s description MUST state the scale's semantics explicitly (design.md D2's
      post-design-gate revision): `0.5` = name+type match with weak/no value or cardinality evidence,
      approaching `1.0` only as sampled values overlap AND both columns show enough distinct values to
      make coincidental overlap unlikely — a bounded heuristic over a small sample, never certainty.

## 2. Backend — semantic role classification

- [x] 2.1 Add `WorkspaceContextService.classifySemanticRole(field: DataField, stats:
      Option[WorkspaceContextColumnStats]): String` implementing design.md D1's 8-step precedence
      (Content→text, boolean, timestamp, name-temporal, name-identifier, numeric→measure,
      string-cardinality→dimension/text, unparseable→text). Include the name-normalization helper
      (camelCase→snake_case→lowercase→token split) as a private, independently unit-testable function.
- [x] 2.2 Wire `classifySemanticRole` into `toDataTypeEntry`'s existing `statsF.map` step — `columns =
      dt.fields.map(f => WorkspaceContextColumn(f.name, f.dataType, f.nullable,
      classifySemanticRole(f, columnStats.get(f.name))))`. No new fetch, no new `Future` step.

## 3. Backend — join hints

- [x] 3.1 Add `WorkspaceContextService.computeJoinHints(dataTypes: Vector[WorkspaceContextDataType]):
      Vector[WorkspaceContextJoinHint]` — pure function, design.md D2: per DataType, gather candidates as
      `dt.columns.filter(c => c.semanticRole == "identifier" && dt.columnStats.contains(c.name))`
      (design-gate round-1 fix — candidacy MUST require `columnStats` membership, which is genuinely
      capped at `SampleColumnLimit`; do NOT gather from `dt.columns` alone, which is unbounded). Group by
      normalized name (design.md D1 step 5's normalization, reused), cap each bucket at
      `MaxColumnsPerNameBucket` (50, stable-sorted before truncation), compare only cross-DataType
      same-type-bucket pairs, compute confidence as `0.5 + 0.5 * jaccard * evidenceWeight` (design.md D2's
      post-design-gate revision — NOT raw `0.5 + 0.5 * jaccard`; `evidenceWeight = min(1.0,
      min(leftColumnStats.distinctCount, rightColumnStats.distinctCount).toDouble /
      MinDistinctForFullConfidence)`, `MinDistinctForFullConfidence = 20`, with `jaccard`'s own explicit
      divide-by-zero guard), apply canonical `(left, right)` assignment (lexicographically smaller
      `dataTypeId` = left), sort + truncate to `MaxJoinHints` (50).
- [x] 3.2 Reuse the existing `roundToFourDecimals` for the confidence score — do not add a second rounding
      implementation.
- [x] 3.3 Wire `computeJoinHints(dataTypes)` into `assemble`, called once after the `Future.traverse`
      that builds `dataTypes` completes; thread the result into `WorkspaceContextResponse.joinHints`.

## 4. MCP (TypeScript) — parity

- [x] 4.1 Mirror `classifySemanticRole` in `helio-mcp/src/context.ts` (same 8-step precedence, same name
      normalization) and add `semanticRole` to the `columns` entries in `buildWorkspaceContext`.
- [x] 4.2 Mirror `computeJoinHints` in `context.ts` (same `columnStats`-membership candidacy restriction —
      task 3.1's design-gate fix, NOT the unbounded `t.fields.map(...)`/`columns` array at
      `context.ts:495` — same bucketing/cap/confidence formula, reusing the existing `roundToFourDecimals`
      helper already in that file) and add `joinHints` to `WorkspaceContext`.
- [x] 4.3 Update `WorkspaceContext` TS interface (`columns[].semanticRole`, top-level `joinHints`).

## 5. Tests

- [x] 5.1 `WorkspaceContextServiceSpec`/dedicated spec: table-driven `classifySemanticRole` cases covering
      every scenario in `specs/workspace-context-assembly/spec.md` ("Deterministic column semantic role")
      plus the false-positive guards (`validated`/`paid` not identifier; `estimated` not temporal;
      `guidance`/`guideline`/`misguided` not identifier — design-gate round-1 finding 2, the token-exact
      `uuid`/`guid` fix).
- [x] 5.2 Pure-unit spec for `computeJoinHints`: matching identifier pair produces a hint with confidence
      > 0.5; non-identifier columns produce no hint; empty-vs-empty example values yields confidence
      exactly 0.5 (no NaN); output cap and per-bucket cap are exercised with a constructed
      >`MaxColumnsPerNameBucket`-sized bucket; a DataType with more than `SampleColumnLimit` (40)
      identifier-named fields still yields at most 40 candidates from it (design-gate round-1 finding 1 —
      the `columnStats`-membership candidacy bound); a source-companion DataType (empty `columnStats`)
      contributes zero candidates; owner-scoping (only ever one caller's `dataTypes` in scope) documented
      via a code comment pointing at design.md D3, not a redundant DB-backed test (carried finding #7 —
      prefer pure-unit specs for constructed edge cases). **REQUIRED (human-review finding, post-design-gate,
      design.md D2's `evidenceWeight`)**: two unrelated identifier columns whose `exampleValues` are
      IDENTICAL small-integer sets (e.g. `["1","2","3","4","5"]`, `distinctCount: 5` on both sides — full
      Jaccard overlap, low cardinality) must NOT produce `confidence >= 1.0` — assert the resulting
      confidence is materially below the scale's maximum (e.g. `<= 0.65`, matching the
      `MinDistinctForFullConfidence = 20` damping math); a sibling case with the same full overlap but
      `distinctCount >= 20` on both sides MUST be allowed to reach a high confidence, to prove the damping
      targets low-cardinality coincidence specifically, not overlap itself.
- [x] 5.3 MCP `context.test.ts`: mirror 5.1/5.2's cases for `classifySemanticRole`/`computeJoinHints`
      parity, INCLUDING 5.2's required low-cardinality-coincidence-does-not-saturate-confidence case and
      its high-cardinality sibling, plus a shared regression fixture (same input, same expected
      `semanticRole`/`confidence` output) asserting both sides agree on at least one non-trivial case per
      role and one join-hint case.
- [x] 5.4 Extend the existing `WorkspaceContextServiceSpec` schema-validation coverage (or MCP's
      equivalent) to assert a sample response validates against the updated
      `schemas/workspace-context.schema.json`.
