## Context

HEL-1727 added `PipelineRootDryRun.capFetchError` (500 code points, marker ` … [truncated]`, `codePointCount` guard
before `offsetByCodePoints`) and applied it only at the propose-time dry run. The body-bearing text is built in exactly
two places, `RestApiConnectorDriver.issueAndParse` (`HTTP $code: $body`) and `issueTest`
(`HTTP $code: ${entity.data.utf8String}`). Every other consumer receives the driver's `Left(err)` unchanged. Owner
ruling: cap at the driver, all paths.

## Goals / Non-Goals

Goals: one shared cap function; applied at both builders; dry run keeps using it; red-first tests for the
`test_connection` result, the apply blocked-run reason and the driver.

Non-goals: a new cap value; changing SQL driver error text (no remote body; already curated per HEL-311); capping
other error text (ContentSourceSupport omits the body); any API shape change; helio-mcp change.

## Decisions

1. **Shared helper location: `com.helio.domain.connectors`** (e.g. `object RemoteErrorText { val MaxCodePoints = 500;
   def cap(s: String): String }`). `PipelineRootDryRun` is `private[services]`, so the driver cannot reach the current
   helper; placing it in the domain layer also adds no new domain->services edge (the tree already has some, e.g.
   `RestApiConnectorDriver.scala:7`, so this is not a strict layering rule). `PipelineRootDryRun.capFetchError` and
   `FetchErrorMaxCodePoints` delegate to (or are replaced by references to) it; the value 500 and the marker are
   defined once. The comment linking 500 to `HomeSummaryLimits.ErrorLogMax` moves with it.
2. **Cap the whole `HTTP <code>: <body>` string**, the same unit HEL-1727 caps (its test expects
   `"HTTP 500: " + 490 x + marker`), not the body alone.
3. **Idempotence.** The dry run re-applies the cap to text the driver already capped. `cap(cap(x)) == cap(x)`: a capped
   string's first 500 code points are the same prefix, so re-capping yields the same string. A test pins this.
4. **Tests must go through the real driver.** Existing apply/assistant tests stub the connector or `SourceService`, so
   a driver-level fix would not turn them red. The `test_connection` and apply tests SHALL use the real
   `RestApiConnectorDriver` against a local stub HTTP server returning an oversized body (with whatever egress-guard
   override the existing local-server specs use), asserting the exact capped text including the marker. The
   surrogate case builds the body so the astral character straddles code unit 500 of the full error text.
5. **helio-mcp**: it relays backend text only; no change. Confirm by grep during execution; if a change proves
   needed, it is source only and the PR notes the MCP redeploy.

## Risks / Trade-offs

- Stored `fetchError` / run `error_log` lose the tail of a long body. Accepted by the owner ruling; 500 code points
  keep the status and useful head of a JSON error.
- Existing tests that assert a full long body would need updating; any such change must be named in the PR as a
  consequence of the ruling, not a fixture tweak to make tests pass.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit script is touched.
