## 1. Contract and wire shape

- [x] 1.1 Introduce the discriminated `secondaryInput` type (`{kind:"source", dataSourceId}` | `{kind:"lane", stepId}`) in the domain layer, shared by `JoinConfig`, `UnionConfig` and `LookupConfig`.
- [x] 1.2 Replace the flat fields on all three configs: `rightDataSourceId` (join), `otherDataSourceId` (union), `referenceDataSourceId` (lookup). Delete the fields; do not retain them.
- [x] 1.3 Make the decoders **strict**: a missing/malformed `secondaryInput`, an unrecognised `kind`, a `kind` paired with the wrong field, or any **legacy flat field** raises a hard, **named** error. No default, no silent `{kind:"source"}` coercion. (Decision 1a; HEL-814 precedent.)
- [x] 1.3a **Do NOT conflate the legacy flat field with an empty id.** `{"secondaryInput":{"kind":"source","dataSourceId":""}}` is a **legal incomplete draft** and must be accepted (HEL-950). Only the *legacy flat shape* errors. See Decision 1a.
- [x] 1.4 Update `PipelineStepConfigCodec` and `PipelineStepProtocol` for the new shape.
- [x] 1.5 **`schemas/` requires no change — verify this rather than assuming it.** `create-pipeline-step-request.schema.json` types `config` as an opaque `{"type":"object"}`; nothing under `schemas/` models step-config shape. Confirm by grep, then state in the PR that `check:schemas`/schema-drift do **not** cover step configs, so neither is cited as evidence for this change. Do **not** invent a new step-config schema surface (unbid scope; three downstream tickets would be planned against it).

## 2. Migration V97

- [x] 2.1 Write `V97__discriminated_secondary_input.sql` rewriting `pipeline_steps.config` for `op IN ('join','union','lookup')`, mapping each op's own legacy field name to `secondaryInput`.
- [x] 2.1a **Empty legacy id maps to `{"kind":"source","dataSourceId":""}`** — preserved as a draft, never dropped, never errored, never rewritten to lane-kind. The real dump fixture has two such rows (`hel904-real-dump.sql:10163`, `:10230`); with no legacy read path, whatever V97 emits is what every future read gets.
- [x] 2.2 Bracket the `UPDATE` with `ALTER TABLE pipeline_steps NO FORCE ROW LEVEL SECURITY;` … `ALTER TABLE pipeline_steps FORCE ROW LEVEL SECURITY;`, copying `V96__canonicalize_inferred_schema_type.sql`. Header comment must state why (non-superuser `helio` role, non-`missing_ok` policy, SQLSTATE 42704, the three failed deploys).
- [x] 2.3 `config` is **TEXT**, not JSONB — ensure a config the migration should not touch is left **byte-identical** (no `::jsonb` round-trip reordering keys or normalizing whitespace on non-matching rows).
- [x] 2.4 Prove idempotence: re-running the statement is a no-op.
- [x] 2.5 **Prove complete coverage** (correctness, not tidiness — no read path can cope with a missed row): count rows matching each of the three legacy field names before; count after; after must be **zero** for all three.
- [x] 2.6 Cover V97 in `FlywayNonSuperuserMigrationSpec` **with real assertions, not by mere presence.** That spec migrates the whole chain, so V97 is nominally "covered" the moment the file lands, with zero new assertions — a green gate proving only that DDL applied, which is verbatim that spec's own documented round-1 blind spot. Required: assert **inside the non-superuser spec** that all six legacy rows in the fixture (all three field names, including the two empty-id lookup drafts) are rewritten, that zero legacy-shaped rows remain, and that a non-matching config is byte-identical.
- [x] 2.7 Verify against **real dump-shaped data**, not only hand-built fixtures. If real dump-shaped data cannot be obtained, say so explicitly rather than silently substituting hand-built rows.

## 3. Delete the Phase-1 invariant — all three sites

- [x] 3.1 Delete `InProcessPipelineEngine.validateGraph` and its call site; remove the `InvalidGraph` pre-flight.
- [x] 3.2 Remove the `InvalidGraph` throw in `PipelineStepRepository.executionOrder`/`walk` (HEL-930) and generalize the traversal to return **all** children in sibling-position order. **Removing the throw must not reintroduce the silent first-match drop it was added to prevent** — this is the most likely way to get this change wrong with every test green.
- [x] 3.2a **Same property, engine side.** `InProcessPipelineEngine.expandChain` and `walkTrunk` both use `childrenOf(...).find(_.position == 0)`, safe today *only because* `validateGraph` guarantees uniqueness — which 3.1 deletes. Convert both, and sweep for **any** site selecting one child where several may now exist. Key the search on the **property**, not on the HEL-930 site.
- [x] 3.3 Remove/repurpose the `InvalidGraph` arm in `PipelineService`.
- [x] 3.4 Fix the stale scaladoc claiming `validateGraph` is "the ONLY layer that enforces this invariant" — it was already false before this change.

