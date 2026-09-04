## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of 33 commits (`a45e9881..b0b29d79`) on `feature/multi-root-pipelines/HEL-913`.
Everything below is derived from the files, the diff, and gates I ran myself.

### What I verified (with evidence)

**Gates — all re-run by me, in this worktree.**

| gate | result |
|---|---|
| `cd backend && sbt -batch test` | **PASS** — `Tests: succeeded 3729, failed 0`, 245 suites, exit 0 |
| `npm run lint` / `typecheck` | PASS |
| `npm test` | PASS — 252 suites / 2590 tests, plus 22 suites / 223 (MCP) |
| `check:schemas` | PASS — 73 schemas / 48 protocol files, 7 enum surfaces, **14 `AssistantProposalToolSchemas` surfaces in sync** |
| `check:openspec` / `check:spec-structure` / `check:repo-integrity` / `check:scala-quality` | PASS |
| `check:node-root-encoding` + `:selftest` + `:ts` + `:ts:selftest` | PASS |
| `check:e2e-types` / `check:helio-mcp-types` | PASS |
| Playwright (`DEV_PORT=6345`) | **37 passed, 1 failed** — sole red is `hel910-pipeline-to-dashboard-flow.spec.ts:144` `waitForURL "/pipelines/undefined"`, the documented HEL-969 expected red |

Process hygiene: I killed the running backend (PIDs 789651/789787) and confirmed port 9252 free
before `start-servers.sh`, so nothing was tested against a stale server. `assert-phase.sh servers`
→ `PASS servers`.

*Reproduced-before-concluding note.* My first Playwright run reported **38/38 failed**. I did not
report that: the failures were all `ERR_CONNECTION_REFUSED at http://localhost:5173`, i.e. my own
error — `playwright.config.ts:8` reads `DEV_PORT`, not `PLAYWRIGHT_BASE_URL`. Re-run with
`DEV_PORT=6345` gave 37/1. The 38-red reading was a measurement artefact, not a defect.

**V98 — verified independently, not taken from the prior clearances.**
- `NO FORCE` bracket at `:64-68` covers all five tables including `pipelines` (the fail-silent
  READ trap); `FORCE` restored on all five at `:330-334`; `pipeline_roots` gets ENABLE+FORCE at
  `:348-349`.
- Orphan disposal (§5, `:174-197`) precedes every CHECK (§6, `:200-216`). Counts are logged to
  `hel913_migration_counts` **before** each delete, so they are measured, not assumed.
- The `binary_refs` UPDATE guards on `pipeline_id IS NOT NULL`; I checked `V94:425` — `pipeline_id`
  carries a real FK to `pipelines(id) ON DELETE CASCADE`, so no non-NULL orphan can survive to
  violate the new `root_id` FK. `outputs.pipeline_id` is `NOT NULL REFERENCES pipelines` (`V94:208`).
  The two disposed populations are exactly the two that can exist.
