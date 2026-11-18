## Context

Round history: design rounds 1-3 (skeptic-design-1..3.md) confirmed a design that sent a debounced `POST /api/pipelines/analyze-proposal` per settled draft edit. Evaluator cycle 1 (evaluation-1.md) found it violates the standing `pipeline-draft-mode-ui` requirement "Client-evaluable edits recompute locally with no request" (spec.md:23-28; "no analyze"; HEL-1631, HEL-1691 `@prod-build` budget), failing `e2e/hel1631-draft-mode.spec.ts:560` and `e2e/hel1632-live-output.spec.ts:216`. **Owner ruling: redesign-no-request** (escalation answered 2026-11-18). This revision replaces D1/D2 of round 3. The truncated fix (D4 below) is unchanged and already proven red-first.

Verified facts (main e83f216b0; evaluator/executor probes in `/home/matt/Development/helio/.concertino/runs/HEL-1732/evidence/`):

- `StepPreviewTable.tsx` (main) builds draft columns from `frameSchema(draftFrame)`: first-seen `Object.keys` order.
- Where the order is lost:
  1. Root frame: `/sample` rows arrive in hash key order (probe: declared `id,region,status,amount,total,created,owner,note`, wire `total,amount,id,note,status,region,owner,created`).
  2. Client `rename` (`evaluator/steps/rowOps.ts:37-47`) copies the row, deletes `from` and `put`s `to`: the renamed column moves to the end.
  3. Server-resolved rows (`useDraftPreviewTransport`, `decodeRow`) and the NDJSON `step`-line `schema` are Scala `Map` iteration order (hash beyond four keys).
- Ops that spread the parent row (`{ ...row }`) inherit the parent's order, so once (1) is fixed they carry a declared order through; ops that build new rows (select, aggregate, pivot, ...) produce their own construction order, which must be checked against the server's analyze for that op.
- Declared orders already on the page with no request: the saved analyze `sourceSchemas` (match by exact `rootId`; NOT via `sourceSchemaForRoot`, which falls back to `sourceSchemas[0]`), the sources list's `inferredSchema` (owned sources), and the saved per-step output schema via `getAnalyzeOutputSchema`.
- HEL-1705's helper `orderColumns(names, schemaNames)` (`features/panels/state/columnOrder.ts`): schema names first, then the rest in ascending code-unit order.

## Goals / Non-Goals

**Goals:**
- The draft grid's columns follow the server's analyze order for the shown step (edited, renamed, descendant, draft-added and server-resolved steps), computed in the browser from data the page already holds.
- Zero network requests on a client-evaluable edit (the standing requirement and its e2e/jest guards untouched and green, including `@prod-build` burst `hel1631:183`).
- The last-good-frame fallback keeps `truncated`.
- Red-first proof for each fix, including a page-level test that fails when the ordering is unplugged from the grid.

**Non-Goals:**
- No `analyze-proposal` request from the grid, and no change to the Output editor sheet (the round-1 page cache and its wiring are removed; the sheet is byte-identical to main).
- No backend, wire, schema or migration change. The NDJSON `step`-line hash order is recorded for the PR as a possible server-side follow-up.
- HEL-1705 agent-note extras stay optional/deferred (listed in the PR).

## Decisions

