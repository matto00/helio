# Design — HEL-949

## Context

`PipelineStepRepository.insert(pipelineId, kind, config, user, enabled)`
(`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala:67`)
takes **no** `parentStepId` and writes `PipelineStepRow(...)` with the parent
column absent. Its sibling `insertInternal(..., parentStepId: Option[...] = None)`
is the only chaining-capable writer. `insert` computes its position scoped to
root siblings (`parentStepId.isEmpty`) — its own comment states outright that
"this method never sets `parentStepId`, so every row it creates is a root
sibling" and that it has "Zero live callers today (test-only)".

Confirmed independently during premise validation: `grep` across
`backend/src/main` finds **no** production call site of this method.

**Corrected after design-gate round 1 (skeptic-design-1.md CR1).** The original
claim that its only consumers were `PipelineRunRoutesSpec` and
`PipelineStepRepositorySpec` was **false**, and the error is itself an instance of
the lesson this ticket is about: the census grep was `stepRepo\.insert`, but two
further consumers bind the repository to `pipelineStepRepo`. The search pattern
was the gate, and it did not scan what it was claimed to scan. The
alias-independent census is:

| File | Sites | Multi-step tests |
|---|---|---|
| `PipelineRunRoutesSpec.scala` | 12 | 2 |
| `PipelineAnalyzeRoutesSpec.scala` | 12 | 1 |
| `PipelineStepRepositorySpec.scala` | 7 | 0 |
| `WorkspaceContextServiceSpec.scala` | 2 | 1 |
| **Total** | **33** | **4** |

Verified with `grep -rnE "\b[a-zA-Z]*[Ss]tepRepo[a-zA-Z]*\.insert\(" backend/src/test`
plus a sweep of every test-tree `val`/`def` bound to a `PipelineStepRepository`
(two further aliases exist — `val repo` in `PipelineStepRepositoryTreeOrderingSpec`
and `mkPipelineStepRepo` in `DashboardPanelAclSpec` — neither of which calls
`insert`). **The authoritative completeness gate is not any of these greps: it is
the compiler**, via D4's rename. That is a substantive argument for the rename
over any comment-based mitigation, and task 6.2 depends on it.

## Pre-execution audit (orchestrator, from reading the spec at e2c522fa)

This audit is the *starting hypothesis* the executor must verify call-site by
call-site, not a conclusion to be taken on trust. It exists so that the executor
re-derives each determination from the test's own text and reports disagreement
rather than inheriting a guess.

**`PipelineRunRoutesSpec` (1056 lines, 12 sites):**

| Line(s) | Test | Steps in test | Hypothesised original intent |
|---|---|---|---|
| 424 | preview returns first 10 rows | 1 | topology-independent (single step) |
| 455 | preview 200 for healthy rest_api source | 1 | topology-independent |
| **468, 469** | **preview only applies steps up to and including the target step** | **2 (select, limit)** | **CHAINED — the whole point is that `limit` is downstream of `select` and must NOT run** |
| **544, 545** | **preview excludes a disabled step from the executed prefix** | **2 (limit disabled, select)** | **CHAINED — "executed prefix" presupposes a trunk; disabled `limit` must be an ancestor of `select`** |
| 559 | preview 422 when target step is disabled | 1 | topology-independent |
| 600 | run failure via bad join, step-attributed errorLog | 1 | topology-independent |
| 623 | run failure via unsupported stringops | 1 | topology-independent |
| 716 | run failure sets last_run_status failed | 1 | topology-independent |
| 876 | SSE queued→running→failed naming failing step | 1 | topology-independent |
| 952 | run failure invokes no alert evaluation | 1 | topology-independent |

**`PipelineAnalyzeRoutesSpec` (12 sites) — found by the skeptic, missed by the
original census:**

| Line(s) | Test | Steps | Hypothesised original intent |
|---|---|---|---|
| **234, 235** | **"return 200 excluding a disabled step from the response entirely"** | **2 (rename disabled, select)** | **CHAINED — the test's own comment asserts flow-through: "The disabled rename never ran, so `order_id` (not `id`) is what flows into the surviving select step's input schema". Structurally identical to 544/545.** |
| 10 others | various | 1 | topology-independent |

**`WorkspaceContextServiceSpec` (2 sites) — also missed by the original census:**

