## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 2f6d44104ec5060c53c7eca7385ba01e6a0f0875 (no src changes yet; only the change dir is untracked).

### What I verified (with evidence)

- **Premise holds.** `PipelineAnalyzeReads.scala:249-295`: `analyzeConcise` resolves root schemas only via
  `dataSourceRepo.findByIdOwned(dsId, user)` (l.257-261). It has no owner-view pass and no `nonOwnerValidationError`
  mapping. `analyze` has both (l.83-88, l.141-146). Stranger: `findByIdShared` None -> `NotFound("Pipeline not found: <id>")` (l.251).
- **The fix is backend-only.** `helio-mcp/src/helioApi.ts:370-380`: `analyzePipeline(id, true)` sends a GET to
  `/api/pipelines/:id/analyze?concise=true`. No MCP change or deploy is needed. The proposal's claim is correct.
- **No row count in concise.** `ConciseAnalyzeNode` is `{path, op, validationError, warnings}` (l.284-289). The design
  correctly says there is nothing to remove.
- **D1 is sound.** The extracted helpers match the existing inline code exactly. The upsert overlay and the
  secondary schemas are already computed in concise (l.262-263), so the owner-view `analyzeNodes` call can be reused as is.
- **Caller-view warnings follow the HEL-1661 ruling.** The archive's proposal.md:10 and design.md:28/46 keep
  `warnings` caller-view. For a grantee, the caller-view root is empty, so `inputFlags` gives `Flags(false,false)`
  (`AnalyzeSchemaWarnings.scala:99`) and no warnings are emitted. That matches the HEL-1661 spec's
  `r.warnings shouldBe Vector.empty` (l.189). Test 5's "warnings as main produces them" is consistent with this.
- **The harness exists.** `Hel1661GranteeAnalyzeVerdictSpec` has the `helio_app_test` two-role pool, the `amount,flag`
  float/boolean fixture, and `$amount * 2` / `$flag AND $amount`. The four "stay green" specs all exist under `backend/src/test`.
- **The ACs are covered.** AC1 is covered by tests 2/3 (DEFECT, red on main). AC2 is covered by tests 1/5 (NOBYPASSRLS
  pin, leak scan, key allow-list). AC3 is covered by test 6 (exact message).
- **No placeholders or scope drift.** The spec delta matches the design. The non-goals are coherent.

### Verdict: REFUTE

### Change Requests

1. **Mutation m3 cannot be killed by the planned fixtures, so the warnings leak guard is vacuous.**
   The design (Test plan, mutations) says m3, "concise computes `warnings` from owner projections", turns test 5 red.
   It does not, for the fixtures listed:
   - `$amount * 2` on `amount: float` gives no owner-view warning. `*` on a trusted float is not
     `numeric-op-on-text-field`, and compute has no unknown-field warning (`AnalyzeSchemaWarnings.scala:33-36`).
   - `$flag AND $amount` has a `validationError` in owner view. A step with an error is skipped by `compute`
     (l.152), so it also gives no warning.

   With m3 applied, the owner-view warnings are therefore still `Vector.empty`, and test 5 stays green.

   This is the leak path that matters most. `missingMessage` (l.~250) lists up to 20 of the input schema's column
   names, so owner-view warnings would send the owner's column names to a grantee. That is exactly what the HEL-1661
   ruling forbids.

   Required: add a fixture where owner-view warnings are non-empty and would name root columns. For example, a CSV
   root plus an enabled `sort`/`filter`/`select` step on an absent field such as `nope`. That step is in
   `referencedFields` (l.277-283), so it is a non-blocking `field-not-in-input-schema` warning that lists
   `amount, flag` in owner view. For that fixture:
   - assert the owner's concise warnings name `amount` (a baseline proving the fixture really produces the leak-shaped warning);
   - assert the grantee's concise warnings equal the literal caller-view value and contain none of `amount`, `flag`, `float`, `boolean`.

   Then name this test as m3's killer in design.md and in tasks 3.2.

### Non-blocking notes

- D1's `nonOwnerValidity(callerView, ...)` is described over a `Vector[AnalyzedStep]`, but concise keys off the
  `projections` map. Either shape works; consider fixing the signature in design.md so the two call sites cannot drift.
- Optional extra check: the same new fixture also exercises test 7 (concise equals full-route `validationError`), with
  none expected for either.
