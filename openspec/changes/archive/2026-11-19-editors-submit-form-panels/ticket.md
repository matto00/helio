# HEL-1784: Let dashboard editors submit form panels

## Description

origin_kind: followup
origin_ticket: HEL-1773

**Owner ruling (2026-11-19):** a user with edit access to a dashboard can submit its form panels.

Today `POST /api/panels/:id/submit` is owner-only ("Only this form's owner can submit to its data source", `PanelService`), and HEL-1773 hides the submit control for everyone who doesn't own the dashboard.

## Acceptance criteria

- A dashboard editor can submit a form panel. The server admits them, and the client shows the submit control to editors.
- Viewers and strangers are still refused; an e2e covers editor, viewer and stranger.
- The appended dataset row, and any auto-run the write triggers, are attributed correctly: the run counts against the pipeline owner, as editor runs already do (HEL-1492), and the editor is recorded as the trigger.
- RLS checked as `helio_app`.
- A test that fails first.

## Agent notes

- Draft: `.concertino/runs/HEL-1773/evidence/.concertino/scratch/HEL-1773/children.md` (child 5a). Form submit contract: CLAUDE.md `POST /api/panels/:id/submit` (HEL-1087/HEL-1089).
- Related: HEL-1087, HEL-1089, HEL-1492. Blocked-by HEL-1773 (merged 62df9ff48).
