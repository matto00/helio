## Standing Constraints

- [C1] RLS sample specs use `dataset` sources (the fixture's stub file system turns a CSV into a post-check "Data file not found" 404 that would masquerade as a denial); each negative asserts status, body and content type equal to an unknown id's.
- [C2] Implement editor-only (D1 recommendation) while the owner escalation is open; Delivery does not start until the owner's recorded answer exists, and a viewer-and-editor ruling applies D1's stated delta before Delivery.
- [C3] Never log row contents, configs or credentials; never reference `PipelineRunService` from the sample path; scratch only under /home/matt/Development/helio/.concertino/scratch/HEL-1648/.

## 1. Repro

- [x] 1.1 Before any code change, reproduce on the running worktree app: editor grantee on a shared pipeline sees "Sample unavailable" (screenshot to the run scratch dir) and the unscoped `/sample` 404

## 2. Backend

- [x] 2.1 Add the D3 pipeline-scoped access path to `SourceSampleService` (owner path unchanged; one NotFound for every denial)
- [x] 2.2 Accept optional `pipelineId` on `GET /api/data-sources/:id/sample` in `DataSourcePreviewRoutes`; malformed id → same 404
- [x] 2.3a Add permission-only `callerRole` to the full analyze response (protocol, service, schema)
- [x] 2.3 Wire `pipelineRepo`/`pipelineStepRepo` into `SourceSampleService` in `ApiRoutes`; no run-guard reference
- [x] 2.4 Document `pipelineId` and `callerRole`: CLAUDE.md endpoint entry (no longer "Owner-only"), OpenAPI under `openspec/` if listed, `docs/live-draft-preview.md` §4 note

## 3. Frontend

- [x] 3.1 `fetchSourceSample` and `dataSourceService` accept `pipelineId`; label refresh sends the current page's `pipelineId` (prop), never a stored one
- [x] 3.2 `useSourceSamples(sourceIds, scope)` requests non-owned ids with the scope only when `canSampleShared`
- [x] 3.3 `usePipelineDetailPage` passes `{pipelineId, canSampleShared: callerRole is owner|editor}` and the per-source three-state sampleability (D6b)
- [x] 3.3a Three-state sampleability (D6b): yes/unknown/no, failed list and rejected analyze mapping; owned sources never wait for analyze
- [x] 3.3b Mirror `callerRole` in `frontend` analyze type and `helio-mcp/src/types.ts`
- [x] 3.4 `SpineSourceCard` and `PipelineDetailHeader` phone chips render no sample label for non-sampleable sources

## 4. Tests

- [x] 4.1 `TwoUserRlsApiFixture` spec: editor root 200, secondary (join, union, lookup) 200, a third user's secondary 200, a step with an undecodable legacy config counts as no use; schema-valid
- [x] 4.2 Same spec negatives, each byte-identical (status, body, content type) to an unknown id: unrelated source, revoked grant, source removed (root and secondary), viewer, stranger, no `pipelineId`, empty, unknown and malformed `pipelineId`
- [x] 4.3 Mutation proofs: dropping the "uses" check and dropping the role check each turn 4.2 red (logs in evidence)
- [x] 4.4 Limiter proof: B's scoped requests exhaust B's bucket (shared with `/preview`), 429 + Retry-After, A unaffected, run-guard tables unchanged
- [x] 4.5 Client unit tests: hook scope/canSampleShared (editor with an invalid step still samples), thunk URL, refresh on P2 scoped to P2, label hidden when not sampleable, unknown shows "Loading sample…" with no request, failed list and rejected analyze map per D6b; existing label tests (`:54`, `:134`) kept and re-pointed, not deleted
- [x] 4.5a Analyze `callerRole`: owner/editor/viewer, editor with an invalid step is `editor` while `canRun` false; server + client schema validation
- [x] 4.6 Seam test: client scoped request URL ↔ server route, response validates the committed schema
- [x] 4.7 Playwright/running app: editor sees the sample label (desktop + phone, light + dark); viewer sees none; screenshots to evidence
