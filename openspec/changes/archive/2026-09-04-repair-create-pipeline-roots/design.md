## Context

Verified against the tree at `4b953460`, not taken from the ticket:

- Request: `CreatePipelineRequest(name, roots: Vector[CreatePipelineRootRequest], tag, steps, outputs)`
  (`backend/.../pipelines/PipelineProtocol.scala:78`). No scalar field; a body carrying one is a hard `400`.
- Read: `PipelineRootSummaryResponse(id, dataSourceId, dataSourceName)` (`:87`), exposed as
  `PipelineSummaryResponse.roots: Vector[...]` (`:100`). Both scalars removed outright.
- Analyze: `PipelineAnalyzeResponse(id, name, sourceSchemas: Vector[RootSourceSchemaResponse], steps,
  sourceSchemaDrift)` (`PipelineAnalyzeProtocol.scala:197`), where
  `RootSourceSchemaResponse(rootId, sourceDataSourceName, sourceSchema)` (`:184`). The singular
  `sourceDataSourceName`/`sourceSchema` pair was retired here too.
- Frontend: exactly **21** files reference `sourceDataSourceId`, **16** reference `sourceDataSourceName`
  (re-enumerated by grep). Real (non-comment) production read sites are few: `CreatePipelineModal.tsx:90`
  (the POST body), `pipelinesSlice.ts:273/603-605`, `usePipelineDetailPage.ts:354`,
  `PipelineDetailPage.tsx:151`, `PipelineListTable.tsx:104`, `EmptySchemaAffordance.tsx:30`,
  `SidebarBody.tsx:90`. The rest are type declarations, doc comments, and test fixtures.

## Goals / Non-Goals

**Goals:**

