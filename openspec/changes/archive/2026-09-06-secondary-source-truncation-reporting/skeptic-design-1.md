## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Backend needs no production change — CONFIRMED.** `PipelineRunService.truncationFields`
  (`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`, read directly) returns
  `(allReads.nonEmpty, primaryStats.availableRowCount, notice, allReads.map(TruncatedReadResponse(...)))`, with an
  order-preserving fold dedupe by `dataSourceName`, primary first. `RunResultResponse` carries
  `truncatedReads: Vector[TruncatedReadResponse] = Vector.empty` (`PipelineProtocol.scala:216`). D3 is correct.
- **MCP drop site — CONFIRMED.** `helio-mcp/src/helioApi.ts:609-618` maps only `sourceRowCount`/`sourceTruncated`/
  `sourceAvailableRowCount`/`truncationNotice`; `RunOutcome` at `helioApi.ts:104-116` has no `truncatedReads`;
  `helio-mcp/src/types.ts` `RunResultResponse` (line ~568) does not declare it. Tool description at
  `helio-mcp/src/tools/write.ts:360-361` names `availableRowCount` unqualified.
- **Existing secondary-source test — CONTRADICTS the plan.** `PipelineRunServiceSpec.scala:1513-1528` asserts BOTH
  `response.sourceTruncated shouldBe true` AND `response.truncatedReads.map(_.dataSourceName) should contain("ds-rest")`.
  A further test (~line 1537) pins `truncatedReads` contents for a three-source run.
- **ts-jest diagnostics.** Root `jest.config.cjs` transforms with `ts-jest` and no `diagnostics: false`, so type errors
  surface as "Test suite failed to run", not assertion failures.
- **Gate selection.** `concertino.config.json → gates` has `when` globs of only `frontend/**` (lint/format/test/build)
  and `backend/**` (backend-test). Nothing matches `helio-mcp/**`. Root `npm test` (`jest && npm --prefix frontend test`)
  is the only thing that runs `helio-mcp/src/*.test.ts`, and it is gated on `frontend/**`.
- **Under-cap REST primary reports a total.** REST is the one driver that populates `availableRowCount`
  (`InProcessPipelineEngine.scala:647,655`); every other kind returns `None`. The field report's `sourceRowCount: 100` /
  `availableRowCount: 100` pair therefore does exist on the backend response in the secondary-truncation case.

### Verdict: REFUTE

### Change Requests

1. **D4 mutation (ii) does not isolate — the premise it rests on is factually wrong.** design.md D3/D4 and tasks 3.1
   (and ticket premise-validation item 2) all state that `PipelineRunServiceSpec.scala:1513` "asserts only
   `sourceTruncated shouldBe true` — never `truncatedReads`". It also asserts
   `response.truncatedReads.map(_.dataSourceName) should contain("ds-rest")` (line 1527), and the multi-source
   order-pinning test just below pins `truncatedReads` contents outright. Mutating `truncationFields` to return only
   the primary read therefore reddens at least two pre-existing tests as well as the new one, which is precisely the
   "the mutation proves old coverage, not the new assertion" failure the ticket's evidence standard bans. Correct the
   stale claim in design.md D3/D4 and tasks.md 3.1, and replace mutation (ii) with one that isolates to the new
   assertion — e.g. drop `availableRowCount` from the secondary `TruncatedRead` (emit `None`), which no existing test
   observes but the new per-source `availableRowCount`/`rowsRead` assertion does.

2. **D4 mutation (i) will fail to compile rather than fail an assertion.** Task 2.3 makes `truncatedReads:
   TruncatedRead[]` a *required* field of `RunOutcome`. Reverting `runPipeline` to "drop `truncatedReads`" then makes
   the returned object literal miss a required property; root `jest.config.cjs` runs `ts-jest` with diagnostics on, so
   the suite reports "Test suite failed to run" (TS2741) and never reaches the assertion. That is a compile failure, not
   a red arm. Respecify mutation (i) as a value-level, still-compiling mutation — map `truncatedReads: []`
   unconditionally instead of `result.truncatedReads ?? []` — so the failure lands on the deep-equal assertion in
   `runPipelineTruncation.test.ts` and nowhere else.

