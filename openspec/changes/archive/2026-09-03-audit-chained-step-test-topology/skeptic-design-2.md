## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**CR1 (census) — ADDRESSED, and the corrected census is COMPLETE.** I did not
trust either grep. I enumerated every receiver of `.insert(` in the test tree:

```
grep -rnoE "\b[A-Za-z_][A-Za-z0-9_]*\.insert\(" backend/src/test --include=*.scala | ... | uniq -c
  19 stepRepo   14 pipelineStepRepo   13 repo   ... (dataSourceRepo, arRepo, dsRepo, panelRepo, ...)
```

and cross-checked it against every test-tree binding of type
`PipelineStepRepository` (48 bindings; receivers are only `stepRepo`,
`pipelineStepRepo`, `repo`, `dbStepRepo`, `mkPipelineStepRepo`).
- `stepRepo.insert` 19 = PipelineRunRoutesSpec 12 + PipelineStepRepositorySpec 7.
  The other seven `stepRepo`-bound specs (PipelineStepRoutesSpec, PipelineAclSpec,
  PipelineStepRepositorySpliceSpec, PipelineRunServiceSpec, the two
  `new PipelineStepRepository(null)` engine specs, V94OutputsMigrationSpec) call
  none.
- `pipelineStepRepo.insert` 14 = PipelineAnalyzeRoutesSpec 12 + WorkspaceContextServiceSpec 2.
- `repo.insert` (13) is entirely `DataSourceRepositorySpec`;
  `PipelineStepRepositoryTreeOrderingSpec`'s `val repo` only calls
  `trunkOf`/`childrenOf`/`tailsOf`/`executionOrder` — no `insert`.
- `dbStepRepo`/`mkPipelineStepRepo` never call `insert`.
- No line-broken or receiver-less `insert(` call exists in the test tree (the only
  bare `insert(` is an unrelated `ResourcePermission` stub override in
  `AclDirectiveSpec:50`).

**12 / 12 / 7 / 2 = 33 is right, and there is no third missed alias or call path.**

**CR2 (the two newly-found multi-step sites) — ADDRESSED, and both intent readings
are CORRECT.**
- `PipelineAnalyzeRoutesSpec:229-247`: inserts a **disabled `rename`** then a
  `select`; asserts `resp.steps should have size 1` and the comment "The disabled
  rename never ran, so `order_id` (not `id`) is what flows into the surviving
  select step's input schema". The flow-through reading is right — and under
  parallel roots the `select` reads the source schema directly, so
  `contain allOf ("order_id","amount")` is true for free. Genuinely vacuous today.
  Confirmed.
- `WorkspaceContextServiceSpec:340-357`: `select` then `rename`, comment "A select
  then a rename step give distinct, order-verifiable outputs". Chained intent,
  confirmed.
- I also re-derived that `PipelineAnalyzeRoutesSpec` has exactly **one** multi-step
  test: I listed all 12 insert lines against the enclosing `... in {` boundaries;
  every other insert is alone in its test.

**CR3 (D4/D6 contradiction) — ADDRESSED.** Impact is now six files, D6 confines
edits to "the six files named in the proposal's Impact section", and task 8.3
matches. No residual three-file lock.

**The D3 `Vector(0, 1)` -> `Vector(0, 0)` prediction — ARITHMETICALLY CORRECT.**
`insertInternalAction` (`PipelineStepRepository.scala:200-214`) computes
`position` as `siblingsQuery(pipelineId, parentStepId).map(_.position).max + 1`,
i.e. scoped to siblings sharing the same parent. Two roots -> 0, 1; a real
two-step trunk -> 0, 0. `listByPipelineInternal`'s own scaladoc (lines 152-161)
states this outright: "after the trunk/tail position-renumbering fix, every trunk
step's `position` is constantly `0`". The recorded prediction is safe to keep.

**Task 5.4's case-(a)/case-(b) ruling — I read the code, and it is case (a). No
product defect.** `WorkspaceContextService.buildPipeline` (lines 262-273) gets its
steps from `pipelineService.analyze(...)`, and `PipelineService.analyze`
(lines ~399-412) sources them from
`pipelineStepRepo.listByPipelineInternal(pipelineId)`, which orders via
`executionOrder(...)` — a `parent_step_id` tree traversal — and only then
`.filter(_.enabled)`. `position` is carried through to
`WorkspaceContextService.toStepEntry` (line 278) as a **reported field**, never as
a sort key; nothing in either service sorts by it. So order is carried by
traversal, `Vector(0, 0)` is the correct chained value, and the test's ordering
claim must be re-expressed against `outputColumns` sequence. This is D3 case (a),
not a live defect. Both branches in D3/5.4 are correctly specified either way —
this is confirmatory, not a change request.

