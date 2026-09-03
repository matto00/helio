# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `b59d453e` on top of `a9d1bdcd`.

## Gates — re-run independently (not taken from the executor's report)

| Gate | Result |
| --- | --- |
| `cd backend && sbt test` | **3631 succeeded, 0 failed** ✅ (`FlywayNonSuperuserMigrationSpec` and `InProcessPipelineEngineTreeWalkSpec` confirmed present in the run output, not skipped/cancelled) |
| `npm run lint` | clean ✅ |
| `npm run format:check` | clean ✅ |
| `npm test` | 252 suites / 2588 tests passed ✅ |
| `npm --prefix frontend run build` | ✅ |
| `npm run check:scala-quality` | clean (147 soft warnings) ✅ |
| `npm run check:schemas` | in sync ✅ |
| `npm run check:openspec` | clean ✅ |
| `tools/check-delta-headers.py` | 0 mismatches ✅ |
| `tools/check-legacy-field-coverage.py` | 0 uncovered ✅ |
| `npx openspec validate multi-lane-pipeline-engine --strict` | exit 0, **1 WARNING** (see non-blocking) |

The executor's gate claims are all accurate. What the gates *scan* is a different matter — see CR3/CR4/CR5, all of which are behaviours no green gate here covers.

## Things independently verified as CORRECT (recorded so they are not re-litigated)

- **V97 RLS bracket** matches `V96__canonicalize_inferred_schema_type.sql` verbatim (`NO FORCE` … `FORCE ROW LEVEL SECURITY`).
- **`FlywayNonSuperuserMigrationSpec` genuinely asserts the rewrite, non-vacuously.** Before/after counts are keyed on the *property* (`jsonb_exists(config::jsonb, '<field>')`, **op-agnostic**), so a legacy field surviving under a mismatched `op` would also fail — the test is deliberately stricter than the migration's own `WHERE`. Critically, the after-counts are read through `migratedDb`, which is built from `embeddedPostgres.getPostgresDatabase` (the **superuser** datasource, line 267) — so the `shouldBe 0` assertions cannot pass vacuously via RLS row-filtering. Before-counts are asserted `> 0`. The empty-draft and byte-identical assertions use `.as[String].head`, which throws on a missing row rather than passing silently.
- **Byte-identical passthrough** is structurally guaranteed, not merely restored: the `WHERE ... config::jsonb ? '<field>'` predicate excludes non-matching rows from the UPDATE's row set entirely, so `config` being `TEXT` cannot cause key reordering on rows that should not change. Proven by the `bf7d6301-…` control row.
- **Complete coverage for all three field names**, including the `join` field, which the real dump carries zero of. The synthetic `join` seed row is well-justified and explicitly labelled at the seed site and in the change record; it is *added alongside* the real dump load, not substituted for it, so the union/lookup evidence remains real-data evidence. **No finding on this judgment call.**
- **Live confirmation on the dev DB** (Phase 3): `pipeline_steps` rows for `e3c19110-…` now carry `secondaryInput`, and the known empty-id draft `7a16cc84-826c-45a9-87cf-611f31119c37` survived as `{"kind":"source","dataSourceId":""}` exactly as Decision 1a requires.
- **The three-way distinction (Decisions 1a/1b)** is implemented exactly as specified in `SecondaryInput.decodeStrict` (`SecondaryInput.scala:79-89`): legacy field present → hard named `StepConfigTypeMismatch` regardless of whether `secondaryInput` is also present; absent/`null` → `Default`; present-but-malformed → raise.
- **HEL-950's guard is genuinely re-proved with each leg broken independently** (`PipelineStepSecondSourceGuardSpec.scala:60-92`): Leg 1 (empty source → both extractors `None`), Leg 2 (populated source → `secondaryDataSourceId` Some, `secondaryLaneStepId` None), Leg 3 (lane → `secondaryDataSourceId` **None**, proving contract item 10's "no fall-through into the source-kind ACL check"). Non-vacuous via `Registry.size should be > 0` + `foundSecondSourceFields shouldBe 3`. The move from a `*DataSourceId` name-suffix convention to reflecting on the field's **type** is the right key.
- **Task 12.6's truncation finding is correct.** `JoinStep`/`UnionStep`/`LookupStep.evaluate` call `ctx.loadSource` only on the `SecondaryInput.Source` branch; the `Lane` branch goes through `ctx.resolveLane` exclusively and never touches `dataSourceRepo`. Verified by reading all three.
- **`SparkJobSubmitter`** fails loudly and by name on a lane-kind input rather than mis-serializing (`SparkJobSubmitter.scala:249-254`).
- **The claimed incidental frontend fix is real, in scope, and works end-to-end.** `useStepCardState.onUnionChange`/`onLookupChange` now widen the narrowed UI value to the wire shape at the one persisting seam. Confirmed live: changing a lookup's reference source issued `PATCH /api/pipeline-steps/ac31816f-…` → 200 and persisted `{"secondaryInput":{"dataSourceId":"43299c7c-…","kind":"source"}}`. (Test gap noted as CR6.)
- **`executionOrder`'s listing-order divergence from `structuralRank`** (change-record judgment call 1) is acceptable in itself: `executionOrder` is a listing/API-ordering helper whose consumers do not drive evaluation, and the new `flatMap` form is a lossless generalization. The related defect is elsewhere — see CR2.

