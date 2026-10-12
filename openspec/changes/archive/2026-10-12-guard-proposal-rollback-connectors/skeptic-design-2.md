## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD a369a9cb84a0966adb3c8c9d515838ebfbf6bb15 on branch task/guard-proposal-rollback-connectors/HEL-1496. The change dir is untracked. The restated scope is the driver's recorded decision and I did not re-argue it.

### What I verified (with evidence)

**Round-1 CR1 (D2 harness): ADDRESSED.**
- design.md D2 now requires three things: (ii) a REAL `PipelineRunService`, (iii) a fetch stub that returns `Left`, and an explicit assertion that apply returned `Right` before the public `rollback`. D1 and C3 now both say that a red from a harness defect (an exception, a null collaborator, the wrong path taken, or apply not returning `Right`) is not a leak and does not trigger the STOP. tasks 1.1 restates all three.
- I checked the code to confirm that this harness reaches the path under test:
  - `SourceService.createRest` with a bare url and a non-null `connectorRepo` creates the Auto Connector first, then calls `createRestWithConfig`.
  - `CreateSourceEnvelope.build`, on a driver `Left`, sets `fetchError = Some(err)` and still returns `Right`. The source is kept.
  - `PipelineProposalService.finishPipeline` (:509-526) sees `fetchFailed.nonEmpty` and calls `pipelineRunService.recordUnrunnable`, which returns `Right(PipelineProposalApplyResponse(...))`. `submit` and `rollbackAll` are never reached.
  - `recordUnrunnable` (PipelineRunService.scala:222+) needs only `pipelineRunRepo`. The real constructor at FirstRunDashboardServiceRollbackSpec.scala:58-61 is a usable template.
  - The response's `sources` carries the created source, so the public `rollback` (:447-450) goes through `cleanupSource`, then `DataSourceService.delete`, then `removeUnadoptedConnector` (DataSourceService.scala:733). That last step happens only when `connectorRepo` is passed (:76-77), and D2(i) requires it.
- The existing `PipelineProposalImplicitConnectorCleanupSpec` already builds `SourceService(..., connectorRepo = connectorRepo)`. So borrowing its setup gives a SourceService that can create the Auto Connector. D2 correctly limits the borrowing to the DB setup and swaps the null run service and the `Right` fetch stub.

**Round-1 CR2 (D3 non-vacuity and 422): ADDRESSED.**
- D3 now says: "Non-vacuity for D3 is its OWN red under mutation D6(a), required, not a fallback to D2". It also requires asserting the post-apply `422` from `applyDashboardPhase`, not a pre-apply `400`. The "rely on D2" fallback is gone. tasks 2.1 names both 1.1 and 1.2 as going red under (a).
- I checked reachability again:
  - `CombinedProposalService.apply` runs the pre-apply checks, then `pipelineProposalService.apply`. If the pipeline apply returns `Right`, `applyDashboardPhase` calls `resolveSentinelOutputId`. For a sentinel panel with zero Outputs that returns `UnprocessableEntity`, and the public `rollback` runs.
  - `validateOutputs` (PipelineProposalService.scala:313-317) folds over an empty vector and returns Right, so a zero-Output pipeline proposal is accepted.
  - With a `Left` fetch stub, the pipeline apply returns `Right` (blocked run), as described for D2.
  - Under mutation (a), the production-wired `DataSourceService` would leave the Auto Connector behind, so D3 can go red on its own.

**Round-1 non-blocking notes: all folded in.**
- D6(b) names the three owner-scoping layers (cleanup `findByIdOwned`, repo `delete` precheck at ~:295, the owner filter on the delete at ~:303). It requires removing them cumulatively and recording which ones had to go.
- D2 counts credentials by `connector_credentials.user_id`.
- D7 covers the `response.source` to `sources` scaladoc fix. I confirmed the singular wording is still present at PipelineProposalService.scala:442.
- D5 drops the cross-tenant proposal-rollback variant and gives the reason (apply rejects a foreign `connectorId`).
- The design's Risks section lists all three server-side Connector creators.

**Structure:**
- Each restated AC maps to a task:

  | AC | Design | Task |
  | --- | --- | --- |
  | 1 | D2 | 1.1 |
  | 2 | D3 | 1.2 |
  | 3 | D4a | 1.3 |
  | 4 | D4b | 1.3 |
  | 5 | D5 | 1.4 |
  | 6 | D6 | 2.1/2.2 |
  | 7 | D7 | 3.1 |

- There are no TODO/TBD placeholders.
- There is no API or schema change, so `skip_specs` is consistent.

### Verdict: CONFIRM

### Non-blocking notes
1. D2's step list still contains the phrase "(stubbed fetch, as the existing spec does)". The existing spec stubs a `Right` fetch. Point (iii) of the same decision overrides this with a MUST (`Left`), so the meaning is clear. The executor should follow (iii).
2. The design's Risks section contains a fallback for D3: "if none exists without fault injection ... narrowest test seam". D3's required post-apply 422 is reachable, as verified above, so that fallback should not be needed. If the executor uses it, the evaluator should treat that as a deviation that needs justification.
3. proposal.md still words the owner question as only the UI "set up connector" step. The PR body should use the broader wording from the design's Risks section: the UI, MCP `create_connector`, and the pending-connector flow.