3. **Task 3.2's second clause is unsatisfiable as written.** 3.2 attaches to 3.1 (the *Scala* test) an assertion that
   "no scalar pair on the response is equal-and-comparable in the way the field report described". The proposal's own
   non-goals keep the backend field names `sourceRowCount`/`sourceAvailableRowCount` unchanged, and for an under-cap
   REST primary those are exactly `100` / `Some(100)` — the equal, unqualified pair, still present by design. Split
   3.2: keep the per-entry `availableRowCount > rowsRead` assertion on the Scala test, and move the "no equal
   unqualified pair" assertion to the MCP test (3.3), which is the only surface where the rename actually removes it.

4. **No gate runs the MCP tests for this change's file set.** This change touches `helio-mcp/**` and `backend/**`;
   the configured gates match only `frontend/**` and `backend/**`, so `sbt test` is the only gate the evaluator would
   select and tasks 3.3/3.4 would never execute in the gate run. Name the explicit verification commands in tasks.md —
   `npx jest helio-mcp/src/runPipelineTruncation.test.ts` (or root `npm test`) and
   `npm run check:helio-mcp-types` — as required evidence for tasks 2.5, 3.3, 3.4 and 3.5, rather than relying on gate
   selection.

5. **The new Scala secondary case cannot name the secondary as long as both sources are `ds-rest`.** Task 3.1 extends
   the line-1513 case, which seeds both sources via `seedRestDs` (hardcoded name `"ds-rest"`,
   `PipelineRunServiceSpec.scala:223`); `truncationFields` dedupes by `dataSourceName`. An assertion that
   `truncatedReads` contains "exactly one entry naming the secondary source" is then vacuous — the name does not
   distinguish primary from secondary, and a future primary-also-truncated regression would collapse into the same
   single entry. Require `seedRestDsNamed` with distinct primary/secondary names in 3.1.

6. **Spec scenario 3's second `AND` is not testable as written.** "contains no pair of equal, unqualified row-count
   fields that could be compared to conclude the run read everything available" leaves both "unqualified" and "could be
   compared to conclude" undefined, and `rowCount` survives the rename as an unqualified row count that equals
   `primarySourceRowCount` in exactly the field-report case. Restate it mechanically, in the style of the (good) final
   scenario — e.g. "**THEN** no top-level field name in the result denotes a row count without a scope qualifier other
   than `rowCount`, and no field named `availableRowCount` or `sourceRowCount` is present" — so an implementer and a
   reviewer read the same test.

7. **D1 overstates its own result; align the prose with what the design achieves.** design.md D1 claims the
   `availableRowCount > sourceRowCount` inference becomes "unavailable". After the rename the pair still exists as
   `primaryAvailableRowCount` / `primarySourceRowCount` and is still equal in the field case; what actually makes the
   "nothing was lost" reading unavailable is `truncated: true` plus a non-empty `truncatedReads`, and the names merely
   stop the pair from being *mistaken* for a run-wide statement. Restate D1 accordingly. (The decision itself is sound
   and self-consistent with the archived spec and the backend wire — this is a claim-accuracy fix, but it matters
   because CR3 and CR6 above are both downstream of the overreach.)

### Non-blocking notes

- D2 (`truncatedReads` required, defaulted `[]`) is consistent with HEL-861's precedent for `truncated` and with the
  spec delta's "present and empty — never absent". No objection.
- The rename's blast radius is genuinely small: the only in-repo readers of `RunOutcome.availableRowCount`/
  `sourceRowCount` are `helioApi.ts` itself, `runPipelineTruncation.test.ts:64,82`, and the `write.ts` description
  string at 360-361 (which `tsc` will not catch — task 2.6 correctly owns it).
- Task 1.2 ("record the confirmation in the commit body rather than changing behaviour") is a good instinct; I
  independently reached the same conclusion above.
