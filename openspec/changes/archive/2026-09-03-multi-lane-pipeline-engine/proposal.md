## Why

HEL-911 is P2.1 of the Pipelines & Outputs remodel (HEL-903) — the first Phase-2 ticket. Phase 1 (HEL-904…910) shipped a linear **trunk** plus **leaf tails** on a node-graph data model, and deliberately fenced that shape in with a named `InvalidGraph` pre-flight: at most one `position = 0` child per node, and no `position >= 1` children below a tail node. That fence was always scaffolding. Phase 2 removes it and lets a node carry several step children — parallel **lanes** — that rejoin through `join` / `union` / `lookup`.

This is not a self-contained engine change. HEL-912 (editor lanes), HEL-913 (multi-root pipelines) and HEL-914 (MCP + proposals for branching) are each blocked on this ticket and will be **planned against the contract it defines**. Stating that contract precisely — the wire shape, the ordering rule, what a lane reference may name, and what the walk guarantees a rejoin can rely on — is therefore a deliverable of this change, not a by-product of it.

Three design questions were escalated to the product owner during planning because the remodel spec does not answer them (its entire Phase-2 engine statement is one sentence, at `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:160`). All three were answered; see `design.md` Decisions 1–3. One answer (Decision 1) deliberately overrides that spec sentence, and one (Decision 3) deliberately overrides the ticket's own prose — both are recorded as decisions rather than left as contradictions.

## What Changes

- **The Phase-1 graph invariant is deleted, at every site that enforces it.** The ticket prose names one; there are three. `InProcessPipelineEngine.validateGraph` (the engine pre-flight), `PipelineStepRepository.executionOrder`'s position-0 guard added by HEL-930, and the `InvalidGraph` arm in `PipelineService` that maps the latter to an API error. It is deleted, not kept as a mode.
- **The walk becomes a topological DAG walk.** Any node may have several step children. Lanes evaluate independently from the parent's frame; sibling `position` is the deterministic tiebreak among otherwise-unordered nodes. A rejoin step's lane reference is a real dependency edge, so the referenced lane is guaranteed evaluated before the rejoin runs.
- **`join` / `union` / `lookup` gain a discriminated secondary input.** `{ kind: "source", dataSourceId }` (today's behaviour) or `{ kind: "lane", stepId }` (new). Per Decision 1 this is a **hard** cutover: a Flyway migration (V97) rewrites every persisted config to the new shape and the tolerant decoders lose their legacy read path.
- **Cycle rejection.** A lane reference that reaches its own ancestor is rejected at write time with a 400 naming the cycle, and defensively at run time.
- **Analyze, capabilities and preview generalize to any node in any lane**, including projecting a rejoin's schema from both of its inputs.
- **Run reporting generalizes.** Per-node counts are reported across lanes, and a failing step names its lane path (extending HEL-859).
- **The remodel spec is corrected in place.** Line 160's trailing "No data-model change." becomes false the moment V97 lands; it is rewritten in the same commit as the migration.

## Capabilities

### New Capabilities

- `pipeline-lane-walk`: the engine's multi-child DAG walk — lane independence, topological ordering with the `position` tiebreak, and the per-node snapshot/schema guarantees a rejoin may rely on.
- `pipeline-lane-rejoin-input`: the discriminated secondary input for `join` / `union` / `lookup`, what a `lane` reference may name, multi-consumer (diamond) legality, and cycle rejection at write and run time.

### Modified Capabilities

- `pipeline-execution`: the execution contract is no longer a trunk-plus-tails tree walk fenced by a graph invariant; it is a DAG walk with no structural fence.
- `pipeline-step-tree`: a node may now have several step children; the at-most-one-position-0-child rule is removed.
- `pipeline-steps-persistence`: `executionOrder`'s position-0 `InvalidGraph` guard (HEL-930) is removed and the traversal generalized.
- `pipeline-union-op`, `pipeline-lookup-op`: secondary input becomes the discriminated shape; the flat `otherDataSourceId` field is gone.
- `pipeline-joinstep-right-source-acl`: the ACL pre-flight must now distinguish a source-kind secondary input (existing owned-source check, including HEL-950's empty-seed-id guard) from a lane-kind one (no data-source ACL applies; the pipeline ACL is the whole gate).
- `pipeline-analyze-api`, `pipeline-capabilities-api`, `pipeline-preview-api`: work at any node in any lane and project a rejoin schema from both inputs.
- `pipeline-run-sse`, `pipeline-run-execution`: per-node counts across lanes; a failing step names its lane path.
- `pipeline-step-config-validation`, `pipeline-step-config-rejection`, `pipeline-step-config-read-strictness`: the secondary-input shape is validated, and the legacy flat shape is now rejected rather than tolerated (an empty `dataSourceId` inside the new shape remains a legal draft).
- `patch-set-apply`, `conversational-refinement`: both carry the legacy flat field names in their spec text and must reference only the new shape.

## Impact

**Backend.** `InProcessPipelineEngine` (invariant deletion + DAG walk), `PipelineStepRepository` (traversal + HEL-930 guard), `PipelineService` (write-time cycle rejection, ACL pre-flight branch, `InvalidGraph` arm), `PipelineAnalyzeService` (rejoin schema projection, any-node capabilities), `JoinStep` / `UnionStep` / `LookupStep` (config shape + lane resolution), `PipelineStepConfigCodec` / `PipelineStepProtocol`, run/SSE reporting.

**Database.** New migration `V97` rewriting `pipeline_steps.config`. `pipeline_steps` carries `FORCE ROW LEVEL SECURITY` (V35) with an indirect-owner policy that reads `current_setting('app.current_user_id')` without `missing_ok` — the exact 42704 shape that broke three consecutive production deploys. V97 must follow the V94/V96 `NO FORCE` / `FORCE` bracket and be exercised by `FlywayNonSuperuserMigrationSpec`, not only by superuser-connected tests.

**Contracts.** OpenSpec capability specs listed above; `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:160`.

**Disposition of the "`schemas/` + OpenSpec updated in the same change" acceptance criterion.** The OpenSpec half is satisfied in full. The `schemas/` half is answered as a **verified no-op, with evidence**: `schemas/pipelines/create-pipeline-step-request.schema.json` types `config` as an opaque `{"type": "object"}`, and no file under `schemas/` mentions any of the three legacy field names or models step-config shape at all. There is therefore nothing in `schemas/` for this change to update, and `check:schemas`/schema-drift do **not** cover step-config shape — neither is cited as evidence for this change. Creating a step-config schema surface here would be unbid scope that three downstream tickets would then be planned against. Recorded explicitly so this AC is met by a stated finding rather than left silently unsatisfied.

**Execution backends.** The `PipelineExecutionBackend` contract must still compile for Dataproc; implementing the multi-lane walk on Spark remains with HEL-238.

**Downstream.** HEL-912, HEL-913, HEL-914 are planned against `design.md`'s "Engine contract" section.

**Out of scope.** Editor (P2.2), multi-root (P2.3), MCP/proposals (P2.4).
