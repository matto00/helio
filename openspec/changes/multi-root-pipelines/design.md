## Context

P2.1 (HEL-911, merged as `a45e9881`) generalized the engine walk to a DAG with parallel lanes and lane-kind rejoin
inputs. Every lane still descends from a single root frame, because `pipelines.source_data_source_id` is one
`NOT NULL` FK (`V22__pipelines.sql:4`) and `Pipeline.sourceDataSourceId` is one field (`model.scala:735`).

This change replaces that with an ordered set of roots. **Section "Multi-root contract" below is a deliverable**, in the
same sense HEL-911's "Engine contract" was: HEL-914 is planned directly from it and must not have to re-derive anything.

### Ground truth established during planning

- **129 occurrences of the single-source assumption across 60 files** (main 51/12, test 76/44, migrations 2). The full
  enumeration is in `tasks.md` §1; it is keyed on the property "code that assumes a pipeline has exactly one source",
  not on the field name alone.
- The **engine never reads the field**. `PipelineRunService` resolves one `DataSource`
  (`findByIdInternal(pipeline.sourceDataSourceId)` at `PipelineRunService.scala:226`, `:333`, `:520`) and hands rows to
  `InProcessExecutionBackend.scala:25`, which calls `engine.loadRowsWithStats(...)` then `engine.executeTree(rows, ...)`.
  **Those three call sites are the entire one-source chokepoint for execution.**
- `TreeWalkResult.nodeOutcomes: Map[Option[String], NodeOutcome]` keys the virtual root as `None`
  (`InProcessPipelineEngine.scala:71-74`, `:340-347`). `Option[String]` admits exactly one root sentinel.
- `PipelineStepRepository.childrenOf(steps, None)` (`:738`) means "root-level", the predicate this change replaces.
  `executionOrder` (`:805`) treats `childrenOf(steps, None)` as *the* root child set.
- **The lane-path string of engine-contract item 11 is not implemented anywhere** — zero construction sites, zero tests,
  across `backend/src` and `frontend/src`. The only `"root"` literal in engine code is a comment
  (`InProcessPipelineEngine.scala:47`). This change therefore has a free hand: nothing to migrate, nothing asserting.
- `pipelines` and `pipeline_steps` both carry **ENABLE + FORCE** RLS (`V35__rls_owner_only_tables.sql:28-29`, `:60-70`),
  widened for sharing by `V39` via the `helio_can_access_pipeline(TEXT)` SECURITY DEFINER function (`V39:28`, `:81`).
- `FlywayNonSuperuserMigrationSpec` migrates to V93 as `helio_migration_test` (NOSUPERUSER NOBYPASSRLS), loads
  `hel904-real-dump.sql`, then migrates to latest. **Any migration above V93 is exercised by it for free**; asserting on
  it requires adding a pre-capture and post-assertion block.
- The real dump has **73 `pipelines` rows, all with a non-null `source_data_source_id`** — so the backfill gets 73 rows
  of real coverage automatically, and a NULL/orphan case must be *seeded* to be tested (as the spec already does for a
  synthetic legacy `join` row at `:171-176`).
- `check:schemas` (`scripts/check-schema-drift.mjs`) diffs **property-name sets** between each `schemas/**` title and the
  same-named Scala case class, and enforces **strict parity** with `AssistantProposalToolSchemas` (`KNOWN_PRE_EXISTING_DRIFT`
  is now empty). So the schema and the case class must change in the same commit, and the hand-rolled proposal tool
  schemas with them. `check:openspec` is **hygiene only** (stray files, archival, handoff files) — it validates no
  requirement content, and must not be cited as evidence that a contract is correct (lesson 4).

## Goals / Non-Goals

**Goals.** Replace the single source FK with an ordered root set. Associate root-level steps with a root. Start the walk
at one lane per root. Add root lifecycle (add/remove) across route + MCP. ACL every root. State the multi-root contract.
Supersede engine-contract item 11. Correct the now-false remodel-spec sentences.

**Non-Goals.** The editor (HEL-968). MCP proposals/grounding for branching (HEL-914). Connector root kinds (v0.9).
Implementing the multi-root walk on Spark (HEL-238) — the `PipelineExecutionBackend` contract must still compile.

---

# Multi-root contract

**This section is a deliverable.** HEL-914 is planned from it. Changing anything here after this ticket merges is a
contract change affecting that ticket.

### R1 — A pipeline has one or more roots; never zero

A pipeline owns an ordered, non-empty set of roots. Each root binds exactly one `DataSource`. A pipeline with zero roots
is not a representable state: the last remaining root cannot be removed (R7). This invariant is enforced in the service
layer and asserted by test; it is deliberately **not** expressed as a database constraint, because "at least one child
row" is not enforceable by a FK or CHECK without a trigger, and a trigger here would fire inside the V98 backfill.

### R2 — Root identity is an opaque id, not a position

A root is addressed by `pipeline_roots.id` — a generated opaque string id, like every other id in the model. **Position
is never an address.** This follows engine-contract item 11's own reasoning for choosing ids over names ("names are
mutable and non-unique"); positions are mutable in exactly the same way, because R7 compacts them.

### R3 — Root order is meaningful for determinism and presentation, never for semantics

`pipeline_roots.position` is a dense `0..n-1` ordering. It determines: the order roots are listed in API and MCP
responses, and the **topological tiebreak** between lanes that are not otherwise ordered — extending engine-contract
item 4's "sibling `position` ascending" rule upward to the root level. It carries **no semantic weight**: no root is
"primary", and **no semantic behaviour may branch on `position == 0`** — no root's data is treated differently, no
root's lane is privileged, no ACL or lifecycle rule reads position. This is the root-level restatement of item 2
("trunk is not an engine concept"), and it is what keeps `roots[0]` from silently becoming the old single source.

**Three deterministic tiebreaks do read position, and they are named here so the rule is true rather than aspirational**
(round-1 skeptic CR3 — an earlier draft stated an unqualified "no behaviour SHALL branch on a root's position" while
R10 branched on it, which would have merged a spec this design violates):

1. the order roots are listed in responses (R3 itself);
2. the canonical node path for a node reachable from several roots (R5);
3. `TreeWalkResult.rows` and the trunk-terminal agreement (R10).

Each is a *tiebreak among otherwise-unordered alternatives*, chosen to make output deterministic — none of them gives
root 0 different data, different permissions, or a different lifecycle. That distinction is the whole of the rule: a
tiebreak is not a privilege. Any *fourth* reader of position is a contract change, not an implementation detail.

