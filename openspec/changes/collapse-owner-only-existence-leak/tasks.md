## 1. Enumerate and classify
- [x] 1.1 Enumerate every `Forbidden` producer (grep Forbidden / StatusCodes.Forbidden / TierForbidden across backend/src/main); write the classification table (D1) into the PR body and handoff, verifying each "verify" row against live code.
- [x] 1.2 Enumerate every route reaching requireOwnerOnly / requireAccess / authorizeResource / authorizeResourceWithSharing (the route table for the parametrised spec).

## 2. Red-first tests
- [x] 2.1 Write the parametrised route-level spec (D5c, byte-identical body, completeness guard) and the AccessCheckerImpl + AclDirective unit specs; run on main code and record the red output.

## 3. Fix
- [x] 3.1 AccessCheckerImpl.requireOwnerOnly per D2; requireAccess no-grant -> NotFound(notFoundMessage).
- [x] 3.2 AclDirective.authorizeResource and authorizeResourceWithSharing no-grant arms -> 404 with the notFoundMessage body.
- [x] 3.3 Convert any additional oracle sites found in 1.1; leave legit 403s.
- [x] 3.4 Remove ShareTokenService.mapForbiddenToNotFound (D4).
- [x] 3.5 Update existing specs that asserted 403-for-no-grant; keep Viewer/tier/PAT 403 assertions.
- [x] 3.6 Confirm green; run one mutation per site class (revert -> red) and record.

## 4. Frontend and helio-mcp
- [x] 4.1 Find and update 403-keyed handling in frontend/src and helio-mcp/src; add/adjust tests.
- [x] 4.2 Live-check (both themes) a stranger's resource URL shows the normal not-found state.

## 5. Docs and gates
- [x] 5.1 Update CONTRIBUTING.md/docs if they describe the 403 arms; confirm PublicRouteOwnerIdLeakSpec unchanged and green.
- [x] 5.2 `cd backend && nice -n 19 sbt testFull`, frontend lint/typecheck/test, helio-mcp tests; report known flakes by name.

## Notes from design gate (non-blocking, binding on executor)
- Directive layer has no grant lookup: a grantee reaching an owner-only route via the directive gets 404 (not a leak); service-layer requireOwnerOnly gives a grantee 403. Record in the classification table.
- Verify `findById(..., Some(user))` returns only rows the caller can see; PanelService.submitForm and PatchSetApplyResolvers dashboard `ownerId != user.id` depend on it. If it returns foreign rows, those 403s are oracles and become 404.
- The completeness guard must also cover service-layer paths (DashboardService delete/duplicate, pipeline-run paths), not only routes calling the four shared helpers.
