## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (against main @ 2f495650, live tree)
- CR1 (D7/4.6): addressed. New OutputHistoryRoutesSpec, explicit `rolsuper OR rolbypassrls` assertion before 200/404, real resource_permissions grantee, non-grantee 404 byte-identical. Sound.
- CR2: addressed. Spec now says sparkline = exactly the returned points, oldest first; "limit narrows the sparkline but not the comparison" scenario distinguishes it. Consistent with D3 (no new query).
- CR3: addressed. Scenario fixtures (T-9d, T-8d, T-6d, T) and C7 make now-relative vs T-relative killable; empty-history scenario present.
- CR5: addressed and correct. `validateOutputFieldMapping` (PipelineService.scala:677) is called from both create (:645) and proposal grounding (:1520, `resolveOneProposalOutputAnalysis`). Note: its body returns `Right(())` early when no fieldMapping, so the compare check must be added independently of that branch (non-blocking, implementer must not nest it inside the `Some(mappingObj)` arm).
- D1 regex + Try(Duration.parse): `P1DT` passes the regex but throws in Duration.parse, caught by the Try, so 400. Fine.
- CR4 mechanism: `OutputHistoryCostMeasurementSpec` does have a counting Proxy (InvocationHandler, counts `execute*`), so the mechanism is real. But the numeric bound is NOT derivable as written (below).
- Authenticated derivation from real code: `withUserContext` = `set_config` select + action (2 executes) per call (DbContext.scala:50); `findById` 2, `findConfigById` 2, `listRecent` 1, `nearestAtOrBefore` 1, `earliest` 1 (each `withSystemContext` single query) = 7 for the service-level read. Public: `findAllByDashboardId` is count + slice = 2 executes (PanelRepository.scala:94-99, privileged), findByIdInternal 1, findConfigsByIdsInternal 1, history 3, plus AclDirective `ownerResolver` (dashboard findByIdInternal, 1) and `hasPublicViewerGrant` (1) = 9, comfortably under 20 (token-validator adds at most a few). Public bound OK.

### Verdict: REFUTE

### Change Requests
1. **The authenticated "≤ 7" bound is not derivable for what the spec/design say it counts.** design D3 and the spec ("Serving either history route ... counted across both connection pools"; task 4.10 "counting proxy on both pools" for "one request") count a whole HTTP request, but the 7 is the service-level sum only. A real request to `/api/outputs/:id/history` first passes `AuthDirectives.authenticate` -> `UserSessionRepository.findValidSession` (UserSessionRepository.scala:25-35), one more executed statement on the app pool (a PAT would add `findUserByTokenHash` plus `touchLastUsed`), so the request-level count is 8 (cookie session) in the worst case, and the proposed `<= 7` assertion would fail on first green. Revise either: (a) state the authenticated bound as 8 and enumerate it (1 session lookup + 2 + 2 + 3), and say which credential kind the spec uses; or (b) define the counting scope explicitly (counter reset after authentication / service-level `OutputHistoryService.read` call) in D3, the spec Requirement and 4.10, and keep 7. Pick one and make spec text, D3 and 4.10 agree. Likewise write the public enumeration (9 + token validator when `?token=` is used) rather than "a constant measured in the spec", so the 20 is a derived ceiling, not a guess.

### Non-blocking notes
- Implement the compare check in `validateOutputFieldMapping` outside the fieldMapping match (early `Right(())` otherwise skips it).
- The mutation for 4.10 (per-point query) should be shown to flip the equal-count assertion between 3 and 150 points; already planned.
