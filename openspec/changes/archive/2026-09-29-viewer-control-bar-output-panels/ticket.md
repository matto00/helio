# HEL-1190: Viewer control bar on output panels: URL-held per-viewer selection, applied as a server filter

## Description

Leaf 3 of HEL-915 (re-scoped 2026-09-29 with the owner, see the epic). The largest leaf; split at design time if needed.

### Why

Owner rulings: a viewer's control selection is **per viewer, ephemeral, and held in the URL**: no database state, and it never changes the saved panel. Controls **refetch** the Output read (server-side filter via HEL-1188's operators); **no recompute**.

## Scope

- Render the author's configured controls (HEL-1189) on output panels for viewers: date range (with presets such as last 7/30 days and this quarter, plus custom), dropdown (options from HEL-1188's distinct-values read), numeric range, and free text.
- **URL state:** each panel's selection is encoded in query params (e.g. `?p.<panelId>.<controlId>=…`; define the encoding). Reload keeps it, a copied URL reproduces it, and clearing it returns to the author's default. It never writes to panel config.
- **Apply as a server filter:** the selection becomes HEL-1188 operators on `GET /api/outputs/:id/rows`, **composed** with the table's own in-panel sort/filter (HEL-1027). Define precedence and composition. Pagination resets coherently on change, with no dropped or duplicated rows, and counts describe the filtered set.
- **Every render path.** HEL-1027's final-gate defect was the mobile stack (`MobilePanelStack` / `MobileStackPanelBody`) never receiving the Output, so verify each path explicitly: desktop grid, **mobile panel stack**, fullscreen overlay, detail modal, and **public dashboards** (optional-auth route tree; anonymous viewers get URL state too).
- Chart panels: decide explicitly whether controls filter chart reads too (charts plot the first loaded page). State it; don't leave it implicit.

## Acceptance Criteria

- Changing a date-range control on a panel bound to an Output larger than one page narrows the whole Output; the count and `hasMore` describe the filtered set. Red-first.
- The URL round-trips: reload and a pasted link reproduce the selection, and the saved panel config is unchanged (asserted).
- Verified live at desktop AND phone widths, both themes, and on a public dashboard as an anonymous viewer. The evaluator must reproduce the pre-fix behaviour first; a check that passes on broken code is not evidence.
- Rapid control changes can't leave a stale response overwriting a newer one (reuse HEL-1027's request-sequencing guard).
- a11y (inline, v0.8 rule): controls are keyboard-operable, labelled, and have visible focus; a result-count change is announced through the existing live region.

## Out of Scope

Dashboard-wide variables (v0.9), recompute (dropped), cross-filter (leaf 4).

## Related Tickets

- Blocked by: HEL-1189 (output panel control config), HEL-1188 (output filter capability contract) — both merged on main.
- Related: HEL-1027 (server-side sort/filter/counts, request-sequencing guard) — merged on main.
- Related: HEL-1194 (cache filter-capabilities contract) — open follow-up, do not fold in unless needed.
- Related: HEL-1192 (dashboard-wide variables) — out of scope (v0.9).
- Related: HEL-1191 (move HEL-588 cross-filter to server-side equals filter) — leaf 4, out of scope.

## Scope Decision (OWNER RULING, 2026-09-29 — resolves the Planning escalation below)

During Planning, the orchestrator found that `PublicDashboardViewerPage.tsx` renders **no panel
content today** — only a bare title+kind list per panel, for every panel on every public
dashboard. The backend rows-read route (`GET /api/dashboards/:dashboardId/panels/:panelId/rows`)
already exists and is spec'd, but nothing in the frontend calls it. This is bigger than the
already-known public-route sort/filter/capabilities gap (see Driver Notes below).

Three options were escalated to the owner: (1) split public rendering into its own prerequisite
ticket, (2) fold everything into this ticket, (3) drop the public-dashboard AC and file a
follow-up. **The owner picked (2): fold-into-this-ticket.** The public-dashboard AC stands as
originally written — it is not dropped, deferred, or split off.

**Scope is therefore:**
1. Controls (date range, dropdown, numeric, text) + URL state + server filter composition, on
   every AUTHENTICATED render path (desktop grid, mobile panel stack, fullscreen overlay, detail
   modal).
2. Real panel content on `PublicDashboardViewerPage` for anonymous viewers — reuse the
   authenticated renderers (`PanelContent`/`TableRenderer`/chart renderers) where feasible; a
   parallel/forked renderer needs an explicit justification in `design.md` (see Standing
   Constraint C13).
3. Controls + URL state + server filter composition on the public dashboard render path, once (2)
   exists.
4. The public-route backend support the above needs: sort/filter on the public rows route,
   equivalents of `filter-capabilities`/`distinct-values` scoped to the anonymous/share-token
   caller.

