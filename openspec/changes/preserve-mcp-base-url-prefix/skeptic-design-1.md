## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 014317f538d3ec10f0394407f2c36d7e8e4fb7d4 (main plus the untracked change dir; HEL-1160 = c939f3781 is an ancestor).

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/mcp-base-url-prefix/HEL-1161`.
- I read ticket.md, proposal.md, design.md, tasks.md and specs/mcp-request-path-safety/spec.md, plus the live
  `helio-mcp/src/httpClient.ts`, `config.ts`, `httpConfig.ts`, `pathSegment.ts`, `oauth/familyClient.ts`,
  `oauth/patCheck.ts`, `requestPathGuard.test.ts` and `httpClient.originGuard.test.ts`.
- **I ran Decision 1's algorithm against HEL-1160's vectors.** Probe:
  `/home/matt/Development/helio/.concertino/scratch/HEL-1161/skeptic-design-probe.mjs` (`node` on it). It implements
  Decision 1 exactly: reject `//`, base = stripped + `/`, strip one leading `/`, resolve, then the origin and
  `pathname.startsWith(base.pathname)` checks. The WHATWG parser is deterministic, so one run is a stable reading.
  - With a prefixed base (`https://h/helio` and `https://h/helio/`, identical results), every escape is refused:
    `/api/../../tokens`, `/../x`, `/%2e%2e/x`, `/%2E%2E/x`, `/.%2e/x`, `/api/%2e%2e/%2e%2e/x`, `/\evil.example/x`,
    `/\t/evil.example/x`, `/\n/evil.example/x`, `/../helio2/x` (a sibling prefix), `/https://evil.example/x`,
    `/javascript:...` and `\\evil.example/x`. `/api/x` and `/api/x?y=1` land under `/helio/`. The containment
    check is correct for a prefixed base, and every helioApi path (all of them are `/api/...` literals or
    pathSegment templates, which I checked by grep) keeps the prefix.
  - **With a root base (`https://helio.test`, the base HEL-1160's tests use),** `/\evil.example/x` resolves to
    `OK https://helio.test/evil.example/x` and `/\t/evil.example/x` to `OK https://helio.test/evil.example/x`. Today
    (`new URL(path, base)`) both resolve to `https://evil.example/x` and are refused. Both are vectors in
    `httpClient.originGuard.test.ts` (`it.each`, line 23). Under the planned algorithm they no longer reject: the
    request is sent. See CR1.
- Decision 2 (sync throw becomes a rejected promise). The AC requires it. The typed error and the
  `calls.length === 0` assertions carry the security property, and those are kept. Converting `toThrow` to
  `rejects.toThrow` is sound and is not a weakening, provided the vector set survives intact (CR1 is the part that
  does not hold).
- Red on main, checked against the live code:
  - The HelioHttpClient prefix test is red (main sends to `https://h/api/x`).
  - The `localhost:8080` client base is red: it parses as scheme `localhost:` with an opaque path, so resolving it
    throws synchronously.
  - The `..`/`%2e%2e` tests under a prefix are red: main sends them to `https://h/tokens` and `https://h/x`.
  - `loadConfig` accepts anything, so its tests are red.
  - **Not red:** `FamilyClient` and `checkPat` with base `https://h/helio` already reach `https://h/helio/api/...`
    on main, because string concatenation keeps the prefix. `FamilyClient` with `localhost:8080`/`ftp://h` already
    sends nothing and returns `unavailable`, because `fetch` throws inside the `try`. For `loadHttpConfig`,
    `helio.test/api` already throws `HELIO_API_BASE_URL is not a valid URL.` See CR2.
- Decision 5 against the real source set:
  - `tools/write.ts:209-210` is `"...(PATCH " + "/api/data-sources/:id/schema) — ..."`. That is a tool description:
    a `+` concatenation with a string literal beginning `/api`. As written, rule (a) flags it, so the widened guard
    would be red on legitimate code. See CR3.
  - The `fetch(` sites in scanned `src` are `httpClient.ts:179` (default `fetchImpl`), `familyClient.ts:98` and
    `patCheck.ts:23`. `testing/` and `contextBudgetFixture.ts` are excluded, which matches the allow-list.
  - The only template with an interpolation before `/api/` is `patCheck.ts:23`. The allow-list bound is
    reasonable.
- Scope:
  - Including `checkPat` is justified. It is a base-joining REST site, and the proposal's "no module joins base +
    path" requires it.
  - Including `loadHttpConfig` is justified. `httpApp.ts:215` feeds `config.apiBaseUrl` to `HelioHttpClient`, and
    `localhost:8080` passes its current `new URL()` check.
  - No other runtime base-joining site exists in `helio-mcp/src`. `scripts/` and `e2e/` concatenate `${baseUrl}/api`
    but are dev harnesses. Leaving them out is defensible, but the plan should say so (non-blocking).
  - The plan touches no 429/Retry-After or timeout code, so the HEL-1162/1163 boundary holds.

### Verdict: REFUTE

### Change Requests

1. **Resolve the root-base regression of HEL-1160's backslash and control-character vectors (design Decision 1 and
   Decision 2, the spec "Origin change is refused" scenario, task 2.2).**
   - The problem: under Decision 1, `httpClient.originGuard.test.ts`'s `"/\\evil.example/x"` and
     `"/\t/evil.example/x"` with base `https://helio.test` resolve same-origin and are **sent**. Today they are
     refused.
   - Why it matters: Decision 2's claim "still a typed HelioRequestUrlError, still zero requests sent" is false for
     these vectors. The spec example (`/\evil.example/x` refused "with or without a base path prefix") is also
     wrong: without a prefix it is accepted, and with one it is refused by the prefix check, not the origin check.
     As planned, the executor will hit an unplanned red HEL-1160 test and have to decide alone whether to delete
     vectors.
   - Required: decide it in the design. I recommend (a): refuse, before resolution, any path containing `\` or an
     ASCII control character or space. pathSegment already forbids `\` in ids, so no legitimate path uses it. That
     keeps every HEL-1160 vector rejecting under both root and prefixed bases. The alternative, (b), is to declare
     those vectors same-origin-allowed and rewrite the tests and spec explicitly.
   - Either way: correct the spec scenario's example, and add the root-base `/\evil.example/x` and
     `/\t/evil.example/x` vectors to task 1.1 with their decided outcome.
2. **Make task 1.1's red claims true (design constraint C1, task 1.1 "every new test fails for the stated reason").**
   - These tests pass on unchanged main:
     - `FamilyClient` and `checkPat` prefix tests with `https://h/helio`;
     - `FamilyClient` "escape/invalid base yields unavailable";
     - `loadHttpConfig` rejecting `helio.test/api`.
   - Required, for each test:
     - either name a variant that is actually red on main, for example:
       - a trailing-slash base passed straight to `FamilyClient`/`checkPat` (main produces `//api/...`);
       - asserting `detail === "HelioRequestUrlError"`;
       - a `loadHttpConfig` vector of `localhost:8080`, `ftp://h`, or `https://h/?q=1`;
     - or label the test explicitly as a regression guard that is not red-first and is proven by a named mutation.
   - Also state that the red for scope addition 2 ("route FamilyClient through the builder") is carried by the
     widened guard (task 1.2), not by a behavioural test.
