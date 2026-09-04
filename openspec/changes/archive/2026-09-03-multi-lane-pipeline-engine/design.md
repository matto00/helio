## Context

Phase 1 of the remodel (HEL-905, P1.2) replaced `InProcessPipelineEngine`'s `foldLeft` over a flat step list with a **tree walk**: a trunk of `position = 0` children, plus **tails** (`position >= 1` children) evaluated from their parent's frame as independent short folds. To keep that shape honest it added a pre-flight, `validateGraph`, raising a named `InvalidGraph` on either of two violations — more than one `position = 0` child at any node, or a `position >= 1` child below a tail node.

Phase 2 deletes that fence. This document records the three decisions the product owner made during planning, and then states the **engine contract** that HEL-912 / HEL-913 / HEL-914 will be planned against.

### Ground truth established during planning

- `InProcessPipelineEngine.validateGraph` — `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala:210-241`. Its own scaladoc claims it is "the ONLY layer that enforces this invariant." **That comment is stale.** HEL-930 subsequently added a second enforcement site.
- `PipelineStepRepository.scala:761-767` — throws `InvalidGraph` during `executionOrder` traversal on a second `position = 0` child. `PipelineService.scala:1298` maps it to an API error. Three sites, not one.
- `UnionConfig` is a flat `(otherDataSourceId: String, mode: String)` with a tolerant `decode` defaulting a missing id to `""` (`UnionStep.scala:11-26`). `JoinStep` and `LookupStep` follow the same pattern.
- `executeTree` already retains **every** node's post-evaluation frame in `TreeWalkResult.nodeOutcomes` (`InProcessPipelineEngine.scala:262-356`), keyed by `Option[String]` with `None` for the virtual root. This is load-bearing for Decision 3 and costs nothing new.
- `pipeline_steps.config` is **`TEXT`**, not `JSONB` (`V23__pipeline_steps.sql:6`).
- `pipeline_steps` carries `ENABLE` + `FORCE ROW LEVEL SECURITY` (`V35__rls_owner_only_tables.sql:60-67`) with an indirect-owner policy reading `current_setting('app.current_user_id')` **without** `missing_ok`.

## Goals / Non-Goals

**Goals.** Delete the Phase-1 invariant at all three sites. Generalize the walk to a DAG. Add a lane-kind secondary input to `join`/`union`/`lookup`. Reject cycles at write and run time. Generalize analyze/capabilities/preview/run-reporting to any node in any lane. State the engine contract explicitly. Correct the now-false spec sentence.

**Non-Goals.** The editor (P2.2), multi-root pipelines (P2.3), MCP and proposals (P2.4). Implementing the multi-lane walk on Spark (HEL-238) — only the `PipelineExecutionBackend` contract must still compile.

## Decisions

### Decision 1 — Secondary input is a discriminated object, cut over hard by migration

**Escalated; owner answered B, against both the orchestrator's and the coordinator's recommendation of A, with the tradeoff stated.**

`join` / `union` / `lookup` configs replace the flat `otherDataSourceId: String` with:

```
"secondaryInput": { "kind": "source", "dataSourceId": "<id>" }
"secondaryInput": { "kind": "lane",   "stepId":       "<id>" }
```

There is **no legacy read path**. The tolerant decoders no longer accept a flat `otherDataSourceId`; a config still carrying it is a rejected config, not a silently-upgraded one. A Flyway migration (**V97**) rewrites every persisted config to the new shape in the same commit.

*Rationale, as the owner decided it.* The remodel spec's decision 11 is "no deprecation — delete retired structures wholesale, no shims." Option A (map the legacy shape at read time) is cheaper and avoids a migration, but it is exactly the shim decision 11 forbids, and it leaves a second config shape alive in the codebase for HEL-914's MCP surface to have to know about. The owner chose decision-11 literalism over migration-avoidance, knowing the cost.

*Consequence the option was labelled with, and which is now this change's responsibility.* The spec sentence at `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:160` ends **"No data-model change."** V97 makes that false. It is corrected **in place, in the same commit as the migration**. A merged spec line contradicting shipped code is the defect class the recent batch repeatedly found, and it would be worse here: three downstream tickets will read that line while being planned.

**Migration constraints — all three are hard requirements, not preferences.**

1. **RLS posture.** `pipeline_steps` is FORCE RLS with a non-`missing_ok` `current_setting` policy. Flyway migrates as bare `helio`, which is **not** superuser and does **not** have BYPASSRLS; local dev, CI and prod-dump replay all connect as **superuser** and mask the failure completely. This is precisely what broke v0.7.8/9/10. V97 brackets its `UPDATE` with `ALTER TABLE pipeline_steps NO FORCE ROW LEVEL SECURITY;` … `ALTER TABLE pipeline_steps FORCE ROW LEVEL SECURITY;`, copying `V96__canonicalize_inferred_schema_type.sql` (which deployed successfully in v0.7.13) and V94 sections 0/22. The migration role owns the table it created, so `NO FORCE` lets it bypass RLS for the statement without `app.current_user_id` being set at all, and the FORCE posture is restored immediately.
2. **Coverage by the right gate.** `FlywayNonSuperuserMigrationSpec` is the only test that actually exercises the non-superuser role. V97 must be covered by it. **A green local run proves nothing here** — that is the entire lesson of the three failed deploys.
3. **Byte-identical passthrough.** Because `config` is `TEXT`, not `JSONB`, any row routed through a `::jsonb` round-trip comes back with reordered keys and normalized whitespace. The `WHERE` clause must therefore be strict enough that a config the migration should not touch is **never** rewritten — proven byte-for-byte, not asserted.

