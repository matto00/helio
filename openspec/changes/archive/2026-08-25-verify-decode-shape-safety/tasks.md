## 1. Live trial setup

- [x] 1.1 Confirm `ANTHROPIC_API_KEY` is set and non-placeholder in this worktree's `backend/.env`; start the
      worktree's backend/frontend dev servers per the standard concertino gate.
- [x] 1.2 Create one throwaway static data source + pipeline per step kind under test (join/pivot/window/
      unpivot), each with exactly one step of that kind, via the worktree's own backend API.

## 2. Live trials — mechanism coverage per step kind

- [x] 2.1 `join`: live-trial a refinement message likely to produce a wrong-shape `JoinConfig` edit,
      targeting `joinKey` (defaults to `""` with NO referential-integrity backstop — the real silent-
      degradation surface) as the primary probe, and secondarily `joinType` (defaults to `"inner"`).
      `rightDataSourceId` is NOT a useful probe target: `PatchSetApplyResolvers.scala:228-232` runs every
      decoded `JoinConfig` through `dataSourceRepo.findByIdOwned`, so an empty `rightDataSourceId` is
      already caught and surfaced as a `NotFound` error — a rejection there proves nothing about the
      prompt rule's coverage of the silent-decode path. Inspect the returned PatchSet's edit
      `patch.config` against the real decoder's expected shape.
- [x] 2.2 `pivot`: live-trial a refinement message likely to produce a wrong-shape `PivotConfig` edit
      (`index` as non-array, or `column`/`values`/`agg` missing/wrong type).
- [x] 2.3 `unpivot`: live-trial a refinement message likely to produce a wrong-shape `UnpivotConfig` edit
      (`idVars`/`valueVars` as non-array, or `varName`/`valueName` missing/wrong type).
- [x] 2.4 `window`: live-trial refinement messages covering BOTH mechanisms — `orderBy` (item-level
      flatMap-drop, e.g. malformed `SortKey` entries) AND `partitionBy` (field-level default, non-array).
- [x] 2.5 Record, per trial: the exact prompt used, the resulting PatchSet edit's `patch.config`, and
      whether the existing "config must match current shape" prompt rule prevented the wrong shape.
- [x] 2.6 Delete every throwaway pipeline/data source created in 1.2, regardless of trial outcome (shared
      dev Postgres).

## 3. Worked examples — unconditional for all four step kinds

- [x] 3.1 Add ONE worked UPDATE example per step kind (`join`/`pivot`/`window`/`unpivot`) to
      `RefinementEditShape.scala` (own `private[services] val` each, mirroring the
      `AggregateStepExample`/`GroupByStepExample` pattern) — added for ALL four kinds regardless of what
      section 2's live trials show. The live trials in section 2 diagnose whether the *existing generic*
      prompt rule already suffices (recorded as evidence in the evaluator/skeptic trail); the worked
      examples ship either way, exactly as HEL-411 shipped the aggregate/groupby examples alongside its own
      live verification, rather than only on a confirmed-live-gap trigger.
- [x] 3.2 Extend `RefinementEditShapeSpec` with one test per new example (all four, unconditional): decode
      it through the real config decoder (`JoinConfig.decode`/`PivotConfig.decode`/`WindowConfig.decode`/
      `UnpivotConfig.decode`) and assert the ACTUAL decoded field values (non-empty vectors, correct field
      counts/contents) — never a bare "decodes without throwing" assertion. This is what the ADDED
      requirement in `specs/conversational-refinement/spec.md` is verified against.
- [x] 3.3 For any step kind where section 2's live trial DID reproduce a wrong-shape edit slipping through:
      re-run that same live trial against the now-updated prompt (with 3.1's example in place) to confirm
      the fix actually closes the gap, mirroring HEL-411's own end-to-end verification. For step kinds
      whose live trial passed without the new example, note this in the evaluator/skeptic evidence trail —
      the example still ships (3.1/3.2), it just wasn't required to close a live-reproduced gap for that
      kind.

## 4. Tests

- [x] 4.1 `sbt test` — full backend suite green, including the new `RefinementEditShapeSpec` cases.
