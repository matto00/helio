## Standing Constraints

- [C1] Every visibility predicate is owner = caller OR grant with grantee_id = caller; grantee-less (public) and third-party grants never confer visibility; proven by a third-party-grant fixture and a grantee-drop mutation.
- [C2] No hidden referencing resource's id or name reaches a response body, message, or a warn+ log (trigger text and exception messages included).

## 1. Inventory

### Backend

- [x] 1.1 Re-derive design D1's reference table from all migrations + domain codecs (grep evidence in files-modified.md or a probe note); add any missed live kind
- [x] 1.2 Probe pre-fix teardown: superuser pool BLOCKS but NAMES a hidden ROOT pipeline (leak, RLS masked; join commits there too); non-superuser MISSES it (join/multi-root commits, sole root P0001)

## 2. Reference finder

### Backend

- [x] 2.1 Add `DataSourceReferenceRepository` (privileged pool, set-of-ids API) with R1 moved from `DataSourceRepository.rootReferences`; compiles
- [x] 2.2 Add R2/R3 step matching: unfiltered privileged scan, op filter, set-of-ids prefilter via bound params (never interpolated), decode only `secondaryInput`/`target` (NOT `findUpsertWriteEdges`, which is visible-only); disabled steps still count
- [x] 2.3 Add R4 form-panel matching joined to dashboards
- [x] 2.4 Add explicit pipeline and dashboard visibility predicates mirroring `helio_can_access_pipeline` / `helio_can_access_dashboard` (cite both)

## 3. Delete guard

### Backend

- [x] 3.1 Switch `DataSourceService.delete` to the finder; additive `pipelines[].references` and `panels[]` in the 409 body and protocol
- [x] 3.2 Reason text names visible refs and counts hidden ones; scrub race-path warn log to source id + SQLSTATE (C2)
- [x] 3.3 Audit the five `DataSourceService.delete` callers (design D5); fix any rollback ordering that would now 409

## 4. Teardown

### Backend

- [x] 4.1 Privileged pre-check in teardown (also on dryRun) with exemption = caller-owned AND tagged T; conflicts never name hidden refs
- [x] 4.2 Keep in-tx root check as identity-free block only (comment); pre-check reads tagged sets with explicit owner+tag; P0001 text reaches no body/warn+ log

## 5. Frontend and MCP

### Frontend

- [x] 5.1 `sourcesSlice` parses `panels`/`references` tolerantly; Jest covers absent fields
- [x] 5.2 Notice: composes its copy from the structured fields (hidden counts stated, no raw ids, each reference once), handles panel-only and hidden-only cases, panel links to `/dashboards/:dashboardId`; running app, light+dark
- [x] 5.3 Update helio-mcp `delete_data_source` description; add `schemas/sources/data-source-delete-conflict-response.schema.json`; helio-mcp tests/typecheck pass

## 6. Tests

### Tests

- [x] 6.1 Route specs: 409 per kind (root, join, lookup, union, upsertTarget, form panel, disabled step); 204 for lane/newSource/empty-draft; no DB internals
- [x] 6.2 Non-superuser two-pool spec: hidden R1-R4 block delete unnamed; visible named; third-party-grant + public-grant fixtures stay unnamed (C1)
- [x] 6.3 Non-superuser two-pool spec: teardown blocked by hidden root and hidden join, unnamed; red on pre-fix recorded per scenario (sole root = P0001, else commit)
- [x] 6.4 Teardown specs: in-batch exemption; foreign T-tagged referencing pipeline blocks uncounted; untagged-dashboard form panel blocks; superuser-pool spec: hidden name/id absent
- [x] 6.5 Rollback test(s) for any D5 caller that can create a reference then delete the source (audit in probe-notes.md: no D5 caller can create a reference to its own just-created source and delete it out of order; existing rollback specs run in the full gate, so no new test)
- [x] 6.6 Mutations recorded: drop each kind's matcher; predicate -> `true`; drop `grantee_id = caller`; each turns a named test red; a log-capture test pins C2
- [x] 6.7 Gates: `nice -n 19 sbt testFull`, frontend lint/typecheck/test, helio-mcp tests all pass
