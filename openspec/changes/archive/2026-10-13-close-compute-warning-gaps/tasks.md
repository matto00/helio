## Standing Constraints

- [C1] Owner ruling: wrong-type literals are a NON-BLOCKING warning (`literal-type-mismatch`), never an analyze `validationError` / D6b error path.
- [C2] Do not edit TimestampParsing, ExpressionDateTimeFunctions or cast/datebucket date handling (HEL-1502 owns them).

### Backend

## 1. Backend

- [x] 1.1 Add `string-body` to `ExpressionTypeInference.TextLike`; verify `$sb + 1` infers `string` in a unit test
- [x] 1.2 Bound StrictParser nesting at 100, add the legacy token pre-check, and an iterative tree-depth limit of 200 in parse/parseLegacy; verify the red-first depth tests now pass
- [x] 1.3 Add `substring` start/end as a numeric context in `ExpressionNumericContexts`; verify the substring scenario test
- [x] 1.4 Add the `text-function-on-numeric-field` scan plus an `ExpressionEvaluator` accessor; verify unit tests
- [x] 1.5 Add the `literal-type-mismatch` scan (string literal in a numeric context, number literal in a text fn); verify unit tests
- [x] 1.6 Per-column trust: `Flags.untrusted`, its propagation, and per-side join/lookup key trust; verify the spec tests
- [x] 1.7 Emit both new warnings from `AnalyzeSchemaWarnings` (new code constants; literal warning not trust-gated); verify spec tests
- [x] 1.8 Update the `PipelineAnalyzeProtocol` doc and the response JSON schema enum; verify the schema-drift check passes

### Frontend

## 2. Frontend and MCP

- [x] 2.1 Extend the `AnalyzeWarningCode` union; confirm StepCard renders any code generically; verify `npm run typecheck`
- [x] 2.2 Extend `helio-mcp/src/types.ts` and the tool-description code lists; verify helio-mcp build and tests
- [x] 2.3 Update docs/compute-expression-grammar.md (per-column trust, new codes, string-body in +, depth limits); verify by grep

### Tests

## 3. Tests

- [x] 3.1 Red-first: deep `-`, deep brackets, legacy `x + ((…))` and a 10000-term flat chain each throw StackOverflowError on main; record, then confirm parse errors after 1.2, and the four depth-200 worst shapes pass on a 512 KB-stack thread (design 6c)
- [x] 3.2 Deliberately invert NumericOpOnTextFieldWarningSpec.scala:128 (the per-step trust assertion) under owner ruling 2, with a comment saying so. AnalyzeSchemaWarningsSpec: every new spec scenario, including floor($body + 1), floor($flag + 1), CSV->compute(total)->floor($price), the join/lookup left, right and lane key scenarios, literals behind coalesce/if not warning, and a mixed-trust 4a argument not warning
- [x] 3.3 Item 3 regression: cast price->float then floor($price) is silent; cast to a legacy target is still untrusted
- [x] 3.4 Mutation check: revert each fix in turn (TextLike, untrusted propagation, depth guard) and confirm a test goes red
- [x] 3.5 Run backend `sbt testFull` (HELIO_TEST_JVM_XMX=3g, nice -n 19), frontend jest (max 3 workers), lint, typecheck; all pass
- [x] 3.6 Dev DB: read user 21d2ffee-a560-47e5-a97b-e370153ac6c9's exact email, then delete it by exact (id, email) with buildUserDeleteSql; record before/after counts
  - Recorded: read id + email (skeptic-hel1403-1791586664@example.test) from local dev Postgres; deleted by exact (id, email) via buildUserDeleteSql. Counts before -> after: users 13134 -> 13133, target row 1 -> 0 (its pipelines 0, dashboards 0).
