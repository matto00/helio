# HEL-279: Add sharing grants for pipelines (analogous to dashboard sharing)

## Context

Surfaced during HEL-265 (now closed). After CS2 (pipeline ACL enforcement), every pipeline read is **owner-only** — there is no `resource_permissions` analog for pipelines. Dashboards have viewer/editor grants and a public-viewer fallback; pipelines have neither.

This is fine for v1.3 because pipelines are mostly authoring artifacts (not consumption surfaces), but it'll bite once we have multi-user teams collaborating on shared pipelines or scheduled pipelines that a non-author needs to monitor.

## Why this didn't block HEL-265

HEL-265 was about enforcement, not adding new sharing primitives. The owner-only repo predicate is correct; adding a sharing layer is a feature.

## Scope

* Extend `resource_permissions` to accept `resource_type = 'pipeline'`
* Grant roles: viewer (read pipeline + runs + steps), editor (mutate steps + trigger runs, NOT delete or transfer ownership), owner (everything)
* Repository update: `PipelineRepository.findById(id, callerOpt)` becomes sharing-aware (mirroring dashboards CS4)
* Routes: `requireRole(Editor)` for mutation endpoints; viewer can read all GET endpoints
* Pipeline run SSE stream: viewer grantees can subscribe (read-only)
* No public-viewer fallback for pipelines (no anonymous use case)

## Acceptance Criteria

1. Pipeline owner can grant viewer or editor role to another user via the existing share UI extended for pipelines
2. Viewer grantee can read pipeline + steps + runs + stream events; cannot mutate
3. Editor grantee can mutate steps + trigger runs; cannot delete the pipeline or transfer ownership
4. Cross-user with no grant → 404 (current CS2 behavior preserved)
5. Test matrix: owner / editor grantee / viewer grantee / cross-user no-grant — same pattern as DashboardPanelAclSpec
6. Frontend share dialog supports pipelines

## Related

* Parent chain: HEL-265 (closed) — established the owner-only baseline
* Pattern reference: CS4 dashboard sharing — mirror its design
* Coordinate with HEL-272 (RLS) — sharing-aware policy is part of HEL-276 once this lands

## Implementation Notes (from orchestrator)

Mirror the existing dashboard CS4 sharing implementation:
- Study how dashboards do resource_permissions, sharing-aware repository predicates, requireRole on routes, and the share dialog
- Replicate the same pattern for pipelines
- No public-viewer fallback (no anonymous pipeline use case)
- Cross-user with no grant → 404

### Test matrix (from DashboardPanelAclSpec pattern)
- owner: full access
- editor grantee: read + mutate steps + trigger runs, no delete/transfer
- viewer grantee: read-only (pipeline + steps + runs + SSE stream)
- cross-user no-grant: 404

### Frontend
- Extend the existing share dialog to support pipelines
- This is a UI-bearing feature; evaluator/skeptic should do a Playwright walkthrough of the pipeline share flow
