# HEL-1882: After HEL-1707: re-check the editor grant at write time for Output create, insight refresh and dashboard-editor writes

## Description

origin_kind: followup
origin_ticket: HEL-1707

HEL-1707 adds a write-time grant re-check (a plain read right after the pipeline lock) to three editor writes: root add/remove, draft save (with its undo restore) and step writes. The owner kept that PR to those three, plus a fix so Output delete and undo of an Output create check the user's current role.

Other privileged writes an editor can reach still check the grant only in an earlier, separate step. So a grant revoked between that check and the write does not stop the write:

1. **Pipeline side:** Output create (`insertInternal`) and insight refresh. Insight refresh renders asynchronously, so its window is long.
2. **Dashboard-editor writes:** panel PATCH, delete, duplicate and batch writes; dashboard contents, PATCH and auto-layout; and form submit.

Apply the same rule HEL-1707 lands: a plain read of the grant inside the write's transaction, after any existing lock. Pin each path with a red-first race test.

## Agent notes

Full enumeration: `.concertino/runs/HEL-1707/evidence/editor-privileged-write-enumeration.md` (main checkout). Precedent: `PipelineRunRepository.insertGranteeRunIfUnderOwnerCap`.

## Acceptance criteria (driver brief)

- A red-first race test per path: the revoke (or downgrade to viewer) lands between the admission check and the write; nothing is written; the route answers its own existing refusal (403/404), no new status. Each red test failable by mutation; red run committed before implementation.
- Non-race behaviour unchanged (GUARD tests, each failable by a named mutation).
- NOBYPASSRLS run for any repository change touching RLS-guarded tables.
- Full spec files run for every touched spec; `ExistenceNotLeakedRoutesSpec` run whenever a `ServiceError.Forbidden` producer is added or moved.
