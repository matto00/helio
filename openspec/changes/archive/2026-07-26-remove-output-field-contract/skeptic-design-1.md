## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **`rowCount`/`description` untouched everywhere.** Read `ticket.md`, `proposal.md`, `design.md`,
   `tasks.md`, and the spec delta in full — every task and every MODIFIED requirement block only removes
   `fields`/`OutputFieldContract` content; `rowCount` semantics (`ExactlyOne`/`AtMostParam`/`Unbounded`) and
   `description` text are identical between the current spec (`openspec/specs/pipeline-shape-registry/spec.md`)
   and the delta everywhere they appear. No task references editing `RowCountContract` or `description`.

2. **Sweep completeness — backend main.** Grepped `backend/src/main/scala/com/helio/domain/shapes/` and
   `backend/src/main/scala/com/helio/api/protocols/PipelineShapeProtocol.scala` / `api/package.scala`:
   - `OutputContract.scala:32,40` — `OutputFieldContract` case class + `fields` member, matches task 1.1.
   - All 5 shape files construct `OutputContract(... fields = Vector.empty ...)`
     (`PassthroughShape.scala:34`, `SingleRowShape.scala:89`, `TopNShape.scala:64`,
     `TimeSeriesShape.scala:78`, `PivotMatrixShape.scala:79`) — matches task 2.1's file list exactly.
   - `PipelineShapeProtocol.scala:5,19-46,115-118` defines `OutputFieldContractResponse` +
     `OutputContractResponse.fields` + the `jsonFormat3` implicits — matches task 3.1.
   - `api/package.scala:252-255` re-exports both `OutputFieldContractResponse` and `OutputContractResponse`
     type aliases — task 3.1's parenthetical ("and `api/package.scala` if it also references the format")
     correctly anticipates this; it does.
   - `PipelineShapeService.scala` — grepped, zero hits for `fields`/`OutputFieldContract`; task 3.2's
     "check... remove if present" is correctly a no-op.

3. **Sweep completeness — contracts.** `schemas/pipeline-shape-catalog.schema.json` lists `fields` in BOTH
   `outputContract.properties` (lines ~36-49) AND `outputContract.required` (line ~51) — confirms Decision 2
   in design.md is grounded, and task 4.1 explicitly calls out removing it from both.

4. **Sweep completeness — helio-mcp.** Grepped all of `helio-mcp/src/` + `README.md` + `scripts/verify.ts`
   for `OutputFieldContract`/`fields`/`outputContract`:
   - `types.ts:328-341` — `OutputFieldContractResponse` interface + `OutputContractResponse.fields`.
   - `helioApi.ts:239-240` — doc comment referencing `outputContract.fields`.
   - `context.ts:75-76` — doc comment referencing `fields` being dropped (code itself never maps `.fields`
     through — `context.ts:191-192` only flattens `rowCount`/`description` — so this file needs a comment
     edit only, consistent with "even if unused").
   - `tools/read.ts:184` — tool description string mentioning `outputContract.fields`.
   - `scripts/verify.ts:173,177-178` — type annotation + log line referencing `fields`.
   - `README.md` — no actual `outputContract.fields` reference found (only an unrelated spray-json-gotcha
     mention of "fields" at line 160); listing it in task 5.1 is harmless over-inclusion, not a gap.
   - Confirmed `tools/proposal.ts`/`tools/write.ts` (also matched the broad grep) only reference unrelated
     step-config `fields` (e.g. `select`/`passthrough` step params) — correctly excluded from tasks.md.

5. **Sweep completeness — frontend.** Grepped `frontend/src/features/pipelines/` and
   `frontend/src/features/panels/` for `outputContract`/`OutputFieldContract`:
   - Only non-test file: `frontend/src/features/pipelines/types/pipelineShape.ts:23-34` —
     `OutputFieldContract` interface + `OutputContract.fields` — matches task 6.1.
   - `pipelineService.ts` and the four UI components named in task 6.2 (`ShapeInstantiateStep.tsx`,
     `DataTypeSelectStep.tsx`, `PanelCreationModal.tsx`, `ShapePickerModal.tsx`) — grepped directly, zero
     `.fields` references in any of them; task 6.2 is correctly scoped as a "check, remove if present"
     no-op.
   - Exactly 7 test files reference `outputContract`/`OutputFieldContract`:
     `useShapeOffering.test.tsx`, `PanelCreationModal.test.tsx`, `ShapeInstantiateStep.test.tsx`,
     `DataTypeSelectStep.test.tsx`, `PipelineDetailPage.test.tsx`, `ShapePickerModal.test.tsx`,
     `pipelineService.test.ts` — matches task 7.3's list exactly, no more, no fewer (verified all 7 exist
     on disk).

6. **Sweep completeness — backend tests.** `TopNShapeSpec`, `SingleRowShapeSpec`, `PivotMatrixShapeSpec`,
   `TimeSeriesShapeSpec` all exist (task 7.1's list). Verified `PassthroughShapeSpec.scala` has zero
   `outputContract`/`OutputContract` references (its `"fields"` hits are all the shape's own `params.fields`
   arg, unrelated) — correctly excluded from task 7.1's edit list.
   `PipelineShapeRoutesSpec.scala:47` — `passthrough.outputContract.fields shouldBe empty` — the exact
   assertion task 7.2 targets; line 45's `paramsSchema...shouldBe Vector("fields")` is an unrelated
   passthrough-param assertion, correctly left alone.

7. **Spec delta fidelity.** Compared all 6 MODIFIED requirement blocks in
   `openspec/changes/remove-output-field-contract/specs/pipeline-shape-registry/spec.md` line-by-line
   against the current `openspec/specs/pipeline-shape-registry/spec.md`: "OutputContract declares...",
   "GET /api/pipeline-shapes returns...", and the four per-shape "declares a[n] ... output contract"
   requirements. Every block is the current text with the `fields`-specific clauses/scenarios
   surgically removed (or, for the shared `OutputContract` requirement and the catalog-GET requirement,
   replaced with an explicit "no fields member" / "SHALL NOT include a fields property" statement plus a
   revised scenario) — no accidental drift in `rowCount`/routing/auth/registry prose found anywhere in the
   6 blocks. This matches design.md's own count ("six separate requirements... all six move together").

8. **Schema-drift tooling exists.** `CONTRIBUTING.md:117` — `npm run check:schemas` — grounds task 7.5's
   reference to "the repo's schema-drift check."

9. **Scope discipline.** Read all of `tasks.md`; every task is a subtraction (delete field/member/property)
   or a mechanical fixture/assertion edit. No task adds new behavior, renames unrelated symbols, or touches
   `expand`/validation logic. `design.md`'s Decision 1 explicitly rejects the two more invasive alternatives
   (schema-only removal, deprecate-with-soak). Matches the ticket's "behavior-preserving" scope exactly.

### Verdict: CONFIRM

### Non-blocking notes

- `helio-mcp/README.md` is listed in task 5.1 as a grep target but currently has no `outputContract.fields`
  reference to remove — not a defect, just means that particular file check will be a no-op for the
  executor.
