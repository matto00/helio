## Context

See proposal.md (Why). Current state, re-derived from the tree at 95cec30cf:

- `helio-mcp/src/httpClient.ts` `buildUrl` (line ~404) does `new URL(path, base + "/")` with no origin check; every
  verb (`get/post/put/patch/delete`, `postMultipart`) goes through it.
- `helio-mcp/src/helioApi.ts` has 60 raw id interpolations on 57 request lines (614, 628 and 786 carry two each)
  plus two non-request `HelioApiError` path labels at ~284 (`getDashboard`) and ~322 (`listSourceObjects`)
  (`${dashboardId}`, `${sourceId}`, `${pipelineId}`, `${rowId}`, `${rootId}`, `${shapeId}`, `${panelId}`,
  `${applicationId}`, `${outputId}`, `${stepId}`, `${dataSourceId}`). Enumerate with
  `grep -oE '\`/api/[^\`]*\`' helio-mcp/src/helioApi.ts` (multi-line calls put the template on the next line).
- `helio-mcp/src/oauth/familyClient.ts:67` (`rotate`) uses `encodeURIComponent(familyId)` only; `familyId` comes from
  a sealed refresh token, not an agent, but `..` survives encoding, so it uses the helper too. That client builds
  URLs with `${apiBaseUrl}${path}` (not `buildUrl`); its paths are constants plus that one id.
- `oauth/patCheck.ts` uses the constant `/api/tokens`; `helioApi.ts:483` encodes a query token into a returned
  `completionUrl` string (not a request) and is left alone.
- `contextBudgetFixture.ts:435` compares an incoming path in a test fixture; not a request site.
- About 40 `HelioApi` methods are plain `Promise`-returning (not `async`), and `HelioHttpClient.send`/`postMultipart`
  are not `async`, so today a throw from them is synchronous. Every tool module's `guarded(produce)` calls `produce()`
  inside its `try` (e.g. `tools/read.ts:25-35`), and the MCP SDK wraps every tool call in try/catch as a backstop, so a
  synchronous throw or a rejection both become an `isError` result, not a crash.

## Goals / Non-Goals

**Goals:** one helper used at every request-path interpolation site; a typed error for rejected ids and for
cross-origin URLs; red-first, mutation-failable tests; a GUARD test against regressions.

**Non-Goals:** HEL-1161/1162/1163 (see proposal). No change to query-parameter or body handling.

## Decisions

1. **New module `helio-mcp/src/pathSegment.ts`** exporting `pathSegment(value: string, label?: string): string` and
   `class HelioInvalidIdError extends Error` (`name = "HelioInvalidIdError"`, readonly `value`, `label`). Rejects
   when `typeof value !== "string"`, `value === ""`, `"."`, `".."`, or `/[/?#\\]/` matches; otherwise returns
   `encodeURIComponent(value)`. Message: `Invalid <label ?? "id"> ${JSON.stringify(value)}: an id must be a single
   path segment (no "/", "?", "#", "\\", and not "", "." or "..")`. A separate module (not `httpClient.ts`) so
   `familyClient.ts` can import it without the HTTP client.
   Alternative rejected: encode-only. `encodeURIComponent("..") === ".."`, so traversal survives.
   Alternative rejected: an allow-list regex (`^[A-Za-z0-9_-]+$`). Ids are server-minted UUIDs and slugs today, but
   an allow-list is a wider behavior change than the ticket asks for, and encoding already makes every other
   character inert inside one segment.
