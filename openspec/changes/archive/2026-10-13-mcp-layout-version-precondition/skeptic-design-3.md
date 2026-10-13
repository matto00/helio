## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Spawn cwd:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/mcp-layout-version-precondition/HEL-1524`. Reviewed at HEAD `38ee89f34282da1e05a754d6749046f6f5aa7285`. The planning artifacts are uncommitted files in the change dir.
- **Round-2 CR1 (patch-set conflict premise): addressed.** design.md D5's apply_patch_set bullet now says:
  - a stale version mid-set rolls the whole set back;
  - the response is **200**, with `failure` set to the LayoutConflict message, `applicationId: null` and no `dashboard`;
  - helio-mcp never calls preview.

  It picks option (a): document re-read and resubmit, return the result unchanged, no D6 helper wiring. Task 3.6 says the same and keeps the `editSchema` survival test. I checked this against ground truth:
  - `PatchSetApplyService.scala` `applyResolved`: `Left((err, appliedSoFar))` → rollback → `Right(PatchSetApplyResponse(rolledBack, failure = Some(err.message), applicationId = None))`.
  - `PatchSetRoutes.scala:42-43`: a `Right` result completes `StatusCodes.OK -> response`.
  - `ServiceError.scala:33`: the message is "This dashboard's layout was changed elsewhere; the layout was not saved.", which matches D5's quote word for word.
  - The forward path really carries the precondition: `PatchSetApplyForward.scala:44` → `dashboardService.update`, which passes `request.expectedLayoutVersion` into `DashboardWrites.Fields` (`DashboardService.scala:197,203`).
  - helio-mcp's only patch-set calls are `/api/refinements` (helioApi.ts:1016), `/api/patch-sets/apply` (:1025) and `/undo` (:1035). There is no preview call, so D5's claim holds.
  - `refinementSchemas.ts:41`: `patch: z.record(z.string(), z.unknown())`, so the key passes through.
- **Round-2 notes addressed:** the call-site count now reads "about 48". `grep -cE` gives 49 lines, minus 1 comment line, as round 2 found. "panel duplicate" has been dropped from the not-applicable list.
- **Server contract for the two layout tools (re-checked):**
  - `LayoutCasRetry.scala:32,37`: a mismatched `expected` is refused at once; otherwise there are at most 3 attempts.
  - `ServiceResponse.scala:86-87`: the conflict is rendered as 409 `LayoutConflictResponse(message, dashboard)`.
  - `AutoLayoutRequest` has `expectedLayoutVersion: Option[Long]` (`DashboardProtocol.scala:85`).
  - `DashboardResponse` has `layoutVersion` (`DashboardProtocol.scala:49,132`), so D1's passthrough premise holds. The evaluator still has to confirm it live on the list endpoint, as D1 says.
- **D5 "not applicable" list:** `expectedLayoutVersion` appears only in the dashboards protocol/service/writes/validation, AutoLayoutService and the patch-set preview projection. The contents PUT, `updateDashboard(name)` (helioApi.ts:1217) and the other listed writes accept no caller precondition. This is consistent.
- **Internal consistency:**
  - The proposal Non-goals ("only documents it"), D5, task 3.6 and the spec delta agree. The spec says nothing about patch-set conflicts, which is correct now that no rendering is planned.
  - D2/D3 required-vs-optional is the same in the proposal, design, tasks and spec.
  - A1/A2 are recorded as assumed product calls and go to OWNER REVIEW.
- **AC coverage:**
  - `layoutVersion` on the type: D1 / 1.1.
  - Layout tools send the precondition: D2, D3 / 2.1, 2.2, 3.1, 3.2. A2 openly softens auto-layout to optional.
  - 409 surfaced with the current dashboard and no blind retry: D4 / 2.3, 3.3.
  - 409 tests: D7 / 4.1, plus the live seam check in 4.3.
  - The optional server-require AC is correctly left as the owner's call.
- **Placeholders / ambiguity:** no TODO or TBD. Every task has a concrete acceptance signal.

### Verdict: CONFIRM

### Non-blocking notes

- D6 says the helper is used by "`write.ts` and `placements.ts`". The pack conflict in place_outputs comes from `placementsHandlers.ts` (where `placeOutputsHandler` lives), while `placements.ts` holds `guarded`. The executor should wire the helper wherever the conflict is caught and rendered.
- Optional (round-2 note, still open): the D7 seam script could also run one stale `apply_patch_set` layout edit to confirm the 200 + `failure` + rollback shape live. That would make the documented outcome evidence-backed.
- The README/description should quote the exact `failure` string, so agents can match on it.
