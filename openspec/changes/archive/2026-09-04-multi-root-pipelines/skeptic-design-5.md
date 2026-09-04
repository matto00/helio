## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Narrow scope: an exhaustive completeness sweep for the concept **"anything whose meaning is *no node* or
*the pipeline's raw root*"**, across SQL / Scala / TypeScript / `schemas/`, plus one honesty assessment of the
proposed guards. Not a general design re-review.

### Method

For each surface I first asked *how could this meaning be encoded here?*, enumerated the encodings, then searched
for each encoding — never starting from a single grep on a name. Encodings hunted:

| Surface | Encodings enumerated and searched |
|---|---|
| SQL | nullable column where NULL carries it; partial index `WHERE … IS NULL` and its complement; CHECK constraints; FK/cascade that depends on it; `WHERE` clauses in DML |
| Scala | `Option`/`None` in that role; Slick lifted `.isEmpty`/`.isDefined`/`=== Option.empty`; `match { case None => }`; **default arguments `= None`**; `getOrElse(source…)` fallbacks; `.forall`/`.fold` on the Option |
| TypeScript | absent optional field; `?: string \| null`; `?? null`; zod `.optional()`; omitted key |
| `schemas/` | `["string","null"]` type union; absent from `required`; prose in `description` asserting absent-means-source |

Spellings that carry the meaning, found by that method (all four are the *same concept*, and no single name
covers them): `node_step_id` / `nodeStepId`, `parent_step_id` / `parentStepId`, **`nodeStepClientId`**,
**`source_data_source_id` / `sourceDataSourceId`**.

---

## TOTAL: 102 sites encode the concept. 75 are covered by a task; 27 are NOT covered or only partially covered.

Legend: ✅ = covered by the named task; ⚠️ = partially covered (the task touches the file/region but does not
state the root obligation); ❌ = not covered by any task.

### SQL — 9 sites (`backend/src/main/resources/db/migration/**`)

| # | Site | Encoding | Status |
|---|---|---|---|
| S1 | `V22__pipelines.sql:4` | `source_data_source_id TEXT NOT NULL REFERENCES data_sources` | ✅ 2.7 (DROP) |
| S2 | `V94:172` | `pipeline_steps.parent_step_id TEXT NULL` — NULL = root | ✅ 2.5 (+`root_id`, CHECK) |
| S3 | `V94:180` | `idx_pipeline_steps_parent_step_id` | ✅ benign (index over the column) |
| S4 | `V94:209` | `outputs.node_step_id TEXT NULL REFERENCES … ON DELETE CASCADE` | ✅ 2.5a |
| S5 | `V94:222` | `idx_outputs_node_step_id` | ✅ benign |
| S6 | `V94:281` | `node_snapshots.node_step_id TEXT NULL` (deliberately no FK) | ✅ 2.5a |
| S7 | `V94:292-293` | `idx_node_snapshots_node_unique … WHERE node_step_id IS NOT NULL` — the **complement** partial index | ⚠️ verify-only (see CR11) |
| S8 | `V94:296` | `idx_node_snapshots_root_unique … WHERE node_step_id IS NULL` | ✅ 2.5b |
| S9 | `V94:426-427` | `binary_refs.node_step_id TEXT NULL … ON DELETE CASCADE` + index | ✅ 2.5a |

Re-verified round 4's finding independently: `grep -rl node_step_id` over the whole migration tree returns **V94
only**; V95/V96/V97 do not touch it. There is no fourth NULL-means-root table, no CHECK constraint anywhere that
encodes it today, and no view or SQL function that does. The V94 DML at `:603`, `:735`, `:765`, `:970`, `:1056`,
`:1091` encodes it in `WHERE` clauses but replays strictly before V98 and is unaffected — confirmed by reading, not
assumed.

### Scala — 59 sites (`backend/src/main`)

