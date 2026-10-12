# HEL-1496: Proposal rollback after a successful apply (and proposal newConnector) can leave an implicit/created Connector behind

## Description

origin_kind: followup, origin_ticket: HEL-1475.

HEL-1475 made `PipelineProposalService`'s internal apply-failure cleanup remove the implicit "Auto:" Connector of a bare-url REST inline root. Two adjacent gaps remain.

**1. Public rollback after a successful apply.** `PipelineProposalService.rollback(response, user)` is called by `CombinedProposalService` (lines ~117/132) and `FirstRunDashboardService` (~145/148) when a later phase fails after a successful apply. It only receives the API response, which cannot say whether a REST source's Connector was call-created, so the source is deleted but its Auto Connector remains. FirstRun uses CSV sources (exposure nil today); CombinedProposal can hit this. Fix options: widen the signature so callers pass the per-source flag, or carry it internally. Do not add it to the API protocol.

**2. The proposal's own `newConnector` draft.** A Connector the proposal creates itself may need its own cleanup on rollback. Investigate whether it can leak.

Red-first, counting `connectors` by exact owner id.

## Restated scope (ticket-drift escalation resolved: proceed-with-restated-scope, driver decision recorded as escalation.answered)

Premise validation (evidence: premise-validation.md) found:
- Gap 1 is closed on main by HEL-1497 (#955): `DataSourceService.delete` itself removes an unadopted implicit Auto Connector after deleting a REST source, and `rollback` deletes sources through it. Not yet proven by a test on this path.
- Gap 2 is unreachable server-side: the backend never creates a Connector from a `newConnector` draft (an unresolved draft is rejected 400 before any write). The only Connector involved is one the user creates explicitly via `POST /api/connectors` before apply; it is kept on rollback today.

## Acceptance Criteria (restated)

1. A test reproduces gap 1 through the real services, production-wired (DataSourceService constructed with the ConnectorRepository): a successful `PipelineProposalService.apply` with a bare-url REST root, then the public `rollback(response, user)`, leaves `connectors` (and the connector's credential row) by exact owner id at the pre-apply count. Red-first was attempted and its result recorded; if it is genuinely red (a real leak), work STOPS and the driver is told before any fix.
2. A route-level test through the real `ApiRoutes` wiring drives `CombinedProposalService`'s post-apply rollback (a dashboard phase that fails after a successful pipeline apply) and asserts the same exact-owner connector count.
3. A test proves a `newConnector` draft apply creates no Connector and no source (exact-owner counts unchanged) and returns the 400.
4. A test characterizes today's behaviour for a user-explicit Connector (created via the connectors API, then referenced by `connectorId`): after rollback the source is gone and the explicit Connector is KEPT. No behaviour change; documented as an open owner question.
5. Cross-tenant: a test proves a rollback/delete by user A never deletes another user's unadopted implicit Auto Connector even when A's source row references it.
6. Each guard is proven failable by mutation, recorded with the red output: (a) disable the HEL-1497 connector cleanup in `DataSourceService.delete` -> the gap-1 tests go red; (b) remove owner scoping from the connector cleanup lookup/delete -> the cross-tenant test goes red. Mutations are reverted before commit.
7. The stale `rollback` scaladoc and the misleading `implicitConnector = false` call are corrected to state that `DataSourceService.delete` (HEL-1497) is what removes the Auto Connector on this path. No production behaviour change.
