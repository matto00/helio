# HEL-968: P2.3b — Editor: multi-root in the river (root columns, "+ root" inline-source flow)

## Description

HEL-913 (P2.3) shipped the multi-root backend only — the `pipeline_roots` model and its V98/V99 migrations, the engine multi-root walk, `roots[]` on `POST /api/pipelines`, `add_root`/`remove_root`, `get_workspace_context`, and root ACL. Its scope bullet 4 (the editor) and its AC5 (the Playwright multi-root flow) were deliberately split out into this ticket at planning time, before any code was written, because the editor half needs HEL-912's lane layout to exist first, and HEL-913/HEL-912 ran in parallel with disjoint file ownership (HEL-912 owned `frontend/**`).

This ticket is the editor surface for a backend that already exists. It is frontend-only.

## Scope

Carried over unchanged from HEL-913's original scope bullet 4:

- The river shows each root as the head of its own lane column.
- "+ root" uses the inline-source flow from P1.5 (`AddSourceModal`, as `CreatePipelineModal` already composes it).
- Removing a root deletes its lane and Outputs, with the same placement-count warning as step deletion (backend behaviour already exists from HEL-913; this is its editor surface).
- The picker never defaults to an unset id — the HEL-620 defect class must not recur.
- Lane-path rendering follows the multi-root node-path format pinned in HEL-913's `design.md` R5 (`root:<rootId> > <stepId> > <stepId>`), which supersedes engine-contract item 11 from HEL-911's archived design. Do not render the stale single-root `root > s1 > s4` format.

## Acceptance criteria

- [ ] AC1 — Playwright: add a second root via pasted table, join it to the first lane, place the resulting table Output. (HEL-913's original AC5, verbatim.)
- [ ] AC2 — Jest: root columns lay out deterministically; removing a root removes its lane's Outputs and surfaces the placement count.
- [ ] AC3 — Lane paths render in the multi-root format defined by HEL-913's `design.md`, not the single-root form.
- [ ] AC4 — Mobile stacking verified at 375px / 430px; the >=44px touch-target guard holds.
- [ ] AC5 — `npm run lint` / `typecheck` / `test` green.

## Out of scope

Backend, engine, `schemas/`, and MCP multi-root surfaces — all delivered by HEL-913. Connector-specific root kinds (v0.9).

## Run constraints (coordinator, verified)

- **No Flyway migration.** Every worktree shares one dev Postgres; a migration from a parallel run poisons `flyway_schema_history` for the others. The multi-root schema already exists from HEL-913 V98/V99. Escalate rather than write one.
- **Three runs in parallel.** Sibling ownership is disjoint and must be respected: HEL-844 owns the REST source fetch path, HEL-970 owns `previewAtNode`/`pathToRoot` in the preview backend, HEL-893 owns CSV/static schema inference. This run owns the frontend river editor.
- **HEL-970's live defect.** `previewAtNode`'s `pathToRoot` never follows a rejoin's `secondaryInput` lane edge, so preview 422s for any non-ancestor lane rejoin. If preview misbehaves on a rejoin, that is HEL-970's defect, not this run's. Do not fix it, do not work around it in the editor, do not let it block an AC — note it and carry on.
- **This run holds the single shared Playwright session.** Use it, but close the browser before parking.
- **Two traps this epic has earned.** Every file enumeration in these tickets has been stale — re-enumerate from the tree and prove completeness with a grep returning zero, not a hand-kept tally. And `npm run typecheck` cannot catch a wire-shape break: the frontend's types are not compile-time-coupled to backend JSON, which is exactly how HEL-913 shipped a broken create flow with every gate green. The proof is the running app.
- **Do not merge.** Hand the PR back to the coordinator.

## Key reference

HEL-913's archived `design.md` "Multi-root contract" R1–R15 lives at `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md`. It was written as a deliverable so this ticket can be planned from it without re-deriving. Load-bearing items: R1 (never zero roots), R2 (root identity is an opaque id, position is never an address), R3 (position is a presentation/determinism tiebreak only — no semantic branch on `position == 0`), R5 (the runtime node-path format), R6 (adding a root: existing `sourceId` or inline source spec, one shape), R7 (removing a root: refuse-last-root, refuse-dangling-lane-reference, report placement count), R13 (`rootClientId` create-time binding).
