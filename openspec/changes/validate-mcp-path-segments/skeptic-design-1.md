## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/mcp-path-segment-validation/HEL-1160`.
- **(a) Enumeration of request-path interpolation sites.**
  - `grep -oE '`/api/[^`]*`' helio-mcp/src/helioApi.ts | grep -o '${' | wc -l` gives 62 interpolations in `/api/` templates.
    Two of them are not requests. They are the `HelioApiError` path labels at `helioApi.ts:284` (`getDashboard`) and
    `:322` (`listSourceObjects`). That leaves 60 request interpolations on 57 lines (614, 628 and 786 carry two each).
    The proposal's figure of 60 is correct. The design's enumeration command
    (`grep -nE '`/[^`]*\$\{'`) returns 60 *lines*, though, and those lines include non-requests 284, 322 and 483.
    The number matches only by coincidence (see note).
  - Outside `helioApi.ts`, the only request-path interpolation is `oauth/familyClient.ts:67`. `oauth/patCheck.ts:23` is a
    constant `/api/tokens`. `fetch(` appears only in familyClient, patCheck, the default `fetchImpl` and `testing/`.
    No tool module calls `http.*` directly. Grep finds no `"/api..." +` string concatenation anywhere.
  - Ids in query strings: every query id (`nodeStepId`, `outputId`, `stepId`, `updatedAt`, `dry`) goes through the
    `query` object, and `buildUrl` applies `url.searchParams.set` (`httpClient.ts:404-411`). None is interpolated by
    hand, so the non-goal is sound.
  - Driver claims are confirmed in the tree. Remote OAuth: `httpApp.ts:214` builds a `HelioHttpClient`, so it shares
    `buildUrl`. Refresh families: `oauth/familyClient.ts`. Shared dashboards: `listDashboards` `include: "shared"`.
    Context-analyze: `helioApi.ts:909`. None of these adds an interpolation site the plan misses.
- **(b) Origin check.** I ran a node probe (`/home/matt/Development/helio/.concertino/scratch/HEL-1160/skeptic-design-url-probe.txt`).
  Against base `https://helio.test/`, all four of `//evil.example/x`, `/\evil.example/x`, `/\\evil.example/x` and
  `/<TAB>/evil.example/x` resolve to `https://evil.example/x`. The tab case slips past a `startsWith("//")` test, so the
  design is right that the comparison `url.origin !== new URL(base + "/").origin` is the real guard. The design is sound.
- **(c) Error surfacing.** All 11 tool modules with handlers define `guarded(produce)` and call `produce()` inside the
  `try` block (e.g. `tools/read.ts:25-35`), so a synchronous throw is caught too. As a backstop, MCP SDK 1.32.2
  `server/mcp.js:150-192` wraps every tool call in try/catch and returns `createToolError(message)` with `isError: true`.
  `limitApi` (`requestLimiter.ts:40-48`) invokes methods inside an `async` closure. So a throw does not escape a tool
  handler. **However, the design's stated reason is false** (see CR1).
- **(d) GUARD design.** The rule "any `/api/` template literal anywhere" catches multi-line calls, where the template sits
  on the line after `http.get<...>(` (263, 302, 377, 597, 785, 833, 851, 947, 1270, 1290, 1420). It also catches
  familyClient's `this.post(pat, `...`)`. The mutation step (reintroduce one raw `${pipelineId}`) proves the guard can
  fail. The same rule also flags the non-request labels at 284 and 322, which feeds CR2.
- **(e) Scope.** HEL-1161 (fetched from Linear) owns preserving the base-path prefix, the invalid base at config load,
  and "No request method throws synchronously". The design does an origin-only comparison and does not convert
  `send` into a rejecting method, so it stays out of HEL-1161's scope. Nothing touches Retry-After (HEL-1162) or
  timeouts (HEL-1163).

### Verdict: REFUTE

These are small, cheap fixes. Two of the plan's statements are false against the tree, and one spec scenario cannot
hold as written.

### Change Requests

1. **design.md Decision 2 rests on a false premise.** It says "Each `HelioApi` method that builds a path is `async`",
   and it has the executor "confirm each site is in an `async` function". That confirmation will fail. About 40 of the
   methods are plain `Promise`-returning functions: `getPipelineRunHistory` (387), `appendDatasetRows` (553),
   `getOutput` (1193), `updatePanel` (1000), `analyzePipeline` (373), `undoPatchSet` (1106), `askDashboard` (1247),
   and most of 1161-1357. For these, `pathSegment` throws *synchronously* out of the method.
   `HttpClient.send`/`postMultipart` (lines ~210, ~222) are also not async, so the new `buildUrl` throw is synchronous
   too. The outcome is still an `isError` result, because `guarded` calls `produce()` inside its `try`. But the
   executor cannot follow the instruction as written: they could convert about 40 signatures to `async`, or they could
   stop. Rewrite Decision 2 to state the real mechanism and pick one explicitly. Either:
   (a) leave method signatures alone, because `guarded` calls `produce()` inside its `try` and the SDK catches the
   rest; or
   (b) convert the affected methods to `async`.
   Also say whether the `buildUrl` tests (task 1.2) assert a synchronous `toThrow` or `rejects`. Today it is
   synchronous, and making it a rejection is HEL-1161's AC.
2. **The spec scenario "Traversal id is rejected without a request" is false for two tools under the planned edits.**
   `get_dashboard` → `getDashboard` (helioApi.ts:278) and `list_source_objects` → `listSourceObjects` (:316) both send
   a list `GET` (`/api/dashboards`, `/api/data-sources`) *before* the id is used in any path. A bad id then fails as a
   `HelioApiError` 404 ("No ... visible"), not `HelioInvalidIdError`. So "no HTTP request is sent" does not hold.
   `listSourceObjects` is also the ticket's own headline example (`sourceId = "1/../../tokens"`). In addition, the
   GUARD's `/api/`-literal rule will flag the `HelioApiError` labels at 284 and 322.
   The design must say what happens here: for example, call `pathSegment(id, "...")` at the top of both methods, before
   the list call. The 284 and 322 labels then use the validated value, and the GUARD stays satisfied. Add a test that
   `list_source_objects` with `1/../../tokens` makes zero fetch calls.
3. **The `familyClient.rotate` failure mode is unspecified.** A `HelioInvalidIdError` thrown in `rotate`
   (`oauth/familyClient.ts:64-68`) escapes before `post`'s try/catch. It then propagates out of
   `exchangeRefreshToken` (`oauth/provider.ts:290`) as a non-OAuth error, which becomes a 500 at `/token` instead of
   `InvalidGrantError`/`ServerError`. It is unreachable without the seal keys (`familyId` comes from a sealed token,
   verified at provider.ts:275-291), but the design should state the intended outcome. For example: return
   `{kind: "refused", reason: "unknown"}`, or let the existing `unavailable` → `ServerError` path handle it. Then add
   one test for it.

### Non-blocking notes

- Correct the design's enumeration command. It returns 60 lines, including the non-requests 284, 322 and 483. The real
  count is 60 interpolations on 57 request lines.
- The GUARD should also assert a minimum count of `pathSegment(` sites it found (for example, ≥ 60). Then a scanner
  pointed at the wrong directory or using a broken regex fails, instead of passing vacuously after the mutation check
  has been run once.
- Add `/\t/evil.example/x` (tab) to the task 1.2 cases. It is the clearest proof that the origin comparison, not the
  `//` prefix test, carries the guard.
- The design says "postForm"; the method is `postMultipart` (`httpClient.ts` ~line 205).
- The local `ticket.md` is a superset of the Linear HEL-1160 AC. It adds all of `helio-mcp/src`, `a\b`, the tool-level
  test, the GUARD and lint. That is stricter than Linear, not drift, but the delivery should say so in the PR.
