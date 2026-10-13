## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn cwd:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/mcp-layout-version-precondition/HEL-1524`. Reviewed at HEAD `38ee89f34282da1e05a754d6749046f6f5aa7285`. The planning artifacts are uncommitted files in the change directory.
- **Server contract (D1/D4 premises): true.** `LayoutCasRetry.run` refuses a mismatched `expected` at once with `LayoutConflict(existing)`. With no precondition it retries up to `MaxAttempts = 3`, then returns `LayoutConflict(current)`. `ServiceResponse.scala:86-87` renders that as `409 LayoutConflictResponse(message, dashboard)`. `DashboardServiceValidation.scala:116-119` returns 400 for "expectedLayoutVersion requires layout" and for a negative version. `DashboardResponse` carries `layoutVersion` (`DashboardProtocol.scala:49,132`). `getDashboard` spreads the list record (`helioApi.ts:244-258`), so D1's pass-through claim holds.
- **helio-mcp current state: true.** `updateDashboardLayout` PATCHes `{ layout }` (`helioApi.ts:1350`). `autoLayoutDashboard` POSTs `{items, cols, breakpoint}` (`:1370`). `HelioApiError` is thrown with `describeError(...)` only, and the body is dropped (`httpClient.ts:272,310`). Both tools are registered in `tools/write.ts:1072,1107`. The `place_outputs` pack is in `placementsHandlers.ts:53`.
- **D3 claim (unnamed panels keep their position on a no-precondition re-pack): true.** In `AutoLayoutService.pack`, `kept = LayoutPolicy.stored(liveLayout, bp).filterNot(requestedSet)` runs against the fresh row (`read`) on each CAS attempt. A2 is framed honestly as a departure from the AC's wording and is recorded for owner review.
- **D2 (required on `update_dashboard_layout`):** sound. This tool sends complete breakpoints, which is the lost-update hazard. The reason given for rejecting a tool-side re-read is correct: a read made after the agent computed its layout protects nothing. A1 is honestly framed as a breaking contract change. Outside helio-mcp, the only in-repo caller is `notes/mobile-pwa-handoff.md`, which is prose.
- **D4 (never retry):** sound as designed. The design has no path that re-sends: a 409 with a `dashboard` body maps to `HelioLayoutConflictError`, and a 409 without one stays verbatim. The test "exactly one request sent" would go red if anyone added a retry.
- **D7 would go red if the precondition were not sent:** yes, on both legs. Unit test: "body carries the precondition". Live seam: a stale N with the precondition missing makes the server re-resolve against the fresh row and succeed, so there is no conflict result and the stored layout is not the second writer's.
- **Spec delta headers** match the base `openspec/specs/mcp-panel-composition-tools/spec.md` (lines 167, 293). The existing scenarios are kept.
- **D5 enumeration: NOT accurate.** See CR1. The `apply_patch_set` dashboard-update path writes agent-supplied layouts, and the server does accept a caller precondition there:
  - `PatchSetApplyResolvers.buildDashboardUpdateResolved` decodes the edit's `patch` as an `UpdateDashboardRequest`, which includes `expectedLayoutVersion`.
  - `PatchSetApplyForward.scala:43-45` passes that request to `dashboardService.update`. That is the same `DashboardWrites` / `LayoutCasRetry` path as the PATCH route.
  - `PatchSetPreviewDashboardProjection.scala:30-32` explicitly refuses a stale `expectedLayoutVersion` with `LayoutConflict`.
  - helio-mcp's `editSchema.patch` is `z.record(z.string(), z.unknown())` (`refinementSchemas.ts:41`), so the field already passes through untouched.
  - The HEL-1458 `target.fingerprint` covers dashboard `layout` (`PatchSetTargetFingerprint.Allowlist`), but it is optional.

### Verdict: REFUTE

### Change Requests

1. **Correct D5 and the proposal's Non-goals on `apply_patch_set` (false premise).** Both state that "the server takes no caller precondition on them" and call these "server-built ops". For a `dashboard`/`update` edit carrying `layout`, both statements are false (evidence above). The agent writes that layout, and the server honours `expectedLayoutVersion` inside the patch. Rewrite the bullet with the true facts and make an explicit decision:
   - (a) keep it out of scope, on the grounds that the HEL-1458 fingerprint covers `layout` and `expectedLayoutVersion` already passes through `patch` untouched; or
   - (b) document the passthrough in the `apply_patch_set` / `propose_patch_set` description and the README.

   Either way, the rationale has to be the real one. If a patch-set apply returns 409 `{message, dashboard}`, say whether it reaches the agent verbatim. Today it does, through `guarded`.
2. **Widen the D5 / task 3.5 re-derivation grep.** As written it covers only calls under `/api/dashboards` and `/api/panels`. That scope cannot find the gap in CR1 (`/api/patch-sets/apply`, `helioApi.ts:1025`). It also misses `/api/proposals/apply` (`:1059`, creates a dashboard and its layout) and `/api/workspace/teardown` (`:1076`). The task should enumerate every `this.http.post|patch|put|delete` in `helioApi.ts` and classify each one as writes `dashboards.layout` or not.

### Non-blocking notes

- D5's "not applicable" list also omits `apply_combined_proposal`, which creates a new dashboard and so needs no precondition. Add it so the list is complete.
- Task 4.1's "required-input rejection" test must go through a real `client.callTool` (the `refinementStaleConflict.test.ts` pattern), not the handler. Only the registered zod schema enforces "rejected before any request".
- D7's live seam check must use a throwaway `@example.test` user, deleted by exact (id, email) through `buildUserDeleteSql`. Name which harness (`verify:isolated` or a scripted run) actually does that.
- `getDashboard` finds the dashboard within only the first 200 list items, which predates this change. An agent with more than 200 dashboards cannot read `layoutVersion` through `get_dashboard`, but `list_dashboards` paging still works. Not this ticket's problem; mentioned because the precondition is now required.
