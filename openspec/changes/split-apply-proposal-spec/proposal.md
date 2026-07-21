## Why

`backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` has grown to
~740 lines — well past CONTRIBUTING.md's ~400-line soft threshold. The single suite
now mixes core apply-proposal coverage, HEL-293 appearance mapping, V41
companion-binding rejections, HEL-316 v1.5 config parity, and HEL-321 timeline sort.
Splitting it along feature seams restores readability and keeps each file scannable.

## What Changes

- Extract the shared test fixture (embedded-Postgres + real-RLS pool setup,
  `beforeAll`/`afterAll`, seeded users/data-source/DataTypes, and the private request
  helpers) into a reusable base trait so it is not duplicated across files.
- Split the ~31 test cases from the single `should` block into cohesive sibling specs
  organized by feature area (core apply + shape/appearance, v1.5 config passthrough
  parity, V41 companion-binding rejections, timeline sort), each comfortably under
  ~400 lines.
- Move test cases verbatim — identical `in { }` bodies and assertion strings. No test
  semantics added, removed, or altered.
- No production code changes.

## Capabilities

### New Capabilities
<!-- None — this is a behavior-preserving test reorganization with no spec/contract change. -->

### Modified Capabilities
<!-- None — no requirement or contract behavior changes. -->

## Impact

- Test-only: `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala`
  and new sibling spec files (plus a shared fixture trait) in the same package.
- No production code, schema, or API contract touched.
- Verification: `sbt test` must be green with an identical total test count before and
  after (no tests silently dropped).
