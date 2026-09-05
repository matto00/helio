## Why

HEL-913 shipped multi-root pipelines as a backend-only capability: `pipeline_roots`, a per-root engine walk,
`roots[]` on create, `add_root`/`remove_root` routes, and root ACL. The editor half was deliberately deferred to this
ticket because it needs HEL-912's lane layout, which landed in a parallel run that owned `frontend/**`.

The result on `main` today is a capability users cannot reach. Every editor display site reads `roots[0]` and nothing
else: a pipeline with two roots renders as if it had one, its second lane is invisible, and there is no affordance to
add or remove a root. The API can express multi-root; the UI cannot. This change closes that gap.

## What Changes

- The river renders **one lane column per root**, each headed by a root card naming its bound source, in
  `pipeline_roots.position` order — the presentation tiebreak R3 already assigns to position.
- A **"+ root"** affordance appends a root, reusing the P1.5 inline-source flow (`AddSourceModal`) so a root's source
  can be picked from the existing list *or* created inline in the same interaction, exactly as `CreatePipelineModal`
  already composes it. The source picker never submits an unset id (the HEL-620 defect class).
- **Removing a root** surfaces the count of panel placements about to be destroyed before it confirms, mirroring step
  deletion, and surfaces the backend's two named refusals (last root; a surviving lane referencing a deleted node)
  as errors rather than as a generic failure.
- **Lane paths render in the multi-root format** `root:<rootId> > <stepId> > …` pinned by HEL-913 `design.md` R5,
  with display names substituted at render time. The stale single-root `root > s1 > s4` form is not emitted.
- Frontend service bindings for `POST /api/pipelines/:id/roots` and `DELETE /api/pipelines/:id/roots/:rootId`, which
  the frontend does not currently call at all.

## Capabilities

### New Capabilities

- `pipeline-root-editor-ui`: the editor surface for a pipeline's root set — per-root lane columns, the "+ root"
  inline-source flow, root removal with placement-count reporting, and multi-root lane-path rendering.

### Modified Capabilities

- `pipeline-lane-layout`: lane columns are keyed and ordered by originating root, not by a single root frame.

## Impact

Frontend only: `frontend/src/features/pipelines/{ui,state,hooks,services,types}`. No backend, no `schemas/`, no MCP,
and **no Flyway migration** — the schema exists from HEL-913 V98/V99, and a migration from this worktree would poison
the dev Postgres shared with two parallel runs.

## Non-goals

Backend, engine, `schemas/`, and MCP multi-root surfaces (HEL-913 delivered them). Connector-specific root kinds
(v0.9). Reorder semantics for multi-root pipelines (HEL-973). HEL-970's `pathToRoot` rejoin-preview defect, which is
live in this feature area and owned by a sibling run.
