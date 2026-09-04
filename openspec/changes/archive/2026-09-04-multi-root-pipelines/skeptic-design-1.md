## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **The RLS silent-empty-read claim is TRUE — and true for a reason design.md states imprecisely.**
  `V35__rls_owner_only_tables.sql:31-32` created `pipelines_owner` as `owner_id = current_setting('app.current_user_id')::uuid`
  (no `missing_ok`) — that form *errors loudly*, it does not return zero rows. But `V39__pipeline_sharing_grants.sql:78-83`
  **drops** it and replaces SELECT with `USING (helio_can_access_pipeline(id))`, and that function
  (`V39:38-45`) reads `current_setting('app.current_user_id', true)` and `RETURN FALSE` when NULL/empty.
  So as the Flyway role, `SELECT ... FROM pipelines` returns **zero rows, silently**. The design's conclusion is
  correct; its stated mechanism ("policy keyed on current_setting … which is unset") is the V35 policy that no longer
  exists, and the V35 form would have failed loudly. Worth correcting so the V98 header teaches the right lesson.
- **`pipeline_steps` still carries the V35 form.** `grep -n "POLICY.*pipeline_steps" *.sql` returns exactly one hit,
  `V35:63`, an all-commands `EXISTS (… current_setting('app.current_user_id')::uuid)` with **no** `missing_ok`.
  Under FORCE as the Flyway role that arm **raises**, it does not return empty. Bracketing it is therefore correct
  and necessary (V97:42/:79 does exactly this). So the two-table bracket is right, for two *different* reasons.
- **Bracket precedent citations are accurate.** `V94:122-131` (`NO FORCE` incl. `pipelines`, `pipeline_steps`) /
  `V94:1309-1316` (restore); `V96:38/:58`; `V97:42/:79`. Owner-bypass works because `helio` owns the tables (`V94:29`).
- **Engine ground truth read directly**: `InProcessPipelineEngine.scala:69-74` (`nodeOutcomes: Map[Option[String], NodeOutcome]`),
  `:212` (single `StepExecutionException` throw site), `:376-393` (the `rows` / `trunkOf` agreement comment),
  `InProcessExecutionBackend.scala:23-29`, `PipelineExecutionBackend.scala:31,:50`, `SparkJobSubmitter.scala:130`,
  `PipelineRunService.scala:361,:443,:692,:715,:891,:929`, `PipelineStepRepository.scala:707-762`.
- **Archived engine-contract items 8 and 11** read at
  `openspec/changes/archive/2026-09-03-multi-lane-pipeline-engine/design.md:150` and `:153`; the merged SHALL asserting
  the un-implemented lane path read at `openspec/specs/pipeline-run-execution/spec.md:9`. Both supersede claims are
  factually accurate.
- **HEL-914 fetched from Linear** (Backlog, P2.4) and its ACs read against the R5 contract.
- **Sweep spot-checks run myself**: `grep -rln 'sourceDataSourceId|source_data_source_id'` → 90 files repo-wide
  (excluding the change dir and `node_modules`); **21 of them under `frontend/src`**, including
  `frontend/src/features/pipelines/services/pipelineService.ts` and `.../ui/CreatePipelineModal.tsx:90` which **post**
  the scalar field.
- All 13 spec deltas read in full.

### Verdict: REFUTE

The migration bracket (Q1) is essentially right, R5 (Q2) is sound reasoning not a rationalization, and R7's
refuse-don't-cascade call (Q4) is the correct one. But there are three silent-data-loss / silent-corruption vectors the
design does not see, one contract contradiction, and two implementation-blocking gaps that would force HEL-914 to
re-derive — which is the failure of a stated acceptance criterion.

### Change Requests

