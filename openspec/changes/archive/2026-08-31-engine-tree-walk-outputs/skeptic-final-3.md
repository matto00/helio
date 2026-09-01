## Skeptic Report — final gate (round 2, skeptic-final-3.md)

Scope: snapshot-semantics dimension only, re-review of skeptic-final-2.md's REFUTE
(tasks.md 4.3/4.4 checked with no corresponding test). The other three final-gate
dimensions CONFIRMed in prior rounds and are untouched by commit 128e3a2b's diff
(one test file + report/tasks docs); not re-reviewed, per orchestrator instruction.

### What I verified (with evidence)

**1. The two tests exist and assert what tasks.md claims.**
`git show 128e3a2b -- .../PipelineRunServiceSpec.scala` — +50 lines, two new tests:
- `"two Outputs on one node share one snapshot row set"` (spec:1231-1251) — attaches
  `outputA` and `outputB` to the SAME `trunkStep.id` via two `outputRepo.insertInternal`
  calls, runs a real non-dry `service.submit`, then asserts (a) `listRows(pid, Some(trunkStep.id))`
  `should have size 2` (the row set is NOT doubled by the second Output) and (b)
  `schemaA should not be empty` / `schemaA shouldBe schemaB` (both Outputs derive from
  that one row set). Two Outputs on one node: confirmed. Claim matched.
- `"only materialized nodes appear in node_snapshots after a run"` (spec:1253-1275) —
  seeds an `unmaterializedStep` with NO Output plus a `materializedStep` WITH one,
  asserts the materialized node has 2 rows while both the root (`None`) and the
  intermediate step are `shouldBe empty`. Includes a genuinely non-materialized node
  that the tree walk still evaluates: confirmed. Claim matched.

**2. Guarded production code is real and matches.**
`PipelineRunService.scala:664-686`: `materializedNodeKeys = outputsByNode.keySet.intersect(nodeOutcomes.keySet)`
is the 4.4 gate; the `foldLeft` is keyed by node with `overwriteRows` called once per
node key and both Outputs' schemas derived from that single `nodeJsRows` — the 4.3
invariant. Tests target the actual mechanism, not a parallel reimplementation.

**3. They pass currently.**
`sbt testOnly PipelineRunServiceSpec -- -z "snapshot row set" -z "only materialized nodes"`
→ `Tests: succeeded 2, failed 0`. Full suite: `Tests: succeeded 48, failed 0, All tests passed.`

**4. Failability verified independently (I applied my own mutations, not the executor's).**
Three mutations to `PipelineRunService.scala`, each run and each reverted:
- **A** — `materializedNodeKeys = nodeOutcomes.keySet` (gate removed): 4.4 RED
  (`Vector({"name":"alice",...}) was not empty`, spec:1274); 4.3 stayed GREEN.
- **B** — `.take(1)` on the per-node Output schema updates (only first Output written):
  4.3 RED (`Vector(SchemaField("renamed","string"),...) was not equal to Vector()`,
  spec:1251); 4.4 stayed GREEN.
- **C** — rows duplicated per attached Output (`Vector.fill(outputs.size)(nodeJsRows).flatten`):
  4.3 RED on the row-set half (`had size 4 instead of expected size 2`, spec:1244);
  4.4 stayed GREEN.
Each test is failable, and the cross-green results show each is *specific* to its own
invariant rather than a broad smoke test. Both halves of 4.3's claim (one row set AND
shared derivation) are independently guarded.

**5. Revert is exact.** After restoring from my pre-mutation copy: `git status --short`
and `git diff --stat` both empty; full spec re-run 48/48 green. No residue.

**6. tasks.md 4.3/4.4 now honestly checked.** Both entries name the exact test title,
cite the CR that caught them, and note the prior false check ("previously checked with
no such test present, fixed cycle 3"). The checkbox now corresponds to a real,
failable test. 4.5/4.6 remain correctly `[ ]` (unchecked, out of scope).

**7. Spot-checks.** `openspec validate engine-tree-walk-outputs --strict` → `Change
'engine-tree-walk-outputs' is valid` (exit 0). All 5 report files
(`evaluation-2.md`, `skeptic-final-1.md`, `skeptic-final-1-graph-invariant.md`,
`skeptic-final-2.md`, `skeptic-final-2-engine-parity.md`) confirmed TRACKED via
`git ls-files --error-unmatch`; working tree clean.

No UI changes in this commit (one Scala test file + markdown), so section 4 UI/design
judgment does not apply to this round.

### Verdict: CONFIRM

The single defect skeptic-final-2.md raised is genuinely closed. The gap was
documentation-vs-test honesty, not behavior — the gating code was already correct, and
my mutation testing confirms the new tests would actually catch a regression in it
rather than passing vacuously.

### Non-blocking notes
- The commit is co-authored `Claude Sonnet 4.6`; repo convention elsewhere is
  `Claude Opus 5 (1M context)`. Cosmetic, no action needed for this ticket.
- 4.3's row-set assertion (`have size 2`) leans on the 2-row seed fixture. It caught
  mutation C cleanly, so it is adequate; a future tightening could assert the row set
  is identical to the node outcome rather than merely the right cardinality.
