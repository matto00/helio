## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of 34 commits (`a45e9881..a8897135`). Every conclusion below is derived from the files,
the diff, gates I ran myself, and one live SQL probe against the migrated database.

### What I verified (with evidence)

**Process hygiene.** A stale backend (PID 858891) was holding `:9252` and a stale `sbt test` (PID
335159) from a prior session was still running; both killed and both ports confirmed free *before*
`start-servers.sh`, so nothing below was measured against stale code.

**Gates — all re-run by me in this worktree.**

| gate | result |
|---|---|
| `sbt -batch test` | **PASS** — `Tests: succeeded 3732, failed 0`, 245 suites, exit 0 (was 3729 in round 1; +3 new) |
| `npm run lint` / `typecheck` | PASS (exit 0) |
| `npm test` | PASS — 252 suites / 2590 tests |
| `check:schemas` / `check:openspec` / `check:spec-structure` / `check:repo-integrity` / `check:scala-quality` | PASS |
| `check:node-root-encoding` / `check:e2e-types` / `check:helio-mcp-types` | PASS |
| `assert-phase.sh servers` | `PASS servers` |
| Playwright (`DEV_PORT=6345 BACKEND_PORT=9252`) | **37 passed, 1 failed** — sole red is `hel910-pipeline-to-dashboard-flow.spec.ts:144` (`/pipelines/undefined`), the documented HEL-969 expected red |

**Round 1's two CRs landed as real changes, not prose.**

- **CR1** — `RefinementEditShape.scala:264-268` now describes `{ "name", "roots": [{ "sourceId" }] }`,
  states `roots` is a NON-EMPTY array with the `sourceId`-or-inline branches, and carries an explicit
  *"`sourceDataSourceId` is RETIRED and hard-rejected … never emit it"* warning. `CreateExample` is
  `private[services]` (`:250`). `RefinementEditShapeSpec:363-379` asserts the current field names are
  present, the retired required-shape phrase is absent, and — the load-bearing half — that
  `Description` actually *includes* `CreateExample`, so the assertion binds to the string the prompt
  really sends. I confirmed the two tests are inside the +3 of the 3732 count.
- **CR2** — `PipelineRootRoutesSpec:126` now passes `outputRepo = outputRepo`; the new test
  (`:281-325`) seeds a root-bound Output (`nodeStepId = None`, `explicitRootId = Some(root2.id)`),
  a real dashboard + panel placing it, asserts both rows exist, removes the root, asserts
  `removedOutputCount shouldEqual 1`, and then asserts both the `outputs` row and the `panels` row
  are gone. That is a genuine non-zero observation of the field plus the cascade, not a re-worded 0.

**The CR2 defect class — swept.** I enumerated all 24 `new PipelineService(...)` sites. The
`= null` optional-collaborator pattern is repo-wide, so the sweep is about which paths *fail closed*
when a collaborator is absent. `create` does (`PipelineService:312`, `InternalError`), and
`OutputService.resolveExplicitRootId:216` does (`rootId` supplied + null repo → named 400).
`removeRoot` does **not** — see Change Request 2. `OutputService.requireUnambiguousRootWhenNeither:190`
skips its guard on a null repo, but that degrade is documented at `:186-188` and cannot mis-target
(nothing to count against), so I am not raising it.

**Rule D (`design.md:645-673`)** does state the corrected *procedure*, not only the observation: "the
classification step must still touch **every site**, even if the report groups them into buckets for
readability afterward — grouping is a presentation choice made AFTER full individual classification,
never a substitute for it." It also names why the bucket was the wrong unit (a prompt literal no
mechanical guard scans). Adequate as a transferable rule.

**V98 — verified independently.** Five-table `NO FORCE` bracket at `:64-68` **including `pipelines`**
(the READ-only fail-silent trap); FORCE restored on all five at `:330-334`; `pipeline_roots` gets
ENABLE+FORCE at `:348-349`. Orphan disposal (`DELETE FROM node_snapshots` `:187`, `DELETE FROM
binary_refs` `:195`) precedes every new CHECK (`:201-214`) and every `RAISE EXCEPTION` guard
(`:284-310`). `FlywayNonSuperuserMigrationSpec`'s external comparison is intact and genuinely
external: `pipelineCountBeforeV98` read over `superDbPreV94` (`:213`), `rootCount` read over
`migratedDb` = `forDataSource(embeddedPostgres.getPostgresDatabase)` (the superuser datasource,
`:289`), with `rootCount shouldBe pipelineCountBeforeV98` **and** `> 0` (`:305-307`). That is the
real backstop, and it does not read through the RLS state V98's own guard is blind to.

