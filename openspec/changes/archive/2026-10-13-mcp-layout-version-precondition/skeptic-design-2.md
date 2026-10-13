## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn cwd:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/mcp-layout-version-precondition/HEL-1524`. Reviewed at HEAD `38ee89f34282da1e05a754d6749046f6f5aa7285`. The planning artifacts are uncommitted files in the change directory.
- **Round-1 CR2 (re-derivation too narrow): addressed.** Task 3.5 and D5 now classify every `this.http.post|patch|put|delete` in `helioApi.ts`. The count "51 at plan time" is slightly off. `grep -nE "this\.http\.(post|patch|put|delete)" src/helioApi.ts` gives 49 lines, including `postMultipart` (lines 621 and 916) and one comment (line 1325), so there are 48 real call sites. This doesn't block, because the executor re-derives the list anyway. `apply_combined_proposal` is now listed (round-1 note addressed).
- **Round-1 notes on `callTool` rejection and the throwaway seam user: addressed** (D7, task 4.1).
- **Round-1 CR1 (apply_patch_set false premise): partly addressed.** The bullet now states true facts about how the request decodes:
  - The edit's `patch` decodes as an `UpdateDashboardRequest` and goes to `dashboardService.update` (`PatchSetApplyForward.scala:43-45`).
  - `editSchema.patch` is `z.record(z.string(), z.unknown())` (`refinementSchemas.ts:41`).
  - Preview refuses a stale version (`PatchSetPreviewDashboardProjection.scala:32`).

  The decision is now explicit: option (b), document the passthrough.

  **But the conflict-handling clause rests on a 409 that helio-mcp never receives.** The round-1 CR asked the design to say what the agent sees. Ground truth:
  - **Apply.** `PatchSetApplyService.apply` handles only resolve and stale-fingerprint failures as `Left`, which the route turns into an HTTP error. A `LayoutConflict` from `dashboardService.update` during forward-apply is a mid-set failure. `applyResolved` (`PatchSetApplyService.scala:141-147`) rolls back and returns **`Right(PatchSetApplyResponse(rolledBack, failure = Some(err.message), applicationId = None))`**. The route maps that to **200** (`PatchSetRoutes.scala:42`). The body has the edit outcomes and `failure: "This dashboard's layout was changed elsewhere; the layout was not saved."` (`ServiceError.scala:33`). It carries no `dashboard` and no `layoutVersion`.
  - **Preview.** This path does return 409 `{message, dashboard}` via `ServiceResponse.run`/`completeError`. However, helio-mcp has no patch-set preview call: the only patch-set call in `helioApi.ts` is `POST /api/patch-sets/apply` at line 1025, and `propose_patch_set` goes to `/api/refinements` at line 1016.

  So the instruction "if the patch-set apply/preview 409 body carries a `dashboard`, render it with the same D6 helper" can never fire in helio-mcp. Task 3.6's "conflict rendering per D5" invites dead code, tested only against a fake 409. The README and tool descriptions it produces would also tell agents to expect a conflict result they will never see. See CR1.
- **Server contract for the two layout tools: true.**
  - `LayoutCasRetry.run` behaves as follows (`LayoutCasRetry.scala:32,37`):
    - a mismatched `expected` is refused immediately with `LayoutConflict(existing)`;
    - with no precondition, it retries up to 3 times, then returns `LayoutConflict(current)`.
  - `ServiceResponse.scala:86-87` renders the result as 409 `LayoutConflictResponse(message, dashboard)`.
  - `AutoLayoutRequest` has `expectedLayoutVersion: Option[Long]` (`DashboardProtocol.scala:85`) and goes through `LayoutCasRetry` (`AutoLayoutService.scala:88`).

  D1, D2 and D4 rest on true premises.
- **helio-mcp current state: true.**
  - `updateDashboardLayout` PATCHes `{ layout }` (`helioApi.ts:1350`).
  - `autoLayoutDashboard` POSTs `{items, cols, breakpoint}` (`:1370`).
  - The only callers are `layoutHandlers.ts:50`, `write.ts:1142` and `placementsHandlers.ts:53`.
  - No `layoutVersion` appears anywhere in `helio-mcp/src`.
  - `placements.ts` has its own `guarded` (line 21), which matches D6.
- **D5 place_outputs reasoning: sound.**
  - `placeOutputsHandler` batch-creates panels (`/api/panels/batch`), and that create bumps the version.
  - It then packs only the newly created ids.
  - Any version the agent holds is stale by construction, so leaving the precondition off and relying on the server-side re-pack is correct.
  - Adding `layoutVersion` to the success result is additive.
- **D2/D3/A1/A2:** coherent. Both are honestly framed as assumed product calls that go to OWNER REVIEW. D3's claim that unnamed panels keep their position was confirmed in round 1 (`AutoLayoutService.pack` uses `kept` from the fresh row).
- **Internal consistency:**
  - The proposal, design, tasks and spec delta agree on required vs optional for the two tools and on no-retry.
  - The spec delta's ADDED/MODIFIED requirements match D2–D5.
  - The spec says nothing about patch-set conflict rendering, so CR1 only touches design.md D5, tasks.md 3.6 and the README/description wording.

### Verdict: REFUTE

### Change Requests

1. **Fix design.md D5 (apply_patch_set bullet) and tasks.md 3.6 so they describe the stale-version behaviour helio-mcp actually receives.** Replace "If the patch-set apply/preview 409 body carries a `dashboard`, render it with the same D6 helper; otherwise it stays verbatim" with these facts:
   - A dashboard `patch` that carries a stale `expectedLayoutVersion` makes `POST /api/patch-sets/apply` return **200**, not 409. Every edit in the set is rolled back, `applicationId` is `null`, and `failure` is `ServiceError.LayoutConflict.Message` (`PatchSetApplyService.scala:141-147`, `ServiceError.scala:33`).
   - There is no current dashboard in that body.
   - helio-mcp makes no preview call, so the preview 409 is out of reach.

   Then make an explicit decision:
   - **(a)** Pass the apply response through unchanged. The `apply_patch_set` description and the README tell agents that this `failure` string means the whole set was rolled back, and that they should re-read with `get_dashboard`, recompute, and resubmit with the new `layoutVersion`. This is the minimal option.
   - **(b)** Detect that exact `failure` string in the handler and append a `get_dashboard` hint. Any such behaviour needs a unit test driven by a fake **200** apply body carrying that `failure`, not a fake 409.

   In both cases, remove the D6-helper wiring for patch-sets from task 3.6. Keep the existing unit test showing that the key survives `editSchema`.

### Non-blocking notes

- D5's "51 at plan time" is really 48 call sites (see above). The executor's re-derived table in files-modified.md is the authoritative one.
- D5 lists "panel duplicate" under not-applicable, but `helioApi.ts` has no panel-duplicate call. Drop it or let the re-derived table settle it.
- Optional: the D7 live seam script could also run one stale `apply_patch_set` dashboard-layout edit and confirm the 200 + `failure` + rollback shape on a real backend. That would prove CR1's documented behaviour end to end.
