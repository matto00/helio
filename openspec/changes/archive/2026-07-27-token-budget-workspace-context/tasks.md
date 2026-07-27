## 1. Backend: protocol + schema

- [x] 1.1 Add `WorkspaceContextTruncation` case class to `WorkspaceContextProtocol.scala` (design.md
      D6 — all fields always-present, no `Option`) and its `jsonFormat` implicit.
- [x] 1.2 Add `truncation: WorkspaceContextTruncation` field to `WorkspaceContextResponse`; update
      its formatter's arity.
- [x] 1.3 Update `schemas/workspace-context.schema.json`: add `Truncation` to `$defs`, add
      `truncation` to the top-level `required` array, document the UTF-16-code-unit caveat (D1) in
      `budgetBytes`/`estimatedSizeBytes`'s descriptions.

## 2. Backend: budget pass

- [x] 2.1 Create `backend/src/main/scala/com/helio/services/WorkspaceContextBudget.scala` (new file
      — design.md's stated preference over growing the 705-line `WorkspaceContextService.scala`
      further, per HEL-631). Pure `apply(response: WorkspaceContextResponse, budgetBytes: Int,
      sourcesPage/typesPage/dashboardsPage totals-vs-lengths): (WorkspaceContextResponse,
      WorkspaceContextTruncation)` — no DB access, no `Future`.
- [x] 2.2 Implement the D1 size measurement (`.compactPrint.length`, UTF-16 code units) and the fast
      path: one full-response serialization (`naturalSize`); if within budget, return unchanged.
- [x] 2.3 Implement D4's exact decomposition for tier 1: per-DataType `sampleRowsLenAtCap(dt, c)`
      for `c` in `0..SampleRowLimit` (serializing ONLY that DataType's own array, never the full
      response), summed across DataTypes, table-lookup the largest fitting `c1` — no full-response
      reserialization per candidate.
- [x] 2.4 Implement D4's tier-2 decomposition for `columnStats[*].exampleValues`
      (`exampleValuesLenAtCap(col, c)` for `c` in `0..ExampleValueLimit`, per column, summed),
      applied only once tier 1 is fully exhausted (`c1 = 0`) and still over budget.
- [x] 2.5 Implement D4's tier-3 decomposition for `joinHints` (`joinHintsLenAtCap(c)` for `c` in
      `0..current length`, serializing only that prefix), applied only once tiers 1 and 2 are both
      fully exhausted and still over budget.
- [x] 2.6 Implement D5's structural-floor case: if all three tiers are exhausted and the response
      still exceeds budget, return it unchanged (minus the emptied tiers) with
      `structuralFloorExceedsBudget = true`. Compute `estimatedSizeBytes` arithmetically from
      `naturalSize` and the three tiers' realized savings — no extra full-response reserialization
      needed purely to report this field.
- [x] 2.7 Implement D-Pagination's `paginationTruncatedResources` computation (compare each fetched
      page's `items.size` to its `PagedResult.total`) — no new query.
- [x] 2.8 Wire `WorkspaceContextService.assemble` to accept a `budgetBytes: Int` parameter and call
      `WorkspaceContextBudget.apply` as the last step before returning.
- [x] 2.9 Add `WORKSPACE_CONTEXT_DEFAULT_BUDGET_BYTES` env-var-overridable default (design.md D8,
      `sys.env.get(...).flatMap(_.toIntOption).getOrElse(200000)`), same convention as
      `TEXT_MAX_FILE_SIZE_BYTES`.

## 3. Backend: route wiring

- [x] 3.1 Add optional `budgetBytes` query param to `WorkspaceRoutes`'s `GET .../context` (design.md
      D7 — `parameters("budgetBytes".as[Int].optional)`), reject negative values with `400`, fall
      back to the configured default when omitted.

## 4. MCP: mirrored budgeting logic

- [x] 4.1 Add `applyBudget` (or equivalently-named pure function) to `helio-mcp/src/context.ts`
      mirroring D1–D6's UTF-16-code-unit measurement, tiered downward-scan algorithm, and
      `WorkspaceContextTruncation`-shaped TS interface.
- [x] 4.2 Wire `buildWorkspaceContext` to call it as the final step before returning, accepting an
      optional `budgetBytes` parameter with the same default as the backend (design.md D8/D9).
- [x] 4.3 Mirror D-Pagination's `paginationTruncatedResources` computation in TS (compare each
      fetched page's `items.length` to its reported total).

## 5. Tests: backend

- [x] 5.1 New pure-unit spec `WorkspaceContextServiceApplyBudgetSpec.scala` (no DB — per HEL-630's
      caution against DB-backed tests with pathological inputs): fixtures for within-budget
      (unchanged), tier-1-only, tier-1+2, tier-1+2+3, and structural-floor-exceeded cases; a
      determinism test (same input+budget twice → byte-identical output); a test that tier 0 fields
      (including `columns[].semanticRole` and `columnStats[*]`'s scalar fields) are never altered at
      `budgetBytes=0`; a test confirming the shed order — construct a fixture where the budget fits
      after `sampleRows` alone is capped and assert `exampleValues`/`joinHints` are UNCHANGED at
      their natural size in that case (pins D3's "cut first" claim, not just its presence); an
      arithmetic-exactness test asserting `naturalSize - estimatedSizeBytes` equals the sum of the
      three tiers' realized per-unit savings (pins D4's decomposition identity, not just the final
      byte count).
- [x] 5.2 Test `paginationTruncatedResources` reports the correct resource kind(s) when a page's
      `items.size < total`, and is `[]` when not.
- [x] 5.3 Add minimal route-level cases to `WorkspaceContextServiceSpec.scala`: `budgetBytes` query
      param wiring (valid value changes trimming), negative value → `400`, omitted value uses the
      configured default, response validates against the updated
      `schemas/workspace-context.schema.json` including `truncation`.

## 6. Tests: MCP

- [x] 6.1 Unit tests in `helio-mcp/src/context.test.ts` for the mirrored tiered budgeting logic:
      same scenario coverage as 5.1 (within-budget, each tier, structural floor, determinism).
- [x] 6.2 A parity test (or shared fixture) asserting the backend and MCP apply the SAME priority
      order and reach the SAME caps (`sampleRowsCap`/`exampleValuesCap`/`joinHintsKept`) for an
      equivalent logical input and budget — not byte-identical serialized output (design.md D9).

## 7. Verification

- [x] 7.1 `sbt test` green.
- [x] 7.2 `cd helio-mcp && npm test` (or equivalent) green.
- [x] 7.3 `npm run lint` / `npm run format:check` clean for any touched frontend-adjacent TS files.
- [x] 7.4 Manual smoke: `GET /api/workspace/context?budgetBytes=0` against a seeded workspace,
      confirm `truncation.structuralFloorExceedsBudget` and empty value-level arrays.
