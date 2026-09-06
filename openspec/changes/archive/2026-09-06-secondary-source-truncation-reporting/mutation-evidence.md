# Mutation evidence (HEL-890, design.md D4)

Both mutations were applied, run, observed, and reverted individually. Neither is left in the
tree — the code below reflects the state BEFORE and AFTER each mutation, both green.

## Mutation (i) — MCP axis, value-level

**Site:** `helio-mcp/src/helioApi.ts`, `runPipeline`, the `truncatedReads` field of the returned
`RunOutcome` object literal.

**Edit applied:**

```diff
-      truncatedReads: result.truncatedReads ?? [],
+      truncatedReads: [],
```

**Command:** `npx jest helio-mcp/src/runPipelineTruncation.test.ts`

**Result:** 1 failed, 3 passed (4 total). The failing test is exactly the new task-3.3 test
(`"a secondary-source truncation (primary complete, lookup/join/union secondary truncated)
surfaces per-source detail via truncatedReads, and the emitted object carries no old-named
field"`), on this assertion:

```
expect(outcome.truncatedReads).toEqual([
  { dataSourceName: "Sleeper Projections 2026", rowsRead: 1000, availableRowCount: 3114 },
]);
```

Failure output:

```
- Expected  - 7
+ Received  + 1

- Array [
-   Object {
-     "availableRowCount": 3114,
-     "dataSourceName": "Sleeper Projections 2026",
-     "rowsRead": 1000,
-   },
- ]
+ Array []
```

**Confirmed an assertion failure, not a compile/lint failure**: Jest ran to completion (`Test
Suites: 1 failed, 1 total`, `Tests: 1 failed, 3 passed, 4 total`); the failure is a
`toEqual`/deep-equality mismatch reported by Jest's matcher, not a `ts-jest` diagnostics error
(no `TS2xxx` code in the output) and not an ESLint failure. This confirms design.md's reasoning
for choosing the value-level mutation over the type-level one (deleting the field would instead
produce `TS2741`, a compile failure, per D4(i)).

**Confirmed no pre-existing test reddens**: the other 3 tests in the file (the two HEL-861
tests plus the "defaults to false" test) all stayed green — none of them reference
`truncatedReads`.

**Reverted:** restored to `truncatedReads: result.truncatedReads ?? []`. Re-ran the same
command afterward: 4 passed, 4 total (see gate output below).

## Mutation (ii) — Backend axis, per-entry numeric detail

**Site:** `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`,
`truncationFields`, the `allReads` val — the `sink.reads` arm specifically (the secondary-source
channel; `primaryRead` is built on the line above and is untouched by this edit).

**Edit applied:**

```diff
-    val allReads = (primaryRead ++ sink.reads).foldLeft(Vector.empty[TruncatedRead]) { (acc, read) =>
+    val allReads = (primaryRead ++ sink.reads.map(_.copy(availableRowCount = None))).foldLeft(Vector.empty[TruncatedRead]) { (acc, read) =>
```

**Command:** `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"`

**Result:** 72 succeeded, 1 failed (73 total). The failing test is exactly the new task-3.1/3.2
test (`"a real run with the primary under the cap and a lookup secondary over the cap reports
the secondary's per-entry rowsRead/availableRowCount, distinct from the (legitimately equal)
primary scalars"`), reported as:

```
[info] - should a real run with the primary under the cap and a lookup secondary over the cap
        reports the secondary's per-entry rowsRead/availableRowCount, distinct from the
        (legitimately equal) primary scalars *** FAILED ***
[info]   None was not equal to Some(3303) (PipelineRunServiceSpec.scala:1564)
```

Line 1564 is `secondaryRead.availableRowCount shouldBe Some(3303L)`.

**Confirmed an assertion failure, not a compile/lint failure**: sbt compiled the mutated source
successfully (`Run completed in 8 seconds, 490 milliseconds`, `Total number of tests run: 73`)
and reported a ScalaTest `shouldBe` mismatch (`None was not equal to Some(3303)`), not a
compiler error.

**Confirmed no pre-existing test reddens**: all 72 other tests in the same spec file — including
both pre-existing name-level truncation cases at line ~1513 (`previewStep over a union step...`,
asserting `sourceTruncated` and `truncatedReads.map(_.dataSourceName)`) and ~1537 (the
three-source ordering test, asserting `truncatedReads.map(_.dataSourceName)`) — stayed green.
Neither observes a secondary entry's `availableRowCount` value, so the mutation is invisible to
them, exactly as design.md predicted and as CR1 of skeptic-design-2.md verified was true of the
plan before any code was written.

**Reverted:** restored to `val allReads = (primaryRead ++ sink.reads).foldLeft(...)`. Re-ran the
same command afterward: 73 succeeded, 0 failed (see gate output below).

## Conclusion

The two mutations are independent axes: (i) held the backend payload fixed and exercised only
the MCP client's mapping; (ii) held the MCP client fixed and exercised only the backend's
per-source payload construction. Neither mutation could have been masked by the other, and
neither produced a false-positive (compile/lint) failure or a false-negative (silent pass, or a
pre-existing test reddening instead of the new one).