---

### Phase 1: Spec Review — FAIL

Issues:

1. **AC "Analyze projects a rejoin schema" is not satisfied** — argued away in the change record rather than implemented, while the shipped spec delta asserts it as a SHALL. See CR3.
2. **AC "a lane referencing its ancestor is rejected at write time (400 naming the cycle)"** — implemented but entirely untested; the cross-pipeline/cross-tenant arm of contract item 6a likewise. See CR5.
3. **AC "Route specs … for lane-kind secondary inputs"** — no route spec anywhere constructs a lane-kind config. See CR5.
4. **Tasks marked `[x]` that were not done:** 11.5 (write-time arm), 11.8 (analyze rejoin schema; capabilities-at-node-in-a-lane), 11.9 (legacy flat shape rejected with a named error; `parentStepId` with siblings at route level), 11.12 (another pipeline / another user's pipeline, both arms).
5. **`pipeline-execution`'s parity requirement is violated by the shipped code** (CR1) — the delta says the walk's persisted rows SHALL be identical "including … a trunk-with-tails graph".

Task 11.14's per-assertion justification *was* done and is accurate: the ~20 converted backend test files are a pure representation change (positional first-arg `JoinConfig("id", …)` → `SecondaryInput.Source("id")`, JSON literal → `secondaryInput` object), with intent preserved in each case. I spot-checked `PipelineStepConfigCodecSpec`, `PipelineAnalyzeServiceSpec`, `InProcessPipelineEngineTreeWalkSpec` and the patch-set specs and found no assertion weakened to accommodate new behaviour.

### Phase 2: Code Review — FAIL

Issues: CR1, CR2, CR3, CR4, CR5, CR6 below. Code-quality/DRY/type-safety/error-handling/no-dead-code/no-over-engineering are otherwise clean; no `CONTRIBUTING.md` mechanical violations found (no inline FQNs, no untyped escape hatches, file budgets are soft-warning-only and pre-existing).

### Phase 3: UI Review — PASS

`scripts/concertino/start-servers.sh` + `assert-phase.sh servers` → `PASS servers`. Verified at 1440/768:

- Happy path: `/pipelines` list, pipeline detail, step expansion all render. A post-V97 `lookup` step correctly displays "Reference data source: A-source3" — i.e. migration → decode → narrow round-trips on real data.
- Write round-trip: changing the reference source PATCHes 200 and persists the discriminated shape (verified in Postgres).
- Unhappy path: running a pipeline whose `lookup` is missing `sourceKey`/`lookupKey` returns 422 and is surfaced as a step-level validation message — no blank screen, no unhandled exception.
- Console: only a pre-existing benign `404 /schedule` (no schedule configured) and the expected 422 above. No unexpected errors.
- Accessible names present on every interactive control in the step editor (`combobox "Reference data source"`, `button "Move step up"`, etc.).
- No horizontal overflow at 768 or 1440.

### Overall: FAIL

---

## Change Requests

1. **`executeTree` breaks P1.2 parity for a graph whose last trunk node has a tail — `TreeWalkResult.rows` changed meaning.**
   Old `walkTrunk` (`a9d1bdcd:InProcessPipelineEngine.scala`) returned the **trunk terminal node's frame**: at a node with no `position == 0` child it returned `frame` *after* evaluating that node's tails. New `executeTree` returns `lastFrame` (`InProcessPipelineEngine.scala:337, 371, 378`), the frame of the **last node evaluated in `structuralRank` order**. Because `structuralRank` visits children in descending position, the position-0 chain is visited *last* at every node — so a trunk terminal that has a tail child is followed by that tail, and `lastFrame` becomes the tail's frame. Two divergent shapes, both legal under the Phase-1 fence:
   - trunk `root → A(pos 0)` with tail `T(pos 1)` under `A`: old returned `A`'s frame, new returns `T`'s.
   - root with only a `position >= 1` child: old returned the **source rows**, new returns that lane's terminal frame.

   This violates the delta this change itself ships (`specs/pipeline-execution/spec.md`, "Parity with the pre-tree-walk engine for tail-free pipelines": *"including a pure trunk and a trunk-with-tails graph — the walk's persisted rows … SHALL be identical"*). It is not cosmetic: `resultRows` drives `PipelineRunService.scala:879` (SSE `succeeded` rowCount), `:976` (`pipelines.last_run_row_count`), `:979` (`pipeline_runs.row_count`), and — worst — `:935`
   `binaryRefRepo.overwriteForNode(pipelineId.value, trunkLastStepId, extractBinaryRefs(pipelineId, trunkLastStepId, resultRows))`, where `trunkLastStepId` is still `pipelineStepRepo.trunkOf(steps).lastOption` (`:929`). Pre-change those two were consistent by construction; now binary refs can be keyed to the trunk-last node but extracted from a *different* node's rows.
   That this was not considered is evidenced by the now-false comment at `PipelineRunService.scala:418`: *"`outcome.rows` is always the TRUNK's terminal frame"*.

   **Required:** either restore the trunk-terminal semantics for `TreeWalkResult.rows` (and keep the `trunkOf`-based callers consistent), or make the change deliberate and update every dependent site + the `PipelineRunService.scala:418` comment + the parity delta wording. Either way, add a parity test for **both** shapes above to `InProcessPipelineEngineTreeWalkSpec` asserting `result.rows` — the existing "evaluate a tail from its parent node's frame" test (`:103-116`) does not cover them because its tail hangs off a *mid*-trunk node, and the "skip a disabled node with a tail child" test (`:178-183`) never asserts `result.rows` at all.

2. **The silent-drop property sweep missed two sites; `.find`/`.headOption` on a now-plural child set remain in `PipelineStepRepository`.**
   design.md's own risk note requires keying the guard on *the property* — "any site selecting one child where several may now exist" — not on the three named sites. `executionOrder`, `expandChain` and `walkTrunk` were converted; these two were not:
   - `PipelineStepRepository.scala:684` — `trunkOf`: `childrenOf(steps, parent).find(_.position == 0)`.
   - `PipelineStepRepository.scala:713` — `tailsOf`'s `expand`: `childrenOf(steps, Some(current.id)).headOption`.

   Both were safe **only** because `validateGraph`/HEL-930 guaranteed at most one `position == 0` child and no `position >= 1` child below a tail. This change deletes both guarantees, and `InProcessPipelineEngineTreeWalkSpec:145` now explicitly asserts a node with two `position == 0` children is legal. So `trunkOf` will silently pick one lane and drop the other's whole subtree at: `PipelineRunService.scala:929` (which node's binary refs are written), `PipelineService.scala:888` (the prospective-parent anchor the lane cycle check is computed against — a silent drop here changes what counts as a cycle), `PipelineService.scala:989` (default append anchor), `PipelineService.scala:1174` and `PipelineStepRepository.scala:543` (reorder validation set). This is HEL-930's defect relocated, and it passes every current test.

   **Required:** decide and document each site's semantics under a multi-lane graph (`trunkOf` returning a `Vector` of lanes, or an explicit "first lane by position, and here is why that is safe here" at each of the five call sites), and add a test with two `position == 0` children asserting no subtree is dropped from each affected surface.

