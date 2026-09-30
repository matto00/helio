## Evaluation Report — Cycle 1 (evaluation-1.md)
Reviewed HEAD c1a0b2ab9b06651e7b50b647d8ae3a0dc1f9b3c3 against live-resolved base e690399e.

### Phase 1: Spec Review — PASS
- AC1 (MCP-only add of an auto-bound date-range control, viewer sees it): independently re-run on this worktree's servers (backend 9532 cwd and frontend 6625 cwd verified = this worktree; backend process started after last backend edit). create_dashboard -> place_outputs -> add_output_control{kind:date-range} produced control column=created_at; viewer UI (dashboard ea81e498...) shows the "CREATED_AT / All time" control bar in BOTH light and dark theme (screenshots persisted, refs below). No console errors.
- AC2 (disallowed control gets the same defined error as UI path): ineligible control -> 400 `control not eligible: column 'region', kind 'date-range'` via add_output_control, apply_proposal, PUT contents, propose_dashboard warning (applyReady=false), patch-set apply (200 + failure string, documented as such). Same shared OutputControlsValidator.
- AC3: get_workspace_context lists controls per placement (re-verified: control id d67df67a present in context output). Schemas updated (dashboard-proposal, output-filter-capabilities-response).
- AC4: new handler/warning/context/server tests present; helio-mcp suites pass.
- Red-first (C1): evidence-red-first.md shows on unmodified main: no control/filter MCP tool, get_workspace_context 0 hits for controls after a real control was written, get_output_capabilities is the unrelated pipeline shape, propose_dashboard passes an ineligible control with applyReady=true. Executor's premise correction is REAL and honestly recorded: raw update_panel config.controls already persisted on main and already returned the defined 400. Claimed gaps are ergonomics/discoverability (no eligible-kinds read tool, hand-minted UUIDs, whole-list replace, invisible in context, no propose-time rejection) - these are genuine and map to the ticket's scope bullets; AC1 "via MCP alone" is technically satisfiable on main but not ergonomically, and AC3 was flatly unmet on main. Accepted.
- C2 status codes: re-probed live against the running backend: 400 ineligible column/kind (`control not eligible: ...`), 404 `Output not found` (filter-capabilities unknown output), 404 `Panel not found` (unknown panel). Tool copy (outputControls.ts, proposal/write copy) states 400/404/200-with-failure consistently with these; no 422 claims. 
- C6: validation lives in shared ProposalPanelSupport; patch-set error is apply-time; dup-id/non-output probed.

### Phase 2: Code Review — PASS
Gates run by me in WORKTREE_PATH (nice -n 19, jest maxWorkers=3):
- npm run lint: exit 0. npm run format:check: all files pass.
- root jest (helio-mcp): 30 suites / 302 tests pass. helio-mcp typecheck clean.
- npm --prefix frontend run build: success.
- cd backend && sbt test: 4941 tests, 0 failed, 336 suites, exit 0 (5m23s).
- No TODO/FIXME/any/inline FQN found in added lines. No flakes observed this cycle.

### Phase 3: UI Review — PASS
Viewer control bar renders for an MCP-added control in light and dark; token-styled, consistent with existing control bar (no frontend code changed beyond optional TS types). 0 console errors. Backend UI-path behavior unchanged.
Evidence: /home/matt/Development/helio/.concertino/runs/HEL-1193/evidence/.playwright-mcp/hel1193-eval-light.png and hel1193-eval-dark.png (plus executor's hel1193-light/dark.png).
(Breakpoint resize sweep not exercised; no layout code changed.)

### Flagged deviations - rulings
1. Client-side propose_dashboard check: ACCEPTED. propose_dashboard is client-only on main (verified in red-first finding 2); the AC ("same defined error") requires a propose-time check, and the check reuses backend controlKinds from the capability contract rather than a separate rule set. Backend validate/combined path also updated.
2. Dropdown auto-bind picks created_at (first column whose controlKinds includes the kind, schema order): ACCEPTED, documented in tool copy ("FIRST column, in the Output's schema order"). Backend permits dropdown on timestamps. Non-blocking suggestion below.

### Three backend defects - scope ruling
(a) PATCH with control missing `id` / non-array / non-object element -> HTTP 500 (re-confirmed live: missing id -> 500 "Internal server error"). (b) duplicate control ids accepted (200). (c) text panel PATCH with config.controls silently 200/ignored.
None is in scope for the ACs: AC2 concerns the contract-disallowed (eligibility) error, which is a defined 400; MCP tools always mint ids and send well-formed lists, and the tool refuses non-output panels client-side. Tool copy does not misstate them. Recommend spinoff tickets (500 on malformed control is the most worthwhile, it is a real defined-error gap on the UI/REST path).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Consider preferring a non-timestamp column (or requiring explicit `column`) for dropdown auto-bind, since defaulting to created_at is rarely useful.
- File the three backend defects as spinoffs (labelled Follow-up, relatedTo HEL-1193).
- Eval left dashboard "HEL-1193 eval" (ea81e498-431e-4e4f-823c-f15611632a64) on the shared dev account; harmless.