**Acceptance criteria against the literal ticket wording.**
- **AC1** — met (V98 spec carries idempotency, byte-identical-untouched-row, both guard-fire proofs,
  bracket-removal mutation proof; real-dump coverage).
- **AC2** — **now fully met**, both clauses: multi-root join at `InProcessPipelineEngineTreeWalkSpec:323-393`,
  and the removal/placement half by the new CR2 test.
- **AC3** — met (`PipelineRootRoutesSpec` blank-id 400 / unowned 404 / non-owner 404).
- **AC4** — met; 13 deltas, all four checks green above.
- **AC5** — R1-R15 is sufficient for HEL-914 to plan from, and I re-checked R4's representation table
  against the shipped code rather than trusting it: `pipeline_steps.root_id` + the parentless CHECK
  (`V98:119-127`) true; `PipelineStepProtocol.fromDomain(step, rootIdOfStep)` has **no default** on
  the map parameter (`:232`) and is the sole constructor, true; domain case classes carry no
  `rootId`, true; `rootIdsOf` fetched at the boundary and threaded, true. **However R1 — the very
  first requirement HEL-914 plans against — is factually false of the shipped system; see Change
  Request 1.** AC5 is therefore not clean.

**Single-root parity (R10 / task 5.5a).** No regression. `roots.head` survives only at the four sites
R3's named tiebreaks permit (`InProcessExecutionBackend:42`, `InProcessPipelineEngine:478`,
`PipelineRunService`, `SparkJobSubmitter:140`). 3732 backend tests and 37 green Playwright specs are
all single-root.

**The fifteenth instance — found, and it is not doc rot.** It hides in none of the eight places the
brief listed: it is a **foreign key whose `ON DELETE CASCADE` silently changed scope** from "the
pipeline" to "one root row". Change Request 1.

---

### Verdict: REFUTE

---

### Change Requests

