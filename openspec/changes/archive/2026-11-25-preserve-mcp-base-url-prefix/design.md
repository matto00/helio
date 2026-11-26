## Context

See proposal.md - Why. `HelioHttpClient.buildUrl` (HEL-1160, c939f3781) rejects `//` paths and any resolved origin
other than the base's, but resolves every path root-relative (`new URL("/api/x", base + "/")`), which discards the
base's path. `FamilyClient.post` and `checkPat` build URLs by string concatenation (`${apiBaseUrl}${path}`), which keeps
a prefix but has no origin or prefix check. `loadConfig` accepts any string; `loadHttpConfig` only checks `new URL()`
parses (so `localhost:8080`, a valid URL with scheme `localhost:`, passes). The request methods call `buildUrl` before
any promise exists, so a build failure is a synchronous throw. HEL-1160's own tests assert that synchronous throw.

## Goals / Non-Goals

**Goals:** one URL builder for every helio-mcp REST call; prefix preservation; prefix containment; no synchronous
throw from an API-client request method; base URL validated once at config load; a static guard that catches a
reintroduced string-joined or builder-bypassing request URL.

**Non-Goals:** Retry-After handling (HEL-1162); timeouts or a typed-error taxonomy beyond what exists (HEL-1163);
`pathSegment` behaviour (unchanged); making `HelioApi` methods that call `pathSegment` before the client non-throwing
(they are not request methods of the client; tool handlers already catch); any deploy.

## Decisions

1. **Shared builder `buildRequestUrl(baseUrl, path, query?)` in `helio-mcp/src/requestUrl.ts`.** It moves
   `HelioRequestUrlError` there (re-exported from `httpClient.ts` so existing imports keep working). Algorithm:
   - reject `path` starting with `//` (unchanged);
   - reject, before resolution, any `path` containing `\`, an ASCII control character (U+0000-U+001F, U+007F) or a
     space (new, skeptic design round 1 CR1). WHATWG strips tab/newline and treats `\` as `/` for http(s), so
     `/\evil.example/x` and `/\t/evil.example/x` would otherwise resolve to `<base>/evil.example/x` (same origin,
     inside a root base) and be sent, where HEL-1160 refused them. `pathSegment` already forbids `\` in ids and
     encodes space/controls, so no legitimate request path contains any of these. This keeps every HEL-1160 vector
     refused under both a root base and a prefixed base;
   - `base = new URL(baseUrl.replace(/\/+$/, "") + "/")` (so trailing slash or not is identical); a base that does not
     parse, is not `http:`/`https:`, or carries a `search` or `hash`, is a `HelioRequestUrlError` (defence in depth
     for callers such as `FamilyClient`/`checkPat` that receive the base without going through `loadConfig`);
   - resolve `path` with its single leading `/` removed, relative to `base`, so `/api/x` lands at `<prefix>/api/x`;
   - refuse when `url.origin !== base.origin` (HEL-1160 check, unchanged in meaning) or when
     `!url.pathname.startsWith(base.pathname)` (new: catches `..`, `%2e%2e`, `.%2e` and similar dot-segment escapes
     above a prefix, including a sibling prefix such as `/../helio2/x`);
   - apply `query` with `searchParams.set` as today.
   *Alternative rejected:* string-join `basePath + path` then parse. It needs its own dot-segment handling, and
   WHATWG normalisation would still have to be checked afterwards, so the post-resolution pathname check is required
   either way; resolving relative to the base and checking the result is the smaller, single source of truth.
   *Alternative rejected:* forbid `..` lexically. Encoded and backslash variants are normalised by the URL parser, so a
   lexical check is bypassable; checking the resolved pathname is not.
2. **No synchronous throw:** `send` and `postMultipart` become `async` (or build the URL inside a promise), so every
   public method (`get/post/patch/put/delete/postMultipart`) returns a rejected promise on a build failure. HEL-1160's
   `httpClient.originGuard.test.ts` changes from `expect(() => ...).toThrow` to `await expect(...).rejects.toThrow`,
   and gains a "call returns without throwing" assertion. This is a direct requirement of this ticket's AC 3 and does
   not weaken HEL-1160: still a typed `HelioRequestUrlError`, still zero requests sent.
3. **`FamilyClient.post` and `checkPat` use `buildRequestUrl`.** A build error inside `FamilyClient.post` already lands
   in its existing `try` and maps to `{ error: "HelioRequestUrlError" }` (outcome `unavailable`), and `checkPat`'s
   existing `catch` maps it to `"unknown"`; the builder call must be inside those `try` blocks.
4. **Config validation** (stdio `loadConfig` trims the value and treats a set-but-blank `HELIO_API_BASE_URL` as unset,
   so the default applies; HTTP mode keeps `required`, which already rejects blank) in one exported helper (e.g. `validateApiBaseUrl(raw)` in `config.ts`) used by both
   `loadConfig` and `loadHttpConfig`: parse with `new URL`, require protocol `http:` or `https:`, require empty
   `search` and `hash`; on failure throw `HELIO_API_BASE_URL must be an absolute http(s) URL ... (got ...)`. Returns the
   value with trailing slashes stripped, as today. The message never echoes the raw value (a URL may carry userinfo
   credentials); it names the variable, states the expected form (`e.g. https://helio.example or
   https://host/helio`), and when the value parsed, names only the offending part (the scheme, or "a query string" /
   "a fragment").