3. **Specify Decision 5's detection rules precisely enough that they are not red on legitimate code, and give
   check (a) a real non-vacuity floor.**
   - Rule (a)'s "`+` concatenation with a string literal beginning `/api`" matches the tool description at
     `helio-mcp/src/tools/write.ts:209-210`. Narrow it, for example to a `+` whose other operand is a
     non-string-literal expression (identifier, member access or call), or to `fetch(` arguments only. Name
     `write.ts` as the known negative case the guard must not flag.
   - "Each new check has its own non-vacuity floor (it must find the known sites)" is meaningless for (a): after the
     fix it has zero sites to find. Specify what (a) counts. My recommendation: run (a)'s matcher on in-test positive
     and negative fixture strings (the pre-fix `FamilyClient` and `patCheck` shapes and `${prefix}/api/x/${id}` must
     match; the `write.ts` description must not). Then the check cannot pass vacuously.
   - For (b), state the floor: exactly the 3 allow-listed sites found. Also state how "identifier bound to a
     `buildRequestUrl(...)` result" is verified statically, for example the same identifier appearing as
     `const <id> = buildRequestUrl(` in that file.

### Non-blocking notes

- Say in the plan that `helio-mcp/scripts/` and `helio-mcp/e2e/` are outside the guard and the builder (dev
  harnesses that build `${baseUrl}/api/...` by concatenation), so a reader does not mistake that for an oversight.
- `loadConfig` does not trim, while `loadHttpConfig` does. A set-but-empty `HELIO_API_BASE_URL=""` will now be
  rejected rather than defaulted. Either is fine; decide and test it.
- The builder's defence-in-depth base check covers only protocol. Consider also refusing a base `search` or `hash`
  in the builder, since `FamilyClient` and `checkPat` receive the base without passing `loadConfig`.
- A `FamilyClient` "path escape" cannot be reached through `create`/`rotate`, because pathSegment guards
  `familyId` first. Tell the implementer to test escapes through the builder itself and test only base failures
  through `FamilyClient`.
- Decision 2's scoping of the "no sync throw" AC to the client methods, which leaves out HelioApi's pathSegment
  calls, is acceptable: the `.catch`-degrading callers in `context.ts:123-124` take no ids.
