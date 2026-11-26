## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `46f2cc85505dbdfc5cf740ae9ecc31764dfef649` against the live-resolved base `014317f538d3ec10f0394407f2c36d7e8e4fb7d4` (`resolve-review-base.sh`, exit 0). This is a helio-mcp-only change with no UI, so step 4 (design judgment) does not apply. I followed the lane constraints: no .env reads, no servers, jest run with 3 workers under nice -n 19, and all scratch under `.concertino/scratch/HEL-1161/`.

### What I verified (with evidence)

**Gates, re-run myself** (`scratch/HEL-1161/skeptic-final-gates.txt`, `skeptic-final-jest.txt`)
- `npm --prefix helio-mcp run typecheck`: exit 0.
- `eslint --max-warnings 0 helio-mcp/src`: exit 0.
- `prettier --check helio-mcp/src`: clean.
- `npx jest helio-mcp --maxWorkers=3`: 79/79 suites and 790/790 tests passed.
- `openspec validate preserve-mcp-base-url-prefix --strict`: valid. The MODIFIED requirement header matches the base spec, and it covers both of the base spec's original scenarios.

**Acceptance criteria, traced to code**
- AC1 (prefix preserved, trailing slash identical).
  - Code: `requestUrl.ts:48` strips trailing slashes and appends `/`. Line 59 resolves the path with its leading `/` removed.
  - Tests: `httpClient.originGuard.test.ts` "path prefix" runs bases `https://h/helio`, `https://h/helio/` and `https://h/helio//`. `requestUrl.test.ts` and the familyClient/patCheck tests cover the same.
- AC2 (`loadConfig` rejects a non-http(s) base and names the variable).
  - Code: `config.ts` `validateApiBaseUrl` is used by both `loadConfig` and `loadHttpConfig`. Every message starts with `HELIO_API_BASE_URL` and never echoes the value. The credential non-echo has its own test.
- AC3 (no synchronous throw).
  - Code: `send` and `postMultipart` are now `async`. `get/post/patch/put/delete` only delegate to `send`, so a JSON.stringify failure is also a rejection.
  - Test: `callWithoutThrowing` runs the check across all 6 methods.
- Scope addition 1 (widened guard). It adds checks (a) and (b), and each matcher has inline positive and negative fixtures. MIN_SITES 63 is kept.
- Scope addition 2 (FamilyClient through the builder). `familyClient.ts:99` calls `buildRequestUrl` inside the existing `try`. `patCheck.ts` does the same.
- Scope addition 3 (origin check intact, no climbing above the prefix).
  - Code: `requestUrl.ts:60-65` checks the origin and that the pathname starts with the base pathname, and the base pathname always ends with `/`.
  - Tests: the `..`, `%2e%2e`, `.%2e` and `/../helio2` vectors, plus `//` and `/https://` under a prefixed base.

**Red-first is real, reproduced independently** (`scratch/HEL-1161/skeptic-final-red-repro.txt`)
- Method: I checked out main's 5 implementation files, removed `requestUrl.ts`, and ran the 7 spec files.
- Result: 63 failed, 36 passed, matching the committed `red-run-main.txt` and the red commit's message.
- The failures are for the stated reasons:
  - The prefix was lost (`https://h/api/x`).
  - Requests threw synchronously.
  - Config accepted bad bases.
  - FamilyClient and patCheck produced `//api`, or attempted a fetch.
  - Guard (a) flagged the real FamilyClient and patCheck shapes. Guard (b) failed for both files.
- `git diff 4b176d369 46f2cc855` touches no test file, so the tests that went red are the tests that now pass.
- Weak point: `requestUrl.test.ts` was red on main only because the module did not exist (TS2307). Every behaviour it asserts is also red-first through a real behavioural test in `httpClient.originGuard.test.ts` or `config.test.ts`, so nothing depends on that import failure.
- The worktree was restored afterwards (`git status`: only `evaluation-1.md` untracked).

**My own mutations, none of them in tasks 3.1** (each restored with `git checkout HEAD --`)
- A. Dropped `async` from `postMultipart` only, leaving `send` async. 4 tests went red, all in the postMultipart no-sync-throw set (`skeptic-final-mutA.txt`).
- C. Prefix check weakened to `startsWith(base.pathname.slice(0, -1))`, which lets the sibling prefix `/helio2` through. 2 tests went red, the `/../helio2/x` vectors in both `requestUrl.test.ts` and `originGuard` (`skeptic-final-mutC.txt`).
- D. Planted `b + "/api/x/" + encodeURIComponent(id)` in `oauth/provider.ts`, a file the plan's mutations never touched. Guard (a) went red and named both joins (`skeptic-final-mutD.txt`). The widened guard can fail.
- B. Replaced the builder in `HelioHttpClient.send` with `` `${this.baseUrl}${path}` ``. 38 behavioural tests went red, but neither guard flagged it (`skeptic-final-mutB.txt`). See the non-blocking notes.

**HEL-1160's protections are not weakened**
- The `//` refusal and the origin check are unchanged in meaning.
- The pre-resolution character check adds refusals: `\`, control characters and space. It removes none.
- The pathSegment template check and MIN_SITES 63 are unchanged and pass.
- The changed HEL-1160 tests assert rejection instead of a synchronous throw, as AC3 requires. They still assert the same `HelioRequestUrlError` type and that zero requests are sent.

**The `git commit -n` on 4b176d369 is acceptable**
- The bypass is disclosed in the commit message along with its reason: the red tests import a module that does not exist yet.
- Lane constraint C12 requires committing the red run before any implementation, so a hook refusal was unavoidable.
- The implementation commit 46f2cc855 was not made with `-n`. All the hook's gates pass at HEAD (my re-run above).
- The test files are unchanged since the bypass, so nothing unlinted or unformatted shipped through it.

**Scope.** There is no Retry-After (HEL-1162) or timeout work (HEL-1163), no backend or frontend change, no migration and no deploy.

### Verdict: CONFIRM

### Non-blocking notes
- Guard heuristic gap (mutation B). A string-joined URL handed to anything other than a literal `fetch(`, such as `this.deps.fetchImpl` or `dispatch`, is invisible to checks (a) and (b) when the template has no `/api/` text. In `httpClient.ts` the behavioural tests catch it (38 red). A future module calling an injected fetch seam would rely on review alone. design.md Risks already acknowledges this, so it is a candidate follow-up, not a defect.
- The HEL-1160 vector `//helio.test/x` (same-origin protocol-relative) was dropped from `httpClient.originGuard.test.ts`. It is redundant: `//evil.example/x` fails the same `startsWith("//")` mutation under a root base. It could be restored cheaply for continuity.
- `index.ts:45` prints `config.baseUrl` to stderr, which could include userinfo credentials. This predates the change and is out of scope.