5. **Widened guard (`requestPathGuard.test.ts`).** Same source set as today (`helio-mcp/src/**/*.ts`, excluding
   `*.test.ts`, `testing/`, `__golden__/`, `contextBudgetFixture.ts`). `helio-mcp/scripts/` and `helio-mcp/e2e/` are
   dev harnesses outside both the guard and the builder (they build `${baseUrl}/api/...` by concatenation against a
   local backend); that is deliberate, not an oversight. Three checks:
   - (existing) every `${...}` in a template literal whose text starts with `/api/` is `pathSegment(...)`; keep
     `MIN_SITES` (>= 63).
   - (a) **no base-joined request path.** The matcher, exported within the test file as a pure function over a source
     string, flags: (a1) a template literal containing `/api/` whose text has an interpolation BEFORE the first
     `/api/` (e.g. `` `${this.apiBaseUrl}/api/x` ``, `` `${prefix}/api/x/${id}` ``); (a2) a template literal that is
     exactly two or more adjacent interpolations with no literal text between them, used as a `fetch(` first
     argument (e.g. `` fetch(`${this.apiBaseUrl}${path}`) ``); (a3) a `+` whose one operand is a string literal starting `/api` and whose other operand is an identifier, a
     member access, a call, or a parenthesised non-literal expression (e.g. `base + "/api/x"`, `"/api/x/" + id`,
     `this.apiBaseUrl + path`). A `+` whose other operand is a string literal or a template literal (with or without
     `${}`) is NOT flagged (skeptic design round 2 CR1). Non-vacuity: the same test runs the matcher on inline fixture
     strings: positives that MUST match (the pre-fix FamilyClient `` fetch(`${this.apiBaseUrl}${path}`, ``, the pre-fix
     patCheck `` fetch(`${apiBaseUrl}/api/tokens`, ``, `` `${prefix}/api/x/${id}` ``, `base + "/api/x"`,
     `"/api/x/" + id`) and negatives that MUST NOT match: the real three-line `tools/write.ts:209-211` shape, verbatim
     in form (string literal `+` `"/api/data-sources/:id/schema) — ..."` `+` a template literal containing
     `${CANONICAL_COLUMN_TYPES_LIST}`), and a plain `` `/api/x/${pathSegment(id)}` ``. Then it asserts zero matches across the real source set.
   - (b) **fetch allow-list.** Every `fetch(` call in the source set is found; the floor is exactly the 3 known sites
     (`httpClient.ts` default `fetchImpl`, `oauth/familyClient.ts`, `oauth/patCheck.ts`), and any other file with a
     `fetch(` fails. In `familyClient.ts` and `patCheck.ts` the first argument must be either a
     `buildRequestUrl(` call or an identifier `<id>` for which the same file contains `const <id> = buildRequestUrl(`.
     In `httpClient.ts` the only `fetch(` is the default `fetchImpl` forwarding its `url` parameter.
   The guard's header comment and `MIN_SITES` comment are updated to describe checks (a) and (b). Builder note (skeptic design round 3 CR1): the builder resolves the BARE stripped path, never `"./" + stripped`; under `"./"` a path such as `/https://evil.example/x` would resolve same-origin inside the prefix and be sent, making the origin check unreachable. A first segment containing `:` (e.g. `/a:b/x`) is therefore refused as an origin change, which is acceptable: every in-repo path starts `/api/`. Check (b) matches the literal token `fetch(` with no whitespace (a `fetch\s*\(` regex would match prose comments in `context.ts`).
   Mutation proof (task 3.1): plant `` fetch(`${this.apiBaseUrl}${path}`) `` back in FamilyClient, plant a
   `` `${prefix}/api/x/${id}` `` template, and plant a new `fetch(` in another file; each must turn the guard red.
   Scope addition 2 ("route FamilyClient through the builder") is red-first through this guard (it is red on main),
   not through a behavioural test.

## Risks / Trade-offs

- [A base with a non-root prefix rejects absolute-root agent paths that previously worked against the root] -> only
  reachable by a misconfigured prefix; every in-repo caller passes `/api/...` paths, which land under the prefix.
- [Static guard heuristics have false negatives (e.g. a URL built via a helper function)] -> the fetch allow-list (b)
  bounds the surface: any new network call site must be reviewed into the allow-list.
- [Changing HEL-1160 tests could hide a regression] -> the same typed error and zero-request assertions remain; only
  sync-throw becomes rejection, which this ticket's AC requires.

## Migration Plan

None. Behaviour-only change in helio-mcp; no deploy in this ticket (C8).
