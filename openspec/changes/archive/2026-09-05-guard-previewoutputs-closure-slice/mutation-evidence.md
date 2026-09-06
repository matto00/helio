# Mutation Evidence — HEL-994

All mutations below were applied to real source
(`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala`), the affected
spec run with `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec -- -z HEL-994"`,
verbatim failure output captured, then the mutation was reverted before moving to the next one.
`git diff --stat -- backend/src/main` was empty for production source after every revert (checked
after each mutation; confirmed again at the end — see "Final state" below). Every mutation sits
inside `previewOutputs`' own body (`PipelineRunService.scala:329-374`) — none at `:507`, which
AC2 disqualifies (that line belongs to `previewAtNode`/`closureOf` and is already covered by
HEL-957's guards).

The two guard tests (`PipelineRunServiceSpec.scala`, `PipelineRunService.previewOutputs` describe
block):

1. "closure-guard: single-Output arm's stepRowCounts key set observes exactly the target's OWN
   dependency closure (HEL-994 AC1, D1, D5)" — drives `previewOutputs(pid, Some(outputId), user)`,
   asserting `envelope.outputs.head.preview.stepRowCounts.keySet` against `target`'s dependency
   closure `{stepA, stepB, target}`.
2. "closure-guard: all-Outputs arm's stepRowCounts key sets observe each Output's OWN closure,
   doubling as D3's non-degeneracy positive control (HEL-994 AC1, AC3, D1, D3, D5)" — drives
   `previewOutputs(pid, None, user)`, asserting EACH `OutputPreviewEntry`'s key set against its
   OWN Output's closure: `targetOutput` -> `{stepA, stepB, target}`, `branchOutput` ->
   `{stepA, branchNode}`.

**Fixture** (`seedClosureGuardFixture`, design.md D2/D2a/D3; skeptic-design-2.md's non-blocking
note): a three-node trunk `stepA -> stepB -> target` (Output `targetOutput` bound to `target`),
plus a second branch off `stepA` — `branchNode` — that is simultaneously (a) the AC3-required
ENABLED node outside `target`'s closure, and (b) its own step-bound Output (`branchOutput`,
closure `{stepA, branchNode}`), resolving skeptic round 2's fixture-ambiguity note explicitly: the
off-closure node IS the second branch's Output-bound node, not a third unbound node, so D3's
positive control has a real vehicle (see guard 2 above and its non-degeneracy discussion below).

## M1 — Single-Output arm, target resolution dropped (`output.node.stepId.map(_.value)` -> `None`)

Edit applied:
```scala
-              previewAtNode(pipelineId, output.node.stepId.map(_.value), output.node.rootId.map(_.value), user).map(_.map { result =>
+              previewAtNode(pipelineId, None, output.node.rootId.map(_.value), user).map(_.map { result => // HEL-994 MUTATION M1
```
Command: `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec -- -z HEL-994"`

Result: RED, right reason (key-set mismatch — `targetStepId = None` routes to the source-level
arm, an empty step slice) on the **single-Output guard**, with the **all-Outputs guard staying
GREEN** — the required cross-arm control (design.md D2a):

