## Context

See proposal.md - Why. Today `DashboardRepository.update` (`:164`) writes `(name, last_updated, appearance, layout)`
from a row read earlier in the request, with no lock or precondition. Callers: `DashboardWrites.writeUpdate` (PATCH,
patch-set forward/rollback/undo via `DashboardService.update`) and `AutoLayoutService.applyAutoLayout`. Other layout
writers already avoid the lost update: `PanelLayoutPlacement.insertAndAppend` (dashboard `FOR UPDATE`, layout-only),
the repair (`updateLayoutIfUnchanged`, CAS on layout), the V122 delete trigger. `DashboardContentsOps.replaceContents`
does NOT: it reads unlocked and writes the read layout back (it only avoids clobbering name) -- a known residual, left
to a follow-up ticket (the new trigger still bumps the version when it writes, so a stale client save 409s after it).
`layout` is jsonb (V33). The client PATCHes only changed breakpoints, each wholesale (`useLayoutSave.persistLayout`).

## Goals / Non-Goals

**Goals:** no layout write overwrites a layout it did not read; no layout write touches name/appearance; a stale
web tab converges without losing either side's work. **Non-Goals:** see proposal.md; no new locks.

## Decisions

**D1. A `layout_version bigint NOT NULL DEFAULT 0` column, bumped by a DB trigger.** New migration (V127, or next free
— re-check before commit; never edit V122/V123): `BEFORE UPDATE ON dashboards FOR EACH ROW WHEN (NEW.layout IS
DISTINCT FROM OLD.layout)` sets `NEW.layout_version := OLD.layout_version + 1`; the function mirrors V122's
`SET search_path` and the trigger V122's `ENABLE ALWAYS`. A trigger means every present and
future writer (including V122's own UPDATE and `DashboardContentsOps`) bumps it without code changes. App code never
writes the column. Alternatives: `last_updated` as the token — rejected: a rename bumps it (spurious 409 on every
rename) and its microsecond round-trip through JSON is fragile; a layout content hash — rejected: needs an identical
canonical hash in Scala and TS.

**D2. Compare-and-set, not locks.** The layout write is one statement: `UPDATE dashboards SET layout=?,
last_updated=? WHERE id=? AND layout_version=?`. 0 rows with the row still present = conflict: 409 via a new
`ServiceError.LayoutConflict(current)` whose body is `{"message", "dashboard": <current DashboardResponse>}`, so the
client needs no list refetch (the list is paged). The token is the caller's `expectedLayoutVersion` when supplied, else the version read at
the start of the request. It takes only the dashboard row lock any UPDATE takes; no panel locks, so the HEL-1485
order ("panel rows, then dashboards") is not touched or widened. It also closes HEL-1485's noted window: a panel
delete between read and write runs V122, which bumps the version, so the stale write fails instead of writing a ghost.

**D3. One transaction, supplied fields only.** `DashboardWrites` builds one DBIO, `transactionally`, in the owner's
user context (what `update` uses today): optional layout CAS first, then `name` only if supplied, then `appearance`
only if supplied, each a targeted column update plus `last_updated`. A CAS miss fails the whole transaction, so a
rejected layout still saves nothing (HEL-1071). `DashboardRepository.update` is removed once it has no callers
(`updateName` folded in). The returned dashboard is re-read inside the transaction (fresh `layoutVersion`).

**D4. No-precondition callers: bounded retry.** Without `expectedLayoutVersion` (helio-mcp, patch-set apply,
rollback/undo, old clients) the service re-reads and re-resolves on a CAS miss, up to 3 attempts, then 409. Their
semantics are unchanged (supplied breakpoints replace stored ones) except they can no longer clobber a write that
landed mid-request. `RestorePriorStored` keeps its no-validation policy; it goes through the same CAS-with-retry.

**D5. Auto-layout.** `applyAutoLayout` reads (live panel ids, panels, dashboard incl. version), packs, CAS-writes
layout + `last_updated` only. Optional `expectedLayoutVersion` on `AutoLayoutRequest`: mismatch → 409 immediately.
Without it, D4's bounded retry (re-read, re-pack). Update the HEL-1485 comment that deferred this to HEL-1457.

**D6. Wire.** `DashboardResponse.layoutVersion: Long` (always present); `UpdateDashboardRequest.expectedLayoutVersion:
Option[Long]` (400 if present without `layout`, or negative); same field on `AutoLayoutRequest`. Domain `Dashboard`
gains `layoutVersion` appended last with a default. Update `schemas/dashboards` JSON Schemas. Public dashboard
responses: include only if they share `DashboardResponse`; do not widen a public allow-list.

**D7. Client.** Invariant (I1): the `expectedLayoutVersion` sent with a save is the version of the server layout
that the local layout being saved was derived from -- never newer. Mechanisms:
(a) the store pairs `layout` and `layoutVersion`: in `updateDashboardLayout.fulfilled` and
`repairDashboardLayout.fulfilled`, the keep-local-by-reference branch also keeps the OLD `layoutVersion` (only the
adopt branch takes the response's version). `useLayoutSave` keeps `persistedVersionRef`, set only where
`persistedLayoutRef` is set from server data (mount/server-landed re-baseline from the store, where the pair is
consistent by (a), and an adopted save response), never from a local placement extension.
(b) The thunk takes `baseLayout` (= `persistedLayoutRef`) and `baseVersion`. On 409 it takes the current dashboard
from the 409 body (fallback: the existing list refetch), rebases per sent breakpoint -- items the user changed (base
vs sent, by panel id) from sent, every other panel from fresh, panels absent from fresh dropped -- and, if every
rebased breakpoint is valid (existing client validity check), retries once with the fresh version.
(c) After a successful retry: if the store layout still equals the original `sentLayout`, adopt the response layout +
version (display shows the other writer's items) and it becomes the baseline. If the user edited during the round
trip (store != `sentLayout`), the store keeps the local layout AND the old version (rule a), and the hook does NOT
advance its baseline/version to the response, so the next flush sends the old version, takes a 409 and rebases again
-- it can never send a breakpoint lacking the other writer's item under a version that includes it.
(d) Invalid rebase or a second 409: upsert the fresh dashboard (drop the staged change) and reject with "This
dashboard's layout was changed elsewhere; your last layout change was not saved." (existing toast path, consistent
with `dashboard-layout-validation`'s "a rejected save is shown"). A 409 resolved by rebase is not a rejected save.
(e) When the adopted layout references panel ids the tab's panel list lacks, refetch that dashboard's panels so the
other writer's panel renders. Own panel create leaves the version stale, so the next save takes one 409 + rebase
round trip -- correct, slightly chatty (follow-up: return the version on placement responses).

## Risks / Trade-offs

- [Extra 409 round trip after the user's own panel create/delete] → rebase makes it invisible; follow-up to return
  the version from placement responses.
- [Trigger on a hot table] → `WHEN` clause; integer add only. [Optional precondition leaves MCP stale-write possible]
  → owner review; follow-up for helio-mcp to send it.
- [RLS] tests run as a non-superuser NOBYPASSRLS role on `VerifiedEmbeddedPostgres`; migration runs as non-BYPASSRLS.

## Migration Plan

Additive column with constant default (metadata-only) + trigger. Rollback: drop trigger/column in a later migration;
clients ignore the unknown field.

## Planner Notes

- Self-approved: version column over `lastUpdated` (D1); CAS over locks (D2); optional precondition with bounded
  retry for legacy callers (D4); client rebase-then-inform (D7). D4 and D7 are the OWNER REVIEW product calls
  (client contract: version field, 409 handling) — reversible; the PR parks for the owner.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit script is touched.
