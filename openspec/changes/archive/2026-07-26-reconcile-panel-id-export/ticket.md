# HEL-368: Reconcile panel id key in export snapshots (snapshotId) with live reads (id)

## Context

An agent reading a dashboard gets the panel id under **different keys depending on the path**, and has to special-case it. `helio-news`'s `clear_dashboard_panels()` (`~/Development/helio-news/news/helio_client.py`) does exactly this:

```python
pid = p.get("snapshotId") or p.get("id")
```

because the MCP `get_dashboard` tool composes its panels from the `/export` snapshot (`helio-mcp/src/tools/read.ts` documents that the backend on `main` exposes neither `GET /api/dashboards/:id` nor `GET /api/dashboards/:id/panels`), and the export path emits `snapshotId`, not `id`. In the backend, `DashboardSnapshotPanelEntry.fromDomain` (`backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala`) sets `snapshotId = panel.id.value`, whereas `PanelResponse.fromDomain` (`backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala`) sets `id = panel.id.value`. Same underlying id, two field names — the export snapshot's field name leaks into every agent that reads panels back.

The `snapshotId` name has a real purpose on **import**: the importer (`DashboardSnapshotRepository`, `DashboardServiceValidation`) treats it as a portable, remappable handle (`idMap` assigns fresh UUIDs; layout entries reference `snapshotId`), so a snapshot can be re-imported as a new dashboard. The fix is to make the read side unambiguous without breaking that import contract.

## Scope

Pick and implement one reconciliation (record the decision in the change's design note):

* **Preferred:** on the **export** response, also emit the panel's real `id` alongside `snapshotId` (keep `snapshotId` for import-remap compatibility). Then the MCP `get_dashboard` can surface a stable `id` and the client stops needing `snapshotId or id`. Touch `DashboardSnapshotPanelEntry` (`backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala`) and the snapshot serialization; leave the import read-path (`snapshotId`) intact.
* **Or:** have the MCP `get_dashboard` composition (`helio-mcp/src/tools/read.ts` + `helio-mcp/src/helioApi.ts`) normalize the panel id to `id` before returning, so agents always see `id` regardless of the underlying export shape. (Client-only fix; less clean than exposing `id` server-side but no wire change.)
* Whichever path: update the MCP `get_dashboard` tool description to state that each returned panel carries a stable `id`.
* Update `schemas/` (snapshot/panel) + `openspec/` to reflect the added `id` field if the export wire changes.

## Acceptance criteria

- [ ] Reading a dashboard through the MCP `get_dashboard` tool yields panels each with a stable `id` field, without the caller falling back to `snapshotId`.
- [ ] The export snapshot still round-trips through import unchanged: `snapshotId`-based remapping and layout references keep working (import tests pass).
- [ ] If `id` is added to the export wire, it equals the panel's real id and is additive (does not replace `snapshotId`).
- [ ] Test coverage: export includes both keys (if server-side path) OR MCP composition returns `id` (if client-side path); import remap unaffected.
- [ ] helio-news' `p.get("snapshotId") or p.get("id")` could be simplified to `p["id"]`.

## Out of scope

* Adding `GET /api/dashboards/:id` / `GET /api/dashboards/:id/panels` authenticated single-read endpoints (a separate, larger contract change — the MCP composes from list + export by design today).
* Changing the import remap semantics or the `snapshotId` handle's role on import.

## Dependencies

* Relates to HEL-363 (idempotent rebuild) — both touch the snapshot/export path; sequencing them together avoids double-editing `DashboardProtocol.scala`.
* No hard blockers.

## Backward compatibility

The preferred path is strictly additive (adds `id`, keeps `snapshotId`), so existing importers and the current `snapshotId or id` client code keep working. The client-only path changes no wire contract at all.

---

## Orchestrator pre-brief notes (not part of the original ticket — carried forward from the human's kickoff instructions)

- Ticket 8 of 8 in the HEL-344 sequential batch. Main is at d4104b94. Do NOT close the HEL-344 epic or touch sibling ticket statuses — only set HEL-368 to Done.
- **Establish semantics before changing any wire field.** Verify against `DashboardExportService` / the export protocol and the panel repository whether `snapshotId` and `id` are the same identity or genuinely different concepts, before proposing a fix. If genuinely different, say so and escalate/re-scope rather than forcing a merge.
- Export files are user data — `GET /api/dashboards/:id/export` / `POST /api/dashboards/import` is a round-trip real users rely on, and previously-exported JSON files exist outside the system. Any wire change must keep importing older exports working. Decide explicitly: additive field, tolerant reader, or versioned envelope. Do not silently break a year-old export file.
- Enumerate existing consumers: frontend import/export path, helio-mcp's `get_dashboard`, and helio-news. Confirm each keeps working. MCP layer is the most likely place for the actual fix (per ticket's own "Or" option).
- Strict `source -> pipeline -> type -> panel` binding rule and owner scoping still apply to anything touched.
- Scope discipline: HEL-369 (external-run hooks) and HEL-624 (pie/scatter aggregation) are queued behind this ticket — do not absorb them.
- Design-gate escalation criterion: a round-N REFUTE that is an incomplete application of an already-decided fix, or a pure consistency nit, is NOT new grounds — continue in-loop. Escalate only genuinely-new substantive design flaws, OR if the two ids turn out to be genuinely different concepts (ticket premise wrong).