**Covered (35):** `model.scala:735` (4.1); `model.scala:827-835` `NodeRef` (5.8a); `PipelineStepRepository:727`
`trunkOf`, `:738-739` `childrenOf(steps, None)`, `:771-775` `tailsOf`/`allParents`, `:805` `executionOrder` (4.4);
`InProcessPipelineEngine:71-74,:340-347` `Option[String]` keying, `:347` `parentKey` (5.1), `:374-390` rows/binary-ref
agreement (5.5), `:310-314` ancestor loop (benign); `PipelineExecutionBackend:31,:50` and `SparkJobSubmitter:130`
(5.7); `PipelineRunService:226,:333,:520` `findByIdInternal` (5.4), `:692` `onNodeProgress` (5.7), `:891`
`outputsByNode.keySet.intersect` (5.8), `:929` `overwriteForNode` key (5.5); `PipelineService:322-333` step
`parentClientId` fold (7.3a), `:1498-1512` `ancestorChainOf` (benign); `OutputRepository:35,:48,:63-66` (`.isEmpty`),
`:160,:177,:190,:275,:290,:301` (5.8a); `NodeSnapshotRepository:38-51,:58-74,:101-107` (5.8a);
`BinaryRefRepository:28,:36,:42-52,:63-86,:102-106` (5.8a); `OutputService:88-94,:138,:284` (5.8a);
`OutputRoutes:36-37` (5.8a); `OutputProtocol:26,:40,:95` (5.8a); `PipelineProposalProtocol:126` (5.8a);
`DemoData:56` (5.8a); `PipelineProposalService:374` (7.6); `PatchSetApplyResolvers:138,:497,:499`,
`PatchSetPreviewProjection:251-274`, `RefinementEditShape:258`, `WorkspaceContextService:293` (7.6);
`PipelineProtocol:38,:47,:188-204` (7.1/7.2); `WorkspaceContextProtocol:124` (7.2);
`PipelineRepository:116,:132,:138,:154,:161,:188-269,:403-410,:434-479` (4.3);
`WorkspaceTeardownRepository:110,:120` (4.5).

**Not covered / partial (24):**