### R4 — Node keying: a root sentinel per root

`Option[String]` keying (`None` = the one virtual root) is replaced by a sealed key:

```scala
sealed trait NodeKey
final case class RootKey(rootId: String) extends NodeKey
final case class StepKey(stepId: String) extends NodeKey
```

`TreeWalkResult.nodeOutcomes` becomes `Map[NodeKey, NodeOutcome]`. Every root's loaded frame is seeded as
`RootKey(rootId)` before the walk. **This supersedes engine-contract item 8's `Option[String]` / `Some(stepId)` keying**;
item 8's substance — that *every* node's post-evaluation frame is retained for the whole run, not only materialized or
terminal nodes — is unchanged and remains load-bearing for lane rejoins.

**How a step's root membership is REPRESENTED — the shipped shape, ruled at the Stage-2 gate.** This is stated
because HEL-914 plans against it, and a contract describing the *intended* model rather than the *shipped* one is the
exact failure this epic keeps producing:

| layer | carries root membership? |
|---|---|
| **Database** | **Yes** — `pipeline_steps.root_id`, with `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` |
| **Wire / protocol** | **Yes** — every step response carries `rootId` (task 7.6a). **This is the load-bearing half of the substitution's justification: it must be true on EVERY step-response path before delivery, not just the listSteps/reorder ones.** A `fromDomain` call site left on the `rootId = None` zero-arg default emits a response claiming the step has no root — which is the same default-argument encoding (sweep C7/C59) this change bans elsewhere, resurfacing on the wire. Task 7.6a is not closed until every call site passes it and the default is removed. |
| **Scala domain case classes** | **No** — the 24 op case classes do NOT carry a `rootId` field |
| **Resolution in code** | `PipelineStepRepository.rootIdsOf(pipelineId): Map[PipelineStepId, PipelineRootId]`, fetched once at the service boundary and **threaded as an explicit parameter** into `executeTree`, `childrenOfRoot`, `trunkOfRoot` |

