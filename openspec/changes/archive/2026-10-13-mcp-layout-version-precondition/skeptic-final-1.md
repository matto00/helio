## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `08906f0d1d6ef2922725e6bc30923ba7d1a17ccd`. Diff base `38ee89f34282da1e05a754d6749046f6f5aa7285`, resolved live
via `resolve-review-base.sh <wt> main origin` (exit 0).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/mcp-layout-version-precondition/HEL-1524`.
- **Scope of diff:** `git diff --stat BASE...HEAD` touches only `helio-mcp/**` and this change dir. There is no
  backend, frontend, schema or migration change, so the UI/design step does not apply. I took no screenshots.
- **AC1 (`layoutVersion` on the Dashboard type):** `helio-mcp/src/types.ts` adds `DashboardResponse.layoutVersion: number`.
  Live check: in my own seam run, `get_dashboard` returned a numeric `layoutVersion` (N=2).
- **AC2 (layout writes send the precondition):**
  - `helioApi.ts` `updateDashboardLayout` PATCHes `{layout, expectedLayoutVersion}`, and the zod schema in
    `write.ts` marks it required (`z.number().int().min(0)`).
  - `autoLayoutDashboard` forwards the version only when it is given (A2).
  - I independently checked that the server enumeration is complete. `grep expectedLayoutVersion backend/src/main/scala`
    shows it accepted only by `UpdateDashboardRequest` (PATCH /dashboards and the patch-set dashboard update) and by
    `AutoLayoutRequest`. No other layout-writing endpoint takes a caller precondition, so the D5 "not applicable" list
    is sound.
  - `update_dashboard` sends `{name}` only (`helioApi.ts:1217`).
- **AC3 (surface, never retry blindly):**
  - `HelioHttpClient.dispatch` retries only on 429 (`httpClient.ts` ~L290-325). A 409 is thrown once, with its body.
  - `withLayoutConflict` maps it to `HelioLayoutConflictError` only when the body carries an object `dashboard`, and
    never re-sends.
  - The server shape matches: `ServiceResponse.scala:86-87` completes `LayoutConflictResponse(message, dashboard)`
    with 409.
  - `layoutConflictResult` returns `isError` with `dashboard`, `currentLayoutVersion` and `nextStep`.
- **AC4 (tests cover the 409 path):** `layoutPreconditionSeam.test.ts` uses a real MCP `Client` ↔ `createServer`
  over `InMemoryTransport`, with the real `HelioApi`/`HelioHttpClient` and a fake fetch. It covers:
  - required-input rejection with `calls.length === 0`
  - a 409 on both tools with exactly one request
  - a 409 without a dashboard body staying verbatim
  - the place_outputs pack 409 naming `createdPanelIds`

  The required-input rejection is real: it goes through `callTool`, so the registered zod schema is what refuses it.
- **Gates, re-run by me at HEAD:**
  - `nice -n 19 npx jest --maxWorkers=3 helio-mcp`: 49 suites, 460 tests passed. The evaluator's 50/468 was the
    unfiltered root jest; my path filter selects a subset.
  - `npm run check:helio-mcp-types`: exit 0.
  - `npx eslint --max-warnings=0 helio-mcp/src helio-mcp/scripts/layoutPreconditionSeam.ts`: exit 0.
- **Live seam, reproduced by me** (servers via `start-servers.sh`, `assert-phase.sh servers` PASS, stopped via
  `stop-servers.sh`). It runs from source via tsx, not the stale dist, and the session MCP client was not used.
  - Normal run (`BASE_URL=http://localhost:9863`): **RESULT: GREEN**, 15/15. Throwaway user
    `f27e6ce5-8efb-42c9-9f14-f96a3b006273` was deleted by exact (id, email).
  - `SEAM_STRIP_PRECONDITION=1`: **RESULT: RED (5 failed)**. The stale `update_dashboard_layout` landed, and the stored
    lg became the stale writer's single panel, so the second writer's panel was dropped: the exact hazard. The stale
    auto-layout was not refused. Throwaway user `6bde611c-923a-4292-9ad3-e72b1b95151e` was deleted.
  - Both readings match the evaluator's claim, independently.
- **Debugging law:** N/A. This is a feature, not a bug fix.
- **A1/A2 framing:**
  - A1 is honestly framed as BREAKING in proposal.md, design.md D2, the README and the tool description, with a
    rejected alternative and a rationale I agree with: a tool-side read would happen after the agent computed its
    layout.
  - A2 rests on a server claim that I verified in `AutoLayoutService.pack`: kept (unnamed) panels keep their stored
    position, packed items go below them, and the no-precondition path re-packs against the fresh row
    (`LayoutCasRetry.run`). So an optional precondition cannot drop an unnamed concurrent placement.
  - The residual stale-intent risk is disclosed in design Risks.
  - `workflow-state.md` records `ASSUMED_PRODUCT_CALLS: A1, A2 -> PR parks with OWNER REVIEW`.
- **Hidden product calls:** I found two further AC-adjacent decisions. Both are recorded in design D5 but are not
  listed among the assumed calls (see the notes below). Neither is concealed and neither is unsafe, so neither
  blocks.

### Verdict: CONFIRM

### Non-blocking notes
1. **OWNER REVIEW completeness.** The PR's OWNER REVIEW section should list two D5 decisions next to A1/A2, because
   both narrow the AC's "layout-writing tools send expectedLayoutVersion":
   - (a) `place_outputs`' internal pack never sends a precondition. This is safe for the same reason as A2.
   - (b) `apply_patch_set` dashboard `layout` edits are documented-only ("SHOULD"), not enforced. An agent that omits
     the key there still gets the server's bounded no-precondition retry, which replaces the whole breakpoint it
     sends. That is the original hazard, still reachable through patch sets even though `update_dashboard_layout`
     now requires the version.
2. `helio-mcp/src/tools/layoutPreconditionSeam.test.ts:4`: the header cites
   `openspec/changes/mcp-layout-version-precondition/seam-check.ts`, which does not exist. The real path is
   `helio-mcp/scripts/layoutPreconditionSeam.ts`. The evaluator noted this too.
3. The patch-set nested precondition is not mutation-covered by the seam strip, which removes only top-level keys.
   The green conflict result does show the key reaches the server. That is acceptable, but it is a guard proven
   green-only.
4. helio-mcp `dist` is gitignored. Sessions get this change only after `npm run build` and an MCP reconnect. Say so in
   the PR.