```
[info] PipelineRunService.previewOutputs (HEL-906 cycle 10, P1.4's preview_outputs(pipelineId, outputId?) dependency)
[info] - should closure-guard: single-Output arm's stepRowCounts key set observes exactly the target's OWN dependency closure (HEL-994 AC1, D1, D5) *** FAILED ***
[info]   Set() was not equal to Set("6fbeb39b-924f-43d8-b1ed-cdeac4ad71ea", "cb04ae7a-2c6d-465b-82db-f12fc3ae6e69", "9c34ebd0-2172-41d4-8376-35f902fe7f6a") (PipelineRunServiceSpec.scala:1361)
[info] - should closure-guard: all-Outputs arm's stepRowCounts key sets observe each Output's OWN closure, doubling as D3's non-degeneracy positive control (HEL-994 AC1, AC3, D1, D3, D5)
[info] Run completed in 2 seconds, 486 milliseconds.
[info] Total number of tests run: 2
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 1, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

Full transcript: `evidence/m1_evidence.txt`. Observed: `{}` (structural — the source-level arm
calls `backend.execute(..., Vector.empty, ...)` regardless of fixture length, per design.md D2a).
Reverted after capture.

## M2 — All-Outputs arm, per-node target dropped (in the `Future.traverse`, `previewAtNode(pipelineId, stepKey, rootKey, user)` -> `previewAtNode(pipelineId, None, rootKey, user)`)

Edit applied:
```scala
-                  previewAtNode(pipelineId, stepKey, rootKey, user).map((stepKey, rootKey) -> _)
+                  previewAtNode(pipelineId, None, rootKey, user).map((stepKey, rootKey) -> _) // HEL-994 MUTATION M2
```
Command: same as above.

Result: RED, right reason (key-set mismatch, `{}` for every entry — same structural cause as M1,
since the mutation forces every `previewAtNode` call down the empty-slice arm) on the
**all-Outputs guard**, with the **single-Output guard staying GREEN** — the required cross-arm
control, and the pair `(all-Outputs guard reds, {})` vs M1's pair `(single-Output guard reds, {})`
is what makes these two axes, not one, per design.md D2a:

```
[info] PipelineRunService.previewOutputs (HEL-906 cycle 10, P1.4's preview_outputs(pipelineId, outputId?) dependency)
[info] - should closure-guard: single-Output arm's stepRowCounts key set observes exactly the target's OWN dependency closure (HEL-994 AC1, D1, D5)
[info] - should closure-guard: all-Outputs arm's stepRowCounts key sets observe each Output's OWN closure, doubling as D3's non-degeneracy positive control (HEL-994 AC1, AC3, D1, D3, D5) *** FAILED ***
[info]   Set() was not equal to Set("e14959c9-9213-42be-80a9-c41609cba9ef", "be517d48-eba5-4c32-893d-e4c9f67b0e02", "3d418ca6-f4bc-4d42-9324-53f310f7b6fc") (PipelineRunServiceSpec.scala:1381)
[info] Run completed in 2 seconds, 497 milliseconds.
[info] Total number of tests run: 2
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 1, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

Full transcript: `evidence/m2_evidence.txt`. **Both guards did NOT red** — no collapse. M1 and M2
are confirmed as two distinct axes by the pair `(which guard reds, observed key set)`, exactly as
design.md D2a predicted; per D2a's own reasoning, "lengthen the fixture until they differ" was
correctly NOT attempted, since `{}` is structural on any fixture length. Reverted after capture.

## M3 — All-Outputs arm, re-pairing corrupted (`byNodeKey((o.node.stepId.map(_.value), o.node.rootId.map(_.value)))` -> `byNodeKey(distinctNodeKeys.head)`)

Edit applied:
```scala
-                      val entries = outputs.map(o => OutputPreviewEntry(o.id.value, byNodeKey((o.node.stepId.map(_.value), o.node.rootId.map(_.value)))))
+                      val entries = outputs.map(o => OutputPreviewEntry(o.id.value, byNodeKey(distinctNodeKeys.head))) // HEL-994 MUTATION M3
```
Command: same as above.

Result: RED, right reason (key-set mismatch, a NON-EMPTY WRONG value — `branchOutput`'s entry
silently carries `targetOutput`'s key set, since `distinctNodeKeys.head` resolved to `target`'s
node key on this run) on the **all-Outputs guard**; the **single-Output guard stayed GREEN**
(unaffected — its own call path is untouched by this arm's re-pairing):

```
[info] PipelineRunService.previewOutputs (HEL-906 cycle 10, P1.4's preview_outputs(pipelineId, outputId?) dependency)
[info] - should closure-guard: single-Output arm's stepRowCounts key set observes exactly the target's OWN dependency closure (HEL-994 AC1, D1, D5)
[info] - should closure-guard: all-Outputs arm's stepRowCounts key sets observe each Output's OWN closure, doubling as D3's non-degeneracy positive control (HEL-994 AC1, AC3, D1, D3, D5) *** FAILED ***
[info]   Set("40472d75-82dc-4d8d-818f-48158077e009", "8c1fb554-5c97-4b6a-ab1c-ad493333edfa", "b20af9ea-4931-471a-8991-aeabd457137e") was not equal to Set("40472d75-82dc-4d8d-818f-48158077e009", "e45d4f21-257e-4f39-9e66-528066034a21") (PipelineRunServiceSpec.scala:1385)
[info] Run completed in 2 seconds, 452 milliseconds.
[info] Total number of tests run: 2
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 1, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```

Full transcript: `evidence/m3_evidence.txt`. Observed set is `target`'s own 3-member closure, not
`branchOutput`'s expected 2-member closure — a **non-empty wrong value**, genuinely distinct from
M1/M2's `{}` on the key set itself (design.md D4). Note the failing assertion's LHS
(`Set("40...", "8c1...", "b20...")`, 3 members) IS `target`'s closure re-appearing where
`branchNode`'s 2-member closure was expected — exactly the re-pairing defect predicted. Reverted
after capture.

## Discarded wrong-reason mutation (AC4) — `distinctNodeKeys.take(1)`

Per design.md D4's pre-recorded prediction: narrowing `distinctNodeKeys` to `.take(1)` makes
`byNodeKey(...)` throw on any output whose own key isn't the retained one, rather than producing a
key-set mismatch.

Edit applied:
```scala
-                val distinctNodeKeys = outputs.map(o => (o.node.stepId.map(_.value), o.node.rootId.map(_.value))).distinct
+                val distinctNodeKeys = outputs.map(o => (o.node.stepId.map(_.value), o.node.rootId.map(_.value))).distinct.take(1) // HEL-994 MUTATION wrong-reason
```
Command: same as above.

Result: RED for the WRONG reason — a `NoSuchElementException`, not a key-set mismatch:

```
[info] - should closure-guard: all-Outputs arm's stepRowCounts key sets observe each Output's OWN closure, doubling as D3's non-degeneracy positive control (HEL-994 AC1, AC3, D1, D3, D5) *** FAILED ***
[info]   java.util.NoSuchElementException: key not found: (Some(a857a117-011a-44b2-acf6-cb8526a6da40),None)
[info]   at scala.collection.immutable.Map$Map1.apply(Map.scala:263)
[info]   at com.helio.services.pipelines.PipelineRunService.$anonfun$previewOutputs$14(PipelineRunService.scala:369)
```

Full transcript: `evidence/wrongreason_evidence.txt`. **This red does NOT count as an axis** —
per AC4/design.md D4, it is recorded here and discarded, not banked as evidence. Reverted after
capture.

## Distinctness table (design.md D2a)

| Mutation | Guard that reds | Observed key set | Cross-arm guard | Cross-arm result |
|---|---|---|---|---|
| M1 | single-Output | `{}` | all-Outputs | GREEN (required control) |
| M2 | all-Outputs | `{}` (every entry) | single-Output | GREEN (required control) |
| M3 | all-Outputs | non-empty WRONG set (`target`'s closure on `branchOutput`'s entry) | single-Output | GREEN (unaffected) |

M1 and M2 observe the identical key set (`{}`) but are two axes, not one, because the discriminator
is the PAIR `(which guard reds, observed key set)` plus the required cross-arm GREEN control — not
the key set alone (design.md D2a). Neither guard reds under both mutations at once; there is no
axis collapse to report.

## AC3 / D3 — non-degeneracy demonstrated, not asserted

Guard 2 above simultaneously serves as design.md D3's positive control: on UNMUTATED source,
`branchOutput`'s own entry key set is `{stepA, branchNode}` — `branchNode`'s id genuinely appears
in a `stepRowCounts` key set when `branchNode` is inside the previewed closure. This proves
`branchNode` IS count-recordable on this fixture (ruling out the `InProcessPipelineEngine
.scala:449` `if (next.enabled)` degeneracy trap), which is what makes `branchNode`'s absence from
`targetOutput`'s key set (asserted by both guards) load-bearing rather than a silent vacuity. The
positive control passed on the baseline run (see "Final state" below, all 72 tests green,
including both new guards on unmutated source).

## Final state — all mutations reverted, spec green

`git diff --stat -- backend/src/main` after every mutation was reverted: empty (no production
source, no migration) — confirmed after each individual revert and again at the end.

`git status --short` at the end of the change:
```
 M backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala
```
Test-only change, as required.

Full `PipelineRunServiceSpec` suite, fresh run on unmutated source
(`sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"`):

```
[info] Run completed in 8 seconds, 604 milliseconds.
[info] Total number of tests run: 72
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 72, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 12 s, completed Sep 5, 2026, 5:51:06 PM
```
