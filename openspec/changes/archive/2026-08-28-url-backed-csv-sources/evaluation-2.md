## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `f49d1e0e` (cycle-1 commit was `b9fe3d54`). Review surface: `git diff b9fe3d54..HEAD`.

Cycle-2 diff scope, enumerated: **three test files only** — `PipelineRunServiceSpec.scala`,
`CsvUrlFetchSpec.scala`, `helioApi.test.ts` — plus the committed `evaluation-1.md`. **No main-source
file was touched in cycle 2**, which is itself the strongest evidence that none of cycle 1's cleared
security/AC findings could have regressed.

### Phase 1: Spec Review — PASS

Re-confirmation of the six cycle-1 security/AC points (re-checked, not carried forward):

- **`ContentSourceSupport.scala` still byte-identical.** `git diff origin/main..HEAD -- backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` is empty at `f49d1e0e`.
- **ADT->status mapping unchanged** — `csvUrlErrorToServiceError` is untouched in the cycle-2 diff; still `InvalidScheme->400 / Upstream->502 / TooLarge->413 / NotCsv->400`, still the single mapper used by both `createCsvUrl` and `refreshCsv`.
- **AC3 assertion intact.** `InProcessPipelineEngineSpec` is not in the cycle-2 diff at all: the two-runs / differing-bytes / differing-rows test (`age "30"` -> `age "31"` + `bob`, `callCount shouldBe 2`) is unmodified, and it executed green in my own suite run (present in the log).
- **Lazy `ActorSystem` seam unchanged** (`PipelineRunService`'s main source untouched; only its spec changed).
- **MCP tool description unchanged** (`write.ts` not in the cycle-2 diff) — still https-only + mutual exclusion + explicit "no caller-supplied filesystem `path`".
- Task list still fully checked; artifacts still match behaviour.

### Phase 2: Code Review — PASS

Gates re-run by me in the worktree at `f49d1e0e` (fresh, not taken from the executor's report):

| Gate | Result |
|---|---|
| `backend: sbt test` | **PASS** — `Total number of tests run: 3741` / `succeeded 3741, failed 0`, `[success] Total time: 220 s`. Exactly the reported +1 over cycle 1's 3740. `- should reject a gopher:// URL` appears in the log, so the new case really ran. |
| `helio-mcp: npx tsc --noEmit` (deps present) | **PASS — exit 0.** |
| `helio-mcp: npm run build` (`tsc`) | **PASS — exit 0.** |
| `helio-mcp` jest | **PASS — 13 suites / 225 tests.** |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| frontend | not run — still no `frontend/**` file in the diff. |

Note on the typecheck evidence: `helio-mcp/node_modules` is now **present in the worktree** (the executor
installed it), so unlike cycle 1 this is a dependency-complete run, not a dependency-less one. I verified
that before trusting the exit code. I left the worktree as found (a stray nested `node_modules/node_modules`
from my own hardlink attempt was removed; `git status --porcelain` is clean).

Per-CR verification:

1. **CR1 — REAL FIX, verified.** The five `TS2532` sites in `helioApi.test.ts` (lines 43, 44, 52, 53, 70) now
   use optional chaining (`calls[0]?.init...`), matching `httpClient.test.ts`'s existing precedent. With
   dependencies installed, `tsc --noEmit` and `npm run build` both exit **0** — the regression that took
   `helio-mcp` from clean to failing is gone. The retraction of the "174 pre-existing errors on main" claim
   is correct: `write.ts`'s `TS7031` cascade was an artifact of missing `@modelcontextprotocol/sdk`
   declarations, and it is absent from the dependency-complete run.

2. **CR2 — strengthened, and the executor's investigation is accurate; see the residual note below.**
   `runs.head.errorLog shouldBe defined` is replaced by `shouldBe Some("Pipeline execution failed")`, plus a
   new `result.swap.toOption.get shouldBe a[ServiceError.UnprocessableEntity]`. I independently verified the
   executor's stated reason for using the generic constant rather than the engine's "not configured" text:
   `PipelineRunService.scala:444-460`'s `runFuture.transformWith` genericizes every failure that is not a
   `StepExecutionException` to the literal `"Pipeline execution failed"` before it reaches `errorLog`, so
   the engine's own message is genuinely unobservable at this level. The comment in the test says exactly
   that and is true. This is a real strengthening: it pins the exact observable and adds a status-class
   assertion.

3. **CR3 — verified.** `CsvUrlFetchSpec` gains `"reject a gopher:// URL"` asserting
   `InvalidScheme(msg)` with `msg.contains("gopher")` — content, not presence, matching its `file`/`ftp`
   siblings. Confirmed executed in my suite run.

Code quality of the cycle-2 delta: three-line-scale test edits, no production change, no duplication
introduced, no dead code. Nothing new to raise.

### Phase 3: UI Review — N/A

No UI-affecting file in the cycle-2 diff (three test files). No dev server started.

### Overall: PASS

### Non-blocking Suggestions

- **CR2 residual: the test's NAME still overclaims, though its assertion is now sound.** The title says
  "... not an NPE", but because `PipelineRunService.scala:457-460` maps *any* non-`StepExecutionException`
  — a `NullPointerException` included — to the identical `"Pipeline execution failed"` constant, a
  run-time NPE would satisfy `shouldBe Some("Pipeline execution failed")` just as well. What actually
  proves the lazy-`system` property is (a) the fixture constructing `PipelineRunService` without `system`
  at all, and (b) `InProcessPipelineEngineSpec`'s explicit `noException should be thrownBy new
  InProcessPipelineEngine(fileSystem)` — both of which exist and pass. The right fix is a **rename** (e.g.
  "...fails the run through the ordinary curated-failure path, with construction never having required a
  system") rather than more assertions; the assertion cannot be made to discriminate an NPE at this layer.
  Not blocking: the assertion is exact-content and the surrounding coverage is real.
- Cycle 1's other non-blocking suggestions were not taken up and remain open, all still non-blocking: the
  `msg.contains("100")` substring risk in the oversize test; the BOM-HTML case asserting only `NotCsv(_)`;
  `csvDataSourceSchema.test.ts` asserting a disclaimer's presence rather than a path input's absence;
  `Upstream`->502 for what is really a caller-input error on a blocked address (skeptic round-4 note 1);
  and the >100 MiB body surfacing as 502 rather than 413.
- Enumeration correction for the record: `helio-mcp` contains **13** test files, not 26 —
  `find helio-mcp -path helio-mcp/node_modules -prune -o -name "*.test.ts" -print | wc -l` = 13, and my
  jest run reports 13 suites. The 225-test figure is genuine and covers all of them.
