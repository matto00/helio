## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `b9fe3d54`. Review surface: `git show b9fe3d54` (note: `git diff origin/main..HEAD`
also shows README/docs-image/.gitignore churn — that is base drift, `origin/main` has moved ahead with a
README refresh not in this branch. Those files are NOT touched by this commit; no scope creep.)

### Phase 1: Spec Review — PASS

Issues:

- **ContentSourceSupport.scala is UNMODIFIED — verified.** `git diff origin/main..HEAD -- backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` is empty. https-only is enforced at the CSV call site (`CsvUrlFetch.fetch`, scheme pre-check before any `fetchUrl` call). Decision 2 honoured.
- **ADT -> status mapping is exactly Decision 2's table, on BOTH paths.** `DataSourceService.csvUrlErrorToServiceError` (`DataSourceService.scala`, one private method) maps `InvalidScheme -> BadRequest`, `Upstream -> BadGateway`, `TooLarge -> PayloadTooLarge`, `NotCsv -> BadRequest`, and is called from *both* `createCsvUrl` and `refreshCsv`'s URL branch. Verified the status wiring downstream: `ServiceResponse.scala:83` BadGateway->502, `:85` PayloadTooLarge->413. Round 3's `refreshText`-style uniform-`BadGateway` regression did NOT creep back in.
- **AC3 engine re-fetch: genuinely proven behaviourally.** `InProcessPipelineEngineSpec` "a URL-backed CSV source re-fetches via the seam and reflects CHANGED upstream content across two runs" drives `loadRows` twice against a seam returning DIFFERENT bytes and asserts the ROWS differ (`firstRun` size 1 / `age == "30"`; `secondRun` size 2 / `age == "31"`, row 2 `name == "bob"`), plus `callCount shouldBe 2`. `loadRows` delegates to `loadRowsWithStats` (`InProcessPipelineEngine.scala:149-150`) — the exact method `PipelineRunService.executeRun` uses — so this is the real run path, not a mock of it. This is not a "method was called" assertion. Companion tests cover the snapshot-backed no-fetch path (asserts `seamCalled == false` and the file's row content) and the failing-fetch path (message names the source and the reason).
- **Lazy ActorSystem seam: correct.** `PipelineRunService.csvUrlFetchSeam` is a `def`, eta-expanded into the eagerly-constructed `engine` field; `system` is dereferenced only inside the body, guarded by `if (system == null)`. `InProcessPipelineEngine`'s default seam value is a pure function, no system capture. Constructing either without a system cannot throw. Covered by a real-DB `PipelineRunServiceSpec` test and by an engine-level `noException should be thrownBy new InProcessPipelineEngine(fileSystem)`.
- **MCP tool description: compliant.** Advertises only `content`/`sourceUrl`, states "`sourceUrl` MUST be `https`", states mutual exclusion and pre-HTTP failure, explicitly states "This tool accepts NO caller-supplied filesystem `path` of any kind". Decision 3's dropped-capability override is respected.
- All 54 task items are checked; none unchecked. Planning artifacts match the implemented behaviour. Backwards compatibility (absent `sourceUrl` decodes to `None`) is implemented in `DataSourceConfigCodec.decodeCsv` and covered by `DataSourceConfigCodecSpec`.
- Non-blocking spec wording nit: `specs/csv-url-ingestion/spec.md` requirement prose says the create surface accepts `config.url` while its own scenarios say "`sourceUrl`". The implementation is correct on both counts (request field is `config.url`, stored config field is `sourceUrl`), but the requirement text reads as if they were the same name.

### Phase 2: Code Review — FAIL

Gates re-run independently by me in the worktree (not taken from the executor's report):

| Gate | Result |
|---|---|
| `backend: sbt test` | **PASS** — `Total number of tests run: 3740` / `succeeded 3740, failed 0`, `[success]`. Confirms the executor's count exactly. |
| `npm run lint` | PASS (exit 0) |
| `npm run format:check` | PASS — "All matched files use Prettier code style!" |
| root `npx jest` | **Misleading — see note.** `jest.config.cjs` has `testPathIgnorePatterns: ["/.claude/worktrees/"]`, which matches this worktree's own absolute path, so a bare `npx jest` here prints "No tests found" and exits 0 while running nothing. Re-run with that pattern removed: **13 suites / 225 tests passed**, including the two new ones. |
| `helio-mcp` `tsc` | **FAIL — see CR1.** |
| `check:schemas`, `check:openspec`, `check:spec-structure`, `check:scala-quality`, `check:no-credential-leak`, `check:repo-integrity` | all PASS |
| frontend `npm test` / build | not run — no `frontend/**` file is touched by this commit. |

**The executor's `tsc` characterisation is FALSE, and it masked a real defect.**
`helio-mcp/node_modules` does not exist in this worktree (only `frontend/node_modules` is linked).
Running `tsc --noEmit` there yields 173 errors — but 14 are `TS2307 Cannot find module
'@modelcontextprotocol/sdk/...'` and the 153 `TS7031` implicit-any errors in `write.ts` are the
downstream cascade of those missing type declarations. That is exactly the "dependency-less worktree
typecheck" the ticket's environmental note forbids reporting as a gate result; it is not a
pre-existing main-branch failure.

I re-ran it with dependencies actually present (hardlink-copied `helio-mcp/node_modules` from the main
checkout, read-only w.r.t. main; removed again afterwards, worktree left as found — `git worktree list`
shows only the two expected entries). With dependencies installed the result is:

```
src/helioApi.test.ts(43,12): error TS2532: Object is possibly 'undefined'.
src/helioApi.test.ts(44,12): error TS2532: Object is possibly 'undefined'.
src/helioApi.test.ts(52,12): error TS2532: Object is possibly 'undefined'.
src/helioApi.test.ts(53,35): error TS2532: Object is possibly 'undefined'.
src/helioApi.test.ts(70,35): error TS2532: Object is possibly 'undefined'.
```

Exit code 2. **Every remaining error is in a file this change adds**, and `write.ts` is clean — so the
baseline on `origin/main` is necessarily zero (the only failing file does not exist there). This change
takes `helio-mcp` from a clean typecheck to a failing one.

Other Phase-2 findings:

- CR2 below: a weak assertion in `PipelineRunServiceSpec`.
- DRY / modularity: good. `CsvUrlFetch` is a single implementation genuinely shared by all three call sites; `csvMaxBytes` in `DataSourceRoutes` now reads `CsvUrlFetch.maxFileSizeBytes` rather than keeping a second env-read with its own literal default. `finishCsvRefresh` extracts the shared refresh tail rather than duplicating it.
- Security: the SSRF guard is reused, not forked; the scheme gate parses the URI rather than `startsWith`; the connection stays pinned by `ContentSourceSupport`; create fetches before persisting so a failed fetch leaves no row and no file (asserted). No injection/secret-handling concerns in the diff.
- Error handling: no silent failures; the engine branch fails the run with a message naming the source and the reason.
- No dead code, no TODO/FIXME, no untyped escape hatches in the Scala diff. Comment density is high but each comment carries a decision rationale, consistent with `CONTRIBUTING.md`'s standard.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala` route-shape-visible-to-UI, `schemas/**` or `openspec/specs/**` file
is changed in a UI-affecting way (`ApiRoutes.scala`'s only edit is a constructor argument). No dev
server started.

### Overall: FAIL

### Change Requests

1. **`helio-mcp/src/helioApi.test.ts` breaks the `helio-mcp` typecheck/build (5 × TS2532).**
   `helio-mcp/tsconfig.json` sets `"noUncheckedIndexedAccess": true` and `include: ["src/**/*.ts"]`,
   so `calls[0]` is `T | undefined`. `npm --prefix helio-mcp run typecheck` **and** `npm --prefix
   helio-mcp run build` (`tsc`) both exit 2 on this file; `origin/main` is clean. Fix the five sites —
   lines 43, 44, 52, 53, 70 — e.g. by pulling the call out once per test with a non-null assertion
   (`const call = calls[0]!;`) and asserting through it. Then re-run `npm --prefix helio-mcp run
   typecheck` in a worktree that actually has `helio-mcp/node_modules` installed (`npm --prefix
   helio-mcp ci`) — a dependency-less run is not evidence either way, and reporting one as a gate
   result is what hid this.

2. **`PipelineRunServiceSpec` (the HEL-862 URL-backed-CSV block): `runs.head.errorLog shouldBe defined`
   is a presence-only assertion, and the test's own name claims something it does not check.**
   The test is titled "... not an NPE", but an NPE-derived `errorLog` would satisfy `shouldBe defined`
   just as well as the intended one — this is precisely the weak-assertion class the ticket's standing
   requirement 3 calls out. Assert content instead, e.g.
   `runs.head.errorLog.get should include ("not configured")` and
   `runs.head.errorLog.get should not include ("NullPointerException")`. (The seam does return
   `Left("URL-backed CSV fetch is not configured")` when `system` is null, so this assertion will hold.)

3. **Add the `gopher://` scheme case to `CsvUrlFetchSpec`.**
   `specs/csv-url-ingestion/spec.md`'s scenario enumerates "a `file://`, `ftp://`, or `gopher://` URL";
   the spec has `file` and `ftp` tests but no `gopher` one. One line, mirroring the `ftp` test, closes
   a scenario this change's own delta asserts. (Also consider giving the "schemeless string" test a
   content assertion — it currently matches `InvalidScheme(_)` with no message check, unlike its
   siblings.)

### Non-blocking Suggestions

- `CsvUrlFetchSpec` "reject a body over the configured limit ... naming the limit" asserts
  `msg.contains("100")` with `maxBytes = 100L`. The message also embeds the test-server URL, whose
  ephemeral port could contain "100" — this is the exact `include("1000")` substring trap HEL-861 hit.
  Assert the fuller phrase (`"maximum allowed size of 100 bytes"`) instead.
- The BOM-prefixed-HTML test asserts only `NotCsv(_)`. The spec says it is "rejected identically", so it
  should assert the same message content the non-BOM case does.
- `csvDataSourceSchema.test.ts`'s "does NOT describe a caller-supplied filesystem path" asserts the
  *presence of a disclaimer sentence* rather than the absence of a path input. A complementary
  `expect(toolBlock).not.toMatch(/`path`\s*(argument|input|parameter)/i)` would actually test the claim.
- Skeptic round-4 non-blocking note 1 was not taken up: a guard rejection (loopback / RFC1918 / blocked
  host) still surfaces as `Upstream` -> **502**, which reads as transient and may invite an agent caller
  to retry a request that can never succeed. No spec scenario asserts a status there, so this is not a
  defect — but a `Blocked` case mapping to 400 remains the better shape if it is ever cheap to add.
- Size-limit boundary: a body above `ContentSourceSupport`'s hard 100 MiB `toStrict` cap fails inside
  `fetchUrl` and surfaces as `Upstream("Request failed")` -> 502, not `TooLarge` -> 413. Only the
  50–100 MiB band produces the 413. Worth a sentence in the design's Decision 7 risk note.
- `jest.config.cjs`'s `/.claude/worktrees/` ignore pattern silently disables the entire root Jest suite
  when Jest is run from inside a delivery worktree (exit 0, "No tests found"). That is a repo-wide
  evaluation hazard well beyond this ticket — worth a spinoff ticket.
- `CsvUrlFetchSpec` builds an ~80 MB `oversizeBody` string and serves it over TLS. It works, but it is
  a heavy fixture; a smaller `maxBytes` against a modest body would prove the same branch.