**Binding guidance from the owner (see Standing Constraints C11-C13 in `workflow-state.md`):**
- **Security (C11):** an anonymous or share-token caller may only filter, and list distinct
  values, on columns the author actually configured as controls on THAT panel, resolved
  server-side from the panel — never a caller-supplied output id or arbitrary column. Reuse the
  SAME share-token/dashboard-membership checks the existing public rows route already uses. The
  design-gate skeptic must attack this specifically.
- **Sequencing (C12):** sequence the work inside this PR — public panel-content rendering first,
  then controls on top — so the evaluator can verify each layer red-first.
- **Reuse (C13):** reuse the authenticated renderers for public panel content where feasible;
  justify any parallel renderer explicitly in `design.md`.
- **Budgets are unchanged.** The larger scope is not grounds to self-extend any execution/skeptic
  round budget — running out of any budget is still a mandatory escalation (C8).

## Driver Notes (verify, do not trust blindly)

- **Premise gap, confirmed at Setup via direct code inspection** (see `premise-validation.md` in this run's evidence): the public read path `GET /api/dashboards/:dashboardId/panels/:panelId/rows` (`PublicDashboardRoutes.scala` ~L140-170) accepts only `offset`/`limit`/`token` — no sort/filter params, and `resolveRows` calls `nodeSnapshotRepo.listRowsPaged` directly, bypassing `OutputService.rows`/`OutputRowsQuery` entirely. There is also no public `filter-capabilities`/`distinct-values` route — both are defined only in the authenticated `OutputRoutes.topLevelRoutes`, which requires `AuthenticatedUser`. This means the AC "verified... on a public dashboard as an anonymous viewer" needs real backend work on the optional-auth tree, not just frontend wiring. Security design point: an anonymous/share-token viewer must only be able to filter and list distinct values on columns the author actually configured as controls on THAT panel, resolved server-side from the panel — never a caller-supplied column/output id.
- HEL-1027's in-panel sort/filter does not currently work on public dashboards either (same route gap) — confirm and state this explicitly in design.
- If design shows the leaf is too big for one PR (e.g. authenticated path + public path + charts), propose the split and ESCALATE to the driver with a recommendation. Don't silently shrink scope, and don't silently drop the public-dashboard AC.
- The chart-panel decision (do controls filter chart reads?) must be stated explicitly in design.md.
- HEL-1194 (cache the capabilities contract once 1190 makes it a per-dashboard-load call) is a known follow-up. Don't fold it in unless it's needed; if it is, escalate.
- HEL-1187 (split OutputService/NodeSnapshotRepository/OutputRoutes) is open. Don't do that refactor here, but keep additions from making those files much worse.
- Enumerate every render path explicitly: desktop grid, mobile stack, fullscreen overlay, detail modal, public dashboard. HEL-1027's final-gate defect (mobile stack never receiving Output) is confirmed FIXED on main already (`MobileStackPanelBody` calls `usePanelData` directly) — still verify live, don't assume it stays correct once controls are layered on.
- Migrations: V112 is the latest on main; V113 is free. The ticket implies no DB state is needed (URL-held, ephemeral) — confirm during design whether any migration is actually required (likely none).

## Standing Constraints (from driver, HEL-1190 run)

- MODELS: sonnet on ALL agents (owner ruling 2026-09-18). No opus/fable override; promote no one.
- Pass explicit `timeout: 600000` on every Bash call that can run hooks, sbt, jest, or CI (git commit, squash-branch.sh, check-pr-mergeable.sh, `gh pr checks <n> --watch --fail-fast`). If a call backgrounds anyway, poll its PID with `kill -0` IN THE SAME TURN. If a watch times out while checks are pending, re-run it in the same turn. Never end a turn "waiting". Never wait via `pgrep -f "<pattern>"` (matches itself).
- Hardware: 6c/12t desktop. Cap parallel work at 3 workers and `nice -n 19`.
- Evidence: ACs require red-first. The evaluator must reproduce pre-fix behaviour on the base commit. Live verification at desktop AND phone widths, both themes, and as an anonymous viewer on a public dashboard. Compare visual cohesion against the RUNNING app (DESIGN.md is binding), not token compliance. Verify dev servers serve THIS worktree (`readlink /proc/<pid>/cwd`). Screenshots never go at the repo root.
- Any "flake": record the test name + assertion message verbatim in the evidence dir before cleanup.
- If NodeSnapshotRepository is touched, run the node-root guard locally and audit any allowlist line remap before the gates.
- Any commit after a final CONFIRM that changes code or tests needs a fresh final verdict. For each post-CONFIRM commit, say whether it's code or archive-only.
- Running out of any budget is a MANDATORY escalation to the driver, never a self-approval. Surfacing a real defect plainly is not lobbying for a round.
- Standalone follow-ups: include `origin_kind: followup` / `origin_ticket: HEL-1190` in the description, relatedTo, and the `Follow-up` label on the same save_issue call, then read it back.
- Use `git -C <path>`; don't cd the session.
- Final report must give the actual squash-merge commit on main (from `gh pr view --json mergeCommit`), not the PR head.