| Line(s) | Test | Steps | Hypothesised original intent |
|---|---|---|---|
| **346, 347** | **"report each step's outputColumns in step order, from the analyze path"** | **2 (select, rename)** | **CHAINED — comment says "A select then a rename step give distinct, order-verifiable outputs"; asserts `steps(1).outputColumns shouldBe Vector("renamed")`.** |

**`PipelineStepRepositorySpec` (7 sites: 117, 144, 159, 182, 189, 196, 211):** all
single-step, topology-independent. Its two multi-row tests use `insertRawStep`
raw SQL, not this method. Listed here so the deliverable's completeness is
self-evident (skeptic non-blocking note).

**These four bolded rows — four tests, eight call sites, across three files — are
the substance of this ticket.** (33 total sites - 8 corrected = 25 untouched
single-step sites. Tests and sites are counted separately throughout; conflating
them is what produced the wrong denominators in rounds 1 and 2.)

**All four are vacuous today**, for the same structural reason: under parallel
roots the second step sits on a different branch, so the property each test
claims to check ("the prefix excluded it", "the disabled step never ran", "the
rename saw the select's output") is true for free, without the production logic
ever being exercised. The two `PipelineRunRoutesSpec` tests would still pass if
the preview prefix walk were rewritten to ignore prefixes entirely; the other two
would still pass if the analyze path ignored `parent_step_id` altogether. Which
mutation demonstrates which is D2's two-target table below.

The remaining **25** sites create exactly one step, where root and chained are
the same shape. They are **legitimately root** and must be left as roots — not
mechanically converted. Converting them would be scope creep and would obscure
the four real findings.

## Decisions

### D1 — Correct only the four multi-step sites; document the rest as intentional roots

Switch `PipelineRunRoutesSpec` 468/469 and 544/545,
`PipelineAnalyzeRoutesSpec` 234/235, and `WorkspaceContextServiceSpec` 346/347 to
`insertInternal(..., parentStepId = Some(prev.id))`, preserving each test's
existing insertion ORDER as the trunk order (at 544/545 the disabled `limit` is
inserted first and therefore becomes the ANCESTOR of `select` — that is what
makes it a *prefix* step and is exactly what the test's name claims).

At `PipelineAnalyzeRoutesSpec` 234/235 the disabled `rename` is inserted first
and likewise becomes the ANCESTOR of `select`. At `WorkspaceContextServiceSpec`
346/347 `select` is the ancestor of `rename`.

The other **25** sites keep root topology, with the audit's per-site
justification recorded in the deliverable of D5 rather than as 25 redundant
inline comments.

**Rejected:** converting every site to `insertInternal` "for consistency". 25
of them have one step; a `parentStepId = None` there communicates nothing, and a
blanket rewrite is precisely the mechanical sweep this ticket exists to warn
against.

### D2 — Mutation-check is mandatory, targets the MECHANISM, and uses A DISTINCT TARGET PER TEST

The four corrected tests do **not** share a production code path — nor even three
of them — so a single "deliberate break" cannot serve them. Each test gets its
own target:

| Test | Property actually under test | Mutation target (verified red-capable) |
|---|---|---|
| `PipelineRunRoutesSpec` 468/469 | preview executes only the target's ancestor path | `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:403` — `val slicedSteps = pathToRoot(target, Vector(target))`; widen to **all** the pipeline's steps |
| `PipelineRunRoutesSpec` 544/545 | the engine **skips a disabled step in place** | `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala:325` — `if (step.enabled) evalOneStep(...) else Future.successful(currentRows)`; execute the step regardless of `enabled` |
| `PipelineAnalyzeRoutesSpec` 234/235 | analyze drops disabled steps entirely | `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:408` — `val steps = allSteps.filter(_.enabled)`; drop the filter |
| `WorkspaceContextServiceSpec` 346/347 | per-step `outputColumns` follow the trunk, so each step sees its parent's output | the schema/`outputColumns` derivation along that same analyze path (**the executor must locate the specific expression and justify it per D2a** before recording any result) |

**Why 544/545 does NOT get the prefix-walk mutation** (recorded so the
mis-assignment is not re-derived later): in that fixture the disabled `limit` is
the ancestor and `select` — the preview target — is the **leaf**. So
`pathToRoot(target)` already equals the entire step set, and widening it to "all
steps" changes nothing. The prefix-walk mutation is a literal no-op there. The
property that test actually covers is the engine's in-place disabled-step skip,
which is a different mechanism in a different file.

**Likewise flagged for 346/347:** `executionOrder` traversal order and raw
insertion order coincide for a two-step trunk, so an "ignore `parent_step_id`"
mutation is inert there too; and the `enabled` filter does not apply at all,
since neither of its steps is disabled. This is precisely why D2a requires a
stated justification before any not-red result may be recorded.

A mutation that cannot fail the test it is assigned to is a fake gate — the exact
"gate that does not scan what you claim" error this ticket exists to close.

**Granularity: a mutation's effect is recorded per ASSERTION, not per test.** A
single test may contain one assertion the mutation fails under both topologies
and another it fails only under the corrected one. Where the effect differs
across assertions within a test, record each assertion's outcome separately; a
bucket-1 ("was-vacuous, now-guarded") claim may be made **only** for an assertion
that is itself green under old topology + mutation. Collapsing a mixed test to a
single bucket loses exactly the signal this ticket is recovering.
This table has now had a mis-assignment found in it twice (design-gate rounds 2
and 3); treat every row as a hypothesis to be justified per D2a, not as settled.

For **each** of the four corrected tests, the executor must:

1. Run it under the corrected (chained) topology and record the result.
2. Apply that test's own deliberate break **to production logic**, re-run, and
   record the result with actual output.
3. Revert the break; re-run; record.
4. Run it **against the OLD (parallel-root) topology with the same production
   mutation applied**, and record the result.

The mutation must target the production code path the test claims to cover, never
the test's own fixture. Mutating the fixture proves only that the fixture is
load-bearing; mutating the production logic proves the assertion is bound to the
behavior under test.

Step 4 is the load-bearing one: a test that stayed **GREEN** there was
demonstrably vacuous before this change, which is the ticket's central claim and
the difference between "we changed some test setup" and "we closed a blind gate".

**A not-red result is a finding, never a licence to escalate the mutation.** See
D2a.

### D2a — Recording, not manufacturing, the mutation result

The required deliverable is *the recorded result of the named mutation*, not a
red result.

**Precondition — justify the mutation before recording any not-red result.**
Before recording "still topology-insensitive" for any test, the executor must
state, in the audit report, **which assertion in that test would have changed
value had the mutation taken effect**. If no such assertion exists, the mutation
was *inert* and the result is a **measurement error, not a finding**: correct the
target, report the mis-specification, and re-run. Without this precondition, an
inert mutation launders itself into a false AC4 "asserting nothing either way"
verdict for a test that is in fact properly guarded — which is how a fake gate
gets certified as a real finding.

The anti-shopping rule below therefore bites only *after* a justified mutation:
it forbids trying further mutations once a **justified** one comes back green. It
never licenses keeping an inert target.

Specifically, for each of the four tests, exactly one of:

- **was-vacuous, now-guarded** — green under old topology + mutation (step 4),
  red under new topology + mutation (step 2). The intended outcome.
- **already guarded, independent of topology** — **red under BOTH** topologies
  with the mutation applied. The mutated mechanism was genuinely covered all
  along, and this test/assertion was never one of the ticket's blind gates. This
  is a legitimate recorded result. It must **not** be reported as bucket 1
  ("was-vacuous, now-guarded"), which would be a false AC4 entry claiming this
  change closed a gap that was never open.
- **coverage LOST by the correction** — red under the OLD topology but GREEN under
  the new one. Not expected for any assigned mutation. If it occurs it is an
  alarming signal that the topology correction *removed* coverage: report it as
  its own outcome and escalate; never squeeze it into another bucket.
- **still topology-insensitive after correction** — green under BOTH topologies
  even with the mutation applied. It is a **mandatory AC4 report entry** ("this test was asserting nothing either
  way"), and it may warrant a follow-up ticket to give that behavior a real gate —
  it is **not** permission to keep trying different mutations until something goes
  red. Manufacturing a red by mutation-shopping is the rubber stamp this ticket
  exists to prevent, pointed at the mutation instead of the expectation.

**Recorded per-assertion prediction for `PipelineAnalyzeRoutesSpec` 234/235.**
Its assigned mutation (dropping `PipelineService.scala:408`'s
`.filter(_.enabled)`) is predicted to split across that test's two assertions:

- `resp.steps should have size 1` -> **red under BOTH topologies**. Without the
  filter the disabled `rename` appears in the response under either shape, so
  this assertion was already guarding the enabled-filter independently of
  topology. Third bucket, not bucket 1.
- `step.inputSchema.map(_.name) should contain allOf ("order_id", "amount")` ->
  **bucket 1**. Under parallel roots the `select` reads the source schema
  regardless, so it is green under old topology + mutation; under the corrected
  trunk the now-running `rename` maps `order_id` -> `id` and it goes red. This is
  the assertion this ticket actually un-blinds.

An earlier draft of this document predicted bucket 2 (green under both) for this
test as a whole. That was wrong, and it is corrected here rather than silently
dropped — a recorded prediction exists precisely so a result cannot be quietly
reinterpreted after the fact (D3), which requires the prediction itself to be
right.

**Refinement (design-gate round 5): the `inputSchema` half above is probably
UNOBSERVABLE, and refuting it is the correct outcome.** ScalaTest fails the block
at the first failed assertion, so once `resp.steps should have size 1` goes red
the `inputSchema` assertion never executes — and under the mutation `steps(0)` is
the `rename`, not the `select`, anyway. The honest expected result for 234/235 is
therefore **bucket 3 at test granularity, with the bucket-1 half refuted as
unobservable under this mutation**. Task 4.5 requires confirming or refuting the
prediction; refuting it is a success, not a failure, and is NOT grounds to switch
mutations.

**Also expect bucket 3 at `PipelineRunRoutesSpec` 468/469.** Its preview target is
the ancestor `select`, so `pathToRoot(select)` is `[select]` under BOTH shapes;
widening it to all steps applies `limit(1)` and turns `rowCount shouldBe 2` red
either way. That is a legitimate bucket-3 result now that bucket 3 exists — flagged
here so it is not mistaken for a mis-assigned mutation and mutation-shopped. Under
D2a it is still a *justified* mutation (it demonstrably changes the assertion's
value), so the anti-shopping rule applies in full.

If a test or assertion lands in the second bucket, report it plainly and move on.

### D3 — A red test is diagnosed, never blanket-updated

If correcting the topology turns any assertion red, the executor must diagnose
that single test and state one of:

- **(a)** the old expected value was wrong *because* it described the parallel
  shape, and the new value is the correct chained-shape value — with the
  arithmetic shown from the seeded fixture (`seedDsWithData` supplies 2 rows;
  `alice` score 40-ish and one other — the executor must read the actual seed,
  not assume);
- **(b)** the red reveals a genuine product defect in the prefix/trunk walk — in
  which case: STOP, do not absorb it, escalate for a spinoff ticket.

Changing an expected number to whatever the code now emits, without landing in
(a) or (b) explicitly, is forbidden. It converts the signal this ticket just
recovered into a rubber stamp.

Note the expected direction of travel: at line 469 `resp.rowCount shouldBe 2` and
at line 545 `resp.rowCount shouldBe 2` should both remain **2** after the fix if
the prefix logic is correct, because in both tests the target step (`select`) is
one that does not change row count and the excluded/disabled `limit(1)` must not
apply. **If either turns red, that is case (b) territory and warrants real
suspicion** — it would mean the prefix walk is applying a step it should not.
This prediction is recorded here deliberately so that a red result cannot be
quietly reinterpreted after the fact.

**A second, DIFFERENT prediction — `WorkspaceContextServiceSpec` 346/347 is
expected to go RED, and that red is anticipated, not a surprise.** That test
asserts `entry.steps.map(_.position) shouldBe Vector(0, 1)`.
`insertInternalAction` computes `position` from `siblingsQuery(pipelineId,
parentStepId).map(_.position).max` — i.e. scoped to siblings *under the same
parent*. Two root siblings therefore get positions 0 and 1, but a genuine
two-step trunk gets **0 and 0**, because the first child under a parent is always
position 0. So correcting this test's topology should flip that assertion to
`Vector(0, 0)`.

This is the single most dangerous spot in the whole change, because
`Vector(0, 0)` is exactly the kind of value an executor would "just update" to
make the suite green. It must instead be resolved explicitly:

- If per-parent position numbering is the intended domain semantics and the
  service's "step order" reporting is derived from tree traversal rather than the
  raw `position` integer, then `Vector(0, 0)` is correct and the test's ordering
  claim should be re-expressed against whatever actually encodes order — asserting
  `outputColumns` in sequence, not positions that no longer carry order.
- If the service genuinely orders steps by the raw `position` column, then a real
  trunk produces two steps both claiming position 0, and **step ordering in
  `WorkspaceContextService` is broken for every chained pipeline** — a genuine
  product defect (D3 case (b)): STOP and escalate for a spinoff. Do not absorb it.

The executor must read `WorkspaceContextService`'s ordering code and state which
of these two it is, with the code cited. "Updated to Vector(0, 0), suite green" is
an explicitly unacceptable resolution.

### D4 — Disarm the trap by renaming, not by adding a defaulted parameter

Rename `PipelineStepRepository.insert` to **`insertRootStep`**.

**Rejected — adding `parentStepId: Option[PipelineStepId] = None` to `insert`:**
a *defaulted* parameter leaves `insert(pid, kind, config, user)` compiling and
still silently root-creating, which is the exact present failure mode. It
disarms nothing.

**Rejected — a required (non-defaulted) `parentStepId` on `insert`:** this makes
`insert` a duplicate of `insertInternal` with a different auth context, inviting
future divergence between two chaining-capable writers.

**Chosen — rename to `insertRootStep`:** the name states the shape at every call
site, cannot be misread as "append the next step", and is a compiler-enforced
break (all call sites are in test code; zero production callers, so nothing
outside the test tree can fail to be updated). `insertInternal` remains the
single chaining-capable writer.

The HEL-922 warning comment at ~line 487 must be **rewritten, not deleted** — it
should now explain that `insertRootStep` deliberately creates a root branch and
that `insertInternal(..., parentStepId = ...)` is the way to chain. Deleting it
would remove the only in-file signpost; leaving it verbatim would leave it
referring to a method name that no longer exists.

### D5 — The audit report is a deliverable, not a side effect

AC1 and AC4 are reporting obligations. The executor writes
`openspec/changes/audit-chained-step-test-topology/audit-report.md` containing:

- one row per audited call site: file, line, test name, step count, determined
  intent (chained / parallel-root / topology-independent), and the evidence in
  the test's own text supporting that determination;
- for each changed test: the mutation applied, its D2a justification (which
  assertion would have changed value), and the recorded outcome under BOTH
  topologies — expressed with D2a's three buckets and, where a mutation's effect
  differs across assertions in one test, recorded per assertion rather than
  collapsed to one verdict;
- an explicit answer to AC4, **including the negative case**: "no audited test
  was asserting something that holds only under one topology" is a valid and
  expected finding here and must be stated outright rather than omitted.

This file is persisted as run evidence. AC4 is not satisfied by silence.

### D6 — Scope discipline

**Corrected after design-gate round 1 (CR3).** The earlier three-file lock
contradicted D4: a compiler-enforced rename necessarily touches every consuming
file, so the executor was pushed either into a compile failure or into
mechanically rewriting two files it had never been told to audit — the exact
blanket update this ticket forbids. Both are now resolved the same way: the two
newly-found files are **in audit scope AND in edit scope**.

Edits are confined to the six files named in the proposal's Impact section.
Within the 25 single-step sites the ONLY permitted edit is the mechanical
`insert` -> `insertRootStep` rename; any change to a topology, an expectation, or
a fixture at those sites is out of scope and must be reported instead.
No bulk `sed` across `openspec/changes/**` or `.concertino/**`. The ~35 stray
`*.png` files at the repo root belong to earlier tickets and are not touched.
No migrations; the shared dev Postgres is used as-is — on any Flyway validation
failure, STOP and report Applied/Resolved values rather than falling back to a
scratch database.

## Risks

- **The rename touches a production file.** Mitigated: zero production callers,
  verified by grep; the compiler enforces completeness across the test tree.
- **A corrected test may go red.** This is the anticipated interesting outcome,
  handled by D3 — diagnosis, never blanket update. One red
  (`WorkspaceContextServiceSpec`'s `Vector(0, 1)`) is specifically predicted and
  specifically guarded.
- **Over-correction.** The 25 single-step sites are the largest surface for
  accidental scope creep, now enlarged by the rename touching two extra files;
  D1 and D6 fix them as rename-only by construction.
- **Census completeness.** The original census was wrong once already. The
  mitigation is structural, not another grep: the compiler enforces it via D4.