1. **Root-bound Outputs and node_snapshots are silently orphaned by R4 — highest-severity finding.**
   `outputs.node_step_id` is `TEXT NULL` (`V94:209`) and `node_snapshots.node_step_id` is `TEXT NULL` (`V94:281`);
   **NULL means "the pipeline root"**. `PipelineRunService.scala:891` computes
   `outputsByNode.keySet.intersect(nodeOutcomes.keySet)` where `outputsByNode` is keyed
   `_.node.stepId.map(_.value)` — a root-bound Output keys `None`, and today intersects the engine's `None` root frame.
   R4 deletes `None` from the key space entirely (`RootKey(rootId)`/`StepKey`). Result: **every existing root-bound
   Output stops intersecting, stops refreshing, and reports no error** — and since HEL-910's public rows route resolves
   panel → output → node_snapshot, those dashboards silently serve permanently stale data. Neither `design.md` § R4,
   § "Migration V98", nor `tasks.md` mentions `outputs`, `node_snapshots`, or their NULL-means-root encoding at all.
   Required: state in the contract what a NULL `node_step_id` maps to under multi-root, add the V98 DML that rebinds
   those rows (`outputs` and `node_snapshots`, both under the `NO FORCE` bracket — both are FORCE-RLS per `V94:1329-1330`),
   and add a proof obligation + `FlywayNonSuperuserMigrationSpec` assertion covering it against the real dump.

2. **`trunkOf` is missing from the enumeration, and R10 breaks the invariant HEL-911 wrote down explicitly.**
   `InProcessPipelineEngine.scala:376-390` states in terms that `rows` **must** be the same node
   `pipelineStepRepo.trunkOf(steps).lastOption` identifies, naming five dependent call sites and warning
   "*or binary refs get keyed to one node and extracted from another*". `PipelineRunService.scala:929` is that keying.
   `trunkOf` (`PipelineStepRepository.scala:727`) is rooted in `childrenOf(steps, None)` and therefore becomes ambiguous
   under multi-root — yet `tasks.md` §4.4 lists only `childrenOf` (`:738`) and `executionOrder` (`:805`), and §5.5 defines
   `rows` without ever mentioning `trunkOf` or the agreement invariant. `trunkOf` also drives `PipelineService.scala:1002`,
   `:1103`, `:1288` and `PipelineStepRepository.scala:543` (attach anchor, reorder). Required: add `trunkOf`/`tailsOf` to
   §4.4, define them root-scoped, and make R10 state explicitly that `rows`, `trunkOf(...).lastOption` and
   `binaryRefRepo.overwriteForNode`'s key must be derived from the **same** root and the **same** node, with a test that
   would fail if they diverge. Also correct R10's claim that `rows` is "consumed once … explicitly transitional" —
   it has five consumers including a persisted binary-ref key.

3. **R10 contradicts R3, and the contradiction is in a merged SHALL.**
   `specs/pipeline-multi-root/spec.md` states "**No behaviour SHALL branch on a root's position; no root SHALL be
   treated as primary.**" R10 then makes `rows` — which feeds SSE row count, `pipelines.last_run_row_count`,
   `pipeline_runs.row_count`, and the binary-ref key — the lowest-positioned root's trunk terminal. That is behaviour
   branching on position, observable in four persisted/wire places, i.e. root 0 *is* primary for row reporting.
   Either (a) narrow the R3 SHALL to "no **semantic** behaviour", naming the deterministic-tiebreak exceptions
   (R5 canonical path, R10 `rows`) explicitly so the spec is true, or (b) change R10 (e.g. `rows` = the single-root
   frame only, undefined/empty for N>1). As written the change would merge a spec that its own design violates.
   Relatedly, the carried-forward scenario "Run with no steps returns source rows unchanged — **all** source rows
   returned" (`specs/pipeline-run-execution/spec.md`) is now **false** for a two-root, zero-step pipeline under R10:
   only the lowest root's rows are returned. That is a scenario the audit should have caught.

