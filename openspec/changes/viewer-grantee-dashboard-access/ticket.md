# HEL-1773: Verify: can a viewer grantee open a shared dashboard in the app, or do they get "Dashboard not found"?

## Description

origin_kind: followup
origin_ticket: HEL-1746

HEL-1746's lane reported that a user with only a viewer grant on a dashboard gets "Dashboard not found" when they open it in the signed-in app. Its stated cause: the dashboard list the app loads (GET /api/dashboards) returns only dashboards the user owns, and `DashboardRoute.tsx` shows "Dashboard not found" for any id that is not in that list.

**This is unverified.** `DashboardRepository` also has a `findAllVisible(user)` query, so a grantee path may exist already. Verify before fixing.

## Acceptance criteria

- An e2e reproduces the claim as a real viewer grantee: it is either red, or it shows the claim is false. If false, close this ticket with that evidence.
- If it is true: a viewer grantee can open the dashboard and sees exactly what their grant allows. Strangers still get not-found. Owners and editors are unchanged.
- Then check that HEL-1746's ask drawer behaves correctly for that viewer: they can ask, and they see no pin.

## Agent notes

- Grantee scoping (HEL-921 premise): a dashboard-only viewer reads only through panel-scoped paths and must never reach payload rows.
- Check RLS behaviour as `helio_app`. RLS never runs in dev or CI (superuser bypasses it); see MISTAKES.md.

## Owner rulings (2026-11-18, escalation answered via chat, recorded in events.jsonl)

1. in-shell-read-only: a viewer grantee opens the dashboard in the normal app with editing hidden; panel data only through the per-panel `/api/dashboards/:id/panels/:p/*` routes.
2. listed-marked-shared: dashboards shared with the user appear in their list with a "Shared" marker.
3. include-editors: editor grantees are in scope.
4. split-into-children: this ticket is child 1; the remaining children are drafted in `.concertino/scratch/HEL-1773/children.md` and filed by the driver.

## Acceptance criteria — child 1 (this ticket, restated scope)

- `GET /api/dashboards` returns dashboards the caller owns plus dashboards they hold a named `editor`/`viewer` grant on (never public-only grants), paged and counted correctly, each item carrying `accessRole` (`owner` | `editor` | `viewer`). Contract updated in `schemas/` in the same change. Verified as `helio_app` (RLS) as well as in dev.
- A grantee opens `/dashboards/:id` in the signed-in app (the stage-1 e2e goes green); a stranger still gets "Dashboard not found"; owners are unchanged.
- Shared dashboards show a "Shared" marker in the dashboards list/sidebar; owned dashboards do not.
- Viewer: the shell hides every editing affordance (layout edit, add panel, refine with AI, share, appearance, panel rename/menus' mutating actions, delete/duplicate) and panel content renders through per-panel routes only. No `/api/outputs/*` request is made to display a non-owned dashboard's panels; panel features this slice does not route through per-panel routes are hidden, never left broken.
- Editor: can open and edit (layout, rename, appearance, panels) exactly as the server already permits; owner-only actions (share, delete, duplicate, layout repair) are not offered; panel content reads through per-panel routes like a viewer's.
