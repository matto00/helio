# HEL-1260: Creating a Text panel adds no item to the dashboard's server-side layout, so later layout saves omit it

## Description

origin_kind: followup
origin_ticket: HEL-1230

Reported by the HEL-1230 evaluator and NOT yet verified by the driver. Confirm it first, with a real repro against the running app and the stored `layout` JSON.

**Claim:** creating a Text panel does not add a layout item for it to the dashboard's server-side layout. Later layout saves (drag, undo/redo, Save now) persist only the items the layout holds, so the Text panel is left out. The report says this predates HEL-1230.

**Questions to answer:**

* Which panel kinds are affected? Check every create path: Text, content, form, and the batch create used by first-run, templates and apply-proposal.
* What renders on reload for a panel with no layout item? Where does it land, and is that position stable?
* Does HEL-1233's repair-on-open interact with it? HEL-1233 was in flight when this was filed.

## Acceptance Criteria

* Every panel create writes a layout item for each breakpoint, and that item passes the HEL-1071 validator.
* A red test reproduces the current omission.
* Existing dashboards with orphaned panels are handled: either repaired, which may fold into the HEL-1233 path, or explicitly placed at render time.

## Driver brief (binding constraints for this run)

* Reproduce live first against the running app and the stored `layout` JSON, then widen to every panel-create path: Text, content, form, the batch create, first-run, persona templates, apply-proposal/MCP `create_content_panel`.
* HEL-1233 (16243f0a) owner repair-on-open; HEL-1230 (d4e53e82) layout-write classification contract in the header of `frontend/src/features/panels/hooks/useLayoutSave.ts` — respect it.
* HEL-1071 rejects bad layout PATCHes with 400; HEL-1023 reflows at render. Every created item must pass the HEL-1071 validator; prove it with a seam test.
* Prefer a server-side create-time fix. Decide how existing orphaned panels are handled.
* Stay out of HEL-1271 (PipelineRunService, NodeSnapshotRepository, Main.scala/ApiRoutes.scala wiring) and HEL-1266 (analyze canRun). V115 is reserved for HEL-1271; no migration expected.
* New route specs extend `com.helio.testkit.HelioRouteTest` (HEL-1228).
* Shared dev DB: record every id created; delete only by exact id. Never write under `~`.
* Backend gate: `nice -n 19 sbt testFull` (Bash timeout 600000), at most 2 workers, everything at `nice -n 19`.
* Known flakes: PanelCard.test.tsx:625 (HEL-1215), ProductEventRollupServiceSpec (HEL-1247) — rerun, don't fix. Report a FirstRunRoutesSpec timeout (HEL-1228 was meant to fix it).
* Red before the fix, green after, plus a mutation. Live check in light and dark.