- `FlywayNonSuperuserMigrationSpec`'s external comparison is **intact and genuinely external**:
  `pipelineCountBeforeV98` is read over `superDbPreV94` (`:213`), and the post-migration
  `pipeline_roots` count is read over `migratedDb`, which is
  `forDataSource(embeddedPostgres.getPostgresDatabase)` — the **superuser** datasource, so the
  comparison is immune to the RLS state V98's own guard is blind to. `rootCount shouldBe
  pipelineCountBeforeV98` **and** `rootCount should be > 0` (`:305-307`). This is the real backstop
  V98's header says it is.
- `V98PipelineRootsMigrationSpec` carries the bracket-removal mutation proof (`:193`), idempotency
  (`:159`), the byte-identical untouched-row proof (`:175`), both guard-fire proofs (`:327`,
  `:372`), and the `pipeline_roots` RLS privilege-escalation test (`:421`). AC1 is fully traced.

**Acceptance criteria traced against the literal ticket wording.**
- **AC1 (migration)** — met; see above. Real-dump coverage (73 pipelines), not hand-built fixtures.
- **AC2 (engine)** — *first clause met, second clause unproven.* `InProcessPipelineEngineTreeWalkSpec:323-393`
  genuinely exercises N>1 roots with content assertions (per-root frame isolation; the R10
  divergence test at `:354` deliberately orders `rootFrames` against id order so a naive
  implementation disagrees; cross-root lane rejoin at `:381`). But see Change Request 2 for the
  "removing a root removes its lane's Outputs" half.
- **AC3 (ACL)** — met. `PipelineRootRoutesSpec:159/167/222` (blank id → 400 with no ownership
  lookup; unowned/nonexistent → 404; non-owner pipeline → 404). Run-time resolution goes through
  `findByIdInternal` with the pipeline's own ACL authoritative (R8, unchanged posture).
- **AC4 (route/MCP specs + gates)** — met; 13 deltas present, all four checks green above.
- **AC5 (contract)** — met, and I checked R4's representation table against the shipped code rather
  than trusting it. DB: `pipeline_steps.root_id` + `CHECK ((parent_step_id IS NULL) = (root_id IS
  NOT NULL))` (`V98:120-127`) — true. Wire: `PipelineStepResponse.fromDomain(step, rootIdOfStep)`
  has **no default** on the map parameter (`PipelineStepProtocol:232`) and is the sole constructor
  of all 24 response subtypes — true. Domain: no `rootId` field on the op case classes — true.
  Resolution: `rootIdsOf` fetched at the boundary and threaded into `executeTree`/`trunkOfRoot` —
  true. R1-R15 is sufficient for HEL-914 to plan from; two small wording gaps are in the
  non-blocking notes.

**Single-root parity (R10 / task 5.5a).** No regression found. `roots.head` survives only where R3's
three named tiebreaks permit it (`InProcessExecutionBackend:42`, `InProcessPipelineEngine:478`,
`PipelineRunService:887-891`, `SparkJobSubmitter:140`), each carrying its stated justification; the
`onRunSuccess` path keys `outputsByNodeKey` on `StepKey`/`RootKey(output.node.rootId)` with an
Output missing both **skipped rather than guessed at** (`:1030-1040`), and `alertEvaluation` does the
same (`:1119-1122`). `previewAtNode`'s unresolvable-`rootId` case now fails closed (`:429-432`,
commit `b0b29d79`), so evaluation-2's suggestion 2 is genuinely closed. The whole 3729-test suite and
all 37 green Playwright specs exercise single-root pipelines.

**The fourteenth instance — I looked for one and found one.** See Change Request 1. It is non-textual
to a symbol grep in the way the brief predicted: it lives inside a **string literal in an LLM prompt**,
so no compiler, no `check:schemas` parity check, and no test observes it.

---

### Verdict: REFUTE

Two blocking items. Neither is in the deferred 9.7 cluster — CR1 is on a surface this change
retained, implemented, and wrote a binding spec delta for; CR2 is a literal acceptance criterion.

---

### Change Requests

**1. `RefinementEditShape.scala:258` still tells the model to emit the deleted scalar
`sourceDataSourceId` for a pipeline-create edit — breaking the refinement pipeline-create path and
contradicting this change's own `patch-set-apply` spec delta.**

The live prompt text reads:

```scala
"only), and pipeline (patch reuses CreatePipelineRequest — { \"name\", \"sourceDataSourceId\" }\n" +
"required, \"tag\"/\"steps\"/\"outputs\" optional). ..."
```

- It is live, not dead: `RefinementPrompt.scala:27` concatenates `RefinementEditShape.Description`
  into the refinement system prompt.
- `CreatePipelineRequest` (`PipelineProtocol.scala:78-84`) now has `roots: Vector[...]` **required,
  no default, no accepted alias** (task 7.2a, `:72-77`). A patch built to this instruction fails
  `decodeCreatePatch[CreatePipelineRequest]` in `PatchSetApplyResolvers.resolvePipelineCreate:492`.
  The refinement flow can therefore no longer create a pipeline at all.
- This change's own delta says the opposite: `specs/patch-set-apply/spec.md` — *"A pipeline `create`
  edit target SHALL carry `roots` in place of a scalar `sourceDataSourceId`."* Shipping this
  publishes a third permanently-false SHALL, which is precisely the defect class R11 spent scope
  eliminating.
- `PatchSetApplyResolvers:496` and `PatchSetPreviewProjection:251` were both correctly rewired by
  task 7.6. Only the text that tells the model what to produce was missed — the sweep was keyed on
  code symbols, and this is a string.

**Required:** rewrite the pipeline-create clause to the `roots[]` shape (`{ "name", "roots": [{
"sourceId": ... }] }` required, mirroring `CreatePipelineRootRequest`'s `sourceId`-or-inline
branches). Add coverage: `RefinementEditShapeSpec` today only parses/decodes the
`private[services]` example vals (`:211`, `:242`, `:250`) and has **zero** assertions over
`CreateExample`, which is why this survived — that is the same "the spec never happened to cover
them, which is how this survived" trap the file itself records at `:186`. Promote the pipeline
create instruction to its own decodable `private[services]` example val and assert it decodes to a
valid `CreatePipelineRequest`, so the prompt and the request shape can never drift again.

**2. AC2's second clause — "removing a root removes its lane's Outputs and reports placements" — has
no evidence. `removedOutputCount` is only ever asserted equal to 0.**

`PipelineRootRoutesSpec` is the only place root removal is exercised, and the single
`removedOutputCount` assertion in the whole repo is `body.removedOutputCount shouldEqual 0`
(`:266`) — on a root that has no Outputs. That is a guard never observed firing.

Concretely unproven:
- the count predicate `o.node.stepId.exists(sid => doomedIds.contains(sid.value)) || o.node.rootId
  .contains(rootId)` (`PipelineService.scala:866-868`) — both arms;
- that the count is computed **before** the transactional delete so a DB cascade cannot undercount
  it — which is the exact hazard R7 phase 2 calls out in writing;
- that the Outputs are actually gone afterwards. Root-bound Outputs rely on `outputs.root_id
  REFERENCES pipeline_roots(id) ON DELETE CASCADE` (`V98:146`) and step-bound ones on the step
  cascade; neither cascade is asserted for this path. Note the sibling test at `:273` *does* prove
  the `node_snapshots` explicit delete by counting rows before and after — the same rigour is simply
  absent for Outputs.

**Required:** one test that removes a root carrying **both** a root-bound Output (`root_id` set,
`node_step_id` NULL) and a step-bound Output on a step in that root's lane, and asserts
(a) `removedOutputCount shouldEqual 2`, and (b) `SELECT COUNT(*) FROM outputs WHERE id IN (...)` is
0 afterwards, while an Output on the surviving root's lane is untouched. The last clause matters: it
is what distinguishes "the cascade fired" from "the cascade fired too widely".

---

### Non-blocking notes

1. **`PipelineRepository.summaryQuery:183-188` inner-joins `root.position === 0`.** If a pipeline
   ever lacked a position-0 root, it would vanish from every list-summaries result **silently**
   rather than erroring. R7's compaction plus `UNIQUE (pipeline_id, position)` makes that
   unreachable today, but an inner join is a fail-silent shape on a fail-loud invariant. A
   `sortBy(position).take(1)`-style resolution, or a note stating the dependency, would remove the
   trap.

2. **Schema-drift baseline is silently lowest-root-only, and the fact lives in the wrong file.**
   `PipelineRunService:1161` captures `last_source_schema` from `roots.head._2` and
   `PipelineAnalyzeResponse.sourceSchemaDrift` is scoped to the same root. This is deliberate and
   documented — but only in `PipelineAnalyzeProtocol.scala:192-196`. HEL-914 plans from `design.md`,
   which never mentions it. One sentence in R9 or R10 ("drift monitoring remains lowest-root-only;
   per-root drift is out of scope") closes the gap.

3. **`AnalyzeStepResponse` carries no `rootId`, while every `PipelineStepResponse` does.** R4's
   table asserts "every step response carries `rootId`" without qualification. No spec delta
   requires it on analyze (I checked `specs/pipeline-analyze-api/spec.md`) so this is not an unmet
   SHALL — but R4 is the artefact HEL-914 plans from, and as written it over-promises. Either
   narrow R4's wording to the `PipelineStepResponse` family or name the analyze exception.

4. **`rootId: Option[String] = None` remains on all 24 `*StepResponse` case classes**
   (`PipelineStepProtocol.scala:45-140`), with a docstring at `:37-41` justifying it as needed "so
   every pre-existing construction site keeps compiling". I checked: `fromDomain` is the sole
   constructor of all 24, so there are no such sites and the default is dead. Harmless, but it is
   the trust-me form of claim that evaluation-2 already had to correct once on
   `firstRootIdAction` — and R4's table explicitly conditions task 7.6a's closure on "the default is
   removed". Either remove the defaults or correct the justification to say the default is
   vestigial.

---

### Advice on the known open item (the 9.7 cluster) — my own read

**Move both deltas to HEL-914. Do not implement here, and above all do not archive them as-is.**

- Implementing here is the scope drift, not the deferral. `ticket.md`'s *Out of scope* names "MCP
  proposals/grounding for branching — HEL-914" explicitly, and the ticket's Scope section never
  mentions proposals. Both deltas' subject — `PipelineProposal` carrying `roots[]` — is HEL-914's
  own deliverable. Pulling it in means ~9 correlated sites plus `AssistantProposalToolSchemas`
  strict-parity churn landing in an already 33-commit change, five design rounds and two evaluation
  cycles deep. That is where late-added surface produces the fourteenth defect.
- The runtime is coherent without it, and I checked rather than took the prior read: a proposal
  yields a well-formed one-root pipeline that `add_root` extends. No user-visible defect is being
  carried.
- The cost is entirely in archiving. This repo has now been bitten three times by a merged SHALL
  nothing implements — R11 exists *because* `pipeline-run-execution` was one, and this change spent
  real scope making that spec true rather than editing it down. Archiving two more of the same shape
  would be this change contradicting its own thesis in the same merge.
- Moving is two file moves and zero code, and it leaves HEL-914 planning from a spec that is true.

Note the boundary this advice draws, because CR1 sits on the wrong side of it: the *patch-set*
delta was retained and implemented in this change, so its remaining gap is unfinished work here, not
deferrable scope. The proposal deltas are the opposite.
