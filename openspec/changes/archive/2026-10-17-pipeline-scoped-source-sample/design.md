## Context

Verified at Setup (544bd79ea); paths under `backend/src/main/scala/com/helio` unless noted.
- `SourceSampleService.sample` authorizes with `DataSourceRepository.findByIdOwned` (RLS pool) and then reads through
  its own engine (`loadRowsWithStats`, `ConnectorResolveContext.Internal`). Route: `DataSourcePreviewRoutes` `/sample`,
  inside `rateLimited` (the `sourceFetchRateLimitDirective`, `ApiRoutes.scala:942`).
- RLS: `data_sources` is owner-only (V35); `pipeline_steps` is owner-only (V35) so a grantee cannot read steps on the
  app pool; `pipelines`/`pipeline_roots` SELECT allow owner or named grantee (V39, V98); a grantee sees only their own
  `resource_permissions` row. Revoke is a hard `DELETE` (`PipelinePermissionService.revoke`).
- Grantee runs (HEL-1492) do exactly what this needs: `findByIdShared(P, Some(user))` (grant visible under the caller's
  RLS), then `findGrantRole` = "editor" (`PipelineRunService.submit`), then privileged reads
  (`listRootDataSourceIdsInternal`, `pipelineStepRepo.listByPipelineInternal`, `DataSourceRepository.findByIdInternal`).
- Secondary source ids: `PipelineAnalyzeService.secondarySourceIdOf(op, config)` covers join/union/lookup
  (`SecondaryInput.Source`, non-empty), lanes excluded.
- Client: `usePipelineDetailPage.ts:184` passes root source ids to `useSourceSamples`, which skips non-owned ids. The
  page has no permission-only role signal: `ownerId` gives owner/not-owner, and analyze's `costVerdict.canRun` is
  `ownerOrEditor && configReasons.isEmpty` (`PipelineAnalyzeReads.scala:192-205`), false whenever a step is invalid.

## Goals / Non-Goals

Goals: an editor grantee samples exactly the sources a shared pipeline uses; every other case is an unknown-id 404.
Non-goals: draft-only references (HEL-1631), HEL-1652, upsert targets, form panels, any new limiter or migration.

## Decisions

**D1. Grant level: owner ruling pending (escalated; recommendation editor-only).** Written here as editor-only. The
sample's only consumer is the draft preview, which only owner/editor can save; a viewer already sees 10 raw root rows
via the any-grant step preview but never 1,000, nor a secondary source's raw rows. If the owner rules
`viewer-and-editor`, D3's role test becomes "any grant", the viewer scenario flips to 200, and D6's client signal
becomes `callerRole` in `owner|editor|viewer` (i.e. analyze answered). Viewer delta in full: a viewer cannot enable a step, so for a viewer D3 step 5 counts
roots and ENABLED steps' secondaries only (editors and owners keep "all steps"); flipped scenarios: "Viewer grantee"
→ 200, new "Viewer and a disabled step's secondary" → 404, store "Viewer opens a shared pipeline" → one scoped
request and a label, store/label "Viewer's card" removed.

**D2. Access rule on the existing route: `GET /api/data-sources/:id/sample?pipelineId=P`.** Same route class, so the
same `rateLimited` bucket by construction, same response schema, same 404 message. A new
`/api/pipelines/:p/sources/:s/sample` was rejected: a second mount would need its own limiter placement inside its own
`pathPrefix` (the HEL-505 "never charge unrelated requests" rule) and duplicates the error mapping. A malformed or
unknown `pipelineId` maps to the same 404 (never "Pipeline not found", which would leak pipeline existence).

