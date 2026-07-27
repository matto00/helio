## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established (not trusting prior reports' narrative)**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/workspace-context-assembly/spec.md` in full.
- Read the actual shipped code end-to-end: `backend/src/main/scala/com/helio/services/WorkspaceContextBudget.scala`,
  `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala`,
  `backend/src/main/scala/com/helio/api/routes/WorkspaceRoutes.scala`, the `assemble` wiring in
  `WorkspaceContextService.scala`, `helio-mcp/src/context.ts` (lines 590-1112), and
  `schemas/workspace-context.schema.json`.
- `git log --stat main..HEAD` (3 commits: ce677c17, 527cfecb, 960d7f50) — diff matches
  `files-modified.md` exactly; no unlisted files touched, no scope creep beyond the ticket's stated
  Impact section.

**1. Determinism, cross-language, including the disclosed max-reduction deviation**
- Confirmed `naturalSampleRowsCap`/`naturalExampleValuesCap` are computed via `maxOption`/`.reduce(Math.max,...)`
  over the already-built `Vector`/array — commutative/associative, so order-independent by construction.
  Verified the same on the TS side (`context.ts:729-738`).
- Ran an independent REPL probe (not part of the repo, discarded) to test a real, concrete risk the
  design doesn't call out explicitly: Scala's immutable `Map` preserves *insertion* order for size
  ≤4 (Map1-Map4) but is insertion-order-*independent* (canonical hash-trie order) for size ≥5.
  Confirmed this empirically:
  ```
  n=2 forward==reversed: false   n=3: false   n=4: false
  n=5 forward==reversed: true    n=6..40: true
  ```
  This means a `columnStats` map for a DataType with ≤4 Structured columns *would* serialize its
  JSON keys in insertion order, not a size-independent canonical order. However, tracing the call
  chain, this is **not a bug in this ticket's new code**: (a) `WorkspaceContextBudget`'s own
  transforms (`trimExampleValues`'s `dt.columnStats.map { case (name, stats) => ... }`) only
  transform *values*, never rebuild keys from an unordered source, so they preserve whatever
  ordering the input map already had; (b) the map's insertion order is itself derived from
  `computeColumnStats`'s `structuredFields.map(...).toMap`, built from the deterministic `fields:
  Vector[DataField]` (pre-existing, upstream of this diff) — same input always inserts in the same
  order, so re-running the same request twice is still byte-identical. The docstring's claim
  ("trimming array/map CONTENTS never introduces new iteration-order dependence") is accurate and
  correctly scoped — it does not claim insertion-order-independence for pre-existing upstream code,
  which is out of this ticket's diff. Verified `sums`/`.take(cap)` operations throughout
  `WorkspaceContextBudget.scala`/`context.ts` never iterate a `Set` or rebuild a map from one.
- design.md D9 explicitly disclaims cross-runtime byte-identical `estimatedSizeBytes` equality
  (different serializers) — verified this disclaimer is honored in the actual parity test
  (`context.test.ts:1010-1019`), which asserts equivalent *caps* reached, not identical bytes.

**2. Cost decomposition is real, not a relabelled full-response rescan**
- Traced the fast path: `coreSize(response)` (one full `.compactPrint`) computed once; if
  `naturalSize <= budgetBytes`, returns unchanged — `WorkspaceContextBudget.scala:191-201`.
- Traced every candidate-cap measurement (`sampleRowsLenAt`/`exampleValuesLenAt`/`joinHintsLenAt`):
  each serializes only a per-DataType `sampleRows` slice, a per-column `exampleValues` slice, or a
  `joinHints` prefix — never `response.toJson` on the full multi-DataType tree. Same on the TS side
  (`context.ts:666-684`).
- Recomputed the worst-case call count from the actual code (not trusting design.md's stated
  number): tier 1 = `naturalSampleRowsCap+1` (≤6) candidates × up to 200 DataTypes = ≤1,200; tier 2 =
  `naturalExampleValuesCap+1` (≤6) candidates × up to 200×40 column-stats entries = ≤48,000; tier 3 =
  `naturalJoinHintsCount+1` (≤51) candidates × 1 = ≤51. Total ≤49,251 — matches design.md D4's stated
  arithmetic exactly, verified independently by re-deriving it from the code, not by reading the doc.

**3. Shed order and tier-0 invariance**
- Code-level: `trimSampleRows` touches only `sampleRows`; `trimExampleValues` touches only
  `columnStats[*].exampleValues`; tier 3 touches only the top-level `joinHints` array. No `.copy(...)`
  anywhere in `WorkspaceContextBudget.scala` touches `id`/`name`/`sourceId`/`pipelineOutput`/
  `columns`/`computedColumns`/`version`/`tag`/`columnStats[*]`'s `nullRate`/`distinctCount`/
  `distinctCountCapped`/`min`/`max`/`mean`/`pipelines`/`dashboards`/`counts`. Same for `context.ts`'s
  `trimSampleRows`/`trimExampleValues` (object-spread only touches the two named fields).
  Cut order confirmed literal: tier 1 (sampleRows) → tier 2 (exampleValues) → tier 3 (joinHints).
- Ran the fresh `budgetBytes = 0` test (`WorkspaceContextServiceApplyBudgetSpec`, "never alter any
  tier-0 field") — passed (see verification run below) — and independently re-read the assertions:
  every tier-0 field is checked field-by-field against the untouched fixture at the tightest
  possible budget.

**4. `truncation` self-description accuracy**
- Verified `paginationTruncatedResources` compares `page.items.size < page.total` for each of
  `sourcesPage`/`typesPage`/`dashboardsPage` — the exact same `PagedResult`s `assemble` already
  fetched, computed synchronously within one request, no re-query — cannot go stale mid-request.
- Verified `estimatedSizeBytes` is computed via the *same arithmetic identity* used to decide the
  cap (`predicted = currentSize - (naturalTierLen - tierLenAtCap(c))`), not a separately-derived
  number — traced this is literally the same formula reused, so it cannot silently diverge from the
  cap decision. The fresh "arithmetic exactness" test (`realCoreSize(result) shouldBe
  result.truncation.estimatedSizeBytes`, computed via the *production* formatter, not
  `WorkspaceContextBudget`'s own private helpers) passed for 3 different budgets spanning multiple
  tiers.
- Attempted to construct an under-reporting scenario by reading the code: the one genuine gap is
  that `estimatedSizeBytes`/`budgetBytes` exclude `truncation`'s own serialized bytes (small, fixed
  overhead, ~200-300 bytes for 9 scalar/vector fields) — so the *true* wire size always exceeds
  `estimatedSizeBytes` by that amount. This is explicitly documented in
  `WorkspaceContextTruncation`'s scaladoc and design.md D6 as a deliberate, disclosed choice (avoids
  the self-referential paradox of a field describing its own length), not a silent gap — does not
  rise to "under-reporting" in the sense the review brief warns against (a consumer is told this
  explicitly in the schema description). `structuralFloorExceedsBudget` is set exactly when
  `findLargestFittingCap` returns `None` at `c=0` for tier 3, which is the correct, exhaustive
  exit condition — verified by tracing `(maxCap to 0 by -1).find(...)` includes `c=0`.

**5. Fresh full-suite verification (all re-run by me, not trusted from prior reports)**
- `sbt test` (backend): **2350/2350 passed**, 138 suites, 0 failed/canceled — full fresh run,
  including `WorkspaceContextServiceApplyBudgetSpec` (18 tests) and the 3 new route-level
  `budgetBytes` cases in `WorkspaceContextServiceSpec`.
- `npx jest --config jest.config.cjs` (root, covers `helio-mcp/src/context.test.ts`): **94/94
  passed**, including `applyBudget`, `paginationTruncatedResources`, and the cross-language parity
  test.
- `frontend`: `npm test` — **1433/1433 passed**, 138 suites (no frontend files touched by this
  ticket; ran anyway per the mandate).
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm run check:schemas` — in sync (32 protocol/schema pairs checked).
- `npx openspec validate token-budget-workspace-context --strict` — valid.
- `npm run check:openspec` — flags only the expected pre-archive "complete but not archived" false
  positive (documented precedent from HEL-374, called out explicitly in the commit messages);
  not a real issue.
- `git status --short` — clean except `workflow-state.md` (orchestrator bookkeeping, not a code
  artifact, expected mid-review). `git log --stat` across all 3 HEL-377 commits — no scratch/debug
  files, no stray screenshots; every changed file matches `files-modified.md`.

**Acceptance criteria traced**
1. Fixed, documented trim order — `design.md` D3 + `WorkspaceContextBudget.scala` implementing it. ✓
2. Deterministic — code-level trace + fresh determinism tests both sides. ✓
3. `truncation` marker with counts — `WorkspaceContextTruncation`, 9 always-present fields. ✓
4. Structural identity preserved at any budget — code trace + fresh `budgetBytes=0` test. ✓
5. Backend/MCP same ordering — independent implementations + fresh parity test. ✓
6. `sbt test`/MCP tests green, schema documents `truncation` — all re-run fresh, green; schema
   `$defs.Truncation` + top-level `required` confirmed. ✓
7. Backward-compat, generous default, additive marker — `D8` 200000 default + fresh
   "omitted budget uses default, applied=false for small fixture" route test. ✓
8. Carried finding (pagination truncation) — `paginationTruncatedResources` makes the existing
   `Page.Default` truncation self-describing without raising the limit, per `D-Pagination`'s
   reasoning (raising the limit would work against the ticket's own goal). ✓

No UI changes in this ticket (backend Scala + MCP TypeScript only) — section 4 of my mandate
(visual/design judgment) does not apply; skipped per the "skip if no UI changes" instruction.

### Verdict: CONFIRM

### Non-blocking notes

- The `truncation` object's own serialized bytes are excluded from `estimatedSizeBytes`/
  `budgetBytes` (a small, ~200-300-byte fixed overhead not counted against the budget). This is
  disclosed in both the scaladoc and design.md D6, but a future ticket wiring this into HEL-341's
  actual token-limited Claude call should account for that small delta explicitly rather than
  treating `estimatedSizeBytes` as the literal wire size.
- The Scala-side small-`Map` (size ≤4) insertion-order-preservation behavior (verified via REPL
  probe above) is a pre-existing characteristic of the upstream `columnStats` construction, not
  something this ticket introduces or needs to fix — flagged here only as a fact worth knowing if a
  future ticket ever needs true byte-identical cross-request output for narrow DataTypes.
