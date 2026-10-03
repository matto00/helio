# HEL-1216: Anonymous public panel list still leaks owner user id via meta.createdBy

## Description
Found during HEL-1206 (which folded in HEL-1197 and stopped emitting `ownerId` to anonymous callers).

The anonymous public panel list (`GET /api/dashboards/:id/panels`) still emits `meta.createdBy`, which equals the panel owner's user id, so HEL-1197's privacy goal is only partly met. Other public surfaces (resource meta on dashboard/outputs) were not audited.

Scope: omit or neutralize `meta.createdBy` (and any other owner-id-equivalent field) for anonymous callers on public routes; audit public routes for remaining owner-id-equivalents; tests asserting absence field by field.

origin_kind: followup
origin_ticket: HEL-1206

## Acceptance criteria (from driver brief)
- Absence asserted field by field on every anonymous/public route, on the serialized JSON.
- Red on main first (test sees owner id), green after.
- A generic guard walks each public response's JSON for any value equal to the owner's user id; failable by mutation.
- The owner's authenticated view still gets its meta (no regression).
- Public-route audit enumerated from code, with fields removed per route.
