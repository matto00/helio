## 1. Red (before any main-code change)
- [x] 1.1 Route tests previewing output update and output delete asserting 200 + Output-level diff; run on unfixed tree, capture command and the observed 500 output

## 2. Fix
- [x] 2.1 Shared PatchSetApplyContext factory; wire outputRepo into PatchSetPreviewService; update ApiRoutes:538 and the 6 test fixtures (ClaudeRoutesChatGateSpec, RefinementRoutesSpec, PatchSetRoutesSpec, PatchSetPreviewRoutesSpec, PatchSetPreviewServiceSpec, RefinementServiceSpec)
- [x] 2.2 Remove `= null` default on context.outputRepo; typed ServiceError when outputRepo is null (apply and preview)
- [x] 2.3 PatchSetPreviewProjection cases for OutputUpdate/OutputDelete; decide/record Impact hint
- [x] 2.4 Audit table: every context field, every `== null`/Option guard, every ResolvedAction case x (kind, op) incl. output:create 400; resolve the Resolvers:673 boundOutputs degradation

## 3. Tests
- [x] 3.1 Structural parity test via shared factory; assert no null field in preview-built context
- [x] 3.2 Test previewing every ResolvedAction variant (no MatchError)
- [x] 3.3 Write-free test, full public-schema checksum, across the whole (kind, op) matrix
- [x] 3.4 pipelineStep delete preview boundOutputs equals apply's
- [x] 3.5 ExistenceNotLeakedRoutesSpec: add Output target to Seeded/targetIdOf, apply+preview rows for output:update/delete, remove exemptions (~:496-497)
- [x] 3.6 Mutation evidence: (a) drop outputRepo from preview context -> red; (b) insert a write in project() -> write-free test red

- [x] 3.7 Remove PatchSetApplyService outputRepo = null default (record in audit table); make 3.2 fail when a new ResolvedAction case is added (sealed-subclass reflection); paste 3.6 mutation output

## 4. Gates
- [x] 4.1 cd backend && nice -n 19 sbt testFull (never bare sbt test)

## Standing Constraints
- [C1] Gates run as `sbt testFull`, one full suite at a time; never bare `sbt test`.