2. **Call sites**: every interpolation becomes `${pathSegment(x, "<paramName>")}`. Method signatures are NOT changed
   (no conversion to `async`): in a non-`async` method the throw is synchronous, in an `async` one it is a rejection;
   both reach the tool's `guarded` try/catch (see Context). Converting `send` to reject instead of throw is HEL-1161's
   AC and stays out of scope.
   **Validate before the list call**: `getDashboard` and `listSourceObjects` list first and only then interpolate the
   id, so a bad id would cost a list `GET` and fail as a 404 `HelioApiError`. Both methods call
   `pathSegment(id, "<param>")` as their first statement (validation only, result discarded), before
   `listDashboards()`/`listDataSources()`. Every later path interpolates `${pathSegment(id, ...)}` directly; the
   `find` comparisons, "No ... with id" messages, returned fields and the `listAllPanels(id)` argument keep the RAW
   id, so nothing is encoded twice. A tool-level test asserts `list_source_objects` with
   `1/../../tokens` makes zero fetch calls.
   **`familyClient.rotate`**: `familyId` comes from a sealed refresh token (unreachable without the seal keys), but a
   throw there would escape `post`'s try/catch and become a 500 at `/token`. `rotate` catches `HelioInvalidIdError`
   from `pathSegment` and returns `{ kind: "refused", reason: "unknown" }` (the same outcome as a backend 404, which
   `provider.ts` maps to an OAuth `invalid_grant`), with no request sent; a unit test covers it.
3. **`buildUrl` origin check** (`httpClient.ts`): throw `HelioRequestUrlError` (new, `extends Error`,
   `name = "HelioRequestUrlError"`) when `path.startsWith("//")`, and after building, when
   `url.origin !== new URL(this.baseUrl + "/").origin`. Origin only, not path: the base path prefix is HEL-1161.
   `/\evil.example/x` resolves cross-origin under WHATWG URL parsing (backslash is a slash for http/https), so the
   origin comparison, not the `//` prefix test alone, is the real guard (`/<TAB>/evil.example/x` also resolves to
   `https://evil.example/x` and passes a `//` prefix test). `buildUrl` is private; tests reach it through the public
   verbs (`get`, `post`, `postMultipart`) with an injected `fetchImpl` and assert a SYNCHRONOUS throw
   (`expect(() => client.get(p)).toThrow(HelioRequestUrlError)`, today's semantics) and zero fetch calls.
4. **Error surface**: neither new class extends `HelioApiError` (no HTTP status exists). Tools' existing generic
   branch renders `HelioInvalidIdError: Invalid pipelineId "1/../../tokens": ...`. A tool-level test
   (`mcpFetchHarness.connectMcp`) calls a real tool with a bad id and asserts `isError: true`, the error name and
   value in the text, and that the fake fetch was never called.
5. **GUARD test** `helio-mcp/src/requestPathGuard.test.ts`: reads every non-test `.ts` under `helio-mcp/src`
   (excluding `testing/` and `contextBudgetFixture.ts`), finds every template literal beginning `/api/` (anywhere,
   so multi-line calls are covered), and fails on any `${...}` whose expression is not a `pathSegment(...)` call or a
   variable produced by one (the two `seg` labels in Decision 2 are allowed by name only if the test checks they are
   assigned from `pathSegment(`; simplest is to interpolate `${pathSegment(...)}` or a `seg` the guard recognises).
   Every site interpolates `${pathSegment(...)}` directly (no `seg` variables), so the rule is simply "every `${`
   in an `/api/` template starts with `pathSegment(`". It also asserts a minimum site count set to the MEASURED count
   after implementation, so a scanner pointed at the wrong place
   fails instead of passing vacuously. Labelled GUARD in its describe title. Failable: the executor reintroduces one
   raw `${pipelineId}` and records the failure.

## Risks / Trade-offs

- [A site missed by the enumeration] → the GUARD test scans the whole tree, not a list.
- [An id containing `%` or a space now encodes differently] → such ids are not minted by the backend; valid UUIDs and
  slugs are byte-identical, covered by a unit test.
- [familyClient builds URLs without `buildUrl`] → its paths are constants plus the helper-encoded id; adding an origin
  check there is out of scope.

## Migration Plan

None: client-only change in helio-mcp. The hosted MCP service is NOT redeployed by this ticket (C8).

## Planner Notes

- Self-approved: helper lives in its own module; `familyClient.ts` included although `familyId` is not agent-supplied.
- Tasks put the red tests first (driver constraint C12: red run recorded and committed before implementation),
  overriding the template rule that tests go last.
- Tests run under the root jest config (`npx jest helio-mcp/...`); typecheck `npm run check:helio-mcp-types`; lint
  `npx eslint helio-mcp --max-warnings=0`.
