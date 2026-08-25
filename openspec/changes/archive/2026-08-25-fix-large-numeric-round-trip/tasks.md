## 1. Backend

- [x] 1.1 In `DataTypeRowRepository.listRows`, replace the bare `.parseJson` call with
      `.parseJson(JsonParserSettings.default.withMaxNumberCharacters(400))` (import
      `spray.json.JsonParserSettings`), scoped to this call site only.
- [x] 1.2 Confirm `overwriteRows` (write path) needs no change — verify via the red-then-green
      test in section 2 that the defect is entirely in the read path.

## 2. Tests

- [x] 2.1 Write a DB-backed regression test directly against `DataTypeRowRepository`
      (`overwriteRows` + `listRows`) — not through `WorkspaceContextService`'s all-DataTypes
      fan-out (see design.md D3 — HEL-373 precedent shows that fan-out poisons unrelated tests in
      the same spec file).
- [x] 2.2 Capture the test FAILING against current `main` (before 1.1) as red evidence — assert
      exact value equality on the round-tripped `JsNumber`, not "no exception"/"row exists".
      Persist the red output as evidence.
- [x] 2.3 Empirically determine and record the real character-length boundary (parse strings of
      length 99, 100, 101, 102 directly, or via the repository) — verify vs. the ticket's ">=100
      chars" claim; report the actual boundary found.
- [x] 2.4 Boundary sweep: numeric literal just under, exactly at, and well over the boundary
      (large integer-part magnitude, e.g. near max `double`).
- [x] 2.5 Negative large-magnitude numeric value.
- [x] 2.6 High-precision decimal value (many significant digits, not just a large integer part).
- [x] 2.7 Small-magnitude / denormal-style value whose plain-decimal expansion is long on the
      fraction side (e.g. many leading zeros after the decimal point, such as a value near
      `5e-324`) — proves the fix isn't scoped only to "large integer part" values, per design.md's
      corrected risk analysis (jsonb is arbitrary-precision `numeric`, not bounded by `double`).
- [x] 2.8 Ordinary small numeric value continues to round-trip unchanged (discriminating control
      case).
- [x] 2.9 Re-run the full test suite (`sbt test`) to confirm no regression in existing
      `DataTypeRowRepository`/pipeline-run/panel-binding/workspace-context specs.
- [x] 2.10 Check dev DB for leftover fixture rows/DataTypes created by these tests; clean up and
      verify cleanup by querying (per driver's shared-dev-DB caution) — only if any test writes
      outside its own transaction/embedded-DB scope.

## 3. Sibling-path audit (report only, do not fix)

- [x] 3.1 Report `AlertEventRepository.value`/`AlertRuleRepository.condition` (both
      `row.<col>.parseJson` over a `JSONB` column, default 100-char settings) as sharing the same
      failure-mode pattern, per design.md Non-Goals — findings reported to the human, code NOT
      changed here without a separate escalation/ticket.