**Evidence required before this is called done** (the migration rewrites persisted user data): before/after row shapes on a seeded fixture; idempotence (re-running V97's statement is a no-op); byte-identical passthrough for a non-matching config; and, wherever obtainable, verification against **real dump-shaped data** rather than only hand-built rows — hand-built fixtures have repeatedly failed to find defects that real ones caught.

### Decision 1a — No deprecation: one shape, everywhere, enforced

**Product-owner reinforcement of Decision 1.** The remodel's standing principle is *no deprecation — a totally new system*. This is the same rule under which Types and Metrics were deleted wholesale rather than deprecated (`/api/types` and `/api/metrics` now 404 outright — no shim, no redirect). Q1 = B was chosen **because it is the answer consistent with that principle**, not merely because a migration was tolerable. The migration is therefore not the whole of the work; it is one layer of it.

**The legacy read path is deleted, not retained as a fallback.** After V97 the flat shape is not a legacy input — it is an **invalid** one. The tolerant `decode` in `UnionStep` / `JoinStep` / `LookupStep` must stop understanding it altogether. It is explicitly **not** acceptable to leave it as a harmless "just in case" fallback: a fallback that never fires is untested code that silently changes behaviour the day it does fire, and it is precisely the deprecation this principle forbids.

**Failure must be loud and named.** Consistent with HEL-814, which hardened the step-config decoders to raise on shape mismatch exactly because silently-tolerant decoding was producing degraded values that looked like successes: a flat `otherDataSourceId` / `rightDataSourceId` / `referenceDataSourceId` arriving after this ships is a hard, named error — **not** a default and **not** a silent `{kind:"source"}` coercion.

**What errors is the legacy *flat field*. An empty `dataSourceId` inside the *new* shape is a different thing, and stays legal.** These two must not be conflated (round-1 skeptic CR1 — an earlier draft of this document did conflate them, and its own spec deltas contradicted it):

- `{"otherDataSourceId": "..."}` — the **legacy flat shape**. Invalid. Hard named error. This is what Decision 1/1a is about.
- `{"secondaryInput": {"kind": "source", "dataSourceId": ""}}` — a **well-formed new-shape config with an unset source**. This is the "+ Add transformation step" picker's incomplete draft, and it remains **legal and accepted**, exactly as HEL-950 established. It does not trigger the ownership check and does not 404.

This is not a softening of the owner's decision; it is the decision applied to the right object. The owner forbade tolerating the *old shape*. An unset second source in the *new* shape is ordinary in-progress authoring, and HEL-950's guard against treating it as a referenced-but-unowned source stays fully in force.

**One bounded, deliberate exception, recorded rather than left to be discovered.** Read literally, V97's rule *is* a legacy flat field being coerced into `{kind:"source"}` with an empty id — at the **migration layer, once**. That is the one place this change does what Decision 1a otherwise forbids. It is accepted because the alternatives are destroying two real saved user drafts or converting them into hard read-time failures, neither of which was asked for and both of which are worse. The prohibition remains absolute where the owner aimed it: the **runtime decoder**, which is strict, with no legacy branch at all.

**This is forced by real user data, not a hypothetical.** The real dump fixture `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` contains **two `lookup` rows with `"referenceDataSourceId": ""`** (lines 10163 and 10230) — genuine saved incomplete drafts. With no legacy read path, whatever V97 emits for them is what every future read gets. **V97's explicit rule: an empty legacy id maps to `{"kind": "source", "dataSourceId": ""}`** — preserved as a draft, never dropped, never errored, never rewritten to a lane-kind input.

**Three legacy field names, not one.** The three ops do not share a field name, and every surface below must be checked for all three:

| op | legacy field | replaced by |
| --- | --- | --- |
| `union` | `otherDataSourceId` | `secondaryInput` |
| `join` | `rightDataSourceId` | `secondaryInput` |
| `lookup` | `referenceDataSourceId` | `secondaryInput` |

**Enumerated surfaces that must accept only the new shape.** This list was produced by grepping the live tree for all three field names (archived `openspec/changes/**` excluded — those are historical records and are correctly left alone). Any surface here that is not converted is in scope for this change, or is a defect this change must name explicitly:

- `backend/src/main/scala/com/helio/domain/steps/UnionStep.scala`, `JoinStep.scala`, `LookupStep.scala` — typed configs + tolerant decoders (the core deletion).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepConfigCodec.scala` — wire codec.
- `backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala` — the patch-set/refinement apply path.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — the Dataproc contract surface. Must still compile and must not serialize the old shape; implementing the multi-lane walk on Spark remains HEL-238's.
- `frontend/src/features/pipelines/types/pipelineStep.ts`, `state/stepNarrowing.ts`, `ui/stepConfigs/UnionConfig.tsx` (and the join/lookup config editors).
- `helio-mcp/src/tools/write.ts` — MCP tool schemas.
- `schemas/pipelines/*` — **no action; the premise was false.** `create-pipeline-step-request.schema.json` types `config` as an opaque `{"type": "object"}`, and no file under `schemas/` models step configs or mentions any of the three field names. `check:schemas` and the schema-drift check therefore **do not cover step-config shape at all** today. This change does **not** introduce a new step-config schema surface: doing so would be unbid scope that three downstream tickets would then be planned against. Recorded here so the gate is not cited as evidence it cannot supply (round-1 skeptic CR3, lesson 4).
- `openspec/specs/pipeline-union-op/spec.md`, `openspec/specs/patch-set-apply/spec.md`, `openspec/specs/conversational-refinement/spec.md`, and the join/lookup op specs.
- `backend/scripts/repair-dev-db.sql` — **writes** the legacy flat shape into the dev DB. Post-V97 it would re-create rows no read path can decode. Must be converted (round-1 skeptic CR5).
- `backend/README.md` — documents the flat shape.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — matches all three field names; covered by the §3.3/§6 work, listed here so this enumeration is actually exhaustive.
- **~17 backend/frontend test files** constructing the legacy shape — see §11 of `tasks.md`; these are not a mechanical find-and-replace.

**Sharpened migration proof obligation.** Because no read path can cope with a row V97 misses, **complete coverage is a correctness requirement, not a tidiness one** — a skipped row is a hard read-time failure, not a graceful degradation. The proof must therefore include: a count of rows matching the old shape **before** the migration, the same count **after** (which must be **zero**), for **all three** field names, and confirmation on **real dump-shaped data** rather than only hand-built fixtures.

### Decision 1b — An absent `secondaryInput` is tolerated; a legacy flat field is not

**Not escalated — resolved here, from an existing live requirement.** Round 3's property sweep surfaced a direct collision between "the decoder is strict" and a live requirement this change must not break: `pipeline-step-config-read-strictness` → *"An absent or empty configuration key SHALL remain tolerant on the read path"*, whose stated rationale is that **every** read of a stored step decodes its config, so a decode failure there is a server error that stops the editor opening at all. Half-configured steps are "a legitimate, currently-occurring state in production."

The two are reconciled by distinguishing **absent** from **present-but-invalid**, which is the distinction that requirement itself already draws:

- **Absent `secondaryInput`** → decodes to the tolerant default `{"kind": "source", "dataSourceId": ""}`. An unconfigured second input; exactly the incomplete-draft state that requirement exists to protect.
- **Present legacy flat field**, unrecognised `kind`, or `kind` paired with the wrong field → **hard named error**. This is a present key of the wrong shape, which the same capability's *other* requirement already says SHALL fail to decode.

This is consistent with Decision 1a rather than a softening of it: what the owner ruled out was *tolerating the old shape*, and the old shape still errors. It is also the same distinction Decision 1a already draws for the empty id. Post-V97 no stored row lacks `secondaryInput`, so this branch is reachable only for a config that never went through the migration — but the live requirement is written about the read path in general, and silently breaking it would trade a config defect for an editor outage.

**Flagged for the owner:** this is the one place where round 3's sweep forced a judgment rather than surfacing a defect. It is recorded as a decision so it can be overturned cheaply if the owner reads Decision 1a as also forbidding the absent-key default.

### Decision 2 — Topological DAG walk, sibling `position` as the deterministic tiebreak

**Escalated; owner answered A, as recommended.**

A lane reference is a **real dependency edge**, not merely a config value. Evaluation order is a topological sort over (parent → child) edges *and* (referenced-lane-node → rejoin-step) edges. Among nodes not otherwise ordered by that sort, sibling `position` ascending is the tiebreak, so evaluation order is fully deterministic for a given graph.

Any acyclic reference is legal — a rejoin may consume a lane anywhere in the graph, not only a lower-positioned sibling under a common ancestor. The rejected alternative (a purely positional walk permitting only rightward rejoins) is simpler, but it would hard-constrain HEL-912's editor to rightward-only rejoins and would very likely have to be undone by HEL-913.

The `position`-as-tiebreak rule is what preserves **P1.2 parity**: for a pure trunk, or a trunk-plus-tails graph with no lane references, the topological order with this tiebreak reduces to exactly today's walk order, and output must be byte-identical. That parity is a required test, not an expectation.

### Decision 3 — A lane reference may name any node, and a lane may be consumed more than once

**Escalated; owner answered A, as recommended. This deliberately overrides the ticket's own prose.**

`{ kind: "lane", stepId }` may name **any** node in another lane; the rejoin consumes that node's **post-evaluation frame**. One lane may be consumed by several rejoins — **diamonds are legal**.

The ticket text says *"its config names the other lane's **terminal** step."* That prose is **superseded by owner decision.** A future reader should meet this as a decision, not as a contradiction. Two reasons it was overridden: the same ticket requires capabilities-and-analyze at *any* node in any lane, which reads as deliberate; and the terminal-only, single-consumer reading would make a diamond illegal, which nothing in the remodel spec asks for.

This is free at runtime: `TreeWalkResult.nodeOutcomes` already retains every node's frame for the whole run, so no new retention, and no re-evaluation, is introduced.

## Engine contract

**This section is a deliverable.** HEL-912, HEL-913 and HEL-914 are planned from it. Changing anything here after this ticket merges is a contract change affecting three tickets.

1. **Graph shape.** A pipeline is a DAG rooted at the source root (the virtual root, `nodeId = None`). Any node may have any number of step children. There is no structural fence: the Phase-1 "at most one `position = 0` child" and "no `position >= 1` child below a tail" rules are **deleted at all three enforcement sites**, not retained as a mode or a flag.
2. **"Trunk" is not an engine concept.** It is a UI notion owned by P2.2. The engine must contain no branch that treats a `position = 0` child as structurally special beyond its role as the ordering tiebreak.
3. **Lane independence.** Each child of a node is evaluated from **that node's** frame. Sibling lanes never observe each other's rows, and never thread into each other, until a rejoin step consumes one explicitly.
4. **Ordering.** Topological over parent→child and lane-reference→rejoin edges; sibling `position` ascending as the tiebreak. Deterministic for a given graph. Reduces exactly to the P1.2 walk order when no lane reference exists.
5. **Secondary input.** `join` / `union` / `lookup` take `secondaryInput: {kind:"source", dataSourceId} | {kind:"lane", stepId}`. **No other shape is accepted anywhere** — not by the engine, the wire codec, the MCP tools, the frontend editors, the patch-set apply path, or the Spark submitter. **`schemas/` is deliberately absent from this list:** no file under `schemas/` constrains step-config shape today (`config` is an opaque `{"type":"object"}`), so there is no `schemas/` enforcement point for this shape and this change does not create one — see Decision 1a. HEL-914 must not be planned against a `schemas/` gate that does not exist. The pre-V97 flat fields (`otherDataSourceId` / `rightDataSourceId` / `referenceDataSourceId`) are invalid input and raise a hard, named error (Decision 1a).
6. **What a lane reference may name.** Any node **belonging to the same pipeline** that is not the referencing step itself and not one of its own ancestors. The frame consumed is that node's **post-evaluation** frame. Multiple rejoins may reference the same node.
6a. **Same-pipeline membership is validated, and is a security boundary.** A `lane` `stepId` naming a step that does not exist, or that belongs to a **different pipeline** (including another user's pipeline), is rejected **at write time with a named error** and **defensively at run time**. This is not a tidiness check. Contract item 10 switches the data-source ACL *off* on the lane branch, justified entirely by the referenced node being in the same pipeline — so if membership is unvalidated, that justification is false and an unvalidated `stepId` arriving from the MCP/proposal surface (HEL-914, planned from this document) is a **cross-tenant read**. Cycle detection cannot catch this: a dangling or foreign id forms no cycle. (Round-1 skeptic CR2.)
6b. **Write-path caveat — an inherited request-body convention, NOT an engine limit.** Read this before concluding the DAG contract is weaker than items 6/6a state. It is not.

   **The engine permits what item 6 says it permits.** On the incremental path (`POST /api/pipelines/:id/steps`, step update), `validateLaneReference` constrains exactly three things — the referenced step must **exist**, must not be the step itself, and must not be an ancestor. Any acyclic reference to any existing node is accepted, which is Decision 2 (Q2=A) implemented faithfully. There is no ordering constraint of any kind.

   **The constraint is on one request encoding, and it predates this change.** A `clientId`-bearing request body — single-call `POST /api/pipelines`, and the proposal apply path — requires a reference to name a `clientId` appearing **earlier in the same request's `steps[]` array**, because those bodies are resolved in a single left-to-right fold. This is **not a rule HEL-911 invented**: at base `a9d1bdcd`, `PipelineService.scala:252` already rejected an unresolvable `parentStepId` with *"it must be an earlier step's clientId in this same request"*, and `PipelineProposalService.scala:202` states the same rule for the proposal path (HEL-907 task 1.1). HEL-911 applies the **existing** convention consistently to the new `secondaryInput` field rather than leaving it as the one clientId-bearing field with no resolution rule. A forward reference fails with a named `BadRequest` identifying the unresolved clientId — never silently persisted as an unrewritten clientId (the cycle-3 defect), never a crash.

   So: **a body-encoding rule, not an engine limit.** The same lane reference is fully legal built incrementally, and once stored behaves exactly as items 6/6a describe.

   **HEL-914 inherits no new constraint.** Its single-call `create_pipeline` must *already* emit `steps[]` in dependency order to resolve `parentStepId` through the same fold. And dependency order is the natural shape anyway: a rejoin comes after both lanes it consumes, so a backward reference is the default, not a restriction. 914 needs no special handling — it needs only to keep doing what `parentStepId` already requires.

   **If forward references are ever genuinely needed, here is the measured cost** (recorded so it need not be rediscovered): `updateInternal` returns a `Future`, not a composable `DBIO`, so a second in-transaction pass requires a **new repository DBIO action** alongside the existing `insertInternalAction`; plus restructuring `buildStepsAction` (141 lines, currently one fold threading `clientIdMap` as its accumulator) into insert-all → build-full-map → update lane-bearing steps. Roughly 30–50 lines across two files, plus tests. Contained; no ripple beyond `PipelineService` and `PipelineStepRepository`.

7. **Cycle rejection.** A reference reaching the referencing step's own ancestor is rejected **at write time with a 400 naming the cycle**, and **defensively at run time**. Both arms are required; the run-time arm is a backstop for data that reached the table by some other path, and must not be dropped because the write-time arm exists.
8. **What a rejoin may rely on.** By the time a rejoin step evaluates, every node it references has already evaluated, and its frame is present in `nodeOutcomes` keyed by `Some(stepId)`. `nodeOutcomes` retains **every** node's frame for the whole run (not only materialized nodes, and not only terminal nodes). **Superseded (HEL-913):** this item's keying is single-root-shaped (`Some(stepId)` alone). Under multi-root, `nodeOutcomes` is keyed by the `NodeKey` root sentinel described in `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md` § R4 — read R4 for the current keying contract; do not implement against this item's `Some(stepId)` form.
9. **Disabled steps.** Unchanged from P1.2 Decision 7 — a disabled node is transparent: never evaluated, its incoming frame passes through unchanged, and it gets no `stepCounts` entry. A **lane reference to a disabled node** therefore resolves to that node's passed-through incoming frame, which is the existing semantics applied unchanged rather than a new rule.
10. **ACL.** A `source`-kind secondary input keeps today's owned-data-source pre-flight, **including HEL-950's empty-seed-id guard** (an empty `dataSourceId` is an incomplete draft, permitted, no ownership check). A `lane`-kind secondary input has no data-source ACL to apply: the pipeline's own ACL is the entire gate — **but only because item 6a validates that the referenced node really is in the same pipeline**. Item 10 is unsound without item 6a; they ship together. The lane-kind branch must not fall through into the source-kind check with an empty id — that is exactly the shape HEL-950 hardened, and this change introduces a second code path past that guard.
11. **Reporting.** Per-node row counts are reported for every node across all lanes. A failing step names its **lane path**, extending HEL-859's "name the failing step and its reason." **Lane path format** (pinned here so HEL-912 renders and HEL-914 reports the same thing, rather than three tickets renegotiating it): the ordered list of step ids from the source root to the failing step inclusive, joined by `" > "`, with the virtual root rendered as `root`. Example: `root > s1 > s4 > s7`. Ids, not names — names are mutable and non-unique; the editor may substitute display names at render time. **Superseded (HEL-913):** this item's path format assumes a single, unnamed `root`. Under multi-root, the runtime graph path is `root:<rootId> > s1 > s4` — see `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md` § R5 for the current format and why it does not conflict with HEL-914's `roots[1] › steps[3]` request-address format. Do not emit this item's bare `root > ...` form.
12. **Analyze / capabilities / preview.** All three operate at any node in any lane. A rejoin's projected schema is derived from **both** of its inputs.

## Delta-authoring disposition (round-3 CR1)

**Rule applied:** every `## MODIFIED` / `## REMOVED` block must be titled with the **exact** requirement header as it appears in the corresponding live `openspec/specs/<cap>/spec.md`, because OpenSpec matches on that header at archive time; a MODIFIED block whose title does not match adds a *new* requirement alongside the legacy text instead of replacing it. Where the intended change is genuinely new behaviour with no live counterpart, the block is `## ADDED`. Where the live requirement is stated in terms of a field this change deletes **and its scenario titles embed that field name**, the requirement is `## REMOVED` (with Reason + Migration) and replaced by an `## ADDED` one, rather than MODIFIED — copying those scenario titles verbatim, as MODIFIED requires, would ship scenario names referring to a field that no longer exists.

**Verification:** a header-match check asserts that every MODIFIED/REMOVED requirement title exists in the corresponding live spec. It currently reports **0 mismatches** across all 16 delta files. It found one real error `openspec validate` did not — "The repository exposes tree-ordered reads" was filed under `pipeline-steps-persistence` when it actually lives in `pipeline-step-tree`; validate passed because it only checks scenario preservation for requirements it *finds*. That is precisely the round-3 CR2 gap, and it is why this check exists separately from validate.

**A header match is necessary but NOT sufficient — the round-4 finding.** A delta can be 100% header-matched, pass `openspec validate`, and still leave the legacy text standing, because a capability has *many* requirements and a delta may touch only some of them. `pipeline-union-op` has 7 live requirements; an earlier draft touched 2, leaving 4 others (descriptive-failure, analyze passthrough, frontend StepCard editor, MCP `add_pipeline_step`) specifying the config as `otherDataSourceId` — so one capability file would have shipped specifying **two contradictory config shapes**, with the frontend and MCP surfaces that contract item 5 explicitly puts in scope described in the deleted shape. This is round 1's failure mode at a third, finer granularity: file-level coverage is not requirement-level coverage.

**The check that actually discriminates** (`tools/check-legacy-field-coverage.py`): for every **requirement** in every live spec whose *body* matches any of the three legacy field names, assert that a delta block exists for that exact requirement. Keyed on the property, not on a file list or a header list. When first run it reported **11** uncovered requirements — not the 4 found by reading, because it also caught all of `pipeline-lookup-op`. Now reports **0**. Both checks (`tools/check-delta-headers.py`, `tools/check-legacy-field-coverage.py`) must be green before this change is considered plannable, and re-run after any delta edit.

**Per-capability disposition:** MODIFIED against a matched live header — `conversational-refinement`, `patch-set-apply`, `pipeline-analyze-api`, `pipeline-capabilities-api`, `pipeline-execution` (×2), `pipeline-lookup-op` (×2), `pipeline-preview-api`, `pipeline-run-execution` (×2), `pipeline-run-sse`, `pipeline-step-config-read-strictness`, `pipeline-step-config-rejection`, `pipeline-step-config-validation`, `pipeline-step-tree` (×2), `pipeline-steps-persistence`, `pipeline-union-op`. REMOVED + replaced by ADDED — `pipeline-joinstep-right-source-acl` (×2), `pipeline-union-op` (ACL requirement), `pipeline-execution` (the Phase-1 invariant requirement, removed outright). Purely ADDED — `pipeline-lane-walk`, `pipeline-lane-rejoin-input`.

## Risks / Trade-offs

- **The migration is the highest-risk element of this change** — it rewrites persisted user data on an RLS-forced table under a non-superuser role, in a repository where that exact combination has already caused three production incidents. Mitigated by the V96 bracket pattern, `FlywayNonSuperuserMigrationSpec` coverage, and the before/after + idempotence + byte-identical-passthrough evidence required by Decision 1.
- **The hard cutover has no rollback path in the config layer, in either direction.** Once V97 runs, a rolled-back binary reading the new shape with old decoders fails; and because Decision 1a deletes the legacy read path, a row V97 *misses* also fails hard at read time rather than degrading. This is inherent in the owner's Decision 1/1a and is accepted, not mitigated — which is exactly why complete migration coverage is a proof obligation (before-count, after-count zero, all three field names, on real dump-shaped data).
- **Surface sweep completeness.** The enumerated surface list in Decision 1a was keyed on three *field names*. Per the batch lesson that "an audit keyed on one function name structurally cannot see sites reaching the property another way," the executor must additionally sweep for the *property* — any code path constructing or consuming a join/union/lookup secondary input — rather than trusting the three-name grep alone. `SparkJobSubmitter.scala` was found only because the sweep was widened past the first field name.
- **Parity risk.** Generalizing the walk could silently change evaluation order for existing pipelines. Mitigated by the P1.2 parity requirement in Decision 2 — byte-identical output for graphs with no lane reference — which is a required test.
- **Deleting a guard is not the same as the shape becoming safe.** HEL-930 added the repository-side `InvalidGraph` because `.find` was *silently dropping* a second position-0 sibling. Removing that throw must be accompanied by the traversal actually handling multiple children, not by restoring the silent drop. This is the single most likely way to get this change wrong while every test stays green.
- **The silent-first-match shape is in the engine too, not only at the HEL-930 site.** `InProcessPipelineEngine.expandChain` and `walkTrunk` both call `childrenOf(...).find(_.position == 0)`. Those `.find`s are safe *today only because* `validateGraph` guarantees at most one such child — and §3.1 deletes `validateGraph`. So deleting the pre-flight silently converts both engine sites into the exact silent-drop defect HEL-930 was filed for. The guard must be keyed on the **property** (any site selecting one child where several may now exist), not on the HEL-930 site alone. (Round-1 skeptic CR6, lesson 6 — an audit keyed on one site cannot see the others.)

## Migration Plan

`V97` rewrites `pipeline_steps.config` for `op IN ('join','union','lookup')` rows carrying the flat shape, into the discriminated `secondaryInput` shape; brackets the `UPDATE` with `NO FORCE` / `FORCE ROW LEVEL SECURITY`; is idempotent; and leaves every non-matching config byte-identical. Covered by `FlywayNonSuperuserMigrationSpec`.

## Open Questions

None. The three that existed were escalated and answered (Decisions 1–3).

## Change record (HEL-911 execution)

- **Task 10.3 — Decision 3 vs. ticket prose.** Recorded: Decision 3 ("a lane reference may
  name any node, not only the other lane's terminal step, and a lane may be consumed more
  than once") supersedes the ticket's own prose ("its config names the other lane's terminal
  step"). This is an owner decision, not a contradiction — see Decision 3 above.
- **Task 12.6 — `pipeline-run-truncation-reporting` finding.** No change needed, confirmed by
  code inspection: `truncatedReads` is built exclusively from `PipelineExecutionContext
  .loadSource`'s truncation callback, and `JoinStep`/`UnionStep`/`LookupStep.evaluate` call
  `ctx.loadSource` ONLY on the `SecondaryInput.Source` branch — the `SecondaryInput.Lane`
  branch resolves via `ctx.resolveLane` exclusively and never touches `loadSource` or
  `dataSourceRepo`, so no data-source resolution (truncated or otherwise) is ever attempted
  for a lane-kind input.
- **Task 7.1/7.2 — analyze's "rejoin schema from both inputs" — SUPERSEDED by cycle 2, see
  below.** The note that originally stood here (best-effort passthrough only, no real
  cross-lane derivation) was wrong to leave standing: evaluation-1.md CR3 required real
  both-input derivation, and it turned out to be genuinely feasible for `lane`-kind (the
  referenced node is in the SAME `steps` list `analyzeNodes` already has, unlike a
  `source`-kind secondary input's `DataSource`, which this layer still cannot resolve — no
  repo access, unchanged). Implemented in cycle 2: see "Cycle 2 (evaluation-1.md)" below.
- **Task 11.14 — why each converted test datum had to change.** The ~17 backend test files
  constructing the legacy flat shape were converted uniformly to the discriminated
  `secondaryInput` shape because Decision 1/1a made the flat shape invalid input (a hard,
  named decode error) — every construction of `JoinConfig("id", ...)` /
  `UnionConfig("id", "mode")` / `LookupConfig("id", ...)` (positional first-arg = the flat
  id) and every literal `{"rightDataSourceId": ...}` / `{"otherDataSourceId": ...}` /
  `{"referenceDataSourceId": ...}` JSON body had to become `SecondaryInput.Source("id")` /
  `{"secondaryInput": {"kind": "source", "dataSourceId": ...}}` respectively, or the test
  would no longer compile/would assert against input the decoder now rejects. This is a
  pure representation change, not a behavior change: every converted test's INTENT (which
  case it exercises, what it asserts) is unchanged — only the literal shape used to express
  "a source-kind second input with this id" moved. `PipelineStepSecondSourceGuardSpec` (HEL-
  950's guard) was reworked more substantially: its reflection now keys on the field's TYPE
  (`SecondaryInput`) rather than a `*DataSourceId` name-suffix convention (the convention the
  legacy shape used, now gone), and it re-proves HEL-950's guard by breaking BOTH legs
  independently — Leg 1 (empty source id → no ACL check) and Leg 2 (lane-kind → no ACL
  fall-through to the source-kind check at all, Engine contract item 10) — rather than only
  re-asserting the single pre-existing leg.
- **Task 2.7 — real dump-shaped data.** Obtained: `hel904-real-dump.sql` carries six real
  legacy-shaped rows across `union`/`lookup` (no `join` row) — used directly in
  `FlywayNonSuperuserMigrationSpec`. A synthetic `join` row (`rightDataSourceId`) was seeded
  alongside the dump load, attached to an existing dump pipeline id, since the real dump
  carries zero `join` rows and design.md's "all three field names" proof obligation requires
  covering `join` too — recorded here rather than silently substituting a fully hand-built
  fixture for the whole proof.
- **Repository `executionOrder` listing order.** Kept the pre-HEL-911 emission SHAPE
  (a node's non-zero-position children before its zero-position continuation, generalized
  from "the" trunk child to "the" — now plural — trunk children) rather than adopting a
  uniform ascending order, because several pre-existing `PipelineStepRoutesSpec` tests assert
  this exact listing order and nothing in HEL-911's own scope asked this LISTING helper to
  change (the Engine contract binds `InProcessPipelineEngine`'s evaluation-order walk, a
  separate, independently-realized function, `structuralRank`). Both were verified against
  the full P1.2 parity + new lane-rejoin test suite, not merely reasoned about in prose.

## Cycle 2 (evaluation-1.md) — change requests addressed

- **CR1 (restored, not redefined).** `TreeWalkResult.rows` was found to have silently changed
  meaning: `structuralRank` visits a node's tails AFTER its own position-0 continuation, so
  `executeTree`'s `lastFrame`-based `rows` returned the wrong node's frame the moment the
  trunk terminal itself had a tail — a real correctness regression (it fed
  `pipelines.last_run_row_count`, `pipeline_runs.row_count`, SSE `succeeded`, and, worst,
  `binaryRefRepo.overwriteForNode`'s node key/value pair). Fixed by RESTORING trunk-terminal
  semantics: `rows` is now `stepRepo.trunkOf(steps).lastOption`'s frame, the exact same anchor
  `PipelineRunService`'s binary-refs write key already uses, so the two can never disagree
  again structurally (both read the identical function). The `PipelineRunService.scala:418`
  comment needed NO fix — it already correctly said "outcome.rows is always the TRUNK's
  terminal frame"; it was the CODE that had drifted from the comment, not the reverse. Two new
  parity tests added to `InProcessPipelineEngineTreeWalkSpec`, each independently verified red
  against the pre-fix `lastFrame` code (temporarily reverted, re-tested, re-restored) before
  being left green.
- **CR2 (re-derived sweep).** Re-swept the whole backend keyed on the property "a child-set
  access that collapses `childrenOf`'s (or an equivalent) result to a single element" rather
  than the two evaluator-named sites. Total sites found: **eight**, three of which were not
  named by the evaluator (one of them, `PipelineStepRepository.deleteInternal`, was found only
  by the re-derived sweep and is recorded below as the "third site" the coordinator asked to
  watch for):
  1. `InProcessPipelineEngine.structuralRank`/`executeTree` — already safe (cycle 1): uses
     `childrenOf(...).flatMap`, never `.find`/`.headOption`.
  2. `PipelineStepRepository.executionOrder` — already safe (cycle 1): generalized to
     `trunkChildren.flatMap` (plural), never drops a sibling.
  3. `PipelineStepRepository.trunkOf` (`.find(_.position == 0)`) — KEPT as a deliberate,
     documented single-anchor convention (see the method's own scaladoc, expanded this cycle):
     every one of its callers needs exactly ONE scalar anchor, and "first `position == 0`
     child, ties broken by Vector order" is now explicit and proven deterministic by a new
     test, rather than an unstated accident of `.find`'s iteration order.
  4. `PipelineStepRepository.tailsOf`'s `expand` (`.headOption`) — FIXED outright (`flatMap`
     over all children): unlike `trunkOf`, `tailsOf`'s whole contract is "every tail, in
     full", it has no live production caller to argue a single-anchor convention is needed,
     and a new test proves no descendant is dropped when a tail node has two of its own
     further children (legal now that the Phase-1 fence is gone).
  5. **`PipelineStepRepository.deleteInternal`'s `childrenSorted.headOption` — the THIRD site,
     found only by the re-derived, whole-backend sweep, not named by the evaluator.** This one
     is more serious in KIND than 3/4: it is not a listing collapse, it is a DELETE — every
     child but the lowest-position one has its ENTIRE SUBTREE DELETED from the database on a
     parent delete. Investigated and determined this is a DELIBERATE, PRE-EXISTING product
     policy (documented in the method's own comment before this ticket, in the plural — "every
     OTHER child... is deleted outright" already covered multiple pre-existing tails), whose
     correctness never depended on the "at most one position == 0" guarantee this ticket
     removes (the selection rule was already position-agnostic). NOT changed by this ticket —
     redesigning delete to preserve every lane rather than absorbing one is a product decision
     with its own UX implications, recorded as a spinoff candidate for P2.2, not bundled in
     here. Documented prominently at the method itself so it is not rediscovered as a surprise.
  6. `PipelineService.scala` (`addStep`'s `.orElse(trunkOf(current).lastOption...)`, the
     lane-cycle-check anchor) — documented inline this cycle: uses the SAME `trunkOf` anchor
     `persistNewStep` will actually splice onto, so the cycle-check's ancestor chain can never
     silently diverge from where the step is actually placed.
  7. `PipelineService.scala` (`persistNewStep`'s own default-append anchor, same `trunkOf(...)
     .lastOption` call) — same convention as 6, already documented at `trunkOf` itself.
  8. `PipelineRunService.scala` (binary-refs write key, `trunkOf(steps).lastOption`) — now
     provably consistent with `rows` by construction (CR1 above), not merely by convention.

  No further (ninth) site was found after the re-derived, property-keyed, whole-backend sweep.
- **CR3 (implemented, not weakened).** Real attempt made and it succeeded for the case the
  shipped delta's own scenario actually tests (`lane`-kind secondary input): `analyzeNodes`
  was generalized from a top-down `parentStepId`-only walk into a Kahn's-algorithm-style
  topological pass (mirroring `InProcessPipelineEngine.executeTree`'s own structure, at the
  schema layer) that defers a rejoin node until its referenced lane node's projection is
  available, then derives the rejoin's schema from BOTH inputs — `union`/`lookup` merge/type
  from the real resolved secondary schema; `join` gained a REAL dispatch case for the first
  time (it had none before this ticket, silently reporting a spurious "Unknown op: 'join'" on
  every analyze call — fixed as part of this). For a `source`-kind secondary input,
  `secondarySchema` is still `None` (this layer has no repo access to a `DataSource`'s
  schema, unchanged, always true, not something this ticket could fix without a genuinely new
  architecture) — that half degrades to the pre-existing best-effort passthrough, exactly as
  the shipped scenario's own text implies by only testing the lane-kind case. Six new tests in
  `PipelineAnalyzeServiceSpec` exercise the shipped scenario directly (merge, a field the
  parent lane never had, join's right-wins collision rule, `join`'s new dispatch case, lookup's
  real per-column typing, and the source-kind degrade-gracefully case) — task 11.8 is now
  genuinely, not nominally, satisfied.
- **CR4 (tests added, verified red individually).** Seven codec-layer tests + three route-layer
  (422) tests added covering Decision 1a's headline behaviour: legacy field present (all three
  ops), unrecognised `kind`, `kind` paired with no companion field, and — CR4d — a legacy field
  present ALONGSIDE a valid `secondaryInput` (proving `decodeStrict`'s legacy-check-first
  ordering). All seven codec-layer tests were confirmed to fail individually (not as a batch)
  against a temporarily-reverted `decodeStrict` (the legacy-field check removed), then
  confirmed to pass again once restored.
- **CR5 (tests added, verified red individually; transactional-create path extended).** Five
  route-layer tests (another user's pipeline, nonexistent stepId, self-ancestor cycle, valid
  sibling-lane acceptance, and the PATCH arm) plus three service-layer tests against
  `createTransactional`'s single-call path (dangling clientId, cycle, valid acceptance) — all
  eight independently confirmed red against a temporarily no-op'd validation branch, then
  green once restored. `PipelineService.validateStepCrossOwnerRefs` (the transactional-create
  path's own pre-flight) was extended with the same three lane checks
  (exists-in-this-request / not-self / not-an-ancestor) `validateLaneReference` performs for
  the per-step `addStep`/`updateStep` paths — it previously validated `secondaryDataSourceId`
  only, so a `lane`-kind `stepId` in a single-call `POST /api/pipelines` request persisted with
  no write-time check at all (the run-time defensive arm still caught it once persisted, since
  `executeTree`'s `byId` is pipeline-scoped, but contract item 6a requires a write-time,
  named-error rejection specifically).
- **CR6 + non-blocking suggestions.** Two new frontend tests assert the exact persisted payload
  shape for `onUnionChange`/`onLookupChange` (the wire-shape-widening seam CR6 flagged as
  untested). The `pipeline-lane-rejoin-input` RFC-2119 warning is fixed (SHALL/NOT REQUIRED
  wording); `openspec validate --strict` now reports zero warnings, not merely exit 0. The
  indentation drift at `PipelineStepRepository.scala` (`executionOrder`'s `val` alignment) is
  fixed. The stale test names/comments still referencing the deleted flat field names (bodies
  were already correct) are updated to name `secondaryInput` instead.

## Cycle 3 — escalated ruling, spinoffs, and a dispute resolved

### The analyze delta was narrowed, by product-owner ruling, as a correction of a spec overreach

Escalated rather than absorbed, because it reduces a **shipped contract** and HEL-912/913/914 are planned from this file. Ruling: **narrow the delta and file a spinoff** (`extend-scope-now` rejected as unbid architectural change at the last execution cycle; `defer-to-p22` rejected because HEL-912 is editor work and an engine-layer async refactor would be buried there).

The correction is recorded **in the delta itself**, not only here, and it is framed accurately: the "or a data source" clause was **written at this change's own design gate describing behaviour that did not exist and could not exist** without threading an async `DataSourceRepository` into `PipelineAnalyzeService.analyzeNodes` — a pure, synchronous domain function — and refactoring its callers. It was an **overreach in the spec, not a shortfall in the implementation**. Source-kind derivation never existed at any point before this change either: at base `a9d1bdcd`, `union` sat in the identity-passthrough group (`PipelineAnalyzeService.scala:364`) and `join` had no analyze dispatch case at all. This change strictly *improved* the area — real lane-kind derivation, plus `join`'s first-ever dispatch case.

**Verified by measurement before editing, not by recollection** (an explicit condition of the ruling): the source-kind analyze tests assert the *passthrough* behaviour directly — `"union — identity passthrough: outputSchema equals inputSchema"` (`PipelineAnalyzeServiceSpec.scala:148`) and the join case asserting `result("join1").outputSchema shouldBe result("laneA").outputSchema`. They assert the **opposite** of both-input derivation, so they would have *failed* against a delta promising it for source-kind. Nothing under test weakens, and **no test was adjusted to fit the narrowed wording** — the tests actively contradicted the overreached clause and are unchanged.

Tracked as **HEL-965** (Medium).

### The re-derived silent-drop sweep bottomed out at 8 sites

Keyed on the property "a child-set access that assumes at most one child," swept across the whole backend rather than the named sites. **8 sites total, no ninth** — the first real evidence this defect class is closed rather than locally patched. It found one site nobody had named: `PipelineStepRepository.deleteInternal`.

**That site's "pre-existing policy" claim was verified by measurement, not accepted from its comment** — an explicit condition of the ruling, because "it was already like that" has been wrong twice recently. A `diff` of the method body against base `a9d1bdcd` is **byte-identical**, and the selection rule (`sortBy(position).headOption` / `drop(1)`) is **position-agnostic** — it never referenced `position == 0`. So its correctness genuinely never depended on the invariant this ticket removes, which is a strictly stronger claim than "it predates the ticket." Filed as **HEL-966** (Medium), related to HEL-912 where a user would actually encounter it.

### Dispute resolved in the executor's favour: `PipelineRunService.scala:418`

`evaluation-1.md` CR1 asserted the comment at `PipelineRunService.scala:418` ("`outcome.rows` is always the TRUNK's terminal frame") had been made false and must be fixed. The executor pushed back, claiming the comment was already correct and the *code* had drifted from it.

**The executor was right; the evaluator was wrong on this detail.** Verified: the comment is byte-identical pre- and post-ticket, it lives in `previewStep` (not the run path), and CR1's restoration of trunk-terminal semantics makes it true again. No edit was made. Recorded here rather than quietly absorbed, because an executor that pushes back with evidence and turns out to be correct is behaviour worth having in the record — the instruction to "fix the stale comment" was itself based on a false premise, and following it would have introduced an error.

## Cycle 3 (skeptic-final-1.md) — the transactional-create lane-clientId defect

**The defect.** `PipelineService.buildStepsAction` rewrites `parentStepId` through `clientIdMap` one line before persisting a step (`parentClientIdOpt.map(clientIdMap(_))`), but had NO equivalent rewrite for a `lane`-kind `secondaryInput.stepId` — `validateStepCrossOwnerRefs`'s `validateLane` (added cycle 2, CR5) validated the `stepId` against the REQUEST's `clientId`s, and then `buildStepsAction` persisted that same clientId VERBATIM instead of resolving it to the real, just-inserted `PipelineStepId`. `create` returned `Right`; the stored row was permanently unrunnable (`LaneReferenceError` on every run), and unrepairable via the editor (lane authoring is P2.2) — Engine contract item 6a inverted, on exactly the write path HEL-914 will be planned against.

**Fix, scoped exactly as instructed.** Added `rewriteLaneClientId`, called at the same site `parentStepId`'s rewrite already runs, resolving a `lane`-kind `secondaryInput`'s clientId through the identical `clientIdMap`. No restructuring of `validateStepCrossOwnerRefs` or the surrounding fold.

**A related asymmetry found and REPORTED, not fixed (per instruction).** Unlike `parentStepId` (whose own write-time guard requires it to be an *earlier* clientId, so it is always resolvable by the time `buildStepsAction`'s fold reaches it), a `lane`-kind reference's write-time check (`validateLane`) does NOT require the referenced clientId to be earlier — contract item 6 permits naming ANY node, forward or backward. A forward-referencing lane `stepId` (e.g. step 1 references step 3's clientId) is therefore genuinely unresolvable at the point `buildStepsAction`'s single left-to-right fold reaches step 1, since steps are inserted strictly in request order. Rather than silently re-persist the unresolved clientId (the exact defect just fixed) or crash on a missing-key lookup, this now fails loudly with a named `BadRequest` identifying the unresolved clientId. This is a genuine, narrower capability than the full contract (forward lane references are rejected by this single-call path specifically, though they work fine via `addStep`/`updateStep`, which persist one step at a time against already-real ids) — supporting them here would require a two-pass build (first insert every step with `parentStepId` only, then a second pass to patch in resolved lane references), which is a real restructure and out of this cycle's scope. Recorded here as the report the instruction asked for, not silently absorbed into the fix.

**The generalizable lesson, as the owner asked it to be stated:**

> **A test that asserts a call succeeded, rather than asserting what it produced, is not coverage.**

The pre-existing test `"accept a union step whose lane secondaryInput names a valid sibling clientId"` — written IN cycle 2, specifically to close CR5's write-time coverage gap — asserted only `result shouldBe a[Right[_, _]]`. That assertion was satisfied by the defect: `create` legitimately returns `Right` right up until the moment anyone tries to *run* the pipeline it built. A coverage-closing test that only checks "did the call succeed" cannot distinguish "succeeded and correct" from "succeeded and silently broken" — and a defect that only manifests on a LATER, DIFFERENT call (a run, not the create) is exactly invisible to a test scoped to the create call alone. This is the same species of gap as CR1's `TreeWalkResult.rows` corruption (3631 green tests, none of which asserted `.rows` for the two shapes where the bug actually showed) and CR2's `deleteInternal` (a pre-existing, working-as-designed test suite that never constructed the multi-lane shape the property actually depends on). Three separate defects in two days, all hidden behind evidence-shaped non-evidence — a green test that exercises the code path without asserting the property actually at risk. The replacement test now asserts two independent things directly on persisted state and behaviour: the exact real step id landed in `secondaryInput.stepId` (not the clientId), and the persisted pipeline runs through the real engine — each verified to fail on its own (not merely in conjunction) against the reverted fix.

## Cycle 4 (skeptic-final-2.md) — comment-only fold-in, plus one test

Three stale comments corrected to describe what the code does now, not what it used to do -- a comment stating the opposite of the code is exactly the shape that hid CR1's `TreeWalkResult.rows` corruption on this ticket:

1. `PipelineService.scala`'s `listSteps` comment claimed `listByPipelineInternal` could still fail with `InvalidGraph` (the HEL-930 guard). That guard is deleted (task 3.1-3.4); the comment now describes `classifyDbError`'s actual remaining role there (a general DB-exception classifier).
2. `PipelineAnalyzeService.scala`'s `analyzeNodes` doc claimed it "deliberately does NOT replicate `InProcessPipelineEngine`'s `InvalidGraph` structural validation" — that invariant no longer exists anywhere to not-replicate. Rewritten to describe the actual current tolerance mechanism (`isReady`, added in cycle 2 for the lane-aware topological pass).
3. `FlywayNonSuperuserMigrationSpec.scala` cited a `V97Hel911MigrationCoverageSpec` that was never created (no stub was added to make the citation true, per instruction) — repointed to the actual location of that evidence (this ticket's own design.md change record and the in-file assertions a few lines below).

No logic was touched in any of the three files at the comment sites; `git diff --stat` confirms exactly one test file plus the three comment-only files changed this cycle (pasted in the executor's return).

One new test, authorized separately from the comments: pins `rewriteLaneClientId`'s `Left` (forward-lane-reference rejection) arm added in cycle 3 — a lane `secondaryInput.stepId` naming a LATER clientId in a single-call create request must fail with a named `BadRequest`, nothing persisted. Verified red against a temporarily simplified `Right(typedConfig)` arm (the simplification a future edit could plausibly make, silently reintroducing the cycle-3 defect) before being accepted — an untested rejection branch is exactly how that defect survived the first time.
