# HEL-1648: Live preview: editors on a shared pipeline get "Sample unavailable"; add pipeline-scoped sample access

## Description

Follow-up of HEL-1628 (PR #1053, 3d9e5a6cb), which added `GET /api/data-sources/:id/sample`. It is **owner-only** (`findByIdOwned`, the same as `/preview`), and the client hook skips sources the caller doesn't own. An **editor grantee on a shared pipeline** (HEL-1492 lets editors run shared pipelines) therefore sees "Sample unavailable" on every source card. Once (e) HEL-1631 wires the live draft preview, collaborators get no preview at all.

**Fix:** a pipeline-scoped sample path. The caller may sample a source when they hold a grant (viewer or editor; decide which in design) on a pipeline that **uses** that source as a root or secondary (join, union, lookup). For example, `GET /api/pipelines/:pipelineId/sources/:sourceId/sample`, or an access rule on the existing route.

- Same HEL-505 source-fetch limiter bucket, keyed to the caller.
- Never the pipeline-run guard.
- Credentials resolve with `ConnectorResolveContext.Internal` only after the access check, as HEL-1628 does.
- No row logging.

**Security (the main risk):** a grant on pipeline P must not let someone sample source S unless P actually uses S. Prove it on `TwoUserRlsApiFixture` (a NOBYPASSRLS role) with negative cases: unrelated source, revoked grant, and a source removed from the pipeline.

## Acceptance Criteria

- An editor grantee gets the sample on a shared pipeline.
- A non-grantee and an unrelated source get a 404 byte-identical to an unknown id's.
- A limiter proof, as in `SourceSampleRoutesSpec`.
- The schema is unchanged, or extended in the same change.
- The client hook samples granted sources.

## Order

Before (e) HEL-1631. Parent epic HEL-1570. Blocks HEL-1631.

## Driver brief (claims to verify, binding house rules)

- Negative cases, each a 404 byte-identical to an unknown id's, on `TwoUserRlsApiFixture` (NOBYPASSRLS): unrelated source; revoked grant; source removed from the pipeline; a viewer (if viewers are excluded); a stranger.
- Which grant levels may sample is a product call, escalated with a recommendation unless already settled.
- Same HEL-505 source-fetch bucket keyed to the caller, with a limiter proof; never the run guard; `ConnectorResolveContext.Internal` only after the access check; never log row contents.
- Schema and contract in the same change with a seam test; the client hook samples granted sources; the label shows correctly for an editor, verified on the running app in both themes.
- Migration only if needed: next free number after V137, unclaimed on any branch, works as the non-BYPASSRLS prod Flyway role `helio`; any new SECURITY DEFINER function needs `GRANT EXECUTE` in fixtures that `SET ROLE`.
- Concurrent lanes HEL-1584 (motion) and HEL-1582 (mobile pipeline page; `PipelineDetailHeader`/`usePipelineDetailPage`/phone sample label): the second to merge integrates.
