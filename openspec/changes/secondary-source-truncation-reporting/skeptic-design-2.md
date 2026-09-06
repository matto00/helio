## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold re-derivation from the tree. Round 1's seven CRs treated as a checklist, then independent
judgment on the revised plan as a whole.

### What I verified (with evidence)

**CR1 — mutation (ii) now isolates. RESOLVED.**
- The stale "asserts only `sourceTruncated`" claim is gone: design.md D3 now states the line-1513 case
  "already asserts `sourceTruncated` and `truncatedReads.map(_.dataSourceName) should contain(...)`",
  and ticket.md premise item 2 carries the corrected ground truth. Matches what I read directly at
  `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala:1525-1527`.
- The rejected mutation (primary-read-only) is explicitly named as rejected, with the reason.
- New mutation (ii) = secondary `TruncatedRead.availableRowCount = None`. Verified isolating:
  `grep -n "availableRowCount\|rowsRead" PipelineRunServiceSpec.scala` returns exactly ONE hit in the
  whole file — line 1493, `response.truncatedReads.head.availableRowCount shouldBe Some(3303L)` — and
  that test (line 1476, `seedRestDs(RestBigUrl)`, no secondary) truncates the PRIMARY only, so its
  `head` is the primary read. A mutation confined to the secondary channel does not touch it.
- Mechanically implementable and compiling: `truncationFields`
  (`PipelineRunService.scala:120-141`) builds `primaryRead` separately from `sink.reads`, so
  nulling `availableRowCount` on `sink.reads` is a one-line, type-correct (`Option[Long]`) edit that
  cannot reach the primary. The two name-only tests (1527, 1553) do not observe it.

**CR2 — mutation (i) is value-level and compiles. RESOLVED.** D4(i) is now "map `truncatedReads: []`
unconditionally instead of `result.truncatedReads ?? []`", with the TS2741 reasoning recorded as the
reason the type-level form was rejected. `[]` is assignable to `TruncatedRead[]`, so this is an
assertion failure, not a suite-failed-to-run. Isolation: no existing helio-mcp test references
`truncatedReads` (the field does not exist yet — `helioApi.ts:609-618`, `RunOutcome` at :104-116),
and task 3.4's complete-run `[]` assertion stays green under it, so only 3.3's deep-equal reddens.

**CR3 — task 3.2 split. RESOLVED.** 3.2 now keeps only the per-entry `availableRowCount > rowsRead`
assertion on the Scala test and explicitly forbids the "no equal unqualified pair" assertion there,
naming the reason (backend names are a non-goal; `100`/`Some(100)` is legitimate). 3.4 carries that
assertion on the MCP surface instead, where the rename actually removes the fields.

**CR4 — gate hole named with real commands. RESOLVED (with a note below).** Re-verified the premise:
`concertino.config.json → gates` matches only `frontend/**` (lint/format/test/build) and `backend/**`
(backend-test); nothing selects `helio-mcp/**`. Both named commands exist and are real:
`check:helio-mcp-types` at root `package.json:29` → `npm --prefix helio-mcp run typecheck` →
`tsc --noEmit -p tsconfig.typecheck.json` (`helio-mcp/package.json:14`); `npx jest
helio-mcp/src/runPipelineTruncation.test.ts` runs under the root `jest.config.cjs`, whose
worktree exclusions are `<rootDir>`-anchored so a worktree's own tests are collected. Task 3.6 makes
the output required evidence for 2.5/3.3/3.4/3.5, and 2.5 cross-references it inline.

**CR5 — distinct source names. RESOLVED.** `seedRestDsNamed(url, name)` exists at
`PipelineRunServiceSpec.scala:228` (and `seedRestDs` is its `"ds-rest"` wrapper at :223); the
line-1534 test already uses it with three distinct names. Task 3.1 now requires it with DISTINCT
names and states the dedupe-by-name reason.

**CR6 — spec scenario 3 is mechanically testable. RESOLVED.** The undefined "no pair of equal,
unqualified row-count fields … could be compared" clause is replaced with "contains no field named
`availableRowCount` and no field named `sourceRowCount`" — a literal key-absence check, and exactly
what task 3.4 asserts. The requirement prose keeps the interpretive sentence but the scenario itself
is now testable.

**CR7 — D1 claim corrected. RESOLVED.** D1 now says the rename "does NOT remove the pair … What it
removes is the pair's apparent run-wide scope", and that "the thing that actually makes 'nothing was
lost' unavailable is `truncated: true` alongside a non-empty `truncatedReads`". The spec delta
carries the same corrected statement. Consistent with the wire I read.

**Independent checks beyond the checklist**
- AC coverage traced: AC1→D1+2.3, AC2→2.1/2.4, AC3→3.1, AC4→2.6, AC5→3.1/3.2 (backend, real
  two-source run) + 3.3/3.4 (MCP surface). No AC uncovered; no task outside the ACs.
- Rename blast radius: the only in-repo readers of `RunOutcome.availableRowCount`/`sourceRowCount`
  are `helioApi.ts` itself, `runPipelineTruncation.test.ts:64,82`, and the `write.ts` description
  string — the last is not `tsc`-visible and is owned by task 2.6. No frontend consumer.
- Migration constraint honoured: no task touches `backend/src/main/resources/db/migration/`.
- Concurrency constraint honoured: file set is `helio-mcp/**`, `PipelineProtocol.scala` (scaladoc),
  `PipelineRunServiceSpec.scala`, and this change's own `openspec/changes/**` — none of the ACL
  path, `schemas/`, or the frontend the concurrent runs are editing.
- No `TODO`/`TBD`/deferred decision remains in proposal/design/tasks.

### Verdict: CONFIRM

### Non-blocking notes

- Task 3.6 is prose an executor could in principle skip; the mitigation that makes it more than prose
  is that its output is named as *required evidence* for four other tasks, so the evaluator has a
  concrete artifact to demand. Worth the evaluator checking for the pasted output specifically rather
  than accepting "verified".
- The MCP-side AC5 evidence is fixture-based (no live two-source run at that layer). That is the only
  option without a server in the unit suite, and the backend test does exercise a real two-source run
  — but the seam between them (backend field names → MCP mapping) is covered only by `tsc`.
- D4's mutation (ii) says "emit `availableRowCount = None` on the secondary's `TruncatedRead`" without
  naming the edit site. `sink.reads` in `truncationFields` is the unambiguous site; recording that in
  the mutation transcript would remove any doubt that the primary path was untouched.