**D3. Check order (new `SourceSampleService.sampleScoped` / one access function, all failures → the one NotFound):**
1. `findByIdOwned(S, user)` hit → existing owner path, `pipelineId` ignored (owners keep today's behaviour).
2. No `pipelineId` → 404.
3. `pipelineRepo.findByIdShared(P, Some(user))` → None → 404 (grant visibility proved under the caller's RLS).
4. Caller is P's owner, or `pipelineRepo.findGrantRole(P, user)` == `editor`; else 404.
5. Uses: `S ∈ listRootDataSourceIdsInternal(P) ∪ {secondarySourceIdOf(op, config) | step ∈ listByPipelineInternal(P)}`.
   All steps count, enabled or not (an editor can enable a step; disabling is not an access boundary). Else 404.
6. Only now `findByIdInternal(S)`; None → 404; image → 400 (as today); then the unchanged engine read.
The service doc comment states that the no-same-owner rule relies on every step-write path checking secondary
ownership with the writer's identity. Steps 3-5 are privileged reads only after the RLS-scoped grant proof, mirroring the run path. No same-owner test on
S: an editor may have added their own source as a secondary (`StepReferenceChecks.secondarySourceOwnershipF` checks the
editing user), and a run by any editor of P already reads it; "P uses S" is the ticket's rule.

**D4. Credentials and logging.** The engine read is the existing one (`Internal`, after the check). Log lines name
ids and exception classes only, as today; no rows, configs or credentials. A denied request logs nothing (no oracle).

**D5. Limiter.** Unchanged mount, so the scoped request is charged to the caller's own bucket (the directive keys on
the session user, or the token id for a PAT caller) including 404s; never the run guard (no `PipelineRunService` reference).

**D6. Client signal: new `callerRole` on the full analyze response** (`owner|editor|viewer`, required, permission
only; computed from the same owner test + `findGrantRole` already used for `canRun`, before the config-validity AND;
schema `schemas/pipelines/pipeline-analyze-response.schema.json` + `pipeline-analyze-api` delta + server and client
schema validation; concise mode untouched). Rejected: `canRun` (goes false on an invalid step, the very state the
draft preview serves); a field on `PipelineSummaryResponse` (served in lists, would cost a grant read per row).
**D6b. Sampleability is three-state per source:** `yes` (owned, or `callerRole` is owner/editor) → label and capture
as today; `unknown` (sources list not yet loaded, or the source is not owned and analyze has not answered) → today's
"Loading sample…" label, no request; `no` (not owned and analyze answered with `viewer`) → no label, no request.
Precedence: `callerRole` owner/editor wins over a failed sources list (a non-owned source is then sampled through the
scope; an owned one too, since the scope also admits the owner). "Analyze rejected" means no analyze result has ever
arrived for this pipeline on this page; a later failed re-analyze keeps the last known role. Failure mapping: a failed sources list keeps today's "Sample unavailable" (the existing label test at
`SourceSampleLabel.test.tsx:134` stays, re-pointed to the `unknown`-after-failure input); a rejected analyze makes a
non-owned source "Sample unavailable" with no request (we cannot know the role; no budget spent). The existing
"Loading sample…" test (`:54`) stays as the `unknown` case. Owned sources never wait for analyze.
**D6a. Client fetch.** `fetchSourceSample({sourceId, pipelineId?, force?})`; the service appends `?pipelineId=`
(encoded) when present. Nothing remembers a pipeline id per entry: `SourceSampleLabel` receives the page's scope as a
prop and its refresh sends the CURRENT page's `pipelineId` (an entry captured on P1 and refreshed on P2's page is
scoped to P2). `useSourceSamples(sourceIds, scope?: {pipelineId, canSampleShared})`: owned ids as today; non-owned ids
are requested with `pipelineId` only when `canSampleShared` (`callerRole` is `owner` or `editor`, after analyze
answers). The page passes the per-source three-state sampleability (D6b) to `SpineSourceCard` and the phone chips in
`PipelineDetailHeader`; a `no` card renders no `SourceSampleLabel` (a viewer would only ever see a failing
"Sample unavailable" with a refresh that 404s). Store keying stays by source id (same rows whichever path served them).

**D7. Schema/contract.** Response unchanged (`schemas/sources/source-sample-response.schema.json`); the new query
parameter is documented in the OpenAPI spec under `openspec/` if the route is listed there. A seam test proves the
client's scoped URL hits the server route and the server's scoped response validates against the committed schema.

**D8. Migration.** None: every read needed already exists on the privileged pool. If implementation finds one is
needed, it is V138+ (checked unclaimed on every branch) and must run as non-BYPASSRLS `helio`.

## Risks / Trade-offs

- [Grant revoked between the check and the read] → one sample served on a just-revoked grant; same window the run
  path has; accepted.
- [Analyze fails or is slow] → an editor's shared samples wait for or miss `callerRole`; label shows loading/absent.
- [Concurrent HEL-1582 edits `PipelineDetailHeader`/`usePipelineDetailPage`] → second to merge integrates.
- [Timing differences between 404 branches] → not addressed (no existing route does); body/status/headers identical.

## Migration Plan

None. Rollback is a revert.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit script is touched.

## Planner Notes

Self-approved: D2 (query parameter on the existing route), D3 ordering and "all steps count", no same-owner test
(every step write checks secondary ownership with the writer's identity, so a foreign source in P was added by its
owner), D6 `callerRole` on analyze, D6a (hide the label for non-sampleable sources; reversible UI). Design-gate round 1
revisions 1-4 applied. Escalated: D1 grant level (product call).