## 4. The DAG walk

- [x] 4.1 Replace the trunk/tails walk with a topological walk over parent→child and lane-reference→rejoin edges; sibling `position` ascending as the deterministic tiebreak.
- [x] 4.2 Retain every node's post-evaluation frame in `nodeOutcomes` for the whole run (already true — assert it, don't regress it) and resolve `lane`-kind inputs from it without re-evaluating the referenced node.
- [x] 4.3 Preserve disabled-step semantics unchanged (transparent, no `stepCounts` entry); a lane reference to a disabled node resolves to its passed-through incoming frame.
- [x] 4.4 Ensure no engine branch treats `position = 0` as structurally special beyond ordering.

## 5. Cycle rejection

- [x] 5.1 Write-time: reject a lane reference naming the step itself or any ancestor with a **400 naming the cycle**, on create and update. No step persisted.
- [x] 5.2 Run-time: defensive rejection of a cyclic graph with a named error, no step in the cycle evaluated. **Both arms required** — do not drop the run-time arm because the write-time arm exists.
- [x] 5.3 **Same-pipeline membership validation (security boundary, not tidiness).** Reject a `lane` `stepId` that does not exist or belongs to a **different pipeline** (including another user's) — named error at write time, defensive rejection at run time. Cycle detection cannot catch this: a dangling/foreign id forms no cycle. Contract item 10 switches the data-source ACL off on the lane branch justified *solely* by same-pipeline membership, so without this the justification is false and an unvalidated `stepId` from HEL-914's MCP surface is a cross-tenant read.

## 6. ACL

- [x] 6.1 Branch the pre-flight on `kind`: `source` keeps today's owned-source check **including HEL-950's empty-id incomplete-draft guard**; `lane` performs no data-source lookup at all.
- [x] 6.2 Assert the lane-kind branch cannot fall through into the source-kind check with an empty id — this change adds a second code path past the guard HEL-950 hardened.

## 7. Analyze, capabilities, preview

- [x] 7.1 Analyze projects a schema at any node in any lane.
- [x] 7.2 Rejoin schema projected from **both** inputs (parent lane + secondary input).
- [x] 7.3 `GET /api/pipelines/:id/capabilities?stepId=` works at any node in any lane.
- [x] 7.4 `POST /api/pipelines/:id/preview` returns per-Output previews across lanes.

## 8. Run reporting

- [x] 8.1 Per-node counts across all lanes (SSE + run history).
- [x] 8.2 A failing step names its lane path (extends HEL-859).

## 9. Sweep every remaining surface (Decision 1a)

- [x] 9.1 `RefinementEditShape.scala` — patch-set/refinement apply path.
- [x] 9.2 `SparkJobSubmitter.scala` — must compile, must not serialize the old shape. Multi-lane walk on Spark stays HEL-238.
- [x] 9.3 `helio-mcp/src/tools/write.ts` — MCP tool schemas.
- [x] 9.4 Frontend: `types/pipelineStep.ts`, `state/stepNarrowing.ts`, `ui/stepConfigs/UnionConfig.tsx`. `ui/stepConfigs/LookupConfig.tsx` **does** exist and carries `referenceDataSourceId`. There is **no** `JoinConfig.tsx` under `stepConfigs/` — do not hunt for a phantom file; locate the join editing surface by grep and name what you find.
- [x] 9.5 **Sweep on the property, not the three field names.** Find any code path constructing or consuming a join/union/lookup secondary input by another route; the three-name grep is a starting point, not the audit. (`SparkJobSubmitter` was found only by widening past the first name.)
- [x] 9.6 Any surface found that still accepts the old shape is either converted here or named explicitly as a defect.
- [x] 9.7 `backend/scripts/repair-dev-db.sql` — **writes** the legacy flat shape; post-V97 it would re-create undecodable rows. Convert it.
- [x] 9.8 `backend/README.md` — documents the flat shape. Update.

## 10. Spec and OpenSpec corrections

- [x] 10.1 Correct `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:160` — the trailing "No data-model change." is false once V97 lands. **Same commit as the migration.** State why in the change record.
- [x] 10.2 Update the OpenSpec capability specs listed in `proposal.md`; each PR lists the ones it touched.
- [x] 10.2a **Run the delta-header check** (`python3 openspec/changes/multi-lane-pipeline-engine/tools/check-delta-headers.py`) — necessary, but NOT sufficient on its own; see 10.2a-bis. For every requirement header under a `## MODIFIED` or `## REMOVED` heading in `changes/multi-lane-pipeline-engine/specs/**`, assert the identical header exists in the corresponding `openspec/specs/<cap>/spec.md`. A MODIFIED block whose title does not match silently *adds* a requirement alongside the legacy text instead of replacing it, and `openspec validate --strict` stays green either way. Currently 0 mismatches; re-run after any delta edit and record the result. See design.md "Delta-authoring disposition".
- [x] 10.2a-bis **Run the requirement-level legacy-field coverage check** — `python3 openspec/changes/multi-lane-pipeline-engine/tools/check-legacy-field-coverage.py`. For every live requirement whose body names a legacy field, assert a delta block exists for that exact requirement. A header match alone is NOT sufficient: a capability has many requirements and a delta may touch only some, leaving one spec file specifying two contradictory config shapes. Currently 0 uncovered (was 11 on first run). Must be 0.
- [x] 10.2b **Post-archive property sweep** (this one only proves anything *after* archive rewrites `openspec/specs/**`, so do not cite it before then). Round 2 established the complete list of live spec files carrying a legacy field name — exactly seven: `conversational-refinement`, `patch-set-apply`, `pipeline-joinstep-right-source-acl`, `pipeline-lookup-op`, `pipeline-run-execution`, `pipeline-steps-persistence`, `pipeline-union-op`. All seven now have deltas addressing the legacy text. Re-run the sweep after implementing and confirm in the change record that no eighth file appeared. (Round 1 named two files and exactly two got fixed — the failure mode this task exists to prevent.)
- [x] 10.3 Record in the change record that Decision 3 supersedes the ticket prose "its config names the other lane's terminal step", as an owner decision rather than a contradiction.

## 11. Tests

- [x] 11.1 Two lanes off one node evaluate independently; rejoin via `union` produces expected rows.
- [x] 11.2 `join` between two lanes produces expected rows.
- [x] 11.3 Diamond: one node referenced by two rejoins; referenced node evaluated once.
- [x] 11.4 Lane reference to a mid-lane, non-materialized node resolves to its post-evaluation frame.
- [x] 11.5 Cycle rejected at write time (400 naming the cycle) **and** at run time.
- [x] 11.6 **P1.2 parity**: pure trunk and trunk-plus-tails produce byte-identical output, counts and evaluation order. Existing P1.2/tail tests pass **unchanged**.
- [x] 11.7 Determinism: same graph, two runs, identical order and counts.
- [x] 11.8 Analyze projects a rejoin schema (lane-kind, real both-input derivation, 6 tests); capabilities-at-node works in a lane. Source-kind derivation is out of scope by owner ruling — the delta was corrected and HEL-965 filed; see design.md "Cycle 3".
- [x] 11.9 Route specs: `parentStepId` with siblings; lane-kind secondary inputs; legacy flat shape rejected with a named error.
- [x] 11.10 Migration evidence per §2.3–2.7.
- [x] 11.11 **Guard integrity**: where a test's guard depends on two conditions, break each leg independently — a conjunction-only guard guards neither leg.
- [x] 11.12 Lane `stepId` naming a step in **another pipeline** (and another user's pipeline) is rejected at write time and at run time.
- [x] 11.13 A `{"kind":"source","dataSourceId":""}` draft round-trips: accepted on create/update, no ownership check, no 404.
- [x] 11.14 **The ~17 existing test files constructing the legacy shape are a mass rewrite of exactly the suites encoding the guarantees this change must preserve** — including `PipelineStepSecondSourceGuardSpec` (HEL-950's empty-seed-id guard), `PipelineStepRequiredConfigSpec`, `PipelineStepConfigCodecSpec`, and the patch-set specs. For **each** converted assertion, justify in the change record *why that datum had to change* (lesson 1). Re-prove HEL-950's guard after conversion by **breaking each leg independently** (lesson 5) — "it still compiles and passes" is not evidence.

## 12. Gates

- [x] 12.1 `sbt test` green.
- [x] 12.2 `check:scala-quality` clean.
- [x] 12.3 Frontend `lint` / `typecheck` / `test` green for the touched frontend surfaces.
- [x] 12.4 Schema + OpenSpec hygiene checks clean.
- [x] 12.5 Confirm what each gate actually scans and that it was invoked the way CI invokes it — a green gate may scan nothing.
- [x] 12.6 **Confirm `pipeline-run-truncation-reporting` needs no change.** It is the one live capability specifying join/union/lookup secondary-input behaviour with no delta. It reads as correct under the new shape, but verify the truncation-reporting path does not attempt a data-source resolution for a `lane`-kind input when building `truncatedReads` (each entry "naming the data source"). Record the finding in one sentence either way — this closes the audit trail rather than leaving a silent gap.
- [x] 12.7 Write `files-modified.md` and commit before yielding.
