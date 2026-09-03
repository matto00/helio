# Tasks

## 1. RED-first probes (before any source edit) — at the REACHABLE surface

Join is picker-excluded (ticket.md CORRECTION), so the red is demanded at the patch-set and API
surfaces, not the UI. Record every request and response verbatim in `execution-progress.md`.

- [x] 1.1 Start the worktree's dev servers and log in as the dev account.
- [x] 1.1b SETUP for 1.2-1.3: create an owned pipeline with one join step and one union step (each
      with a REAL owned second source) for the patch-set edits to target. Without existing steps to
      update, a `pipelineStep` update edit fails on target resolution before ever reaching the ACL
      arms, which would make the "red" prove the wrong thing.
- [x] 1.2 `POST /api/patch-sets/apply` with a `pipelineStep` update edit carrying
      `UnionConfig.otherDataSourceId: ""`. MUST be rejected by the unfixed code. This is the cell
      HEL-620 missed and the one reachable today. Record the rejection verbatim.
- [x] 1.3 The same probe with `JoinConfig.rightDataSourceId: ""`. MUST be rejected. Record verbatim.
- [x] 1.4 (Same join code path as 1.3 at a different surface — cheap, so do both, but do NOT read a
      green 1.4 as covering the patch-set surface.) `POST /api/pipelines/:id/steps` with the seed body
      `{"type":"join","config":{"rightDataSourceId":"","joinKey":"","joinType":"inner"}}` — what
      `defaultConfigFor("join")` returns, reached here via direct API/MCP rather than the picker.
      Record the `404`.
- [x] 1.5 The same for `PATCH /api/pipeline-steps/:id`. Record the `404`.
- [x] 1.6 If ANY of 1.2-1.5 does not fail against unfixed code, STOP and report — a green probe
      before the fix means the probe is wrong, not that the bug is absent.

## 2. Shared extractor

- [x] 2.1 Add `secondaryDataSourceId(config: Any): Option[String]` to
      `com.helio.api.protocols.pipelines`, alongside `PipelineStepConfigCodec`, per design Decision 1.
      The parameter is `Any` because `decode` returns `Try[Any]` and the 23 config case classes share
      NO sealed parent — `PipelineStepConfig` is a frontend TypeScript type and does not exist in
      Scala. Do NOT put it in `com.helio.domain.package.scala` (an alias-only re-export shim) or in
      the services packages (a services→services dependency). Doc comment names
      HEL-386/HEL-620/HEL-950, the `defaultConfigFor` seed rationale, and the `Any`/Decision 7
      relationship. Use `.nonEmpty` on the raw string, never `.trim.nonEmpty` (Decision 4).
- [x] 2.2 Unit-test the extractor directly: `None` for a config kind with no second source, `None`
      for each of the three kinds with an empty id, `Some(id)` for each of the three with a real id.

## 3. Rewrite the ACL blocks

- [x] 3.1 `PipelineService.addStep` — replace `joinCheckF`/`unionCheckF`/`lookupCheckF` with one
      check driven by the extractor. Preserve the error string `s"Data source not found: $id"` exactly.
- [x] 3.2 `PipelineService.updateStep` — same, preserving its error string exactly.
- [x] 3.3 `PatchSetApplyResolvers` pipelineStep-update triad (one `match`, three arms) — same,
      preserving `s"edit $index: data source not found: $id"` exactly.
- [x] 3.4 Read the diff and confirm no non-empty-id path changed behavior. Name BOTH preserved error
      strings explicitly in the evidence record (lesson 3: constrain the mechanism, not the outcome).

## 4. Tests, with each leg guarded independently (design Decision 3)

- [x] 4.1 `PipelineService.addStep`: empty-id-succeeds and cross-user-404 tests for join.
- [x] 4.2 `PipelineService.updateStep`: the same pair for join.
- [x] 4.3 `PatchSetApplyResolvers`: empty-id-not-rejected and foreign-owned-rejected for join AND
      union (the two cells HEL-620 missed).
- [x] 4.4 Confirm the pre-existing union and lookup empty-id and cross-user tests still pass
      unmodified. The design gate grepped `backend/src/test/` and found NO existing test asserting an
      empty second-source id, so nothing should need changing. If some fixture nevertheless does,
      state per-assertion why (lessons 1 and 6) — never blanket-update expected values.
- [x] 4.5 MUTATION CHECK, recorded in `execution-progress.md`: for each op, (a) revert that op's
      empty filter ALONE and confirm its empty-id test goes red while its cross-user test stays
      green; (b) delete that `findByIdOwned` call ALONE and confirm the cross-user test goes red.
      Each leg singly, never only in conjunction (lesson 5).

- [x] 4.6 STRUCTURAL GUARD (design Decision 7): add a `*GuardSpec` that enumerates
      `PipelineStep.Registry`, decodes each kind via `companion.decodeConfig`, uses
      an explicit `case p: Product` narrowing (a non-`Product` decode MUST fail the guard, never be
      skipped) and `Product.productElementNames` to find every field whose name ends in `DataSourceId`, and for
      each asserts `secondaryDataSourceId` returns `None` on the default (empty) decode and
      `Some("real-id")` when that field is set — letting that decode fail LOUDLY for a future
      non-string field rather than wrapping it in a swallowing `Try`. Assert the POSITIVE baseline too: all 23 registered
      kinds visited, exactly three second-source fields found. Model on `RlsPolicyGuardSpec` — do NOT
      cite `SchemaFieldStructuralGuardSpec` / `RestConnectorEgressGuardSpec` as source-scanning
      precedent; verified at the gate, none of the three reads a source file.
- [x] 4.7 PROVE THE GUARD ON BOTH LEGS, each broken singly (lesson 5 applied to the guard itself,
      not only to the ACL tests). Record both states in `execution-progress.md`:
      (a) DETECTION — temporarily add a fourth field (e.g. `extraDataSourceId: String`) to one step
      config; the guard MUST go red; remove it.
      (b) HANDLING — delete ONE arm from `secondaryDataSourceId` alone; the GUARD itself (not merely
      task 2.2's unit test) MUST go red; restore it.
      A guard that survives either mutation is vacuous and must be fixed before proceeding.

## 5. GREEN verification

- [x] 5.1 Re-run every task-1 probe; record the now-successful responses verbatim alongside the reds.
- [x] 5.2 Confirm by live probe (not only unit test) that a non-empty FOREIGN-OWNED
      `rightDataSourceId` still returns `404` at both surfaces — the guard must not weaken the real
      ACL check.
- [x] 5.3 UI REGRESSION GUARD, labelled as such and NOT as proof of the join fix: add a `union` step
      from the op picker and choose its other source; no error toast. Proves the extractor rewrite
      did not regress a previously-correct op. Do NOT attempt a join picker walkthrough (impossible)
      and do NOT claim UI evidence for the patch-set cells (AC6c).

## 6. Gates and handoff

- [x] 6.1 `sbt test` (backend). State explicitly which gates actually scan the changed files: this
      change is backend-only, so `npm run lint` / `npm run typecheck` / `npm test` scan NOTHING
      relevant and must not be cited as coverage of this fix (lesson 4). Run them only to confirm
      no incidental breakage.
- [x] 6.2 `openspec validate guard-join-picker-empty-source-id --type change`.
- [x] 6.3 Write `files-modified.md`, then commit.
