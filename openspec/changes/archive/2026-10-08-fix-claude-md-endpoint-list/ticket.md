# HEL-1268: CLAUDE.md lists GET /api/data-sources/:id, which returns 405 (only PATCH/DELETE exist)

## Description

origin_kind: followup
origin_ticket: HEL-1264

Reported by the HEL-1264 lane and not verified by the driver.

The CLAUDE.md "Key endpoints" list includes `GET/DELETE /api/data-sources/:id`. A GET on that route returns 405; only
PATCH and DELETE exist. HEL-1264's verify script checks that a source is gone via `/api/data-sources/:id/schema`
instead.

## Acceptance Criteria

- Re-derive the whole data-sources section of the endpoint list from `ApiRoutes` and the sub-routers. Don't patch only
  this line; check the other endpoint bullets for drift while there.
- Decide whether a GET-by-id should exist. If not, correct the docs; if so, file it as its own ticket.

## Driver scope notes (2026-10-08)

- Scope is helio's own `CLAUDE.md` "Key endpoints" list only. Every OTHER bullet in that list is checked against the
  route tree the same way; any other false line found is fixed (same defect class). Each check is listed in evidence.
- Do NOT rewrite the env-var table or any other section; do not reformat the file. If Prettier would reflow anything
  beyond the changed lines, stop and escalate.
- Never touch the user's home `~/CLAUDE.md`.
