## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (against live tree, HEAD 2f495650)
- Round-2 CR1 resolved as option (b). Spec Requirement "Bounded query count", design D3 and task 4.10 now all say the same thing: counting starts at the route with an already-resolved caller, session/token authentication excluded; authenticated <= 7; anonymous public <= 9. No remaining disagreement between the three.
- Authenticated 7 re-derived from code: OutputRepository.findById and findConfigById each use ctx.withUserContext (set_config + action = 2 executes each); listRecent, nearestAtOrBefore and earliest are single withSystemContext statements (per L1). 2+2+3 = 7.
- Public 9 re-derived: AclDirective.authorizeResourceWithSharing (anonymous branch) = ownerResolver 1 + permissionRepo.hasPublicViewerGrant 1; the token validator is only consulted when that returns false, so excluding ?token= is coherent; resolvePanelOutput = findAllByDashboardId (count + slice = 2, per round-2 reading of PanelRepository) + outputRepo.findByIdInternal (1, withSystemContext); findConfigsByIdsInternal 1 (withSystemContext); history 3. Total 9.
- Route-scope is achievable: OutputRoutes is `new OutputRoutes(outputService, user)` (user already resolved; OutputRoutesSpec:175 does exactly this) and PublicDashboardRoutes takes `userOpt` plus `aclDirective` (PublicProvenanceRoutesSpec:101 constructs it with userOpt = None). The ACL directive is invoked inside PublicDashboardRoutes.routes, so it falls within the counted scope. A counting-proxy spec can therefore build both directly.
- Compare check placement: PipelineService.validateOutputFieldMapping (line ~677) returns Right(()) from its `case None` arm when no fieldMapping; D2 and task 1.4 explicitly place the compare check before that early return, so it always runs. Sound and consistent.
- Looked for new defects introduced by revisions: D1 grammar (regex then Try(Duration.parse), >0, <=365d), D5 public type allowlist, D7 NOSUPERUSER proof, D8 fixtures, ACL-before-history ordering on both routes — no contradictions or placeholders found. All ticket ACs (nearest-before + null/availableFrom, non-grantee 404, bad compare 400, bounded query count, schemas + seam test, non-BYPASSRLS proof, HelioRouteTest, L1 repo reuse, no migration) map to tasks 4.2-4.10 / 3.4 / 4.6.

### Verdict: CONFIRM

### Non-blocking notes
- The ≤9 public figure relies on findAllByDashboardId being count + slice; if the implementer measures a different number, re-derive and update spec/D3/4.10 together rather than loosening the bound.
- Authenticated route-scope excludes session auth by design; the spec should build the OutputRoutes with a fixed user (as OutputRoutesSpec does) so the exclusion is automatic.
