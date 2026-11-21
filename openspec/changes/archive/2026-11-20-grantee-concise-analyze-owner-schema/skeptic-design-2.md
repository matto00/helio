## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 2f6d44104ec5060c53c7eca7385ba01e6a0f0875 (no src changes; only the change dir is untracked).

### What I verified (with evidence)

**Round-1 CR1 (m3 unkillable) is closed.**
- Validation path: a `sort`/`filter` step on an absent field carries no `validationError`. `checkEnabledStep`
  (`PipelineAnalyzeService.scala:32-40`) runs `validateStepConfig` (schema-independent; `SortConfig.decode` only
  decodes `sortBy: [{field, direction}]`, `SortStep.scala:21-29`) and then `inferOutputSchema`. For
  `filter|limit|sort|dedupe|upsertsource` that returns `(inputSchema, None)` (`StepSchemaInference.scala:30`). So the
  owner gets no error. `select` goes through `inferSelect`, which may error, and the design already says to fall back
  to sort/filter if it does.
- Warning path: with no error, `AnalyzeSchemaWarnings.compute` (l.151-162) emits `field-not-in-input-schema` for each
  `referencedFields` entry that is absent from the input (`sort` → `sortBy.field`, l.280). This needs `in.names`,
  which for a parentless step is `inputSchema.nonEmpty` (l.99). The message is `missingMessage` (l.254-264):
  `"sort: field 'nope' not found in this step's inferred input schema (available: amount, flag)"`.
  - The owner's caller-view root is the seeded `[amount:float, flag:boolean]` (`Hel1661GranteeAnalyzeVerdictSpec.scala:97,126`),
    so the owner baseline names `amount`.
  - A grantee's caller-view root is empty (`findByIdOwned`, `PipelineAnalyzeReads.scala:257-261`), so `in.names` is
    false and the grantee gets no warning. Concise then gives `warnings = None`, via `warningsByStep.get` (l.281,288).
  - Under m3, the grantee would get the owner-view message naming `amount, flag`, and test 6a turns red.
    `AnalyzeSchemaWarningsSpec.scala:79` already uses this exact sort/`nope` shape for this warning, which corroborates it.
- design.md test 6a states the owner baseline, the grantee literal plus the leak scan, and the main-run check for the
  owner having no error. m3 maps to 6a in the mutation list, and tasks 3.2 names 6a. Test 7 now includes the 6a fixture.
- Round-1 note on the signature is addressed. D1 pins `nonOwnerValidity` over `Map[String, AnalyzedStep]`, the same
  shape as the `projections` that both call sites hold (l.132, l.279). Only `validationError` is replaced.

**Fresh review of the whole plan**
- Premise re-checked from the code, not from the evidence file. `analyzeConcise` (l.249-295) uses only the caller view
  and has no `nonOwnerValidationError`. `analyze` has both (l.83-88, l.141-146).
  `helio-mcp/src/helioApi.ts:370-380` calls `/api/pipelines/:id/analyze` with `concise`, so the fix is backend-only.
- D1 is behaviour-preserving for `analyze`. Mapping the whole map also touches disabled steps, but `analyze` still
  selects `enabledSteps` from the map, and `warnings` are computed from the unmapped caller-view projections (l.133).
  So the steps, the cost verdict and the warnings do not change.
- D2 and D3 match the HEL-1661 rulings: the owner's schema decides validity, a grantee's warnings and schemas stay
  caller-view, and the reason text is neutral via `NeutralStepError`.
- There is no row count to remove: `ConciseAnalyzeNode` is `{path, op, validationError, warnings}`. `path` is
  `RuntimeGraphPath.pathOf`, built from root and step ids, never source names.
- D4: a stranger gets `findByIdShared` None, then `NotFound("Pipeline not found: <id>")` (l.251), before any root
  read. Test 6 pins the exact message.
- AC coverage:
  - AC1 (red on main): tests 2 and 3.
  - AC2 (no new schema data, no live row count, NOBYPASSRLS): tests 1, 4, 5 and 6a.
  - AC3 (stranger gets the same not-found): test 6.
- Spec delta: the ADDED requirement matches D1-D4, and its scenarios map to the tests. No placeholders, no
  contradictions, no scope drift. No API/schema delta is needed, because the wire shape is unchanged.

### Verdict: CONFIRM

### Non-blocking notes
- The HEL-1661 `seedFixture` takes only a compute expression. 6a needs a sort-step variant with
  `{"sortBy":[{"field":"nope","direction":"asc"}]}`. Use `sort` first: it is guaranteed error-free, while `select`
  goes through `inferSelect`.
- Keep `warnings` computed from the unmapped caller-view `projections`, as D2 says, not from the
  `nonOwnerValidity` result. For a grantee the empty root makes the two identical today, but the unmapped map is the
  one the ruling names.
