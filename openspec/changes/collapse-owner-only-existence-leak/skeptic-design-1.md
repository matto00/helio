## Skeptic Report — design gate (round 1, skeptic-design)

### What I verified (with evidence)
- Read ticket.md, proposal, design, tasks, spec delta; checked against live code.
- AccessCheckerImpl.scala:38 and :71 are the two Forbidden oracle arms; AclDirective.scala:55,125 the directive twins; ShareTokenService.scala:41-48 holds mapForbiddenToNotFound -- all as the design claims.
- Grepped every Forbidden producer in backend/src/main; D1 table covers them. Spot-checked the "verify" rows: PanelService.submitForm:130-134, PatchSetApplyResolvers:374, DashboardService delete/duplicate:158/178 all follow findById(..., Some(user)) (visibility-filtered, so 403 after it is non-oracle, and design comment says Grantee->403 intentionally); PipelineRunService:232/583 and PatchSetApplyResolvers:125 are post-findByIdShared grantee checks (legit).
- Every ticket AC maps to a task: identical status/body (1,3,D3), parametrised red-first tests (2.1, D5c), mapping removal (3.4), frontend/live both themes (4.1/4.2), helio-mcp (D6/4.1), PublicRouteOwnerIdLeakSpec (5.1). Owner ruling reflected (global, no opt-in, legit 403s kept). No placeholders; no schema change needed.

### Verdict: CONFIRM

### Non-blocking notes
- Directive owner-only path (authorizeResource) has no grant lookup, so a grantee hitting a directive-guarded owner-only route gets 404, while service-layer requireOwnerOnly gives a grantee 403. Not a leak (404 is safe) but inconsistent; executor should note it in the classification table.
- Executor should confirm that findById(Some(user)) really filters to visible-only for dashboards/pipelines/panels (PanelService.submitForm and PatchSetApplyResolvers:374 depend on it); if it returns foreign rows, those 403s are oracles and must flip.
- Completeness guard in D5(c) should key on grep of route sources, as designed; make sure it also covers sites reaching services' DashboardService.delete/duplicate and PipelineRun paths, not only the four helpers.