4. **Nothing defines how a step names its root at create time — this blocks implementation AND blocks HEL-914.**
   `specs/pipeline-create-api/spec.md` asserts "*Single call builds a lane under each of two roots … one root-level step
   naming each root*" and `specs/pipeline-steps-persistence/spec.md` asserts "*a step is appended with no parent step
   against a named root*", but no requirement, and no line of `design.md` (R6 defines only the `roots[]` element shape)
   or `tasks.md` §7.1, defines the mechanism. At create time root ids do not exist yet — this is precisely the problem
   R5 solves for *error addresses* and leaves unsolved for *step→root binding*. HEL-914's AC #1 is "one `create_pipeline`
   call builds a **two-root, two-lane** pipeline with a `join` rejoin", so HEL-914 cannot be planned without re-deriving
   this — failing the ticket's AC5 ("explicit enough for HEL-914 to be planned from without re-deriving it").
   Required: add an R-clause defining the create-time root reference (`rootIndex`, or a `clientId` on each `roots[]`
   element mirroring the existing step `clientId` convention), and a matching task for `CreatePipelineRequest`'s step
   element and for `POST /api/pipelines/:id/steps` / `AddPipelineStepRequest` (see CR6).

5. **The proposed `pipeline_roots` RLS policy is a privilege escalation relative to both siblings.**
   V98 step 8 proposes a single `USING (helio_can_access_pipeline(pipeline_id))` "mirroring V39:81". `V39:81` is
   `pipelines_select` — **SELECT only**. V39 deliberately split the commands (`V39:78-95`): SELECT is sharing-aware,
   INSERT/UPDATE/DELETE are owner-only; and `pipeline_steps`' policy (`V35:63`) is owner-only for **all** commands.
   A single all-commands permissive policy using the sharing-aware predicate (which Postgres reuses as `WITH CHECK` for
   INSERT when none is given) would let a **grantee of a shared pipeline add and remove that pipeline's roots** — a write
   privilege they have on neither `pipelines` nor `pipeline_steps`. Required: per-command policies —
   `FOR SELECT USING (helio_can_access_pipeline(pipeline_id))` plus owner-only INSERT/UPDATE/DELETE in the
   `pipeline_steps`/`V39` owner form — and a test asserting a grantee cannot write a root.

6. **`root_id`'s invariant is asserted in the spec but enforced nowhere, and the step-append route is unaccounted for.**
   `specs/pipeline-steps-persistence/spec.md` states "*A step with no parent step SHALL have a non-null `root_id`*",
   but V98 step 4 adds the column **nullable** with no `CHECK`, no `NOT NULL`, and no service-layer task; the only
   enforcement is the one-shot `DO $$` guard at migration time. A step landing with both `parent_step_id` and `root_id`
   NULL afterwards is invisible to `childrenOf(steps, RootKey(...))` and is **silently dropped from the walk**.
   The obvious way it lands: `POST /api/pipelines/:id/steps`, which `tasks.md` never touches (§7 covers create + the two
   root routes only) and for which there is no spec delta modifying the request shape. Required: a
   `CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL))` (or the stated equivalent), a task for the step-append
   route/protocol carrying `rootId`, and a spec delta for it.

7. **R7's numbered steps put the destructive deletes before the refusal check.**
   R7 lists: 1 last-root refusal, 2 delete steps, 3 delete Outputs/placements, **4 reject when a surviving lane
   references a deleted node**. Read as an order of operations — which is how a numbered list in a design will be read —
   the deletes happen before the check that should prevent them. The spec scenario is right
   ("*no root, step, or Output is deleted*"); the design is not. Required: reorder so all refusal checks (last-root,
   surviving-lane reference) are evaluated **before** any delete, and state that the whole removal is one transaction.

