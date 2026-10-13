## Context

See proposal.md (Why). Ground truth on main at f3490d1d8:

- V127 (`hel1457_bump_dashboard_layout_version`) sets `NEW.layout_version := OLD.layout_version + 1` on every UPDATE that
  changes `dashboards.layout`, and pins it otherwise. One changing UPDATE = exactly +1.
- Every placement goes through `PanelLayoutPlacement.insertAndAppend`: `SELECT layout ... FOR UPDATE`, panel insert,
  then ONE `UPDATE dashboards SET layout, last_updated`. Callers: `PanelMutationOps.insertPlaced` (single create, user
  context), `duplicate` (system context) and `insertBatchPlaced` (system context). An append always changes the layout.
- `PanelRoutes.placedResponse` builds the create/duplicate/batch-item `PanelResponse` (`layout`, `layouts`); the batch
  route wraps them in `CreatePanelsBatchResponse(panels)`. `PanelResponse` uses `jsonFormat11`.
- Web: `createPanel` / `duplicatePanel` thunks (`panelThunks.ts`) call `adoptPlacedLayouts` (`panelPlacement.ts`),
  which dispatches `setDashboardLayoutLocally` (layout only; the store's `layoutVersion` is untouched).
  `useLayoutSave` classifies that store change as class 3 (placement extension, `detectPlacementExtension`), extends
  `persistedLayoutRef` by the appended items and deliberately does NOT move `persistedVersionRef` (header comment,
  "HEL-1457 — LAYOUT VERSION PRECONDITION"). Hence the next save sends the pre-create version and takes a 409.
- The web client never calls `POST /api/panels/batch`; only helio-mcp does (out of scope, HEL-1524 lane).

## Goals / Non-Goals

Goals: return the post-placement version on the three placement responses; let the web baseline adopt it only when
provably consecutive; keep I1 and every existing 409 path intact.
Non-Goals: DELETE responses, patch-set/auto-layout/contents-replace responses, helio-mcp, migrations, the trigger.

## Decisions

D1. **Read the version back inside the placement transaction.** After the layout UPDATE in `insertAndAppend`, re-select
`layout_version` for that dashboard in the same transaction (the row is still locked `FOR UPDATE`, so the value is the
one this transaction produced). Alternative rejected: compute `pre + 1` in Scala from the `FOR UPDATE` read; it
duplicates the trigger's rule in a second place and silently goes wrong if the trigger ever changes. The re-read is
one indexed PK select per create. The result is plumbed out to the route alongside `PlacedLayouts`; the carrier type is
the executor's choice, with one constraint: no default value (e.g. `0L`) that could ever be serialised for a real
placement. Non-route callers (`PatchSetApplyForward`, `PatchSetUndoService`, `PatchSetApplyRollback`,
`DashboardProposalService`) keep ignoring it.

D2. **Wire shape.** `PanelResponse` gains `layoutVersion: Option[Long] = None` (omitted on the wire unless set, like
`layout`/`layouts`), set only by `placedResponse`. Every other producer stays `None`, so GET/list/patch responses are
byte-identical. `CreatePanelsBatchResponse` gains a top-level `layoutVersion: Option[Long]`, `Some` whenever at least
one panel was created (the empty-batch short-circuit in `insertBatchPlaced` performs no write and returns `None`).
Batch items do NOT each repeat it (one transaction, one version). `jsonFormat11` → `jsonFormat12` (well under 22).
Schemas: `panel.schema.json` (optional integer `layoutVersion`, description naming the three responses) and
`create-panels-batch-response.schema.json` (optional top-level integer). Additive; helio-mcp's TypeScript types are
structural and unaffected (PR body note for HEL-1524).

D3. **Client: the store carries the candidate, the hook decides.** `adoptPlacedLayouts` passes the response's
`layoutVersion` into `setDashboardLayoutLocally` as an optional `placedLayoutVersion`. The reducer sets the store's
`layoutVersion` to it only when `placedLayoutVersion === dashboard.layoutVersion + 1`; otherwise it changes only the
layout (today's behaviour). This keeps the store's (layout, layoutVersion) pair valid: the store layout was derived
from server version v, the server's v+1 is v's layout plus exactly this placement, so store layout plus placement is
derived from v+1.
In `useLayoutSave`, in the class-3 branch only: when the store version observed in this render equals
`persistedVersionRef.current + 1` AND the store version changed in this same render (track the previous store version
in a ref), set `persistedVersionRef.current` to it after extending the baseline. Any other combination (version
unchanged, jumped by more than one, baseline version already behind the store's, class 1/2/4) leaves
`persistedVersionRef` exactly as today. Rejected alternative: have the thunk write the version straight into a hook
ref; the hook is the single owner of the baseline pair and the store is how all other server truth reaches it.
Rejected alternative: always adopt the response version; it violates I1 when another writer landed in between (the
baseline would lack that writer's items under a version that includes them).

D4. **Why `+1` is the right proof on the client.** The response version is the version after a single +1 bump. If it
equals baseline+1, the server's layout immediately before the create was at the baseline version, i.e. no other layout
write happened between the baseline and the create, so baseline + appended items is exactly the server layout at the
response version. If anyone else wrote in between, the response is >= baseline+2 and the client keeps the old version,
so the next save 409s and rebases (I1 preserved). The `useLayoutSave` header comment is updated to describe this.

D5. **Two own creates in flight.** Responses may arrive out of order. The in-order case adopts both (+1, +1). Out of
order, the first-arriving (v+2) is not adopted; the second (v+1) is; the pair (layout incl. both, v+1) has a version
older than its content, which I1 allows; the next save 409s and rebases once. Safe; not optimised further.

## Risks / Trade-offs

- [Hook ordering: the version ref effect and the layout effect run in declaration order] → the class-3 check reads the
  store version via the existing `storeLayoutVersionRef` plus a new previous-version ref; covered by the two tests below.
- [A placement response arriving while a layout PATCH is in flight] → the PATCH fulfilled path is class 4 and
  re-baselines from the response; nothing new adopts an unproven version. Existing `inflightResponse` test must stay green.
- [helio-mcp drift with HEL-1524] → no helio-mcp edits; optional fields only; PR body tells the HEL-1524 lane.

## Migration Plan

None. Additive response fields; no migration (V131 stays free). Rollback = revert.

## Planner Notes

- Self-approved: DELETE is excluded (not in the AC; 204 body change is a separate contract decision) and filed as
  HEL-1539 (Follow-up, relatedTo HEL-1525). Driver suggested enumerating delete; the ticket AC lists create, duplicate and batch.
- Self-approved: batch carries one top-level version rather than per-item.
- Tests (AC 3, 4) live in the existing `DesktopPanelGrid.layoutConflict.test.tsx` pattern (mocked HTTP, real store,
  real hook); backend version assertions extend `DashboardLayoutVersionSpec` / route specs against the real DB.
