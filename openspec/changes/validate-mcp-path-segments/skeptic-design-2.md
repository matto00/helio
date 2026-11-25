## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c. The change dir is untracked and there are no code changes yet.
I read ticket.md, proposal.md, design.md, tasks.md, specs/mcp-request-path-safety/spec.md and the round-1 report.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/mcp-path-segment-validation/HEL-1160`.

- **Round-1 CR1 (sync/async mechanism; buildUrl test semantics): RESOLVED.**
  - design.md Context and Decision 2 now state the real mechanism. About 40 methods are non-`async`, so a throw there
    is synchronous. Decision 2 says explicitly that no method is converted to `async`. tasks.md carries the same rule
    as Standing Constraint C1.
  - I checked this against the tree:
    - `httpClient.ts:245-264` `send` and `:236-243` `postMultipart` are non-async and call `buildUrl` synchronously
      (`:404`).
    - `tools/read.ts:25-35` `guarded` calls `produce()` inside its `try`, so a synchronous throw is caught.
    - `requestLimiter.ts:40-48` `limitApi` wraps every method call in `async () => await ...`, so a synchronous throw
      becomes a rejection.
  - Decision 3 and task 1.2 pin the buildUrl tests to a SYNCHRONOUS `toThrow` with zero fetch calls. That matches
    today's `send` semantics and keeps HEL-1161's "reject, don't throw" AC out of scope. The tab case
    (`/<TAB>/evil.example/x`) is now in task 1.2. `buildUrl` (`:405`) only prefixes `/` when the path lacks one, so
    the tab path reaches `new URL` intact, and only the origin comparison catches it. Good test choice.

- **Round-1 CR2 (validate before the list call; zero-fetch test): RESOLVED.**
  - Decision 2 has `getDashboard` (`helioApi.ts:278`) and `listSourceObjects` (`:316`) call `pathSegment` as their
    first statement, before `listDashboards()`/`listDataSources()`. Both also reuse the validated value in the 404
    labels at `:284`/`:322`.
  - Task 1.3 asserts zero fetch calls for both `list_source_objects` and `get_dashboard` with `1/../../tokens`. Both
    tools route through `guarded` (`tools/read.ts:98`, `:131`).
  - I checked for other list-then-path methods in `helioApi.ts`:
    - A `.find(...id ===` scan finds only `:280` and `:318`.
    - An awk scan for methods that await a request before their first id interpolation flags `listAllPanels`,
      `getDashboard`, `listSourceObjects`, `expandPipelineShape`, `runPipeline` and `deletePipelineStep`. I read each
      one. Apart from the two already handled, all of them use the id in their first request, so a bad id throws
      before any send.
  - Methods with two distinct ids (`updateDatasetRow`, `deleteDatasetRow`, `removePipelineRoot`) put both ids on the
    same single path. Both are validated before the send.

- **Round-1 CR3 (familyClient.rotate outcome; test): RESOLVED. I verified the provider mapping myself.**
  - Decision 2: `rotate` catches `HelioInvalidIdError` and returns `{kind:"refused", reason:"unknown"}` with no
    request sent. Task 1.3a tests this.
  - Ground truth for the mapping:
    - `oauth/familyClient.ts:26`: `reason: "unknown"` is a valid `RotateOutcome`.
    - `:72`: a backend 404 already maps to exactly this outcome.
    - `oauth/provider.ts:305-312`: `case "refused": throw new InvalidGrantError(...)`, and `reason: "unknown"` falls to
      the final branch, "refresh token does not match this client or resource".
  - So the orchestrator's claim holds: refused/unknown becomes OAuth `invalid_grant`, not a 500.
  - Testability: `FamilyClient.post` (`:90`) calls the global `fetch` (there is no injected seam). Task 1.3a can still
    assert "no request" by spying on `globalThis.fetch` or with the `testing/httpHarness.ts` stub backend's
    `familyBodies`. That is feasible.

- **Independent check: interpolation-site enumeration.**
  - Every `/api/` template literal in non-test `helio-mcp/src` contains 64 `${...}`:
    - 62 in `helioApi.ts`: 60 request interpolations plus the two labels.
    - 1 in `oauth/familyClient.ts`.
    - 1 `${DASHBOARD_ID}` in `contextBudgetFixture.ts`, which the GUARD excludes.
  - This matches design.md's "60 + labels + 1".
  - No indirect path construction:
    - Every `http.<verb>(` call takes a literal `/api/` path. Calls that split across lines carry a template or a
      constant string on the next line (`:397`, `:976` and `:1074` are constants).
    - There is no `"/api/..." +` concatenation.
    - `patchCheck.ts:23` is a constant path.

- **Independent check: other planning risks.**
  - The GUARD scope (all non-test `.ts`, any `/api/` template, multi-line covered) plus a vacuity floor and a mutation
    step meets the ticket's grep-GUARD AC.
  - Each AC maps to a task:
    - Helper and GUARD: 1.4 and 2.3.
    - Rejection cases plus UUID/slug pass-through: 1.1.
    - `buildUrl` `//` and origin: 1.2.
    - Tool-level `isError` with zero requests: 1.3.
    - Suite, typecheck and lint: 3.1.
  - No TBD or placeholder remains. Proposal, design, tasks and spec agree with each other.

### Verdict: CONFIRM

### Non-blocking notes

1. **Double-encoding risk.** In `getDashboard`, the viewer path calls `this.listAllPanels(dashboardId)` (`:289`), and
   `listAllPanels` applies `pathSegment` itself at `:264`. Pass it the RAW id, not `seg`, or an id containing `%` or a
   space is encoded twice. For the same reason, the `find` comparisons (`:280`, `:318`), the "No ... with id" messages
   and the returned `sourceId` must keep the raw value. Only paths take `seg`.
2. **GUARD floor is tight.** If `getDashboard`/`listSourceObjects` use a `seg` variable, the literal `pathSegment(`
   count in request paths drops by 3 (1 export path plus 2 preview paths) and gains the 2 `seg =` declarations and
   familyClient's 1. That puts it at about 60, right at the `>= 60` floor. Derive the floor from the measured count
   after implementation instead of failing a correct implementation on the number. The simplest fix is to interpolate
   `${pathSegment(...)}` directly everywhere and skip the `seg`-recognition rule entirely.
3. **Spec wording is broader than the requirement.** The scenario "Traversal id is rejected without a request" says
   "a tool is called with an id". Some ids are never put in a path. For example, `panelId` in
   `tools/outputControlsHandlers.ts:38-39` is matched against a fetched snapshot, so a bad `panelId` still costs one
   GET of a valid dashboard and then fails "not found". That is safe, because the id never reaches a path, and the
   Requirement text scopes itself to interpolated ids. But the tool-level test should pick a tool whose bad id is a
   path id (as task 1.3 does).
4. **Stale method name.** design.md Context bullet 1 still says "`postForm`"; the method is `postMultipart` (Decision 3
   already uses the right name).
5. Carried over from round 1: the local ticket.md is stricter than the Linear AC. Say so in the PR.
