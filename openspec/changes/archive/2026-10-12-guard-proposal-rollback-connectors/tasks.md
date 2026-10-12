## Standing Constraints

- [C1] New specs use `VerifiedEmbeddedPostgres.start`; every sbt run's output shows `[hel1468-guard]`.
- [C2] Count `connectors` (and credentials) by the exact owner id; any user row uses a unique throwaway `@example.test` email; never matt@helio.dev.
- [C3] No production behaviour change. If a repro is genuinely RED because of a real leak (apply Right, Auto Connector existed, still present after rollback), STOP and escalate to the orchestrator before any fix; a red from a harness defect is not a leak, fix the harness.
- [C4] Every guard is proven failable by a recorded, reverted mutation (red output in red-evidence.md).
- [C5] Never log or print credential values; no inline FQNs; comments per CONTRIBUTING.md.
- [C6] Heavy runs under `nice -n 19`; targeted `testOnly`, never more than one full `testFull` from this lane; shut down every sbt server started; MemAvailable >= 15 GB before heavy runs.

## 1. Repro (red-first attempt)

- [x] 1.1 Write the production-wired service spec for gap 1 (design D2: real PipelineRunService, fetch stub returning Left, assert apply Right first) and run it before touching any main code; record the result in red-evidence.md.
- [x] 1.2 Write the route-level combined-proposal test (D3); run and record.
- [x] 1.3 Write the newConnector tests (D4a, D4b); run and record.
- [x] 1.4 Write the cross-tenant test (D5); run and record.
- [x] 1.5 If any of 1.1-1.4 is red because of a real leak, STOP (C3).

## 2. Mutation proofs

- [x] 2.1 Mutation (a): no-op `removeUnadoptedConnector` -> 1.1/1.2 red; record; revert.
- [x] 2.2 Mutation (b): drop owner scoping cumulatively across the three layers (D6b) -> 1.4 red; record which layers; revert.

## 3. Comment corrections

- [x] 3.1 Correct `PipelineProposalService.rollback`'s scaladoc and the `implicitConnector = false` call (D7).

## 4. Verification

- [x] 4.1 Run the new specs plus `PipelineProposalImplicitConnectorCleanupSpec`, `DataSourceDeleteAutoConnectorSpec`, `DataSourceDeleteAutoConnectorRoutesSpec`, `InlineSourceCleanupUnifiedRuleSpec`, `InlineSourceLeakPathsRoutesSpec`, the CombinedProposal and FirstRun specs; all green with `[hel1468-guard]` visible.
- [x] 4.2 Scala code-quality / format checks and the pre-commit hook pass; write files-modified.md (bulleted backticked repo-relative paths).
