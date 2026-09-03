## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Call-site census in `PipelineRunRoutesSpec`.**
  `grep -n "stepRepo.insert" backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala`
  returns **12** `stepRepo.insert(` sites: 424, 455, 468, 469, 544, 545, 559, 600,
  623, 716, 876, 952. Not 13. (The ticket says "13 known" and then lists 12
  numbers; proposal.md and design.md inherited the wrong total without checking.)

- **The "only 468/469 and 544/545 are multi-step" claim — TRUE for this file.**
  Read each surrounding test body (`sed -n` over 400-480, 535-640, 700-730,
  860-900, 940-975). 424, 455, 559, 600, 623, 716, 876, 952 each create exactly
  one step; `seedPipeline`/`seedPipelineWithDtId` (lines 125-138) inserts only a
  `pipelines` row and no steps, so nothing hidden adds a second step. The
  "topology-independent (single step)" classification is correct at every one of
  those eight sites. Sites 499/502, 524/527, 835/839 already use `insertInternal`.

- **`PipelineStepRepositorySpec` (7 sites: 117, 144, 159, 182, 189, 196, 211).**
  Read 60-220. Every one is a single-step test; the two multi-row tests
  (`decode rows for every step kind...`) use `insertRawStep` raw SQL, not
  `stepRepo.insert`. So no chained intent there. Design.md omits this file from
  its table but tasks 1.2 covers it — acceptable.

- **Zero production call sites of `PipelineStepRepository.insert` — TRUE.**
  `grep -rn "insert(" backend/src/main --include=*.scala` filtered to real
  invocations yields only `panelRepo`, `dataSourceRepo`, `dashboardRepo`,
  `permissionRepo`, `userRepo`, `alertRuleRepo`, `repo` (uploads) — no
  `PipelineStepRepository.insert`. The only `main` references to the pipeline-step
  writer are doc comments naming `insertInternal`/`insertInternalAction`. D4's
  rename premise holds.

- **D3's arithmetic prediction — SOUND.** `seedDsWithData()`
  (`PipelineRunRoutesSpec.scala:92-101`) seeds exactly 2 rows:
  `[["alice",42.0],["bob",37.0]]`. At 468/469 the preview target is `select`
  (row-count preserving) with `limit(1)` downstream and excluded from the prefix →
  2. At 544/545 the disabled `limit(1)` becomes the ancestor and is skipped, target
  `select` → 2. Both `rowCount shouldBe 2` expectations are correct under the
  corrected chained topology. The recorded prediction is safe to keep.

- **`skip_specs: true` — correct.** `.openspec.yaml` sets it; the change adds no
  product behavior, no route, no persisted shape, and (per the grep above) the
  renamed method has no production consumer. Not dodging a spec delta.

- **AC4 reporting obligation — adequately forced.** D5 names
  `audit-report.md` as a deliverable and states outright that the negative case
  must be written ("AC4 is not satisfied by silence"), with tasks 7.1 and 5.3
  echoing it. This cannot be satisfied by omission.

- **D2 constrains the mechanism, not just the outcome — adequate.** It requires
  the mutation to hit the production prefix walk and explicitly forbids mutating
  the fixture, AND it demands the "stayed GREEN under the same mutation on the OLD
  topology" run (tasks 2.2) — the was-blind-before evidence, not only the sees-now
  evidence. This is the strongest part of the plan.

- **D3 forces per-test diagnosis — adequate.** Blanket-updating expectations is
  explicitly forbidden, with a required (a)/(b) classification and a STOP-and-
  spinoff branch. Meets carried-forward lesson 1.

### Verdict: REFUTE

The plan's substantive claim about `PipelineRunRoutesSpec` is right, but its
**scope claim about which files consume `insert` is factually false**, and that
error hides at least two more instances of exactly the trap this ticket exists to
close — while simultaneously creating a contradiction the executor cannot resolve.

### Change Requests

1. **Correct the consumer-file census. `insert` has FOUR test consumers, not two.**
   `grep -rn "\.insert(" backend/src/test --include=*.scala | grep -iE "step[Rr]epo"`
   gives, by file:
   - `PipelineRunRoutesSpec.scala` — 12
   - `PipelineAnalyzeRoutesSpec.scala` — **12**
   - `PipelineStepRepositorySpec.scala` — 7
   - `WorkspaceContextServiceSpec.scala` — **2**

   ticket.md, proposal.md ("Its only consumers are `PipelineRunRoutesSpec` and
   `PipelineStepRepositorySpec`") and design.md's Context section all repeat the
   two-file claim. Fix it in design.md and proposal.md (Impact section), and
   extend the audit scope (AC1/AC2/AC4 apply per-call-site, not per-file).

2. **Audit the two newly-found MULTI-STEP sites — these are the same trap, missed.**
   - `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala:234-235`
     — test `"return 200 excluding a disabled step from the response entirely"`
     inserts a **disabled `rename`** then a `select`, and asserts
     `"The disabled rename never ran, so order_id (not id) is what flows into the
     surviving select step's input schema"`. That comment asserts flow-through, so
     the intent is unambiguously **chained** — and it is structurally identical to
     line 544/545, the very site design.md calls out as the substance of the
     ticket. Under parallel roots the `select` reads the source regardless, so the
     assertion is true for free and the disabled-step-exclusion logic is never
     exercised.
   - `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala:346-347`
     — test `"report each step's outputColumns in step order, from the analyze
     path"` inserts `select` then `rename` with the comment "A select then a rename
     step give distinct, order-verifiable outputs", and asserts
     `entry.steps(1).outputColumns shouldBe Vector("renamed")`. **Chained** intent;
     under parallel roots the rename reads the source directly and (source schema
     being `[value]`) still yields `renamed` — vacuous either way.

   Both must appear in the audit table with a determined intent, be corrected or
   confirmed-as-root per AC2, and — if their topology changes — carry the full D2
   mutation evidence. A missed multi-step site is the highest-severity miss on this
   ticket, and the plan currently has two.

3. **Resolve the contradiction D4's rename creates with D6 / task 8.3.** Renaming
   `insert` to `insertRootStep` is a compiler-enforced break across **all** call
   sites, including the 14 in `PipelineAnalyzeRoutesSpec` and
   `WorkspaceContextServiceSpec`. As written, D6 confines edits to "the three files
   named in the proposal's Impact section" and task 8.3 requires the diff to touch
   only those three — which the build cannot satisfy. Either widen Impact/D6/8.3 to
   the five files, or state a different disarming mechanism. As it stands the
   executor is pushed either to a compile failure or to mechanically renaming two
   files it was never told to audit — the precise "blanket update" this ticket
   forbids.

4. **Fix the arithmetic in D1 and Risks.** With 12 sites in `PipelineRunRoutesSpec`
   and 4 of them in the two multi-step tests, the untouched remainder is **8**, not
   eleven. D1 says "the remaining eleven sites" and then, three lines later, "Nine
   of them have one step" — two different wrong numbers inside one decision; Risks
   repeats "the eleven single-step sites". Since the audit table IS the deliverable
   here, a wrong denominator either invites a hunt for a nonexistent 13th site or
   lets a short table pass as complete.

### Non-blocking notes

- design.md's audit table lists no rows for `PipelineStepRepositorySpec` even
  though AC1 names it. Tasks 1.2 covers it, so this is presentational — but adding
  its 7 sites (all single-step, verified above) to the table would make the
  deliverable's completeness self-evident.
- D2/tasks 2.1 correctly hedge on the production symbol names
  (`previewAtNode`/`pathToRoot`, "verify the real names, do not trust these").
  Keep that hedge; I did not confirm those identifiers.