So **"each step knows its root" is TRUE at both boundaries HEL-914 touches** — persistence and wire. The absence of a
domain-object field is an internal representation choice, not a contract difference: `childrenOfRoot`/`trunkOfRoot`
are pure functions receiving the map as an argument, so no pure code needs a repository call, and
`PipelineExecutionBackend` takes `roots: Vector[(String, DataSource)]` with `onNodeProgress` keyed by `NodeKey`, so
even the Spark path is root-aware at the contract level (it uses `roots.head` only; the real multi-root Spark walk
stays HEL-238's). Fetch-once-and-thread also avoids the N round-trips a lazily-resolved field would invite.

A root-level step (`parent_step_id IS NULL`) reads the frame of `RootKey(its root_id)`. `childrenOf(steps, None)` is
replaced by `childrenOf(steps, RootKey(rootId))`; "root-level" stops meaning "parent is null" and starts meaning
"attached to root R".

### R5 — Node-path format, and why it does NOT conflict with HEL-914's `roots[1] › steps[3]`

**These are two different addresses of two different objects. Both are correct. Neither replaces the other.** Reading
them as competing formats is the mistake this clause exists to prevent.

| | **Request address** | **Runtime graph path** |
|---|---|---|
| Names | a position in an inbound request body | a node in the persisted graph |
| Format | `roots[1] › steps[3]` | `root:<rootId> > <stepId> > <stepId>` |
| Used by | validation errors on `POST /api/pipelines` / `create_pipeline`, before anything is persisted | run-time failure reporting, per-node counts, analyze |
| Why indices | at validation time the steps have `clientId`s, not ids; the only stable address is the array slot the caller sent | ids are the only stable address once persisted |
| Owner | **HEL-914** (its AC states it verbatim) | **this change** (supersedes item 11) |

**HEL-914's acceptance criteria need no editing.** Its `roots[1] › steps[3]` is a request-body address for validation
errors, which is exactly the right shape for that job and is unaffected by anything here. This change defines only the
runtime path.

**The runtime path**, superseding engine-contract item 11: the ordered list of ids from the originating root to the
target step inclusive, joined by `" > "`, with the root rendered as `root:<rootId>`. Example:
`root:r_7a2f > s1 > s4 > s7`. Ids, not names — the editor may substitute display names at render time. Item 11's
single-root rendering (the bare literal `root`) is **dead**: under multi-root a bare `root` is ambiguous, and since the
sweep found zero implementations and zero assertions, nothing is being migrated — the format is simply defined here for
the first time in code.

**A node reachable from several roots** (a rejoin consuming lanes from two roots) has more than one path to it. Its
canonical path is the one through the **lowest-positioned** originating root, so the rendering is deterministic; the
tiebreak is R3's ordering, applied to the same purpose it already serves.

### R6 — Adding a root

`POST /api/pipelines/:id/roots` and the `add_root` MCP tool append a root at `position = n`. The body is either an
existing `sourceId` or an inline source spec, matching the `roots[]` element shape used at create time — one shape, not
two. The new root's source is ACL-checked exactly as at create (R8). A new root starts with no steps: it is an empty
lane until steps are attached to it.

### R7 — Removing a root, and what happens to node paths

`DELETE /api/pipelines/:id/roots/:rootId` and `remove_root`. **The whole removal is one transaction, and every refusal
check is evaluated before any delete** (round-1 skeptic CR7 — an earlier draft numbered the surviving-lane check
*after* the deletes, which read as an order of operations in which the deletes happen first):

**Phase 1 — refuse, before touching anything.**

1. **Refuse to remove the last root** with a named error, not a 500 and not a silent no-op (R1).
2. **Refuse when a surviving lane references a node that would be deleted** via a `{kind:"lane", stepId}` secondary
   input, with a named error identifying the referencing step. Cascading instead would leave a surviving rejoin
   silently reading a deleted node — the same silent-corruption class this batch has repeatedly found. Engine-contract
   item 6a makes same-pipeline membership a security boundary, and item 10's ACL reasoning rests on that invariant
   holding, so a dangling lane reference left behind by a root removal is not merely untidy.

**Phase 2 — report, then delete, atomically.**

3. Report the placement count of the Outputs about to be deleted, exactly as step deletion already does
   (remodel decision 9).
4. Delete every step whose lane originates at that root — its root-level steps and their transitive descendants —
   together with those steps' Outputs and the Outputs' panel placements, and any Outputs/`node_snapshots` bound to
   the root itself (R12).
5. **Compact the remaining positions** to `0..n-2`. Safe precisely because of R2 — nothing addresses a root by
   position — and it keeps `roots[i]` in a response a faithful mirror of `position`.

`panels.output_id` is `ON DELETE CASCADE` (`V94:344`), so a **database-level** root delete would cascade
root → outputs → panels and remove placements without ever producing phase 2's placement report. The service path
above reports first, so this is a hazard only if a root is ever deleted outside it — which is a reason to keep root
deletion service-owned, not to rely on the cascade.

**Node paths through the removed root cease to exist**, because their nodes cease to exist. No path is rewritten,
renumbered, or left dangling. Paths through surviving roots are **unaffected**, because R2 makes them id-based: this is
the concrete payoff of choosing ids over positions.

### R8 — ACL: every root, at write time

Every root's `data_source_id` must resolve through `dataSourceRepo.findByIdOwned(...)` for the caller; an unreadable or
non-existent source is a **404**, per root, at create time and at `add_root`. This generalizes the HEL-384 cross-tenant
rule from the union second source to roots. At run time, roots resolve through `findByIdInternal` (the pipeline's own
ACL is authoritative), unchanged from today's single-source behavior.

**The HEL-950 empty-seed-id guard does NOT extend to roots, and must not be "generalized" to them.** That guard exists
because a `secondaryInput` with an empty `dataSourceId` is a legitimate in-progress draft of a *step*
(`PipelineStepConfigCodec.scala:103-116`). A root is not a draft: a pipeline with a root bound to nothing has no frame
to walk from, so an empty/blank root source is a hard **400** at write time, exactly as `PipelineService.scala:113`
already treats an empty `sourceDataSourceId`. The HEL-620 defect class is avoided by never defaulting an unset id into a
lookup, not by tolerating one.

### R9 — Run atomicity and freshness stay per pipeline

One run loads every root's source and refreshes every Output, atomically — scheduling and freshness remain per pipeline,
never per root. A failure loading any root's source fails the whole run, naming the failing root's path (R5). There is
no partial-root run and no per-root schedule.

### R10 — `TreeWalkResult.rows`, and the trunk-terminal agreement it must not break

`TreeWalkResult.rows` is **not** an incidental legacy field, and an earlier draft of this document wrongly called it
"consumed once ... explicitly transitional" (round-1 skeptic CR2). `InProcessPipelineEngine.scala:374-390` records an
explicit agreement HEL-911 had to restore after a cycle-2 defect: `rows` **must** be the frame of the same node that
`stepRepo.trunkOf(steps).lastOption` identifies, because **five** call sites depend on that identity — the SSE row
count, `pipelines.last_run_row_count`, `pipeline_runs.row_count`, and, critically,
`binaryRefRepo.overwriteForNode` keyed by `trunkOf(steps).lastOption` (`PipelineRunService.scala:929`). The comment
states the failure mode in terms: *"or binary refs get keyed to one node and extracted from another."*

`trunkOf` (`PipelineStepRepository.scala:727`) is rooted in `childrenOf(steps, None)` and therefore becomes **ambiguous**
under multi-root — the same ambiguity R4 resolves for node keys, in a function the planning sweep missed.

**The rule.** `trunkOf` and `tailsOf` become root-scoped: `trunkOf(steps, rootId)` walks the trunk of one root's lane.
`TreeWalkResult.rows` is the terminal frame of the **lowest-positioned root's** trunk (R3 tiebreak 3), and
`rows`, `trunkOf(...).lastOption`, and the binary-ref key **must all be derived from the same root and the same node**.

**This is a required test, not an expectation:** a test that would fail if `rows` and the binary-ref key ever diverge —
i.e. one that constructs a two-root pipeline where the naive implementations disagree and asserts they do not. A test
merely asserting the run succeeded would not catch the divergence (lesson 8: assert what it produced, not that it
succeeded).

Single-root parity is byte-identical to today, and that parity is likewise a required test (as engine-contract item 4
already requires for walk order).

### R11 — The lane path is emitted, not merely specified (accepted scope addition)

**A merged canonical spec asserts a SHALL that nothing implements.** `openspec/specs/pipeline-run-execution/spec.md:9`
requires the run error to identify the lane path in a stated format, and lines 17/21 repeat it as scenario outcomes;
HEL-911's archived `tasks.md:57` records it as done. The planning sweep independently confirmed zero construction sites
and zero assertions anywhere in `backend/src` or `frontend/src`. This change makes the spec true by implementing it,
rather than editing the spec down to match the code.

**Sizing (measured, not assumed) — it is small, and the reason matters.** The spec requires the *reported error* to
identify the path, and `StepExecutionException`'s own `getMessage` is already what reaches the client: it is forwarded
verbatim at exactly three sites (`PipelineRunService.scala:361`, `:443`, `:715`), and the class is thrown from exactly
one site (`InProcessPipelineEngine.scala:212`), where the walk already holds the full step vector. So the path can be
composed into the existing message. **No new wire field, no run-status protocol change, no SSE payload change, and no
frontend contract change** — which is precisely the ripple that would have made this unbounded. The work is: one field
plus message composition on `StepExecutionException` (`:25-37`), one path-builder over the parent chain, and one call at
the single throw site. The builder is nearly free here because R4 already replaces node keying in this change — the
ancestor walk it needs is the same traversal.

**Format.** The path is R5's runtime graph path, `root:<rootId> > s1 > s4`, not the spec's current single-root literal
`root`. `pipeline-run-execution` is therefore corrected to the multi-root format as part of this change. That correction
would be required **even if the implementation were deferred**: a SHALL asserting a format nothing produces is a false
merged spec, which is the defect class this batch has been finding all day.

**Not in scope: the frontend consumer.** HEL-912 is deferring the failure highlight. This change emits the field;
rendering it is a later editor ticket. `frontend/src/features/pipelines/state/pipelinesSlice.ts:82` flattening
`runError` to a string is context, not a file this change touches.

### R12 — The NULL-means-root encoding, swept

**Round 1 found this; round 2 found that the fix was a rule about two tables rather than a sweep of the encoding, and
that the fix's own encoding reintroduced the bug it existed to prevent.** Both corrections are folded in here. This
clause is the *executed* form of this document's own closing lesson — the lesson was stated, then not carried out.

**The encoding.** Three tables mark "bound to the pipeline's raw root" as `node_step_id IS NULL`:

| table | column | encoding stated at | RLS |
|---|---|---|---|
| `outputs` | `node_step_id TEXT NULL` | `V94:200`, `:209` | FORCE (`V94:1329`) |
| `node_snapshots` | `node_step_id TEXT NULL` | `V94:281` | FORCE (`V94:1330`) |
| `binary_refs` | `node_step_id TEXT NULL` | `V94:425-427`, `BinaryRefRepository.scala:28` | FORCE (`V46:34`) |

`PipelineRunService.scala:891` intersects `outputsByNode` (keyed `_.node.stepId.map(_.value)`) with
`nodeOutcomes.keySet`, so a root-bound Output keys `None` and today matches the engine's `None` root frame. **R4
deletes `None` from the key space**, so without this clause every root-bound Output silently stops refreshing while
HEL-910's public rows route keeps serving its stale snapshot — silent, unbounded, user-visible only as data that
quietly stops updating.

**The rule — and the predicate this change bans.** Each of the three tables gains a nullable `root_id`, with
`CHECK ((node_step_id IS NULL) <> (root_id IS NULL))` — exactly one is set.

**The FK is NOT uniform across the three tables, and the asymmetry is load-bearing** (round-3 skeptic CR1; an earlier
draft answered uniformly, citing `V94:279`'s "no FK" line without engaging with the *reason* at `V94:261-280`):

| table | `root_id` | why |
|---|---|---|
| `outputs` | `TEXT NULL REFERENCES pipeline_roots(id) ON DELETE CASCADE` | no identity column, so the landmine below does not apply — it already carries a real FK |
| `binary_refs` | `TEXT NULL REFERENCES pipeline_roots(id) ON DELETE CASCADE` | same |
| `node_snapshots` | **bare `TEXT NULL`, no FK** | see below |

`V94:261-280` records, as an **empirical finding of that cycle**, that `node_snapshots` is deliberately FK-free: it has
a `BIGSERIAL` identity column, and `TRUNCATE ... RESTART IDENTITY CASCADE` transitively cascades through any
FK-reachable table and then requires **ownership** of that table's identity sequence — a privilege
`helio_privileged`'s GRANT-based setup does not have and cannot obtain via GRANT. Twelve specs run that TRUNCATE,
three of them against `users` (`BetaAccessRoutesSpec:112`, `ApiRoutesSpec:104`,
`AuditMutationInstrumentationSpec:135`) — precisely the case V94 names. A `root_id` FK would make `node_snapshots`
FK-reachable from `pipeline_roots → pipelines → users` and break all of them.

So for `node_snapshots`, referential integrity stays the application's job — exactly as `pipeline_id` already is
there — and **R7 phase 2 must delete its root-bound snapshot rows explicitly**, not rely on a cascade that will not
exist. This asymmetry is stated here and in the V98 header because the obvious tidy-up is to "fix" the inconsistency
by adding the FK back.

`ON DELETE CASCADE` on the other two makes R7 phase 2 partly automatic there and makes the CHECK a genuine invariant.

**`node_step_id IS NULL` as a standalone predicate is banned.** It is the whole defect: under multi-root it silently
means "every root", not "the root". Every read and write keys on the resolved `NodeKey` — `StepKey(node_step_id)` or
`RootKey(root_id)` — so the `:891` intersect keeps working *by construction* rather than by a NULL-matches-NULL
coincidence. A mechanical guard (a repo-integrity style grep over `backend/src/main`) must fail the build on a
surviving `node_step_id IS NULL` predicate in these three tables' queries; a rule this easy to reintroduce and this
silent when reintroduced needs an enforcer, not a convention.

**Two sites where the naive fix actively destroys data across roots** (round-2 skeptic; both verified):

1. `idx_node_snapshots_root_unique` (`V94:294-296`) is `UNIQUE (pipeline_id, row_index) WHERE node_step_id IS NULL`.
   Under multi-root, root A row 0 and root B row 0 both satisfy the predicate with the same key and **violate the
   index**. V98 drops it and recreates it as `UNIQUE (pipeline_id, root_id, row_index) WHERE node_step_id IS NULL`.
   Note the index's own V94 comment explains it exists *because* plain UNIQUE treats NULLs as distinct — the same
   reasoning now applies one level down, to roots.
2. `NodeSnapshotRepository.overwriteRows` (`:38-51`) deletes
   `WHERE pipeline_id = ... AND node_step_id IS NULL` before inserting, and
   `BinaryRefRepository.overwriteForNode` (`:42-52`) does the identical thing. **Whichever root writes second wipes
   the other root's rows** — the exact stale-dashboard vector this clause exists to close, reintroduced by the clause's
   own first draft. Both take a `NodeKey` and scope the delete to one root.

**The enumerated surface.** Listed by *encoding*, not by field name, because that is what the name-keyed sweep could
not see. Every site carries `root_id`/`NodeKey` through, or is justified in writing:

- `NodeSnapshotRepository.scala:38-51` (`overwriteRows`), `:58-74`, `:101-107` (`fetchRows`)
- `BinaryRefRepository.scala:42-52` (`overwriteForNode`), `:63-86` (`findByNode`, `findByNodeAndRow`, `selectQuery`)
- `OutputRepository.scala:63-66` (`listByNodeInternal` — `nodeStepId.isEmpty` returns *every* root's Outputs),
  `:160-190` (`insertInternal`), `:275`, `:290`, `:301` (`OutputRow` / `*` projection)
- `OutputService.scala:88-94` (`listByPipeline`), `:138` (`create`) — **and `CreateOutputRequest`**, which today has no
  way to express a root-bound Output; once the CHECK lands, every such create fails without it
- `OutputRoutes.scala:36-37` (`nodeStepId` query parameter), `OutputProtocol.scala:26`, `:40`, `:95`
- `model.scala:827-835` (`NodeRef.nodeStepId: Option[String]`, whose `:830` comment states the NULL encoding)
- `PipelineProposalProtocol.scala:126` (`ProposalOutputSummary`), `DemoData.scala:56`
- `PipelineRunService.scala:891` (the intersect), `:929` (the binary-ref key — see R10)
- the Output-related files under `schemas/` (§8 listed three schemas and none was an Output schema)

**Unrebindable rows must be disposed of before the CHECK, or the migration aborts on real production data**
(round-3 skeptic CR2). Two populations cannot be rebound, and neither is hypothetical:

- **`node_snapshots` orphans.** The table has no FK to `pipelines` and **nothing deletes its rows when a pipeline is
  deleted** — the only two DELETE sites in the codebase are inside `NodeSnapshotRepository.overwriteRows:41,43`, both
  scoped to one live pipeline. Every deleted pipeline that ever held a root-bound (zero-step) snapshot left rows whose
  `pipeline_id` matches no `pipelines` row, hence no `pipeline_roots` row.
- **`binary_refs` never-rekeyed rows.** `V94:793-797` backfilled `pipeline_id`/`node_step_id` only for refs whose
  `data_type_id` had an owning pipeline; V94's own section 10 records 77 `data_types` rows with none. Those refs kept
  `pipeline_id IS NULL AND node_step_id IS NULL` and were never deleted.

Both would leave `root_id` NULL, fail the new CHECK, and **abort the deploy**. That is loud rather than silent — better
than the R12 class of bug — but the obvious under-pressure "fix" is to relax or drop the CHECK, which reopens exactly
the hole R12 exists to close. So V98 **deletes them as orphans before adding the CHECK**, with the count of each
population logged in the `hel913_migration_counts` style V94 section 10 already established. The counts must be
**measured against the real dump and recorded, not assumed zero** — "the real dump has none" is precisely the
assumption task 3.6 already had to make explicit for the source-id case.

**V98 therefore brackets FIVE tables** — `pipelines` (read), `pipeline_steps`, `outputs`, `node_snapshots`,
`binary_refs` (written) — rebinds every NULL-`node_step_id` row in the last three to its pipeline's new root, and
recreates the partial index. Same four proof obligations as the root backfill, against the real dump.

### R13 — How a step names its root at create time

**Without this, HEL-914 cannot be planned and this ticket's own contract AC fails** (round-1 skeptic CR4): the create
API spec asserts "one root-level step naming each root" while nothing defined the mechanism, and at create time root
ids do not exist yet — the same problem R5 solves for error addresses and left unsolved for step binding.

**Each element of `roots[]` carries a `clientId`**, exactly mirroring the `clientId` convention `steps[]` already uses
for `parentStepId` resolution. A step with no `parentStepId` carries `rootClientId` naming one of them. Resolution is
the same single left-to-right fold that already resolves `parentStepId` (`PipelineService.scala:252`), so this adds a
second key to an existing map rather than a second mechanism — and inherits, unchanged, the existing rule that a
reference must name an element appearing earlier in the same request (engine-contract item 6b).

Rules: a `rootClientId` naming no element of `roots[]` is a named `BadRequest`; a step with neither `parentStepId` nor
`rootClientId` is a named `BadRequest` (**not** a silent default to `roots[0]` — defaulting is how HEL-620 happened, and
under R3 root 0 has no claim to be the default); a step with **both** is a named `BadRequest`.

On the incremental path, `POST /api/pipelines/:id/steps` carries `rootId` (a real id, since roots exist by then) under
the same three rules.

### R14 — The request-address format this change emits

R5 assigns the request address `roots[1] › steps[3]` to HEL-914, but **this change ships multi-root create validation
first** (per-root 404/400, R13's three BadRequests), so it needs the format now or HEL-914 will retrofit a second one
(round-1 skeptic, Q2 gap). This change **emits that same format**, from this ticket onward: `roots[<i>]` and
`steps[<i>]` addressing the request arrays, joined by `" › "` (U+203A) when a path has more than one segment.
HEL-914 inherits it rather than defining it.

### R15 — What the root's node key serializes to on the wire

R4's `NodeKey` is not purely internal: it crosses the `PipelineExecutionBackend` trait
(`PipelineExecutionBackend.scala:31`, `:50`), `PipelineExecutionOutcome`, the `onNodeProgress` SSE callback
(`PipelineRunService.scala:692`), and `SparkJobSubmitter.scala:130`. `tasks.md` reducing this to "must still compile"
was too weak (round-1 skeptic Q6).

On every wire surface that today emits a node id with `null` for the root, a **root node serializes as its root id**,
and responses carry an explicit discriminator rather than relying on "null means root". SSE per-node progress therefore
reports a concrete id for every node including roots, and a consumer can no longer conflate "the root" with "unknown
node". This is the same substitution R12 makes in the database, applied to the wire, so the two cannot drift.

---

## Migration V98

### The failure mode this migration is designed against

**Reading `pipelines` as the Flyway role returns zero rows unless RLS is bracketed.** `pipelines` is FORCE RLS. The
mechanism matters and an earlier draft of this document got it wrong (round-1 skeptic): it is **not** V35's
`pipelines_owner` policy — `V39__pipeline_sharing_grants.sql:78-83` **dropped** that and replaced SELECT with
`USING (helio_can_access_pipeline(id))`, and that function (`V39:38-45`) reads
`current_setting('app.current_user_id', true)` with `missing_ok = true` and **`RETURN FALSE`** when it is NULL or empty.
So the read returns **zero rows, silently**. V35's form (`current_setting(...)` with no `missing_ok`) would have
**raised** — loudly, and harmlessly. The dangerous behaviour exists precisely because V39 made the policy
sharing-aware and fail-closed. `pipeline_steps` still carries the V35 form (`V35:63`), so **it raises rather than
returning empty** — the two tables need the same bracket for two different reasons, and only one of them fails
silently. A backfill of the form
`INSERT INTO pipeline_roots SELECT id, source_data_source_id, 0 FROM pipelines` therefore **inserts nothing, succeeds,
and reports success** — after which the old column is dropped and every pipeline in production has lost its source.
Local dev, CI and prod-dump replay all connect as superuser and would show this migration as perfectly green. This is
the exact mechanism that broke v0.7.8/9/10, with a worse blast radius, and it is a **silent** failure: there is no error
to notice.

**This inverts the failure mode the RLS rule was learned from.** v0.7.8/9/10 failed *loudly* — the migration errored and
the deploy stopped. This one fails *silently* and succeeds, which is a strictly worse blast radius than the incident
that taught us the rule, and it would pass every check currently trusted.

**The generalization a future reader will get wrong** (and which V98's header must state in these terms): the danger is
on the **READ side of the backfill**, so the `NO FORCE` bracket must cover **every table the SELECT touches**, not only
the table being written. V94/V96/V97 all bracket the table they mutate, so the pattern *looks* like "bracket what you
write" — that reading is wrong here and would leave the trap fully armed. V98 brackets `pipelines` because it is
**read**, and `pipeline_steps` because it is **written**.

### Order of operations

1. `CREATE TABLE pipeline_roots (id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE
   CASCADE, data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE, position INTEGER NOT NULL,
   created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (pipeline_id, position))`, plus an index on `pipeline_id`.
2. `NO FORCE ROW LEVEL SECURITY` on **five** tables — `pipelines` (read), `pipeline_steps`, `outputs`,
   `node_snapshots`, `binary_refs` (written, per R12; FORCE per `V94:1329-1330` and `V46:34`). Copied from
   `V94:122-131`. Bracketing fewer would leave part of R12's rebind silently writing nothing — the same silent-empty
   failure this whole section is about, one level down.
3. Backfill one root per pipeline, `position = 0`, id generated deterministically from the pipeline id so a re-run
   cannot produce a second root. Guarded `WHERE NOT EXISTS (SELECT 1 FROM pipeline_roots r WHERE r.pipeline_id = p.id)`
   for idempotency.
4. `ALTER TABLE pipeline_steps ADD COLUMN root_id TEXT REFERENCES pipeline_roots(id) ON DELETE CASCADE;` then
   `UPDATE pipeline_steps SET root_id = (...) WHERE parent_step_id IS NULL AND root_id IS NULL`. After the backfill,
   add `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` — the invariant must be enforced by the database,
   not only by the one-shot `DO $$` guard (round-1 skeptic CR6). Without it, a later parentless step with a NULL
   `root_id` is invisible to `childrenOf(steps, RootKey(...))` and is **silently dropped from the walk**; the obvious
   way it lands is `POST /api/pipelines/:id/steps`.
4a. R12's rebind, on **all three** encoding tables: add `root_id` — a FK
   `REFERENCES pipeline_roots(id) ON DELETE CASCADE` on `outputs` and `binary_refs`, a **bare `TEXT NULL` on
   `node_snapshots`** (R12: an FK there breaks `TRUNCATE ... RESTART IDENTITY CASCADE` in twelve specs). Backfill it
   for every row whose `node_step_id IS NULL`. Then **delete the unrebindable orphan populations** (orphaned
   `node_snapshots` rows whose `pipeline_id` matches no pipeline; `binary_refs` rows with `pipeline_id IS NULL`),
   logging each count. Only then add `CHECK ((node_step_id IS NULL) <> (root_id IS NULL))` — added before the
   deletion it would abort on real production rows.
4b. Drop `idx_node_snapshots_root_unique` and recreate it as
   `UNIQUE (pipeline_id, root_id, row_index) WHERE node_step_id IS NULL` — without this, two roots' row 0 collide
   (R12).
5. **Assert the backfill actually moved rows** — and this assertion is itself exercised by a test that sees it fire
   (a guard never observed failing is the same species of non-evidence as everything else this batch has found). Before the destructive step: a `DO $$ ... RAISE EXCEPTION ... $$` block
   failing loudly if any pipeline has no root, or any `parent_step_id IS NULL` step has no `root_id`. This converts the
   silent-empty-read failure above into a hard migration failure. It is the single most important statement in V98.
6. `ALTER TABLE pipelines DROP COLUMN source_data_source_id;` (no deprecation — decision 11).
7. Restore `FORCE ROW LEVEL SECURITY` on **every table step 2 bracketed — all five**, enumerated explicitly:
   `pipelines`, `pipeline_steps`, `outputs`, `node_snapshots`, `binary_refs`. Copied from `V94:1309-1316`. An earlier
   draft said "both tables" after step 2 had already widened, which taken literally would have left `outputs`,
   `node_snapshots` and `binary_refs` **permanently `NO FORCE`** — a durable RLS weakening on three sharing-aware
   tables, shipped by a migration whose entire thesis is RLS care (round-2 skeptic).
8. `ALTER TABLE pipeline_roots ENABLE ROW LEVEL SECURITY; ... FORCE ROW LEVEL SECURITY;` with **per-command**
   policies. A single all-commands policy using the sharing-aware predicate would be a **privilege escalation**
   (round-1 skeptic CR5): Postgres reuses a permissive `USING` as the `WITH CHECK` for INSERT when none is given, so a
   grantee of a *shared* pipeline could add and remove that pipeline's roots — a write privilege they hold on neither
   `pipelines` nor `pipeline_steps`. V39 deliberately split these (`V39:78-95`): SELECT sharing-aware, INSERT/UPDATE/
   DELETE owner-only; `pipeline_steps` (`V35:63`) is owner-only for all commands. So:
   `FOR SELECT USING (helio_can_access_pipeline(pipeline_id))`, plus owner-only INSERT/UPDATE/DELETE in the V39 form.
   A test must assert a grantee can read but **cannot write** a root. Enabling RLS **after** the backfill avoids a
   further bracket.

### Proof obligations

Non-negotiable, and all four must be evidenced, not asserted:

1. **Full coverage** — count of pipelines before, count of `pipeline_roots` rows after: equal, and non-zero (73 from the
   real dump). Every `parent_step_id IS NULL` step has a non-null `root_id`.
2. **Idempotency** — re-running V98's DML is a no-op; root count unchanged.
3. **Byte-identical passthrough** — a row the migration must not touch (a non-root step) is byte-for-byte identical
   after, in the style of `FlywayNonSuperuserMigrationSpec:247-252` / `:363-368`.
4. **Non-superuser coverage** — carried by `FlywayNonSuperuserMigrationSpec` with a pre-capture and post-assertion block,
   `"pipeline_roots"` added to its `forceRlsTables` list. **A green local `sbt test` proves nothing here**; the
   non-superuser spec is the only gate that exercises the role Flyway actually runs as.

## Accepted end state: main is knowingly broken, for a bounded and owned window

**Decided by the product owner during the design gate (round-1 skeptic CR8), not absorbed silently.** 21 files under
`frontend/src` reference the scalar `sourceDataSourceId`; `CreatePipelineModal.tsx:90` and
`services/pipelineService.ts` **post** the shape this change makes a hard 400, and `PipelineDetailHeader.tsx:47`
resolves the source for display from it. `frontend/**` is off limits to this change (HEL-912 owns it in a parallel
run), and HEL-968 is blocked by both HEL-913 and HEL-912, so it cannot repair this promptly.

**Resolution: HEL-969** — a focused repair making the existing single-source create flow post a one-element `roots[]`,
blocked by HEL-913 **only**, explicitly not by HEL-912, so it can run the moment this lands. Between the two merges,
`main` carries a non-functional Create Pipeline flow. This is the same shape as remodel decision 17, which already
accepts a knowingly non-functional web app on `main` between P1.3 and P1.6 because deploys fire only on `v*` tags —
the difference being that this window is **owned and bounded** rather than unowned.

**Expected-red e2e specs during the window**, so the executor can tell "expected" from "I broke it" — a distinction
`check:e2e-types` cannot make, because a type-check does not run a browser:

- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` — drives the create UI.
- `e2e/hel813-mobile-touch-target-floor.spec.ts` — drives the create UI.
- (`e2e/hel908-full-flow.spec.ts` is a pre-existing quarantined flake, HEL-964, unrelated to this window.)

Any **other** e2e spec going red is this change's defect, not the window.

## What the design gate taught, in transferable form

**Four REFUTE rounds found 23 defects. Every one was an instance of exactly two meta-defects.** Recorded because the
pattern, not the individual findings, is what transfers:

**Meta-defect A — "root" is encoded in more ways than it is named.** A sweep keyed on a *name* cannot see an encoding.
The same "this means the root" concept appeared as: a scalar FK column (found by the name sweep), a **NULL** column in
three tables (round 1 + round 2, invisible to any grep for a field name), a **Slick lifted predicate**
`.nodeStepId.isEmpty` carrying no matching text at all (round 3), and an **absent optional field** in the TypeScript
MCP surface (round 4). Four encodings, one concept. Each round's fix was correct and each was too narrow, because it
was written against the encoding just found rather than against the concept.

**Meta-defect B — a fix landing in prose rather than in the binding artifact.** Twice, a correction was made in
`design.md` and the artifact that actually binds — a spec delta's SHALL (round 2), a task the executor works from
(round 4) — was left stating the old rule. `design.md` is not enforced by anything. The check that catches this is
mechanical: after revising a rule, grep the spec deltas and `tasks.md` for the old rule's text.

### Rule A — state the property as a MEANING, then ask how that meaning is encoded, before grepping anything

**A property stated as "which fields are named X" cannot see a property encoded as "what a NULL means here" — or as
what an absent field, an empty option, or a lifted predicate means.**

The procedure that follows from it, and the one this change should have used from the start:

1. State the property as the **meaning** you are looking for ("anything that means *no node* / *the pipeline's raw
   root*"), never as a name or a field list.
2. For **each language and surface** the system spans, ask *how could that meaning be encoded here?* — nullable
   column, partial index, sentinel, empty string, `Option`/`None`, a lifted predicate carrying no matching text, an
   absent optional field, an omitted key, a default argument, a `getOrElse` fallback.
3. Only then search, once per encoding. **Never start from a grep on a name.**
4. Report a **total count with the full list**, never a diff of the sites just fixed. A total is the only output that
   can show a class is *closed* rather than merely quieter — a diff always looks complete.

This epic has now taught this three times: HEL-911 stated the property as field names, this change stated it as field
names, and the same concept then turned up in four distinct encodings across four rounds.

**The concrete proof that a name-keyed sweep structurally cannot work here:** the concept "no node / the pipeline's
raw root" is carried by **four different spellings** — `node_step_id`, `parent_step_id`, `nodeStepClientId`,
`source_data_source_id` — and *no single name covers them*. There is no grep on an identifier that returns this set.
It is reachable only by asking, per surface, "how could this meaning be encoded here?" and searching once per
encoding. That method — not the resulting 102-site list — is the durable artifact: the list expires with the next
refactor, the method does not.

### Rule B — a rule that matters lands in a binding artifact, and a guard says what it does not cover

**`design.md` is enforced by nothing.** Any rule that matters must land in a spec delta, a task the executor works
from, or a mechanical check. After revising a rule, grep the spec deltas and `tasks.md` for the *old* rule's text —
this change twice left the old rule standing in the binding artifact while the prose was correct.

**Corollary, learned the hard way in this very change: a fold-in is itself a lossy step.** Four sites named in a
round-4 change request were silently dropped while folding that round's fixes in, and only a *total-count* sweep in
round 5 found them — a diff-shaped check would have shown the fold-in as complete. This is Rule A's "report a total,
never a diff" applied to one's own revision process.

**And a guard must cover every surface its rule spans, or say in its own header which surfaces it does not cover and
why.** A Scala-only guard enforcing a rule that spans SQL, Scala and TypeScript is *green-while-broken by
construction* — the same species of defect as a credential scan that reads the frontend while an MCP diff sails past,
or a spec CI never invokes. An honest narrow guard is fine. A narrow guard that reads as complete is not.



**A property stated as "which fields are named X" cannot see a property encoded as "what a NULL means here."**

The planning sweep was keyed on a property rather than a name list — "code that assumes a pipeline has exactly one
source" — and still missed R12 entirely, because the root binding for Outputs and snapshots is encoded as a **NULL**
(`node_step_id IS NULL` means "the root", `V94:200`), and no grep for a field name can see a NULL's meaning. This is
lesson 6 biting for the third time on this epic; HEL-911's sweep was stated as field names too. The sharper rule is the
sentence above: when a sweep is keyed on names, enumerate separately the **encodings** — nullable columns, sentinel
values, empty strings, absent keys — that carry the same meaning without carrying the name.

**Two tables need the same RLS bracket for opposite reasons, and a future reader will get this backwards.**
`pipelines` fails **silently** (V39's `helio_can_access_pipeline` returns FALSE on an unset setting → zero rows);
`pipeline_steps` fails **loudly** (it still carries V35's `current_setting(...)` form with no `missing_ok` → raises).
The dangerous one is the table that was made *sharing-aware and fail-closed* — i.e. the more carefully secured table is
the more dangerous one to migrate. Do not generalize "V39-style policy" and "V35-style policy" as interchangeable.


## Risks

- **The silent-empty-read above** is the dominant risk. Mitigated by step 5's hard assertion, which fails the deploy
  rather than corrupting it.
- **Scope breadth.** 129 sites is a large mechanical surface where a missed site compiles but misbehaves. Mitigated by
  keying the sweep on the property and re-running the full enumeration at evaluation, reporting a total count with the
  full list rather than a diff of sites just fixed (lesson 6).
- **`check:schemas` strictness.** Schema, Scala case class, and `AssistantProposalToolSchemas` must move together in one
  commit or the pre-commit gate fails. This is a feature, not an obstacle.
- **Parallel HEL-912.** Shares one dev Postgres; V98 will be applied to it. HEL-912's planned e2e spec
  (`e2e/hel912-lanes-rejoin.spec.ts`) will post the old scalar shape and must be updated by whichever change merges
  second. Flagged, not silently absorbed.
- **The frontend window.** See "Accepted end state" above — owned by HEL-969, bounded, with the expected-red specs
  named so a red e2e run is diagnosable rather than ambiguous.

### Rule C — proving a guard properly finds more than the guard does

**Twice on this change, forcing a guard to be proven against the SHIPPED artifact rather than a copy produced a
better finding than the guard itself was built to catch.**

1. The design gate's insistence that a mechanical guard declare its surface coverage exposed that a Scala-only guard
   was green-while-broken for a rule spanning four languages.
2. Task 3.5a — mutating V98's real `NO FORCE` bracket instead of asserting an inline copy of its predicate — proved
   that **V98's `RAISE EXCEPTION` guard is VACUOUS in the one scenario it exists to catch**. The guard's own
   `COUNT(*) FROM pipelines` is gated by the same RLS state the backfill's read was: with `pipelines` unbracketed it
   sees zero rows, computes "0 pipelines lack a root", and **reports success** having dropped the column. Not merely
   "the guard didn't fire" — *false confidence*, in the exact failure mode it was written for.

   The correction this forced: the guard converts every OTHER failure mode into a loud one (a coding error in the
   backfill's `WHERE`, a partial roll-forward), but **a missing bracket on a fail-silent table is the one shape it
   cannot self-detect by construction.** The real backstop is `FlywayNonSuperuserMigrationSpec`'s pre-migration count,
   captured over a **separate superuser connection** and therefore immune to the migration's RLS state. That external
   comparison — not the in-migration guard — is where "the bracket is necessary, not decorative" is actually proven
   for `pipelines`/`outputs`/`node_snapshots`/`binary_refs`. (`pipeline_steps` is exempt: its V35-form policy raises
   42704 before the guard runs, so it never reaches the vacuous-pass state.)

**An inline-copy test would have "proven" the guard works and left this invisible permanently.** The generalizable
rule: *a guard that reads through the same mechanism it is guarding cannot validate that mechanism.* Prove guards by
mutating the shipped artifact; if the only available proof reads through the thing under test, the guard is not the
backstop and something external must be.

### Rule D — a bucketed total is a diff wearing a total's clothes

**Reporting a total is necessary but not sufficient.** The final-gate skeptic (skeptic-final-1.md CR1) found the
fourteenth root-ambiguity instance — a live refinement-prompt string literal instructing the model to emit the
retired scalar `sourceDataSourceId` — sitting inside the executor's own §1.2 re-sweep the whole time. The re-sweep's
raw count (179 occurrences) genuinely included it. What hid it was the CLASSIFICATION step: the 65
`backend/src/main`+`src/test` occurrences were reported as one bucket ("mostly `PipelineRepository`'s
self-documented DTO retention"), and this one site rode along inside that aggregate judgement without ever being
individually named.

**A bucket summarised in aggregate is a diff wearing a total's clothes.** Rule A already established "report a
total, never a diff, because a diff always looks complete" — but a total can be produced honestly and still hide a
site if the CLASSIFICATION of that total collapses distinct sites into one aggregate verdict. The number was real;
the judgement applied to the number was not per-site. Two properties this bites hardest:

1. **A summary judgement is not the same claim as a per-site one.** "Mostly X" is true and also compatible with
   "and one site is Y" — the reader cannot tell which sites were actually individually checked from the aggregate
   sentence alone.
2. **The riskiest bucket is the one no mechanical guard scans.** This site was a prompt string literal: no compiler
   sees it, no type system sees it, the mechanical root-encoding guards do not scan it (they cover SQL/Scala/
   TypeScript code, not hand-authored prose fed to a model), and being wrong here produces *confidently malformed
   model output*, not a compile error or a 400. A bucket containing an ungrated surface is exactly where "mostly"
   is least trustworthy, because nothing else is going to catch what the classification missed.

**The corrected procedure, added to Rule A's four steps:** when a total's sites are too numerous to name
individually in a report, the classification step must still touch **every site**, even if the report groups them
into buckets for readability afterward — grouping is a presentation choice made AFTER full individual
classification, never a substitute for it. A bucket description ("mostly self-documented DTO retention") is a
summary of a per-site judgement already made, not a shortcut that skips making it.

## Execution evidence: the repository rewiring was demonstrated, not assumed

**A full `sbt test` after landing only V98 plus the domain model produced 583 failures**, falling 583 → 417 → 68 → 2
→ 0 as each class of fixture and write-path gap was closed (Stage 1, commit `a11d4d1d`).

Recorded here rather than only in `files-modified.md`, which is archived and removed: this number is the empirical
proof that carrying the repository/fixture rewiring in the same change was **necessary**, not scope creep. A reviewer
asking "why did a migration ticket touch 20 test files?" has the answer as a measurement rather than an assertion.

## Design gate: closed

Five cold rounds (REFUTE ×4, CONFIRM). Findings per round: 9, 7, 5, 2, then a scoped completeness sweep. No change
request ever survived a round. The final round enumerated **102 sites** encoding "no node / the pipeline's raw root"
(9 SQL, 59 Scala, 9 `schemas/`, 25 TypeScript) and found nothing architectural — the root model, V98's shape, and the
HEL-914 contract all survived unchanged.

**Two distinct properties, two distinct totals, deliberately not merged** — they key on different things and a single
merged number would hide both:

| property | total | source |
|---|---|---|
| "assumes exactly one source" | 129 sites / 60 files | planning sweep |
| "means *no node* / *the pipeline's raw root*" | 102 sites | `skeptic-design-5.md` |

**What would falsify the second being closed** (recorded so it is checkable rather than a claim): a fifth spelling
inside a JSON `config` blob, which no type or schema constrains and no identifier grep can reach; a root reference
reconstructed at runtime from *position* rather than stored — a numeric encoding invisible to every search run, and an
idiom this repo has used before (`V94:185`); or anything in `frontend/**`, out of scope here and carried by HEL-969.
