## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `304cb1af`.

### Phase 1: Spec Review — PASS

Issues: none.

- **AC1** — Satisfied and *documented*, not inferred. `RunOutcome.availableRowCount` → `primaryAvailableRowCount`, `sourceRowCount` → `primarySourceRowCount` (`helio-mcp/src/helioApi.ts:117-131`), `truncated` explicitly documented run-wide. design.md D1 records the decision and both rejected alternatives. Backend wire names deliberately unchanged (non-goal).
- **AC2** — `truncatedReads` declared on `RunResultResponse` (`helio-mcp/src/types.ts:572-575`) and mapped in `runPipeline` (`helioApi.ts:639`, `result.truncatedReads ?? []`), so it is no longer dropped at either the type boundary or the mapping.
- **AC3** — New `PipelineRunServiceSpec` case at `:1535-1566`: primary under cap (`seedRestDsNamed(RestSuccessUrl, "primary-under-cap")`, 1 row), `lookup` secondary over cap (`seedRestDsNamed(RestBigUrl, "secondary-over-cap")`). Added alongside the line-1513/1537 cases, none replaced. Distinct names used, so the dedupe-by-name concern is handled.
- **AC4** — `run_pipeline` description rewritten (`helio-mcp/src/tools/write.ts:357-373`): names every returned field, states `truncated` is run-wide, states the scalars are primary-only, states `truncatedReads` may include the primary and is `[]` when nothing was truncated.
- **AC5** — Both the backend and MCP tests assert emitted structure, not the notice string. The MCP test additionally asserts `expect(outcome).not.toHaveProperty("availableRowCount"/"sourceRowCount")` — the "cannot be read as nothing-was-lost" assertion at the surface an agent actually reads.
- Tasks 1.1–3.6 all marked done and all verifiably present in the diff. No scope creep: only the two backend files, four helio-mcp files, and the change dir are touched.
- Spec delta present under the change dir (`specs/pipeline-run-truncation-reporting/spec.md`), consistent with the implementation; `npx openspec validate --strict` reports valid. `openspec/specs/` itself untouched.

### Phase 2: Code Review — PASS

Gates re-run by me, fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE`):

- `npm run lint` — clean (`--max-warnings=0`).
- `npm run format:check` — "All matched files use Prettier code style!".
- `npm test` — 256 suites / 2654 tests passed.
- `cd backend && sbt test` — 3893 tests, 256 suites, 0 failed.
- `sbt "testOnly ...PipelineRunServiceSpec"` — 73/73 passed.

Gate-selection gap explicitly re-covered (task 3.6 — gates match only `frontend/**` / `backend/**`, nothing selects `helio-mcp/**`):

- `npx jest helio-mcp/src/runPipelineTruncation.test.ts` — **4 passed, 4 total**, including the new secondary-source test.
- `npm run check:helio-mcp-types` — clean (`tsc --noEmit -p tsconfig.typecheck.json`, no output). This is what proves task 2.5 (every in-repo reader of the renamed fields moved); grep confirms no surviving unqualified `RunOutcome.availableRowCount`/`sourceRowCount` reader in `helio-mcp/src`.

**Mutation spot-check (mutation-evidence.md not taken on trust).** I re-applied mutation (i) myself: `truncatedReads: result.truncatedReads ?? []` → `truncatedReads: []` in `runPipeline`. Observed exactly the claimed behaviour:

- 1 failed, 3 passed. The failing test is the new task-3.3 secondary-source test, and only it.
- The failure is the claimed assertion — `expect(outcome.truncatedReads).toEqual([...])` at `runPipelineTruncation.test.ts:117`, a Jest deep-equality mismatch (`Expected -7 / Received +1`, `Array []`).
- It is an **assertion** failure, not TS2741 / lint / compile: the suite ran to completion, no `TS2xxx` diagnostic, only the ts-jest 151002 config warning (pre-existing, unrelated).
- No pre-existing test reddened — the two HEL-861 tests and the defaults-to-false test all stayed green.
- Reverted via `git checkout helio-mcp/src/helioApi.ts`; `git status --porcelain` is empty and the suite is 4/4 green again.

The design's reasoning for choosing the value-level over the type-level mutation is therefore corroborated, and mutation (ii)'s claim (backend axis, `sink.reads` arm only, primary path built separately) is consistent with the file I read.

**Expected values are fixture literals, not re-derived.** MCP test: the entire `RunResultResponse` fixture is hand-written and the expectation is the literal `[{ dataSourceName: "Sleeper Projections 2026", rowsRead: 1000, availableRowCount: 3114 }]` — no reference to `RunOutcome`'s mapping. Backend test: `sourceRowCount shouldBe 1L`, `sourceAvailableRowCount shouldBe Some(1L)`, `rowsRead shouldBe 1000L`, `availableRowCount shouldBe Some(3303L)` — bare literals, plus the independent `availableRowCount.get should be > rowsRead` loss proof. Nothing is computed from the implementation under test.

**Hard constraints — all hold:**

- No Flyway migration added or edited (`git diff --name-only main...HEAD` matches nothing under `db/migration`).
- No `schemas/`, no `frontend/`, no ACL-path, no `PipelineStepRepository` file in the diff.
- No inline fully-qualified names added in Scala: grep of added `+` lines for `com.helio.<pkg>.` returns zero hits.
- Backend production change is scaladoc only (`PipelineProtocol.scala:204-208`); `PipelineRunService` is untouched, matching D3.

Other checks: DRY (reuses `seedRestDsNamed`/`seedPipeline`/`insertStep`, adds no helper); readable (each literal has a comment explaining *why* it is that value, notably why the primary pair is legitimately equal); type safety (`TruncatedRead` is a real exported interface, `availableRowCount?: number` mirrors the backend `Option`, no `any`); no dead code or TODOs; no over-engineering; no drive-by behaviour changes. The breaking rename is self-approved in design.md with rationale and is flagged for the PR body.

### Phase 3: UI Review — N/A

No UI-affecting files changed: the diff touches only `backend/src/main/scala/.../PipelineProtocol.scala` (scaladoc), `PipelineRunServiceSpec.scala`, four `helio-mcp/src/**` files, and the change directory. `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**` and `frontend/**` are all untouched.

### Overall: PASS

### Change Requests

(none)

### Non-blocking Suggestions

- `helio-mcp/src/helioApi.ts:96-110` — the new `TruncatedRead` interface was inserted *between* `RunOutcome`'s pre-existing doc block ("run_pipeline outcome. The run is synchronous on `main`…") and `RunOutcome` itself. The result is two stacked doc comments on `TruncatedRead` (the HEL-890 one wins for TSDoc) and `RunOutcome` left with no doc block of its own — an IDE hovering `TruncatedRead` may surface the `run_pipeline`-outcome prose. Purely cosmetic and invisible to agents (the tool description, not the TSDoc, is what they read), but on a ticket about documentation accuracy it is worth fixing: move the `TruncatedRead` declaration *above* the `run_pipeline outcome…` block so each comment sits on its own declaration.