**`insert` still has zero production call sites.** Re-verified: every
`backend/src/main` reference to `PipelineStepRepository` is a constructor/param
binding or a doc comment naming `insertInternal`/`insertInternalAction`. D4's
rename premise holds; the compiler is a real completeness gate (lesson 4 —
I checked what this gate actually scans: it scans every call site of the renamed
symbol, which is exactly the census claim being made).

**D6's rename-only constraint on the single-step sites — enforceable and
sufficient.** It is diff-checkable (task 8.3), and the constraint is on the
mechanism (only the identifier may change), not merely the outcome.

### Verdict: REFUTE

Three of the four round-1 change requests are genuinely fixed, and I found no
third missed call path — the census is now correct. But the round-1 arithmetic
defect was fixed in one place and reintroduced in another, and D2 — the part
round 1 called the strongest in the plan — was never rescoped from two tests to
four, leaving the evidence bar naming a code path that does not exist on two of
the four tests.

### Change Requests

1. **The single-step remainder is 25, not 29.** 33 sites minus the **8** corrected
   call sites (468, 469, 544, 545, 234, 235, 346, 347) = 25.
   `12-4=8` (Run) `+ 12-2=10` (Analyze) `+ 7` (StepRepo) `+ 2-2=0` (WCS) = **25**.
   "29" appears to be 33 minus the four multi-step *tests* — a tests-vs-sites
   category error. It is wrong in six places: design.md lines 88, 108, 109, 112,
   243, 260 and tasks.md lines 44 and 99. This is the same class of defect as
   round-1 CR4, and it matters for the same reason: the audit table IS the
   deliverable, so a wrong denominator either sends the executor hunting four
   nonexistent single-step sites or lets a 4-row-short table pass as complete.

2. **D2 was not rescoped from two tests to four, and the mutation target it names
   does not exist on two of them.** D2 still reads "For each of the **two**
   corrected tests" and "each of the **two** tests must be run once against the OLD
   topology", and design.md:82-86 says "**Both** are currently vacuous / **Both**
   would still pass if `previewAtNode` were rewritten to ignore prefixes entirely"
   immediately after asserting there are four. Tasks 2.2/4.2 say "all four", so the
   binding decision and the tasks now disagree — and the tasks are the ones that
   are under-specified, because **`previewAtNode` / `pathToRoot` prefix walking is
   not the code path `PipelineAnalyzeRoutesSpec:234-235` or
   `WorkspaceContextServiceSpec:346-347` exercise at all.** Those two run through
   `PipelineService.analyze` -> `PipelineStepRepository.listByPipelineInternal` ->
   `executionOrder` + `.filter(_.enabled)` (verified above). A single "deliberate
   break to that production path" cannot serve both groups. D2 must name **two**
   mutation targets — the preview prefix walk for the two `PipelineRunRoutesSpec`
   tests, and the analyze step-graph/enabled-filter path for the other two — and
   its counts and "Both" prose must be corrected to four.

3. **Task 4.2's unconditional "record the tests RED" contradicts AC4's negative
   case, for at least one test where I expect no red.** For
   `PipelineAnalyzeRoutesSpec:234-235`, the surviving `select`'s input schema is the
   source schema under parallel roots AND under a chained trunk whose only ancestor
   is a disabled (therefore filtered-out) `rename`. That assertion plausibly stays
   green under both topologies even after correction — which is precisely the AC4
   finding "this test was asserting nothing either way", and the proposal already
   contemplates it ("A test still passing under both topologies is reported as
   having tested nothing either way"). But task 4.2 as written *requires* four reds,
   which pressures the executor into escalating the mutation until something breaks.
   Rewrite 4.2 (and D2 step 2) so the required output is the *recorded result* of
   the named mutation, with a not-red result being a mandatory AC4 report entry
   ("still topology-insensitive after correction"), explicitly not a licence to
   pick a different mutation until red appears.

### Non-blocking notes

- Task 5.4 can be pre-answered: I read the code and it is case (a) (see above,
  `WorkspaceContextService.scala:262-278`, `PipelineService.scala:399-412`,
  `PipelineStepRepository.scala:152-163`). The executor should still re-derive it,
  but there is no product defect lurking here and no spinoff is expected.
- design.md line 82 says "The four bolded rows across three files" but the tables
  bold five line-pairs' worth of rows across three files (two rows in
  PipelineRunRoutesSpec, one each in the other two) = four rows / eight sites.
  Wording only; fixing it alongside CR2 would remove the last "two vs four"
  residue.
