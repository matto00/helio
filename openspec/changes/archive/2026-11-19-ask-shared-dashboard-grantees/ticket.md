# HEL-1781: Ask about a shared dashboard for grantees, with the pin hidden

## Description

Child 3 of HEL-1773. HEL-1773 hides the "Ask about this dashboard" entry from everyone who doesn't own the dashboard. The ask route itself already admits grantees and returns `pin: null` for a dashboard-only viewer.

Origin: follow-up of HEL-1773. Depends on HEL-1773 (merged 62df9ff48); HEL-1780 (per-panel routes for grantees, b2603ab79) and HEL-1785 (a1cfd19dc) are also merged.

## Acceptance Criteria

- A dashboard-only viewer on the beta tier can open Ask on a shared dashboard and ask. The real `POST /api/dashboards/:id/ask` admits them.
- A cited-Output link in an answer never opens an Output route the grantee can't read.
- They see no pin action. Prove `pin: null` with a server-side seam case for a dashboard-only viewer, not only a faked response.
- An editor with no grant on the cited pipeline also sees no pin.
- The ask loop's per-call scope re-check stays the only data path. A grantee's ask never reads payload rows.
- Free-tier grantees get the existing upsell.

## Driver constraints (from the dispatching driver; claims to verify)

- `/api/outputs/*` is refused to dashboard-only grantees by prod RLS; dev/CI superuser does not enforce it -- prove RLS as the NOBYPASSRLS test role (`helio_app_test`, `TwoUserRlsApiFixture`).
- No live model call anywhere: backends started with `ANTHROPIC_API_KEY` exported empty; ask behaviour tested via scripted/fake transport and the seam fixtures.
- Any product question the ticket does not settle: escalate.
- Avoid HEL-1784's files (FormRenderer.tsx, FormPanelView.tsx, PanelService submit, the new per-panel schema route, V146). A migration, if needed, takes V147 (and must be reported).

## Premise validation

See `.concertino/runs/HEL-1781/evidence/premise-validation.md`. Verdict minor-staleness: today the answer card lists cited Outputs by plain name (no link); the actual Output-route exposure is the citation chip, whose provenance popover calls `GET /api/outputs/:id/provenance`.