| # | Site | Encoding | Status |
|---|---|---|---|
| C3 | `domain/model/PipelineStep.scala:62` | `def parentStepId: Option[PipelineStepId]` — the **domain** trait has no root reference at all | ❌ |
| C59 | `domain/steps/*.scala` ×24 (`CastStep:39`, `JoinStep:44`, `FilterStep:58`, … ) | `parentStepId: Option[PipelineStepId] = None` — **default argument** meaning root, in all 24 op case classes | ❌ |
| C4 | `PipelineStepRepository:879,:891,:893` + `rowToDomain :826-848` (24 lines) | `PipelineStepRow.parentStepId`, `column[Option[String]]("parent_step_id")`, `*` projection, and 24 construction lines | ⚠️ 4.4 says "`root_id` column" only |
| C5 | `PipelineStepRepository:85` | `s.parentStepId.isEmpty` — Slick lifted, max position over the **root sibling group** | ❌ |
| C6 | `PipelineStepRepository:668-671` `siblingsQuery` | `case None => … s.parentStepId.isEmpty` — the shared root-sibling query behind insert/splice/attach/reorder | ❌ |
| C7 | `PipelineStepRepository:196,:212,:322,:381` | `parentStepId: Option[PipelineStepId] = None` **default arguments** | ❌ |
| C8 | `PipelineStepRepository:549-550` (`reorderTrunkInternal`) | `val newParent: Option[String] = if (idx == 0) None else …` then `.update((newParent, 0, now))` — writes `parent_step_id = NULL` with **no `root_id`** | ⚠️ 4.4 touches `:543` as a `trunkOf` scoping item only |
| C9 | `PipelineStepRepository:633-644` (`deleteInternal`) | head child promoted to `deletedRow.parentStepId` (`None` when the deleted step was root-attached) with **no `root_id`** | ❌ |
| C18 | `PipelineAnalyzeService:159` | `NodeStepInput.parentStepId: Option[String]` — `None` = child of the raw source | ❌ |
| C19 | `PipelineAnalyzeService:224-225` | `schemaAt(parentId) = parentId.flatMap(results.get)…**.getOrElse(sourceSchema)**` — the textbook `getOrElse`-means-root | ❌ |
| C20 | `PipelineAnalyzeService` singular `sourceSchema` parameter (and `:228` `.forall`) | one source schema per analyze call | ❌ (7.3's "analyze seeded per root" names no file) |
| C24 | `PipelineRunService:488,:491,:499,:503` `backfillOutputNode` | `nodeStepId: Option[PipelineStepId]`, `None` = the raw source | ❌ |
| C25 | `PipelineRunService:516-520` `evaluateNodeRowsForBackfill` | `case Some(dataSource) if targetStepId.isEmpty =>` — the explicit source-level branch | ❌ (5.4 covers only the `findByIdInternal` on `:520`) |
| C29 | `PipelineRunService:1038-1046` `extractBinaryRefs` | `nodeStepId: Option[String]` threaded into every `BinaryRef` | ❌ |
| C31 | `PipelineService:395-410` (transactional outputs fold) | `spec.nodeStepClientId` absent ⇒ `nodeStepId = None` **and** `nodeSchema = …getOrElse(sourceSchema)` | ❌ — **writes the NULL/NULL row 2.5a-ii's CHECK rejects** |
| C32 | `PipelineService:984-1001,:1053,:1085` | add-step anchor; `:1085` "`insertInternal`'s bare `parentStepId = None` default" | ⚠️ 4.4 names `:1002,:1103,:1288` |
| C35 | `OutputRepository:247-249` `deleteByNodeInternal` | takes a non-`Option` `PipelineStepId` — there is **no root twin** for task 7.5's root removal | ❌ |
| C43 | `PipelineProposalService:200-202` | `step.parentStepId.exists(p => !seenClientIds.contains(p))` — absent parent is accepted as root | ⚠️ 7.6 names `:374` only |
| C45 | `PatchSetApplyRollback:309` | `parentStepId = prior.parentStepId.map(_.value)` — restoring a root-attached step loses its root | ❌ |
| C46 | `PatchSetUndoInverse:146-150` | `fields.get("parentStepId")` from `priorState`; its own comment records that `priorState` once didn't carry `parentStepId` — the same trap, one level up | ❌ |
| C51 | `PipelineShapeProtocol:66,:78` | `parentStepId = if (idx == 0) None else Some(…)` — shape expansion emits a root-attached first step | ❌ |
| C52 | `AssistantProposalToolSchemas:153,:159` | `"parentStepId"` tool-schema property, absent = root | ⚠️ 8.4 is name-parity only |
| C53 | `domain/panels/OutputBindingSpec.scala:170` | doc: "`nodeStepId: null` — `analyzeNodes` omits the source itself" | ❌ (doc) |
| C54 | `PipelineStepProtocol:27-38` | `def parentStepId: Option[String]` on **every** step response — the wire shape R15 governs | ❌ |

### `schemas/` — 9 sites

The ticket asked me not to assume HEL-911's "no schema file constrains this" result carries over. **It does not.**
Four schema files encode the root concept beyond the two `tasks.md` 8.3a names, and 8.3a's parenthetical —
*"the only two schema files matching `nodeStepId`"* — is **literally true and materially false**: the third and
fourth files spell it `nodeStepClientId` and `parentStepId`. That parenthetical is the search-by-name defect
preserved verbatim in the artifact.

| # | Site | Encoding | Status |
|---|---|---|---|
| H1 | `pipelines/create-pipeline-request.schema.json:7,:10` | `sourceDataSourceId` required | ✅ 8.1 |
| H2 | `pipelines/pipeline-proposal.schema.json:7,:14,:25,:32` | `source` required; `:25` description "absent means the pipeline's raw source" | ⚠️ 8.2 covers `source`→`roots[]`, not the `:25` output-level prose |
| H3 | `workspace/workspace-context.schema.json:345,:359` | `sourceDataSourceId` | ✅ 8.3 |
| H4 | `outputs/create-output-request.schema.json:9` | `"nodeStepId": {"type": ["string","null"]}` | ✅ 8.3a |
| H5 | `outputs/output.schema.json:10,:22` | required + `["string","null"]` | ✅ 8.3b |
| H6 | `pipelines/create-pipeline-transactional-step-request.schema.json:12` | `"parentStepId": {"type": ["string","null"]}` — **explicit null-means-root on the wire**, which R15 and the spec delta ban | ❌ |
| H7 | `pipelines/create-pipeline-transactional-output-request.schema.json:9` | `"nodeStepClientId": {"type": ["string","null"]}` — same, and the counterpart to C31 | ❌ |
| H8 | `pipelines/create-pipeline-step-request.schema.json:21` | `parentStepId` optional — the `POST /steps` body task 7.3b changes in Scala with no schema task | ❌ |
| H9 | `pipelines/reorder-pipeline-steps-request.schema.json:5` | description: "stepIds[0]'s parent becomes the pipeline root" — singular-root contract prose | ❌ |

### TypeScript — 25 sites (`helio-mcp/src/**`, `e2e/**`; `frontend/**` excluded per scope)

**Covered (12):** `write.ts:330` (9.9); `outputs.ts:60,:70` (9.9); `outputsHandlers.ts:35,:42` (9.9);
`pipelinesHandlers.ts:166,:189-201` (9.9); `context.ts:200` (9.9); `context.ts:315,:441` (9.4);
`helioApi.ts:499-506` (9.5); `types.ts:257` (9.5); `pipelines.ts:65-68` (9.1/9.6); `read.ts:166` (9.6);
`write.ts:762` (benign, descendant-delete prose); e2e `sourceDataSourceId` ×11 (10.1).

**Not covered / partial (13):**

| # | Site | Encoding | Status |
|---|---|---|---|
| T6 | `context.ts:146-147` | `nodeStepId: string \| null` **type declaration** + its comment "absent on the wire — spray-json omits `Option = None`" | ❌ (9.9 fixes `:200`'s value, leaves the type that permits it) |
| T9 | `helioApi.ts:515,:524` | `parentStepId?: string` on `addPipelineStep` | ❌ |
| T10 | `helioApi.ts:828` | comment "`nodeStepId` absent means the pipeline's raw source" | ❌ (**named in round-4 CR1, dropped in fold-in**) |
| T11 | `helioApi.ts:833-836` | `listOutputsByPipeline(pipelineId, nodeStepId?)` | ❌ (**named in round-4 CR1, dropped**) |
| T12 | `assertSchemas.ts:109,:123` | `parentStepId?: string` in the add-step handler input + forward | ❌ (**named in round-4 CR1, dropped**) |
| T13 | `types.ts:189,:204` | `nodeStepId?: string` on the Output request/response types | ❌ |
| T15 | `types.ts:737-743` | `parentStepId?: string \| null` (proposal step) | ❌ |
| T16 | `types.ts:749-752` | `nodeStepClientId?: string \| null` (proposal output) | ❌ |
| T17 | `types.ts:790` | `nodeStepId?: string \| null` | ⚠️ 9.5 names `:798`, not `:790` |
| T19 | `pipelineProposal.ts:69,:75,:80,:117,:120-121` | zod `.optional()` on `parentStepId` and `nodeStepClientId`, plus tool prose "absent means the pipeline's raw source" | ❌ (9.7 covers `pipelineProposalValidation.ts` only — a different file) |
| T21 | `read.ts:252` | description enumerating `nodeStepId` as the Output's node handle | ❌ (minor) |
| T23 | `context.test.ts:199-207` | test **pins** `nodeStepId: null` for a source-attached Output | ❌ (**named in round-4 CR1, dropped**) |
| T25 | `hel908-trunk-reorder-order.spec.ts:12-16,:112` | comments asserting the reorder relinks to "the pipeline root" (singular) | ❌ (minor) |

---

### Assessment of the guards (5.8b, 5.8b-i, 9.10): **not honest as specified**

Three independent defects in the guard specification, each of which produces a guard that is green while the rule
it names is violated:

1. **The guard's stated rule is narrower than the property it is named for.** 5.8b covers exactly two encodings
   (`node_step_id IS NULL` in raw SQL; `.nodeStepId.{isEmpty,isDefined}`/`=== Option.empty`) on exactly three
   tables. It does not see `parentStepId`/`parent_step_id IS NULL` (C5, C6, C8, C9 — of which C9 is a live CHECK
   violation), `nodeStepClientId` (C31, H7, T16), default arguments `= None` (C7, C59), or `getOrElse(sourceSchema)`
   (C19, C31). A reviewer reading "mechanical guard covering BOTH encodings" will believe the class is mechanically
   closed. It would be closed for one spelling out of four.
2. **No surface-coverage statement anywhere.** Neither 5.8b nor 9.10 requires the guard to declare, in its own
   header, which surfaces it covers and which it does not. This is precisely what the brief asks for and it is absent.
3. **The TypeScript half has no prove-it-fires twin.** 5.8b-i requires introducing a violating line of each Scala/SQL
   form and observing failure. 9.10 has no `9.10-i`. An unproven guard is the same non-evidence 3.5 and 5.8b-i were
   written to reject — so the one surface added *because* a Scala-only guard is green-while-broken is itself the
   surface with no firing proof.

---

### Verdict: CONFIRM

Nothing found is architectural. The root model (opaque root id, position never an address), the migration shape
(V98's bracket/backfill/orphan-delete/CHECK/index/guard/drop order), and the HEL-914 contract all survive this sweep
intact — every one of the 27 gaps is an *additional site that must conform to* the model the spec already fixes, not
a reason to change it. C9, C31 and H7 are the sharpest (they write rows the new CHECK rejects, i.e. runtime/deploy
failures rather than awkward reads), but each is repaired by carrying a root id through code that already exists.
Fold in as change requests.

### Change Requests (mechanical — foldable without another round)

1. **§4.4** — add: the **domain** `PipelineStep` trait (`PipelineStep.scala:62`) and **all 24 op case classes**
   (`domain/steps/*.scala`, each `parentStepId: Option[PipelineStepId] = None`) gain a root reference; the `= None`
   default argument must not survive as an implicit "root". Include `PipelineStepRow` (`:879`), the
   `column[Option[String]]("parent_step_id")` (`:891`), the `*` projection (`:893`) and all 24 `rowToDomain`
   construction lines (`:826-848`).
2. **§4.4** — add `PipelineStepRepository:85` and `siblingsQuery` (`:668-671`): the root sibling group becomes
   **per-root**, or position numbering and splice/attach/reorder mix lanes from different roots.
3. **§4.4** — add `PipelineStepRepository:549-550` explicitly: `reorderTrunkInternal` writes `parent_step_id = NULL`
   for `idx == 0` and must write that trunk's `root_id` in the same `.update`, or the new CHECK aborts every trunk
   reorder. State it as a write obligation, not as a `trunkOf` scoping item.
4. **New §4.4a** — `PipelineStepRepository:633-644` (`deleteInternal`): the head child promoted to
   `deletedRow.parentStepId` must also inherit `deletedRow.root_id`. As written, deleting any root-attached step
   produces `parent_step_id IS NULL AND root_id IS NULL` and fails the 2.5 CHECK. Test: delete the first step of a
   two-root pipeline; the promoted child carries the same root.
5. **New §5.9** — `PipelineAnalyzeService`: `NodeStepInput.parentStepId` (`:159`), `schemaAt`'s
   `getOrElse(sourceSchema)` (`:224-225`) and the singular `sourceSchema` parameter become root-keyed. Task 7.3's
   "analyze seeded per root" currently names no file and no function.
6. **New §5.10** — `PipelineRunService` backfill path: `backfillOutputNode` (`:488-503`),
   `evaluateNodeRowsForBackfill`'s `case Some(dataSource) if targetStepId.isEmpty` (`:516-520`) and
   `extractBinaryRefs` (`:1038-1046`) take a `NodeKey`, not `Option[PipelineStepId]`. 5.4 covers only the
   `findByIdInternal` call inside `:520`.
7. **§7.3a** — extend from steps to **Outputs**: `PipelineService:395-410`'s `nodeStepClientId` fold must accept a
   `rootClientId` (never silently `roots[0]`) and the `nodeSchema = …getOrElse(sourceSchema)` grounding must resolve
   that root's schema. Without this, every transactional create with a source-attached Output writes the NULL/NULL
   row 2.5a-ii rejects.
8. **§7.5 / §7.6** — add `OutputRepository` a root-scoped delete twin to `deleteByNodeInternal` (`:247-249`) if the
   `outputs` FK cascade is not being relied on, and add `PatchSetApplyRollback:309` + `PatchSetUndoInverse:146-150`
   (restoring a step from `priorState` must restore its root) and `PipelineProposalService:200-202` and
   `PipelineShapeProtocol:66,:78` (shape expansion's `idx == 0` step needs a root) and `PipelineStepProtocol:27-38`
   (every step response's wire shape).
9. **§8 — four new checkboxes.** Correct 8.3a's parenthetical ("the only two schema files matching `nodeStepId`") to
   name the property, not the string, and add:
   `schemas/pipelines/create-pipeline-transactional-step-request.schema.json:12` (`parentStepId` `["string","null"]`);
   `schemas/pipelines/create-pipeline-transactional-output-request.schema.json:9` (`nodeStepClientId`
   `["string","null"]`); `schemas/pipelines/create-pipeline-step-request.schema.json:21` (`parentStepId`, the
   7.3b body); `schemas/pipelines/reorder-pipeline-steps-request.schema.json:5` (singular-root description). Also
   `pipeline-proposal.schema.json:25`'s "absent means the pipeline's raw source" prose. Each of these three
   `["string","null"]` unions is the wire null-means-root R15 bans, in the binding contract itself.
10. **§9.9 — restore the four round-4 sites dropped in fold-in** (`helioApi.ts:828`, `helioApi.ts:833-836`,
    `assertSchemas.ts:109,:123`, `context.test.ts:199-207`) and add: `context.ts:146-147` (the `string | null` type,
    not just `:200`'s value); `helioApi.ts:515,:524`; `types.ts:189,:204,:737-743,:749-752`, and correct `:790` (9.5
    says `:798`); **`pipelineProposal.ts:69,:75,:80,:117,:120-121`** — 9.7 covers `pipelineProposalValidation.ts`,
    a different file, so the proposal tool's own zod `.optional()` root encoding is currently untouched;
    `read.ts:252`; the e2e comments at `hel908-trunk-reorder-order.spec.ts:12-16,:112`.
11. **§2.5b** — while dropping/recreating `idx_node_snapshots_root_unique`, state explicitly that the **complement**
    index `idx_node_snapshots_node_unique` (`V94:292-293`, `WHERE node_step_id IS NOT NULL`) was checked and
    deliberately left unchanged. I verified it remains correct under multi-root; record the verification so the next
    reader does not have to re-derive it (and does not "tidy" it).
12. **Guards (5.8b / 5.8b-i / 9.10) — make them honest.** (a) Widen the rule to the property, covering the
    `parentStepId`/`parent_step_id IS NULL`, `nodeStepClientId`, `= None` default-argument and
    `getOrElse(sourceSchema)` encodings — or explicitly exclude each with a reason. (b) Require the guard script's
    **own header** to state, in one block, exactly which surfaces (SQL / Scala / TypeScript / `schemas/`) it scans
    and which it does not and why. (c) Add **9.10-i**: introduce a violating line of each TypeScript form and observe
    the guard fail — the Scala half has 5.8b-i and the TypeScript half currently has no firing proof at all.

### Is the class CLOSED?

**Yes, as an enumeration** — with the 27 gaps above folded in. I searched by encoding rather than by name across all
four surfaces, which surfaced three spellings (`parentStepId`, `nodeStepClientId`, `sourceDataSourceId`) that a
`nodeStepId` sweep cannot see, and four non-textual encodings (default arguments, `getOrElse` fallbacks, Slick
lifted predicates, JSON `["string","null"]` unions). The 102 sites are the real total, not a diff.

**What would falsify it:** (a) a fifth spelling I did not conceive of — most plausibly inside a JSON `config` blob
(a step config field naming an upstream node), which no type or schema constrains and no grep on an identifier can
reach; (b) a root reference reconstructed at runtime from *position* rather than stored (e.g. "the position-0 step
is the root child"), which is a numeric encoding invisible to every search I ran — `V94:185`'s comment shows this
repo has previously had exactly that idiom; (c) anything in `frontend/**`, deliberately out of scope here and
carried by HEL-969. The executor's §1.2 end-of-change re-sweep should be run against **this** 102-site list, not
against the planning sweep's 129/60 count, which keys on a different property ("assumes exactly one source").

### Non-blocking notes

- Round 4's non-blocking note (align `design.md` V98 step 5 with `tasks.md` 2.6's three-table NULL/NULL condition)
  is still worth folding in; both artifacts are binding.
- `outputs.ts:118,:123` (`list_outputs`' `nodeStepId` filter) is **not** an instance of the concept — omitting it
  means "all Outputs", not "the root's". Left off the list deliberately. It does, however, leave no way to filter to
  one root's Outputs once roots exist; a `rootId` filter there is a small ergonomic add for HEL-914's benefit.