3. **`pipeline-analyze-api`'s shipped delta specifies behaviour the code does not implement.**
   `specs/pipeline-analyze-api/spec.md` states: *"For a `join`, `union` or `lookup` step, the projected schema SHALL be derived from **both** of its inputs"*, with a scenario *"Rejoin schema is projected from both lanes … THEN the projected schema reflects both inputs per the configured mode, rather than the parent lane alone."* The code does not do this: `PipelineAnalyzeService.scala:364` routes `union` into the identity-passthrough group (`(inputSchema, None)`), and `join` has no dispatch case at all. The change record itself records this ("no NEW cross-lane schema derivation"), and task 11.8 is nonetheless marked `[x]`.
   This is precisely the defect class design.md:39 makes this change responsible for — a merged spec line contradicting shipped code — and it is worse here because HEL-912/913/**914** will be planned from it. It also leaves the ticket AC "Analyze projects a rejoin schema" unmet.

   **Required:** either implement both-input derivation, or rewrite the requirement and its scenario to state the actual shipped behaviour (kind-agnostic best-effort passthrough; the secondary input's schema is not resolved at the analyze layer for `source`-kind *or* `lane`-kind), escalate the AC reinterpretation rather than absorbing it, and un-tick 11.8. Do not leave the SHALL standing.

4. **Decision 1a's headline behaviour — a legacy flat field is a hard, named error — has zero test coverage.**
   `grep` across `backend/src/test`, `frontend/src` and `helio-mcp` finds no test that supplies `rightDataSourceId` / `otherDataSourceId` / `referenceDataSourceId` to a decoder or route and asserts rejection. Nor is there any test for an unrecognised `secondaryInput.kind`, or for a `kind` paired with the wrong field. The shipped `specs/pipeline-step-config-rejection/spec.md` adds five new scenarios; only "An empty dataSourceId in the new shape is NOT rejected" has coverage (`PipelineStepRoutesSpec` PATCH-to-empty tests). Task 11.9 claims this is done.
   Consequence: if a "harmless just-in-case" legacy fallback is ever reintroduced — the exact thing Decision 1a forbids by name — every test stays green.

   **Required:** add tests for each of `union`/`join`/`lookup` covering (a) legacy flat field present → named `StepConfigTypeMismatch` at the codec layer **and** 422 at `POST`/`PATCH /pipeline-steps`, (b) `{"secondaryInput":{"kind":"other",…}}` → named error, (c) `{"secondaryInput":{"kind":"lane"}}` with no `stepId` → named error, (d) legacy field present *alongside* a valid `secondaryInput` → still an error (the `decodeStrict` ordering at `SecondaryInput.scala:80` is deliberate and unproven).

5. **The write-time lane-reference arm — contract item 6a's security boundary — is entirely untested, and one write path skips it.**
   `PipelineService.validateLaneReference` and `PipelineService.ancestorChainOf` have no direct tests, and no route spec constructs a lane-kind config at all (`grep -n 'kind.:.lane' PipelineStepRoutesSpec.scala` → nothing). Only the run-time defensive arm in `executeTree` is covered. Contract item 6a states plainly that item 10's ACL skip is *unsound without* item 6a — so the justification for switching the data-source ACL off is currently unproven by any test.
   Separately, `createPipelineTransactional`'s `validateStepCrossOwnerRefs` (`PipelineService.scala:194+`) performs **no** lane-reference validation, so the single-call pipeline-create path persists a dangling or foreign `stepId` with no write-time check at all. (The run-time arm still catches it — `executeTree`'s `byId` is scoped to one pipeline, so a cross-tenant *read* is structurally impossible — but contract 6a requires write-time rejection with a named error.)

   **Required:** (a) route-level tests for `addStep` and `updateStep`: lane `stepId` naming a step in **another user's pipeline** → named rejection; naming a nonexistent step → named rejection; naming the step's own ancestor → 400 naming the cycle; naming a valid sibling-lane node → 201/200. (b) Either extend the transactional-create path to validate lane references, or record explicitly in design.md why that path is exempt.

6. *(minor)* **No frontend test for the wire-shape widening.** `useStepCardState.onUnionChange`/`onLookupChange` (`useStepCardState.ts:364-388`) now transform the persisted payload; `stepNarrowing.test.ts` only covers the read direction. A regression to `persist(newConfig)` would ship a config the backend now rejects outright, with jest green. Add a test asserting the persisted payload is `{secondaryInput: {kind: "source", dataSourceId: …}, …}` for both ops.

## Non-blocking Suggestions

- `npx openspec validate multi-lane-pipeline-engine --strict` exits 0 but emits a WARNING: `pipeline-lane-rejoin-input` — "A lane reference may name any non-ancestor node…" contains no SHALL/MUST. Reported as "green"; worth cleaning since this file is a contract three tickets are planned from.
- Stale test names still referencing the deleted fields (bodies were correctly converted): `PipelineCreateTransactionalSpec.scala:292,316,343`; `PatchSetApplyServiceSpec.scala:499,530,554,577`; `PipelineStepRoutesSpec.scala:204,669,769` (comments).
- Indentation drift introduced at `PipelineStepRepository.scala:755-763` (`val rootTrunk      =`, `rootTails       =`) — not caught by any gate since Scala has no format check here.
