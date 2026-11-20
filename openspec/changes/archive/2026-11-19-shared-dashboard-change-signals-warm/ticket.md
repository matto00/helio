# HEL-1783: Data-change dots and warm cache for shared dashboards

## Description

Child 6 of HEL-1773 (origin_kind: followup, origin_ticket: HEL-1773). HEL-1773's final review found that
`GET /api/dashboard-changes` gives a shared dashboard its content change time but never its data change time. The
open-tab "changed" dot and the warm cache therefore never react to new pipeline data on a shared dashboard.

## Acceptance Criteria

- `GET /api/dashboard-changes` returns data change times for dashboards shared with the caller, without exposing
  anything the grant doesn't allow.
- Open-tab change dots and the warm cache work for shared dashboards; an e2e as a grantee shows it.
- Verified as `helio_app` (RLS).

## Owner ruling (comment, 2026-11-19)

Scope added by owner ruling (HEL-1780 split): this ticket also restores the warm tab cache for shared dashboards. Warm
restore depends on the data change times this ticket adds, so it moved here from HEL-1780.

## Driver constraints carried into the run

- The warm cache restores rows for a non-owned dashboard only through grantee-safe per-panel reads; never
  `/api/outputs/*` or `/api/pipelines/*`.
- Per-Output data times for a shared dashboard must not reveal anything the grant does not allow (no Output ids the
  grantee could not otherwise see). Proven under RLS as the non-`BYPASSRLS` `helio_app` role.
- No migration expected (if one is needed: V147; V146 is claimed by in-flight HEL-1784).
- Avoid sibling files: HEL-1784 (FormRenderer.tsx, FormPanelView.tsx, PanelService, form-schema route, ApiRoutes
  wiring) and HEL-1778 (CI e2e specs, shard weights, workflows).
