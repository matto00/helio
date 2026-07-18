# HEL-290 — Sidebar dashboard list shows stale "No dashboards yet" after proposal apply

- **Type:** Bug
- **Priority:** Low
- **Linear URL:** https://linear.app/helioapp/issue/HEL-290/sidebar-dashboard-list-shows-stale-no-dashboards-yet-after-proposal
- **Branch:** bug/stale-sidebar-after-proposal-apply/HEL-290

## Symptom

After accepting a dashboard proposal (`POST /api/dashboards/apply-proposal` via the Proposal Review UI), the **sidebar dashboard list** shows "No dashboards yet / Create your first dashboard" for one render frame until any navigation or reload. The created dashboard itself renders immediately in the main area, and the sidebar list is correct after reload.

Visible in the Phase 6 app-proof screenshot: three panels render while the sidebar still says "No dashboards yet".

## Likely cause

The dashboards-list Redux state / cache isn't invalidated on the apply-proposal success path — analogous to how panel creation calls `markDashboardPanelsStale`. The apply flow creates the dashboard through the API but the sidebar list selector doesn't refetch/insert the new dashboard until the next navigation.

## Severity

Cosmetic render-timing only — no data loss, dashboard is fully created and correct. Low priority.

## Context

Discovered during the agent-native layer build (HEL-148 Phase 6) on branch `feature/agent-pat-auth/HEL-148`; flagged rather than chased late to keep the gates green.

## Session directives (binding)

- **Iron Laws:** probe-confirm the root cause (likely a Redux dashboards-slice cache not invalidated/updated by the apply-proposal flow — verify, don't assume) before fixing.
- **Repro-widening:** audit the OTHER mutation flows that create/delete dashboards outside the standard createDashboard thunk (import, duplicate, MCP-driven creates via SSE/polling if any) for the same stale-sidebar class; fix trivially-same-class instances, report anything bigger as spinoff candidates.
- **Context to verify, not trust:** main includes v1.5 + HEL-305/298 (PRs #230-237). The apply-proposal flow shipped in HEL-148/225 (agent-native layer). `markDashboardPanelsStale` exists in the panels slice for panel-cache invalidation — the dashboards LIST cache may need an analogous mechanism.
- **Operational hygiene:** Playwright screenshots go to the session scratchpad or gitignored tmp — NEVER the repo root. NEVER bulk-delete by glob. HEL-298 cleanup may briefly run in parallel — stay inside this worktree and its assigned ports (dev 5463, backend 8370). The `-n` commit bypass is accepted ONLY when check:openspec-hygiene is the sole pre-commit failure pre-archive; call it out.

## Acceptance criteria (derived)

1. After applying a proposal via the Proposal Review UI, the sidebar dashboard list immediately includes the newly created dashboard (no stale "No dashboards yet" frame, no reload/navigation needed).
2. Root cause is probe-confirmed before the fix (systematic-debugging Iron Law).
3. Other dashboard-creating/deleting mutation flows outside `createDashboard` (import, duplicate, etc.) are audited for the same stale-list class; trivially-same-class instances fixed, larger ones reported as spinoff candidates.
4. Existing behavior of the standard create/delete flows is unchanged; lint/tests/gates pass.