- The existing single-source create flow posts a one-element `roots[]` and succeeds against the shipped API.
- Every production read of a pipeline's source resolves through `roots[]`.
- Zero occurrences of either scalar under `frontend/src`, proven by grep.
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` green.

**Non-Goals:**

- Any multi-root UI (HEL-968). No "+ root" affordance, no root columns, no multi-root editing.
- Any backend change, migration, or API change.
- Repairing `openspec/specs/pipeline-list-api` and `openspec/specs/pipeline-edit-flow`, which still document
  the removed scalars in **backend** response requirements — HEL-913 server-side spec drift, recorded for
  follow-up triage, not absorbed here.

## Decisions

**D1 — `roots[]` is modelled on the frontend exactly as the server sends it.** Add
`PipelineRoot { id, dataSourceId, dataSourceName }` to `types/pipelineStep.ts` and replace the two scalars on
`PipelineSummary` with `roots: PipelineRoot[]`. Rejected: keeping a derived scalar getter (e.g. a
`sourceDataSourceName` computed property) — it would satisfy nothing, since AC3 is a zero-hit grep, and it
would re-hide the single-root assumption the server deliberately made explicit.

**D2 — "name this pipeline's source" reads `roots[0]`; "does this pipeline use this source" reads every
root.** These are different questions and conflating them is the one real correctness trap here.

- Display (`PipelineDetailPage:151` → header `sourceName`, `usePipelineDetailPage:354` bound-source lookup,
  `PipelineListTable:104`) names a single source and legitimately takes `roots[0]`, matching the pre-existing
  single-source experience.
- Dependency counting (`SidebarBody:90` delete warning, `EmptySchemaAffordance:30`) must use
  `roots.some(r => r.dataSourceId === source.id)`. A multi-root pipeline reading the source from a non-first
  root still breaks when that source is deleted; keying on `roots[0]` would under-warn. This costs nothing
  today (every pipeline the UI creates has one root) and is correct the moment HEL-968 lands.
- `selectPipelineNamesBySourceId` (`pipelinesSlice:603`) is a dependency map, so it indexes **every** root,
  and must not list the same pipeline twice when two of its roots share one source — dedupe per pipeline.

**D3 — `roots[0]` access is guarded, never asserted.** `roots` is typed non-optional but arrives from the
network; treat it as possibly empty. Display sites use `roots[0]?.dataSourceName ?? ""` (or render nothing)
rather than a non-null assertion. The `pipeline-editor-page` delta states the empty-roots render explicitly.

**D4 — `PipelineAnalyzeResponse` is realigned to `sourceSchemas[]`, and the per-root NAME field is OMITTED.**
Its `sourceDataSourceName`/`sourceSchema` fields are stale in the same way and AC3's grep covers them. Grep
confirms **zero production consumers** of either field — the only non-test reference to `sourceSchemas` is its
own type declaration — so this is a type-and-fixture correction with no UI behavior change, not editor work.

*Revised after evaluation cycle 1 (product-owner ruling `omit-unconsumed-field`).* This decision originally
rejected omission on the grounds that "the server does send them, and a type that omits sent fields is the
same class of drift". That reasoning was written before the real collision was known and does not survive it:

- AC3 bars the identifier `sourceDataSourceName` from `frontend/src` entirely, comments included.
- The analyze API still **sends** a field by exactly that name (`RootSourceSchemaResponse.sourceDataSourceName`,
  `PipelineAnalyzeProtocol.scala:184`). It was never retired — only the `PipelineSummary` scalars were.
- The underlying cause is a backend inconsistency: `PipelineRootSummaryResponse` sends `dataSourceName` while
  `RootSourceSchemaResponse` sends `sourceDataSourceName` for the same concept. That is why the frontend type
  looks wrong however it is written. Filed as **HEL-975**; out of scope here (a backend wire change).

So the type cannot both satisfy AC3 and name that field truthfully. Renaming it to `dataSourceName` (cycle 1's
attempt) was rejected by the evaluator, correctly: a type naming a field something the wire does not send is
exactly the silently-wrong-type defect class this ticket exists to close. Omission is the only option that
neither lies about the wire nor requires editing the user's acceptance criteria — a narrower type is honest,
since extra JSON keys are unremarkable in TypeScript, whereas a misnamed one is false.

`RootSourceSchema` is therefore `{ rootId, sourceSchema }`. The omission carries a comment naming HEL-975, so
the next person who needs that field learns the name to expect and why it is absent rather than rediscovering
this collision.

**D5 — `CreatePipelinePayload.outputDataTypeName` is left alone.** It is a documented legacy field for
`ShapeInstantiateStep.tsx`, which does not reference either scalar and is out of this ticket's path. Removing
it is unrelated cleanup.

**D6 — Proof is the e2e run, never the typecheck.** The frontend's types are not compile-time-coupled to the
backend JSON, which is precisely why these consumers stayed green while broken. A green `npm run typecheck`
is necessary and worthless as evidence here. The load-bearing evidence is `hel910` going from red to green
against a running backend. `hel813` is already green on the base branch and is a no-regression check only —
it is NOT evidence this fix worked and must not be cited as such.

## Risks / Trade-offs

- **Fixture churn is wide (21 + 16 files, mostly tests).** A mechanical find-and-replace risks converting a
  dependency-counting fixture into a `roots[0]` shape that silently passes while encoding D2's wrong answer.
  Mitigation: change the two dependency sites and their tests deliberately, and add a fixture with a pipeline
  whose *second* root matches the source, which fails under a `roots[0]` implementation.
- **A stale scalar can hide in a doc comment and still fail AC3.** Mitigation: AC3 is verified by running the
  grep for both scalars over all of `frontend/src` and showing zero hits, comments included.
- **`hel910` red at the start of the run is pre-existing.** Its baseline red must be captured before the fix
  so the transition to green is real evidence rather than an assumed starting state.

## Planner Notes

- Self-approved: including the `PipelineAnalyzeResponse` realignment (D4), on the grounds that AC3's grep
  forces it and it has zero production consumers. It did not pull in any analyze-rendering UI work.
- ESCALATED, not self-approved: D4's AC3-vs-wire collision. Product-owner ruling `omit-unconsumed-field`,
  recorded via `concertino answer`. D4 above is rewritten rather than merely appended to, so its superseded
  reasoning does not stand unqualified.
- Self-approved: `roots.some(...)` for the two dependency counters rather than the narrower `roots[0]`
  reading of "restore the pre-existing experience". Under a single root the two are identical, so this adds
  no behavior today and removes a latent under-warning bug.
- Filed, not fixed here: `openspec/specs/pipeline-list-api/spec.md:47` and
  `openspec/specs/pipeline-edit-flow/spec.md:8` still require the removed scalars in backend responses —
  **HEL-976**. Backend naming inconsistency behind D4 — **HEL-975**.