8. **The change knowingly breaks the frontend and does not say so, or say who repairs it.**
   21 files under `frontend/src` reference `sourceDataSourceId`, including `services/pipelineService.ts` and
   `ui/CreatePipelineModal.tsx:90`, which **post** the scalar shape that this change makes a hard 400, and
   `ui/PipelineDetailHeader.tsx:47`, which resolves the source for display from it. `frontend/**` is correctly off
   limits here; HEL-912's out-of-scope disclaims multi-root editor work; HEL-968 is blocked by both. So on merge, main
   carries a **non-functional Create Pipeline flow** for an unbounded window, and `e2e/**` — which IS in scope — drives
   that UI in several of the eight specs `tasks.md` §10.1 lists. §10.2 anticipates only `hel908-full-flow`'s known
   flake and treats `check:e2e-types` green as the gate; a type-check does not run a browser. This is not a reason to
   change the scope decision, but the design must state the accepted end state explicitly, name the ticket that
   restores the UI, and enumerate which e2e specs are expected to go red and are being deliberately quarantined —
   otherwise the executor will hit a red e2e run with no way to tell "expected" from "I broke it".

9. **Duplicate carried-forward scenarios in `pipeline-execution`.** The MODIFIED "The engine walks the step tree, not a
   flat list" block carries both "*A lane off a mid-graph step sees that step's frame*" and "*A tail off a mid-trunk
   step sees that step's frame*" (same `A → B → C` + `T` fixture, pre-HEL-911 and HEL-911 wordings), and both
   "*Disabled steps are skipped in place anywhere in the graph*" and "*… on trunk and tails*". Not false, but the
   programmatic merge kept a superseded scenario alongside its own generalization in the same block. Drop the
   superseded halves.

### Non-blocking notes

- **Q1 (bracket) verdict:** the two-table `NO FORCE` bracket is correct and sufficient *for the tables the backfill
  touches* — modulo CR1, which adds two more (`outputs`, `node_snapshots`). FK referential-integrity checks against
  `data_sources` bypass RLS, so `data_sources` does not need bracketing. Enabling `pipeline_roots` RLS after the
  backfill (step 8) is right and does avoid a third bracket. The step order is otherwise sound and the step-5 hard
  assertion before the drop is, as claimed, the single most important statement in the file.
- **Q1, correctness of the header's lesson:** please fix the mechanism as described in "What I verified" — the design
  currently attributes the silent read to the V35 policy form, which V39 deleted and which would in fact have failed
  loudly. The generalization the header teaches ("bracket every table the SELECT touches") is correct and worth keeping.
- **Q2 (R5) verdict: sound, not a rationalization.** `roots[1] › steps[3]` addresses an array slot in a body whose steps
  have only `clientId`s; `root:<rootId> > s1 > s4` addresses persisted nodes. They cannot collide because they never
  exist at the same time, and the tokens are visually distinct. One gap: **this** change ships the multi-root create
  validation errors (per-root 404/400) before HEL-914 exists, so it needs a request-address format now — R5 assigns
  that format to HEL-914. Say which form this change emits, or 914 will retrofit its own.
- **Q4 (R7) verdict: refuse-don't-cascade is the right call.** Cascading would leave a surviving rejoin silently
  reading a deleted node, and item 6a makes same-pipeline membership a security boundary. The only coverage gap I found
  is the ordering defect in CR7.
- **Q6 (enumeration):** the 129/60 figure is keyed on the right property, but the sweep missed `trunkOf`/`tailsOf`
  (CR2), the `outputs`/`node_snapshots` NULL-root encoding (CR1), the step-append route (CR6), and the
  `Option[String]` node key on the `PipelineExecutionBackend` trait / `PipelineExecutionOutcome` /
  `onNodeProgress` SSE callback (`PipelineExecutionBackend.scala:31,:50`, `SparkJobSubmitter.scala:130`,
  `PipelineRunService.scala:692`), which R4 necessarily changes but `tasks.md` §5.6 reduces to "must still compile".
  Say what the root's node key serializes to on the SSE progress channel.
- **Q3 (spec deltas):** the `pipeline-create-api` REMOVED + ADDED modelling is the right call and the reason is honest —
  the old block's scenarios name a field that 400s, and the two requirement titles differ so nothing collides. Other
  than CR3's now-false zero-step scenario and CR9's duplicates, the carried-forward scenarios survive the new text.
  "*whose base source is a reachable rest_api source*" in the run-execution block reads as single-source-era language
  but remains true for a one-root pipeline; harmless.
