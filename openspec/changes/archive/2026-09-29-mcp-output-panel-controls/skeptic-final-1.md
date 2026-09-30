## Skeptic Report - final gate (round 1, skeptic-final-1.md)

Reviewed HEAD c1a0b2ab9b06651e7b50b647d8ae3a0dc1f9b3c3.

### What I verified (with evidence)
- Servers: 6625 / 9532 processes have cwd = this worktree's frontend/ and backend/ (readlink /proc/<pid>/cwd); assert-phase servers PASS.
- (1) MCP-created date-range control (dashboard "HEL-1193 eval", control column=created_at, kind date-range, auto-bound) renders for a human viewer in the running app, light and dark. Screenshots: /home/matt/Development/helio/.concertino/runs/HEL-1193/evidence/.concertino/runs/HEL-1193/evidence/skeptic-light.png and skeptic-dark.png (persist-evidence refs). Token-styled, consistent with the existing control bar; no frontend code changed beyond optional TS types. The add itself was driven through the MCP tool (evidence-e2e.md transcript); I did not re-drive MCP myself, I re-viewed its persisted result live.
- (2) Live re-probe with my own session: PUT /dashboards/:id/contents -> 400 "panel 'p': control not eligible: column 'region', kind 'date-range'"; POST apply-proposal -> 400 same message; POST /api/panels -> 400 "control not eligible: ..." (write path). Same status and same suffix everywhere (only a panel-position prefix differs). Propose path: client warning applyReady=false with identical message (evidence-e2e). Patch-set: 200 with failure string, documented in tool copy (refinement.ts:94) and matches live probe.
- (3) filter-capabilities unknown output -> 404 "Output not found" (live). 400/404 copy matches; tests assert copy contains "HTTP 400" and not "422".
- (4) Validator reuse: ProposalPanelSupport.preValidateControls calls the existing OutputControlsValidator.reject; the only new backend rule is a structural check (controls only on output panels; not both controls and config.controls). Client propose check (proposalValidation.ts computeControlWarnings) only reads the backend's controlKinds (computed by OutputControlEligibility.kindsFor) - no eligibility table in TS.
- (5) Naming split: description cross-references in both directions, asserted by a test; docs table lists both.
- (6) Mutation checks (reverted, git status clean): removed controlKinds check in computeControlWarnings -> 3 tests fail; column pick ignoring controlKinds -> 4 fail; label default removed -> 1 fail. helio-mcp jest: 30 suites / 302 tests pass (nice, 3 workers).
- (7) Dropdown auto-bind to created_at: documented in tool copy as first eligible column in schema order; backend permits dropdown on timestamps. Accepted.
- Evaluator's sbt (4941 pass), lint, format claims are pasted in evaluation-1.md; not re-run by me.

### Verdict: CONFIRM

### Non-blocking notes
- Test gap: DashboardContentsService.preValidateControls (PUT contents) and the ApiRoutes wiring of outputControlsValidator into DashboardProposalService/DashboardContentsService have no backend test (DashboardContentsReplaceSpec has no controls case; ProposalControlsSpec constructs the service directly). Because the parameter is nullable-optional, dropping the wiring silently skips the check. The 400 would still surface (via panelService.create) but with different message/atomicity; behaviour is live-verified above, just not regression-pinned. Recommend a route-level PUT-contents test as follow-up.
- Dropdown default to a timestamp column is rarely useful; consider requiring explicit column (evaluator suggested the same).
- Three pre-existing backend defects (500 on malformed/missing-id control, duplicate ids accepted, text-panel config.controls silently ignored) belong in follow-up tickets.
- Playwright wrote the first screenshot into the main checkout's .concertino/runs/HEL-1193 (moved into the worktree and persisted); no repo-root strays.