**D1. Input frames in declared order (roots AND source secondaries), memoized.** Every sample that becomes an evaluator input frame (a root frame via the root path, and a join/union/lookup source secondary via `selectSourceFrames` -> `sampleFrame()`) is re-keyed into a declared order, keys the order does not name following in ascending code-unit order. The declared order for a source is, in precedence:
1. the saved analyze `sourceSchemas` entry whose `rootId` EXACTLY matches the root (no `sourceSchemas[0]` fallback; `sourceSchemaForRoot`'s `[0]` fallback must not be used for this, and if it is reused it gets an exact-match variant);
2. the source's `inferredSchema` from the sources list already in state (`state.sources.items[].inferredSchema`, `sources/types/dataSource.ts`), for an owned source (covers a draft-added root and a source secondary);
3. none: code-unit order.
The re-keyed frame is memoized on (sample object identity, ordered names joined): an analyze refresh that yields the same order keeps the same frame object, so the walker cache, the draft-preview request body and the flash baseline are untouched. `rootFrames` and `savedRootFrames` (and the saved and draft secondary frames) go through the same function, so the base frame the flash compares against and the draft frame have the same key order. Re-keying runs when a sample or its order changes, never per edit; the executor measures it on 1,000 rows x 20 columns and records it.

**D2. Client op handlers place columns where the server's analyze does.** Audit every client step handler in `evaluator/steps/` (registry) against the server analyze for the same op (`PipelineProposalAnalyze.scala`, `MultiInputSchemaInference.scala`, the per-op inference such as `inferCompute`), given ordered inputs (D1 makes both primary and secondary inputs ordered). Record a table (op, client output order, server analyze order, match/fixed/deviation) in `files-modified.md`. Fix the handlers that differ. `rename` is known to differ: keep the existing fold (it implements chained/colliding renames in `scalaMapKeyOrder` order) and then rebuild the output object's key order from the INPUT row's key order, substituting each input key by its final name (dropping keys the fold removed, appending any key the fold created that has no input position in code-unit order); test chains (`a->b, b->c`) and collisions. Check `compute` onto an existing name (client `put` keeps position) against `inferCompute`'s existing-name branch. A handler not fixed is a disclosed deviation (D3b rule applies) listed in the PR.

**D3a. Client-evaluated frames: the grid's ordering function.** For a client-evaluated `ok`/`disabled` view the grid's columns are `orderColumns(frameSchema(frame), names)` where `names` is the frame's own key order taken from its FIRST row only if that row has every key of the frame, otherwise the union in first-seen order is replaced by: the parent's displayed order (recursively, root = D1 declared order) with the step's renames substituted in place, then the step's other new columns in the frame's first-seen order. In practice, after D1 and D2, `names` = `frameSchema(frame)` for dense frames; the explicit rule exists so a sparse frame (row 1 has `a,c`, row 2 has `b`) still shows `a,b,c` from the parent's order instead of `a,c,b`. The executor implements this as one pure function `draftColumnOrder(...)` with unit tests including the sparse case.

**D3b. Server-resolved frames.** For a step whose rows come from the draft-preview transport (a `rows` line, or its last good frame), columns are `orderColumns(frameKeys, names)` where `names` is:
1. the step's saved analyzed output schema, when the step exists in the saved pipeline and NOTHING it depends on differs from the saved pipeline: the step itself and every ancestor step (config, enabled, position, parent), the root binding of its lineage (the draft's `roots` vs `savedRoots`: root added/removed or `dataSourceId` changed, HEL-1734), and every lane or source secondary it or an ancestor reads (`laneDependencyOf`/`sourceDependencyOf`, recursively, including those lanes' own ancestors);
2. otherwise the displayed order of its nearest client-evaluated ancestor (D3a), with the step's new columns after in code-unit order;
3. otherwise `[]` (code-unit).
**D4. Truncated fallback (unchanged, already red-first).** In `mapServerResolved`'s `ok` branch, when the rows fall back to `lastGood.rows`, `truncated` is `lastGood?.truncated === true`.

**D5. Remove the request-sending pieces of cycle 1.** Delete `hooks/useDraftStepProjection.ts`, `state/draftProjection.ts` and their tests; revert the page/sheet wiring (`usePipelineDetailPage.ts`, `usePipelineDraftPresentation.ts`, `PipelineDetailDialogs.tsx`, `outputSheetDraft.ts`, `useOutputSheetNode.ts`, `useDraftNodeCapabilities.ts`) to main; revert the test edits in `PipelineDetailPage.draftMode.test.tsx` and `usePipelineDetailPage.keys.test.tsx` to main. `git diff main -- <those files>` must be empty at the end.

**D6. Tests (RED first, mutations recorded in `.concertino/scratch/HEL-1732/`).**
- Unit: input re-key (hash-ordered sample -> declared order; exact rootId match only, a draft-added root whose rootId is not in `sourceSchemas` uses the sources-list `inferredSchema`, else code-unit, never `sourceSchemas[0]`; unnamed keys code-unit); a source secondary re-keyed the same way; memo identity: a re-delivered analyze with an identical order keeps the same frame object.
- Unit: join with a source secondary: appended right columns in the secondary's declared order.
- Unit: `draftColumnOrder` incl. the sparse-frame case.
- Flash: a first edit after the re-key flashes only the changed rows (`StepPreviewTable` comparison against `baseRows`), i.e. base and draft frames share key order.
- Unit per changed handler (at least `rename` in place), and an order assertion for each audited handler that already matches.
- Unit: D3b precedence: unchanged lineage -> saved order; changed ancestor -> ancestor order + new columns code-unit; changed root binding -> rule 2; an edit in a secondary lane the step reads -> rule 2.
- The cycle-1 `StepPreviewTable.columnOrder.test.tsx` (hand-fed `projectedSchema`) is removed or rewritten with the prop; no hand-fed-schema test survives.
- **Page-level (closes evaluator CR2):** render the pipeline page with a draft over a 6+ column source whose sample rows arrive hash-ordered (realistic fixture), make a draft edit (a rename in the shown step), and assert the "Rows after step N" headers for the shown step AND a descendant step; record that unplugging the ordering (e.g. reverting D1's re-key, or the grid back to raw `frameSchema` of an unordered frame) turns it red. The same test asserts `httpClient.post`/`get` were not called by the edit.
- **Draft-added step derived for real (closes evaluator CR3):** a draft-inserted compute step's headers derived through the real evaluator walk and the real ordering path, not a hand-supplied schema.
- `draftStepView.test.ts` truncated test stays.
- Existing guards unchanged and green: `PipelineDetailPage.draftMode.test.tsx` (as on main), `e2e/hel1631-draft-mode.spec.ts` (incl. :560), `e2e/hel1632-live-output.spec.ts:216`; the `@prod-build` burst `hel1631:183` via `npm run e2e:prod-build` with its HEL-1691 latency budget.

## Risks / Trade-offs

- Key order inside client rows changes (input re-key, rename in place). Order-sensitive consumers (the flash's `rowKey` = `JSON.stringify(row)`, compare/history keys, the Live Output column) stay consistent because saved and draft input frames go through the same D1 function (D1, D6 flash test). The memo must also keep the `RootFrame[]` array identity stable when the order is unchanged (else the full saved-side `baseWalk` re-runs on every analyze/sources refresh), and its key must use a separator that cannot appear in a column name (or a nested Map).
- Re-keying costs one pass over each sample at load; measured and recorded, must not move the HEL-1691 budgets.
- A draft-added root or a secondary whose source the caller owns takes the sources list's `inferredSchema` (D1 precedence 2); one the caller does not own has no declared order on the page: code-unit order (deterministic, disclosed).
- Any D2 handler left unfixed is a known deviation from the spec's SHALL and must be listed as such in the PR. Rename chains/collisions follow the client fold's final names (the server analyze does one lookup per column); recorded in the D2 table.
- The `projectedSchema` prop is removed from `StepPreviewTable.tsx` itself, not only its test.
- D3 rule 2 can place a server-resolved step's new columns differently from the server's analyze (code-unit after the passed-through ones); disclosed, and rule 1 covers the common unchanged case.
- If the D2 audit finds many handlers differing, scope grows; any handler not fixed is listed in the PR with its reason.
