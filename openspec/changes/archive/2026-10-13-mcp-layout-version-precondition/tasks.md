## Standing Constraints

## 1. Types and transport

- [x] 1.1 Add `layoutVersion: number` to `DashboardResponse` in `helio-mcp/src/types.ts`
- [x] 1.2 Retain the parsed non-2xx body on `HelioApiError` (`body`, optional, backward-compatible constructor)
- [x] 1.3 Add `HelioLayoutConflictError` (409, `current` dashboard, `expectedLayoutVersion`)

## 2. API methods

- [x] 2.1 `updateDashboardLayout(dashboardId, layout, expectedLayoutVersion)` sends `{ layout, expectedLayoutVersion }`
- [x] 2.2 `autoLayoutDashboard(..., expectedLayoutVersion?)` sends it only when given
- [x] 2.3 Both map a 409 with a `dashboard` body to `HelioLayoutConflictError`; no retry

## 3. Tools

- [x] 3.1 `update_dashboard_layout`: required `expectedLayoutVersion` input; description explains its source
- [x] 3.2 `auto_layout_dashboard`: optional `expectedLayoutVersion` input; description updated
- [x] 3.3 Shared `layoutConflictResult` rendering used by both tools (design D4/D6)
- [x] 3.4 `place_outputs`: pack conflict names created panel ids; success adds `layoutVersion` when a pack ran
- [x] 3.5 Classify every post/patch/put/delete in `helioApi.ts` (design D5); record the table in files-modified.md
- [x] 3.6 Patch-set tools: document `expectedLayoutVersion` in dashboard layout patches and the 200 + `failure` +
      rollback conflict outcome (re-read, resubmit); no D6 helper wiring; unit test that the key survives `editSchema`
      into the request body

## 4. Tests and docs

- [x] 4.1 Unit tests: precondition in body (both tools), required-input rejection via real `callTool`, 409 → conflict result with one
      request sent, 409 without dashboard stays verbatim, place_outputs pack 409
- [x] 4.2 Existing helio-mcp tests updated for the new required argument; typecheck clean
- [x] 4.3 Live seam check against a real backend (design D7) with transcript saved in the change dir
- [x] 4.4 README documents `layoutVersion`, the precondition and the conflict result
