## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d3ccfda244c49fe48a17e6441451d8551011af4d`. The diff base was resolved live with `resolve-review-base.sh`: `95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c` (origin/main). The spawn-cwd guard returned READY. No UI and no backend in the diff, so step 4 (design judgment) was skipped and no servers were started.

### What I verified (with evidence)

**Gates, re-run fresh by me (all from the worktree root)**
- `nice -n 19 npx jest --maxWorkers=3 helio-mcp`: 76 suites, 689 tests passed, exit 0.
- `npm --prefix helio-mcp run typecheck`: exit 0.
- `npx eslint --max-warnings=0 helio-mcp/src`: exit 0.
- `npx prettier --check helio-mcp/src`: all files pass, exit 0.

**Adversarial check 1: can an agent-controlled value still reach a request path unencoded?** No.
- I searched every non-test file in `helio-mcp/src` for `fetch(`, `http.get/post/put/patch/delete/postMultipart` and `new URL(`. The only request paths are built in three places:
  - `HelioApi` (through `HelioHttpClient`)
  - `oauth/familyClient.ts`, whose `post` does `${apiBaseUrl}${path}`
  - `oauth/patCheck.ts`, which uses the literal `/api/tokens`
- A perl multi-line scan of every template starting with `/` that has a `${…}` other than `${pathSegment(…)}` found only three:
  - `helioApi.ts:496` is a returned `completionUrl` string, not a request. Its query value is already `encodeURIComponent`-encoded.
  - `contextBudgetFixture.ts:435` is test fixture data.
  - `httpClient.ts:420` (`` `/${path}` ``) is the `buildUrl` normalizer, which the origin guard now covers.
- No `"/api…" + x` concatenation exists anywhere.
- The OAuth `FamilyClient.rotate` validates first and maps a bad id to `refused/unknown`. `create` uses a literal path.
- No tool handler calls `HelioHttpClient` directly; only `index.ts`/`httpApp.ts` construct it.
- C2 holds:
  - `getDashboard` and `listSourceObjects` keep the raw id for `find`, messages and `listAllPanels(dashboardId)`.
  - There is no `pathSegment(pathSegment(` and no leftover `encodeURIComponent` on a path.

**Adversarial check 2: is the GUARD failable and non-vacuous?** Yes, by mutation, and each file was restored with `git checkout -- <file>`:
- M1: revert `getPipelineRunHistory` to `${pipelineId}`. GUARD FAIL (1 failed).
- M1b: revert the multi-line `removePipelineRoot` `rootId` to `${rootId}`. GUARD FAIL. This shows multi-line templates are scanned.
- M1c: revert `familyClient` to `${encodeURIComponent(familyId)}`. GUARD FAIL. This shows the `oauth/` subdirectory is scanned.
- Against vacuity, it asserts `MIN_SITES = 63`, and the committed `evidence/red-run.txt` shows the GUARD red with 254 raw sites before implementation.

**Adversarial check 3: do the unit tests fail under real mutation?** Yes. I ran each mutation against `pathSegment.test` + `pathSegment.toolSeam`, `httpClient*` or `familyClient.test`:
- Drop the `..` branch: 1 failed.
- Drop the `.` branch: 1 failed.
- Drop the `""` branch: 1 failed.
- Drop `/` from FORBIDDEN: 6 failed, including all tool-seam cases.
- Drop `?`: 2 failed.
- Drop `#`: 1 failed.
- Drop `\`: 1 failed.
- `return value` with no encoding: 1 failed.
- `buildUrl`, drop the `//` check: 1 failed (`//helio.test/x`, which is same-origin, is caught only by that check).
- `buildUrl`, drop the origin check: 2 failed (`/\evil`, `/\t/evil`).
- `familyClient`, remove the validate-first block: 2 failed (the template's `pathSegment` throws outside `post`'s try, so `rotate` rejects).
- After all mutations, `git status --short` shows only the untracked `evaluation-1.md` (not mine).

**Adversarial check 4: does a rejected id reach the agent as a typed isError with no request?** Yes.
- `pathSegment.toolSeam.test.ts` drives the real MCP server through `connectMcp` for `get_pipeline`, `list_source_objects` and `get_dashboard` with `1/../../tokens`.
- It asserts `isError === true`, that the text contains `HelioInvalidIdError` and the value, and that the recorded URL list is `[]`.
- A positive control shows a UUID still reaches `/api/pipelines/<id>` and `/steps`.
- Every `guarded` wrapper (`tools/*.ts`) formats a non-`HelioApiError` as `${name}: ${message}` with `isError: true`, so the rejection is typed and not a crash.
- Before the fix, the red run shows `list_source_objects`/`get_dashboard` returning a `HelioApiError (status 404) for /api/data-sources/1/../../tokens`, which is the right red reason.

**Acceptance criteria trace**
1. GUARD: `requestPathGuard.test.ts`, proven failable above. Met.
2. Unit tests for `..`, `.`, `a/b`, `a?b=1`, `a#b`, `a\b` and `""` rejected with `HelioInvalidIdError`, and a UUID and slugs unchanged: `pathSegment.test.ts`. Each rejection branch is mutation-proven. Met.
3. `buildUrl` throws for `//…` and for an origin change: `httpClient.ts:416-424` and `httpClient.originGuard.test.ts`. Both are mutation-proven and the throw is synchronous (C1). Met.
4. Tool-level isError with no HTTP request: `pathSegment.toolSeam.test.ts`. Met.
5. Existing tests, typecheck and lint pass: re-run above. Met.

**Red-first evidence judgment**
- `evidence/red-run.txt` records 5 red suites. Three are behavioural reds:
  - GUARD: 254 raw sites.
  - `familyClient`: `unavailable` instead of `refused`.
  - tool seam: no isError / a 404 off a traversed path.
- Two are compile reds (`pathSegment.test` and `originGuard` import a not-yet-existing module or export). A compile red alone does not prove the assertions can fail. My mutation runs close that gap for both files.
- Task 1.5's "commit it before any implementation" was not literally followed. The red file is committed together with the implementation in `d3ccfda24`. The orchestrator says the pre-commit hook refused a red-only commit and that the driver's C12 allows this if the PR states it. I can only verify the content of the red run, not when it was captured. It names failures that cannot exist after the implementation (missing module/export, 254 raw sites), so it is self-authenticating as pre-implementation output. **The PR body must disclose the combined commit**, as C12 requires.

### Verdict: CONFIRM

### Non-blocking notes
- **The PR body must disclose the combined commit.** It must say that `evidence/red-run.txt` was committed together with the implementation because the pre-commit hook refuses a red-only commit (C12). This is a delivery-step obligation; if it is skipped, the gate chain is incomplete.
- **The GUARD scans only templates that start with `` `/api/ ``.** A future path built another way would bypass it, for example `` `${prefix}/x` ``, `"/api/x/" + id`, or a non-`/api` prefix. Nothing like that exists today (verified above). The `startsWith("pathSegment(")` check would also accept `pathSegment(a) + b`. These are acceptable limits for a grep guard; a follow-up could tighten them if the surface grows.
- **The origin check covers only `HelioHttpClient.buildUrl`.** `FamilyClient.post` concatenates `${apiBaseUrl}${path}` with no origin check. Its only callers pass a literal path or a `pathSegment` path, so this is not exploitable today. The ticket scopes the origin check to `buildUrl`.
