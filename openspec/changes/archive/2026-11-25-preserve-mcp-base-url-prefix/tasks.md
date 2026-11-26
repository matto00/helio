## Standing Constraints

- [C1] Red first: every AC item and both scope additions have a test that fails on unchanged main, recorded and committed as .txt before implementation; each fix is mutation-proven.
- [C2] HEL-1160's protocol-relative and origin checks stay intact; a prefixed base still refuses origin escapes, and no path may resolve above the base path prefix.
- [C3] Do not widen into HEL-1162 (Retry-After) or HEL-1163 (timeouts/typed errors); no deploy, no migration, no backend/frontend change.

## 1. Red first (commit before any implementation)

- [x] 1.1 Write tests against unchanged `main` code. Each is labelled in the test name or a comment as RED-FIRST (must fail on main for the stated reason) or GUARD (passes on main; a regression guard proven by a named mutation in task 3.1). Do not claim a GUARD test as red.
  - RED-FIRST, `HelioHttpClient`: base `https://h/helio` and `https://h/helio/` + `/api/x` both request `https://h/helio/api/x` (main: `https://h/api/x`).
  - RED-FIRST, `HelioHttpClient` no sync throw: every request method (`get/post/patch/put/delete/postMultipart`) called with a `//` path, `/\\evil.example/x` (main: synchronous throw), `/https://evil.example/x` (main: sent same-origin), and on a client constructed with base `localhost:8080`, returns without throwing and the promise rejects with `HelioRequestUrlError`; zero requests sent (main throws synchronously).
  - RED-FIRST, prefix containment under base `https://h/helio`: `/api/../../tokens`, `/../x`, `/%2e%2e/x`, `/.%2e/x`, `/../helio2/x` reject with `HelioRequestUrlError` and send nothing (main sends to `https://h/tokens` etc.).
  - GUARD (existing HEL-1160 vectors, now asserted as rejections): `/\evil.example/x` and `/\t/evil.example/x` under root base `https://helio.test` AND under `https://h/helio` reject with `HelioRequestUrlError` and send nothing. On main these already refuse (synchronously) under the root base; the mutation that proves the new backslash/control/space check is task 3.1's "remove the pre-resolution character check". Add a RED-FIRST vector that main sends: a path containing a space or control character that main resolves same-origin, e.g. `/api/x y` or `/api/x\u0000` (verify main sends it; if not, label GUARD).
  - RED-FIRST, `loadConfig`: rejects `localhost:8080`, `helio.test/api`, `ftp://h`, `file:///x`, `https://h/?q=1`, `https://h/#f` with a message naming `HELIO_API_BASE_URL` (main accepts all); blank `HELIO_API_BASE_URL="  "` loads the default (main yields a blank base). GUARD: unset/`https://h`/`https://h/helio`/`https://h/helio/` accepted.
  - RED-FIRST, `loadHttpConfig`: rejects `localhost:8080`, `ftp://h`, `https://h/?q=1` naming `HELIO_API_BASE_URL` (main accepts these). GUARD: `helio.test/api` rejected (main already rejects).
  - RED-FIRST, `FamilyClient`/`checkPat` with a trailing-slash base passed directly (`https://h/helio/`): requests go to `https://h/helio/api/mcp-refresh-families` / `https://h/helio/api/tokens` (main produces `//api/...`). RED-FIRST: `FamilyClient` with base `localhost:8080` returns `unavailable` with `detail === "HelioRequestUrlError"` and sends nothing (main: a fetch error name). GUARD: `https://h/helio` (no trailing slash) prefix preserved (main already concatenates). Path escapes are tested on `buildRequestUrl` directly, not through `FamilyClient` (pathSegment guards `familyId` first).
  - Scope addition 2 (FamilyClient through the builder) is red-first through the widened guard in 1.2, not a behavioural test.
  - Verify: run the full spec files on main; every RED-FIRST test fails for its stated reason and every GUARD test passes.
- [x] 1.2 Widen `helio-mcp/src/requestPathGuard.test.ts` per design Decision 5 (string-joined request URL check + `fetch(` allow-list, each with its own non-vacuity floor; keep MIN_SITES >= 63). Verify: it is red on `main` (FamilyClient's `${this.apiBaseUrl}${path}` and patCheck's `${apiBaseUrl}/api/tokens` are flagged).
- [x] 1.3 Record the red run as `.txt` under `openspec/changes/preserve-mcp-base-url-prefix/evidence/` and commit it with the tests before writing implementation code (if the pre-commit hook refuses a red commit, keep the .txt and say so in the PR).

## 2. Implementation

- [x] 2.1 Add `helio-mcp/src/requestUrl.ts` with `buildRequestUrl` and `HelioRequestUrlError` (re-exported from `httpClient.ts`) per design Decision 1. Verify: prefix and containment tests from 1.1 pass.
- [x] 2.2 Make `HelioHttpClient` use the builder and make every request method reject instead of throwing synchronously (Decision 2); update `httpClient.originGuard.test.ts` from sync `toThrow` to `rejects.toThrow` with zero-request assertions kept. Verify: origin-guard and no-sync-throw tests pass.
- [x] 2.3 Route `FamilyClient.post` and `checkPat` through the builder inside their existing `try` blocks (Decision 3). Verify: family/patCheck prefix and escape tests pass; existing `familyClient.test.ts`, `familySeam.test.ts`, `oauthFlow.test.ts`, `refreshFlow.test.ts` stay green.
- [x] 2.4 Add the shared base-URL validator and use it in `loadConfig` and `loadHttpConfig` (Decision 4). Verify: config tests from 1.1 pass; `httpConfig.test.ts` stays green.
- [x] 2.5 Guard green: `requestPathGuard.test.ts` passes with the real sites.

## 3. Mutation proof

- [x] 3.1 For each fix, revert it alone (or plant the pre-fix shape) and confirm the matching test goes red, then restore: root-relative resolution (prefix lost), removed pathname-prefix check (`..` escapes), removed pre-resolution backslash/control/space check (root-base `/\evil.example/x` is sent), removed builder base search/hash check, sync `buildUrl` call in `send`, removed config scheme check, FamilyClient back to `${this.apiBaseUrl}${path}`, and a planted `` `${prefix}/api/x/${id}` `` template plus a planted unlisted `fetch(` for the guard. Record each mutation's red output as `.txt` evidence.

## 4. Gates

- [x] 4.1 `npm --prefix helio-mcp run typecheck`, root lint/format for changed files, and the full helio-mcp jest suite (`npx jest helio-mcp` from the repo root, 3 workers, `nice -n 19`) green. Verify: command output recorded.