**1. Deleting a `DataSource` now leaves a rootless orphan pipeline — R1 ("a pipeline with zero roots
is not a representable state") is false in the shipped system, and this is a silent behaviour
regression against pre-V98.**

Ground truth, measured — not reasoned. `V22__pipelines.sql:4` had
`source_data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE`, so deleting a
source deleted **the pipeline row itself**. `V98:320` drops that column, and `V98:81` re-homes the
cascade one level down:

```sql
data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE
```

Confirmed against the live migrated database (`pg_constraint.confdeltype = 'c'` on
`pipeline_roots_data_source_id_fkey`), and reproduced end-to-end in a rolled-back transaction on real
data:

```
pipelines_before=1  roots_before=1  outputs_before=1
DELETE 1                                   -- DELETE FROM data_sources WHERE id = <that root's source>
pipelines_after=1   roots_after=0   outputs_after=0   steps_after=0
```

The pipeline row **survives with zero roots, zero steps, zero Outputs.**

- `DataSourceService.delete:550-569` has no in-use guard of any kind, and there is no trigger on
  `data_sources`. `DELETE /api/data-sources/:id` is an ordinary shipped route.
- This is exactly a fifteenth root-ambiguity instance: the database decides *which* roots vanish (all
  of them, transitively) with no service-layer say, and R7's placement-count warning — the whole
  point of `RemovePipelineRootResponse` — never fires. Panels are deleted out from under dashboards
  via `panels.output_id → outputs(id)` with no report, which is the precise hazard R7 phase 2 exists
  to prevent.
- `removeRoot`'s "Cannot remove the last root of a pipeline" guard (`PipelineService:838`) is fully
  bypassed by this path.
- The resulting state is one the new code states cannot exist:
  `PipelineRepository.findPrimaryDataSourceIdInternal:105-111` — *"Every pipeline has at least one
  root … so `None` here means the pipeline itself does not exist, not 'no source'"* — is now wrong,
  and the run path turns it into a permanent `422 DataSource not found for pipeline`.
- It also makes round-1 non-blocking note 1 **reachable**, contradicting the reasoning that dismissed
  it. `PipelineRepository.summaryQuery:183-188` inner-joins `root.position === 0`; a partial cascade
  (multi-root pipeline, position-0 root's source deleted, no compaction because no service code ran)
  makes the pipeline vanish **silently** from every list-summaries result while its row persists.
- `design.md:56-61` (R1) asserts this invariant is "enforced in the service layer and asserted by
  test". The service layer is not the only writer of `pipeline_roots`; the FK is, and no test covers
  it. HEL-914 plans against R1.

**Required:** (a) decide and implement the intended semantics for deleting a source that is a
pipeline root — either refuse the delete when the source is a root (`409`/named `400`, mirroring the
`removeRoot` last-root guard and reporting the placement count), or restore the pre-V98 semantics by
cascading the *pipeline* — and state the ruling in `design.md` R1/R7; (b) add a test that deletes a
source bound as a root and asserts the chosen outcome, including the partial case (a multi-root
pipeline losing its position-0 root) so the position-hole/list-invisibility path is covered; (c) if
the chosen answer leaves any window where a pipeline can hold zero roots, correct R1's wording rather
than shipping a requirement the system falsifies — this change's own thesis (R11) is that a merged
SHALL nothing enforces is the defect.

**2. `PipelineService:861-863` — `removeRoot` silently reports `removedOutputCount = 0` when
`outputRepo` is null, while the delete still cascades the Outputs away. This is the exact mechanism
that made round 1's CR2 vacuous, and the CR2 fix repaired the test wiring without removing it.**

```scala
val removedOutputsF: Future[Int] =
  if (outputRepo == null) Future.successful(0)
  else outputRepo.listByPipelineInternal(pipelineId).map(_.count { ... })
```

The sibling path in the same file fails closed for the same collaborator
(`PipelineService:312` → `InternalError("Output creation is unavailable (no OutputRepository configured)")`),
and `OutputService:216` fails closed for the same reason. Here the API instead returns a
**factually false report** — "0 Outputs removed" — while the root's Outputs and their panel
placements are genuinely destroyed by the FK cascade. Production wires the repo, so no live user
defect; the objection is that the fallback is precisely the "a fallback that never fires is untested
code that changes behaviour silently the day it does" shape `ticket.md`'s *No deprecation* section
bans, and leaving it in place means the next unwired fixture is back in a structurally-guaranteed-0
state with nothing to catch it.

**Required:** mirror `:312` — return `ServiceError.InternalError` when `outputRepo == null` on the
`removeRoot` path, and cover it (or, if a null repo must be tolerated here, say so in the method doc
with the same explicit degrade contract `OutputService:186-188` gives, and make the response
distinguish "no Outputs" from "not counted").

---

### Non-blocking notes

1. **`PipelineRunService.resolvePrimaryDataSourceInternal:224` is now dead** — the three run/preview/
   backfill call sites all use `resolveAllRootDataSourcesInternal`. Its docstring ("every
   run/preview/backfill call site in this class is still single-root in this stage") is stale and
   reads as a live claim about the shipped engine. Delete the method or correct the doc.
2. **`resolveAllRootDataSourcesInternal:237-242` silently drops a root whose `DataSource` cannot be
   resolved** (`collect { case (rootId, Some(ds)) => ... }`) while the caller comment at `:254-255`
   asserts "a run is atomic across roots (R9), never partial". Unreachable today *only* because of
   the same FK that CR1 is about — R9 is enforced by a foreign key, not by this code. A `size` check
   raising the named error would make the comment true of the code.
3. **`PipelineRepository.summaryQuery`'s docstring:177-182** ("preserved as-is at this task … the wire
   shape moves to `roots[]` in task 7.2, a later stage", "today's only case" = single root) is stale
   after tasks 7.2/7.3 landed; `PipelineSummary.sourceDataSourceId` now has no reader outside its own
   construction.
4. Round-1 non-blocking notes 2, 3 and 4 (drift-baseline lowest-root-only undocumented in `design.md`;
   `AnalyzeStepResponse` carrying no `rootId` while R4 says "every step response"; the 24 vestigial
   `rootId = None` defaults) were not addressed in `a8897135` and still stand.

### On the known open item (the 9.7 proposal-delta cluster)

Not treated as a defect, per instruction. For the record my independent read agrees with the three
prior ones: move `pipeline-proposal-contract` and `pipeline-proposal-apply` to HEL-914 and do not
archive them as-is — the runtime is coherent without them, and archiving a SHALL nothing implements is
the failure R11 was written to end.
