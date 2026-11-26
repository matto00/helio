## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `46f2cc85505dbdfc5cf740ae9ecc31764dfef649` against the live-resolved base `014317f538d3ec10f0394407f2c36d7e8e4fb7d4`.
Commits: `4b176d369` (red-first tests and red evidence; `--no-verify` is disclosed in the commit body, and the only reason is that `requestUrl.test.ts` imports a module that did not exist yet), then `46f2cc855` (implementation).
I ran every check below myself. Scratch output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1161/eval1-*`.

### Phase 1: Spec Review — PASS
Issues: none

Acceptance criteria and scope additions in ticket.md:
- AC1 (prefix kept; a trailing slash makes no difference): `httpClient.originGuard.test.ts` "path prefix" covers bases `https://h/helio`, `https://h/helio/` and `https://h/helio//`, and `requestUrl.test.ts` adds root bases. These tests fail on main.
- AC2 (`loadConfig` rejects a base that is not an absolute http(s) URL and names the variable): `config.test.ts` covers 8 rejected values and checks that no credential is echoed. `httpConfig.test.ts` covers HTTP mode. Both use the shared `validateApiBaseUrl` (`config.ts:25`).
- AC3 (no synchronous throw): `send` and `postMultipart` are now `async` (`httpClient.ts:239`, `:249`). The test runs every method (get, post, patch, put, delete, postMultipart) with `callWithoutThrowing`, using `//`, `/\`, `/https://` and a `localhost:8080` base.
- Scope 1 (widened guard): checks (a) and (b) were added. `MIN_SITES` is still 63 (`requestPathGuard.test.ts:92`). Planted shapes turn it red (see Phase 2).
- Scope 2 (`FamilyClient.post` goes through the builder): `familyClient.ts:99`, inside the existing `try`. A bad base maps to `unavailable` with detail `HelioRequestUrlError`, and this is tested.
- Scope 3 (origin check holds under a prefixed base; `..` cannot climb above the prefix): `buildRequestUrl` checks the resolved pathname against the base pathname (`requestUrl.ts:63`). Tested vectors: `..`, `%2e%2e`, `.%2e`, a sibling `/../helio2/x`, and origin escapes under `https://h/helio`.

Red evidence, re-run by me. I checked out main's five implementation files with `git checkout 014317f53 --` and removed `requestUrl.ts`, then ran the 7 spec files. Result: 63 tests failed, 36 passed, and `requestUrl.test.ts` failed to compile (TS2307). This matches the executor's reported "63 failing, 36 passing". I then cross-checked the results against the test labels:
- No RED-FIRST test passed on main.
- No GUARD test failed on main. The exception is guard checks (a) and (b), which design Decision 5 intends to be red on main.
- The unlabelled tests are the pre-existing ones, and all of them passed.

I restored the files with `git checkout HEAD --` and confirmed `git status` was clean afterwards.

Other spec checks:
- Every task is marked done and matches the code.
- No scope creep. Nothing touches HEL-1162 or HEL-1163, and there is no backend, frontend, migration or deploy change.
- The spec delta modifies the existing requirement "Requests never leave the configured API origin" by its exact header. `openspec validate --strict` passes.
- CONSTRAINTS C1, C2 and C3 are all honoured.

### Phase 2: Code Review — PASS
Issues: none

Gates, run fresh in WORKTREE_PATH under `nice -n 19` with `--maxWorkers=3`:
- `npx jest helio-mcp`: 79 suites and 790 tests, all passing.
- `npm --prefix helio-mcp run typecheck`: exit 0.
- `npx eslint --max-warnings=0` on the changed helio-mcp files: exit 0.
- `npx prettier --check` on all changed files: clean.
- The frontend and backend gates do not apply, because no `frontend/**` or `backend/**` file changed.

Mutations I applied myself (each reverted with `git checkout HEAD --`):
- m2, the pathname-prefix check disabled: 11 tests fail, all of them containment vectors in `requestUrl.test.ts` and `originGuard`.
- m3, the character check disabled: 12 tests fail. These include the root-base `/\evil.example/x` case across all six methods, and the GUARD test for root-base `/\` and `/\t`.
- m5, `async` removed from `send` and `postMultipart`: 34 tests fail, all in "refusals are rejected promises".
- m7, FamilyClient's `fetch` changed back to `` `${this.apiBaseUrl}${path}` ``: guard (a) "finds none across the real source set" and guard (b) "familyClient.ts passes buildRequestUrl" both fail.

The widened guard is not vacuous. I planted new shapes in a throwaway `helio-mcp/src/zzEvalPlant.ts` (removed afterwards), and each one turned the guard red:
- `` `${prefix}/api/dashboards/${id}` `` fails check (a).
- `base + "/api/dashboards"` fails check (a).
- `"/api/dashboards/" + id` fails check (a).
- A bare `fetch(u)` in a file that is not on the allow-list fails check (b).
- `` fetch(`${x}${"y"}`) `` fails both (a) and (b).

The guard's own matcher fixtures (positive and negative) also run inside the suite.

HEL-1160's protections are intact:
- The `//` refusal and the origin check are unchanged in meaning (`requestUrl.ts:35`, `:60`).
- `pathSegment` is untouched, and its guard keeps `MIN_SITES` 63.
- No `buildUrl` remains, and no request URL is built by string concatenation in `helio-mcp/src`.
- The bare-path resolution (no `./` prefix) keeps `/https://evil.example/x` refused, and this is tested.

Code quality:
- The new module is small at 71 lines, with clear names. `HelioRequestUrlError` is re-exported from `httpClient.ts`, so existing imports keep working.
- There are no `any`s, dead code or TODOs.
- Config errors name the variable and never echo the value, and this is tested.

### Phase 3: UI Review — N/A
None of the UI triggers match. Every changed file is under `helio-mcp/` or the change folder: nothing under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The spec delta lives in the change folder, not in `openspec/specs/`. I started no servers.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- HEL-1160's original vector `//helio.test/x` (a same-origin, protocol-relative path) was dropped from `httpClient.originGuard.test.ts`'s list. The `startsWith("//")` check still refuses it, but the explicit assertion is gone. Consider adding it back to the `METHODS` path list.
- `helio-mcp/README.md:46` and `:128` could mention that a path-prefixed `HELIO_API_BASE_URL` (for example `https://host/helio`) is now supported, and that it is validated at startup.
- The guard's describe blocks "GUARD (a)" and "GUARD (b)" are red on main by design. A one-line comment saying so would avoid confusion with the RED-FIRST/GUARD label convention.
