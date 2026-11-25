## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: c3755f0d3b34ba28d48f64a195d718543dd19cf1. Diff base, resolved live with
`resolve-review-base.sh <wt> main origin` (exit 0): 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c.
Changed code: `RemoteErrorText.scala`, `RestApiConnectorDriver.scala`, `ContentSourceSupport.scala`, and three test
files. Everything else is under `openspec/changes/bound-rest-response-read/`.

### Phase 1: Spec Review — PASS
- **AC1 (a large error body never makes the driver hold more than a small amount, measured):** met.
  - `/endless` is a paced stream that never ends. The server counts the bytes it sends for each request, and the spec
    reads that count when the driver future completes. Bound: <= 5120 bytes, on fetch and on connection test.
  - `/huge` is 64 MiB. Bound: < 8 MiB on both paths.
  - The helper spec counts the bytes pulled from an infinite source and checks that the source was cancelled.
  - My own run measured: /endless 4096 / 4096 bytes; /huge 983040 (fetch) and 851968 (test); fetchUrl /endless 512;
    helper 4096 pulled.
- **AC2 (capped text unchanged for ordinary bodies):** met.
  - The literal `/big`, `/surrogate` and `/short` cases are unchanged.
  - New `/multibyte` and `/malformed` cases are expected to equal `cap` of the full body.
  - The byte-identity argument (design D2) holds: 490 body code points need at most 1960 bytes plus 3 bytes of decoder
    lookahead, well under 4096. A body cut at 4096 bytes decodes to more than 1000 code points, so both the old and the
    new text carry the marker. Bodies of 4096 bytes or fewer are read whole.
  - Mutation M1 shows this guard can fail (see Phase 2).
- **AC3 (success path unchanged, or its new limit stated and tested):** met.
  - I checked `maxStrictBytes` against the Pekko HTTP 1.1.0 source jar. `HttpEntity.toStrict(timeout)` (HttpEntity.scala:86-90) uses
    `fm.system.settings.config`, key `pekko.http.parsing.max-to-strict-bytes`. `EnhancedConfig.getPossiblyInfiniteBytes`
    maps `"infinite"` to `Long.MaxValue` and otherwise uses `getBytes`.
  - The driver's materializer is `Materializer(system)`, so `system.classicSystem.settings.config` is the same config.
    The limit is identical, including the infinite case.
  - Literal, two-sided guards (8388608 / 8388609, chunked and Content-Length, fetch and test) pass.
- No AC was reinterpreted. All tasks are ticked and match the code.
- **Scope:** the `ContentSourceSupport.fetchUrl` change is outside the REST driver itself. It was self-approved in
  design D5 and confirmed at the design gate, the proposal states it, and it only affects the error path. Accepted.
- No API, schema or frontend change. The spec delta (`fetch-error-envelope`) matches what was built.
- `workflow-state.md` CONSTRAINTS is `[]`, so there is nothing to honor.

### Phase 2: Code Review — PASS
Gates I ran myself (backend only; `nice -n 19 sbt -J-Xmx3g testOnly`, full spec files, lane DB env, ScalaTest summary
lines checked, not just sbt's exit code):
- **Shard 1, 15 suites, 184 tests, 0 failed, 0 aborted** (`[hel1468-guard] failed=0 aborted=0`):
  - RemoteErrorBodyPrefixSpec, RestApiConnectorDriverErrorCapSpec, RemoteErrorTextSpec
  - RestApiConnectorDriverBodySpec, KindGuardSpec, PendingGuardSpec, QueryParamsSpec, TemplatingSpec,
    ConnectorResolutionSpec
  - ContentSourceSupportSpec, CsvUrlFetchSpec, PinnedPoolReuseSpec, RestConnectorEgressGuardSpec,
    DataSourceServiceCsvUrlSpec, InProcessPipelineEngineUrlRefetchSpec
- **Shard 2, 9 suites, 69 tests, 0 failed, 0 aborted:**
  - RestApiConnectorSpec (the class in RestApiConnectorDriverSpec.scala)
  - PipelineApplyProposalRemoteErrorCapSpec, AssistantToolExecutorRemoteErrorCapSpec
  - ProposalDryRunRestSchemaSpec, ProposalDryRunEgressGuardSpec, ProposalDryRunParitySpec
  - SourceSampleServiceSpec, RestSourceConstructionSiteSpec, PipelineServiceInlineRestBodySpec
- `node scripts/check-scala-quality.mjs`: clean (no inline FQNs; the size warnings are informational and already
  existed).

Mutations I ran myself (full `RestApiConnectorDriverErrorCapSpec` file; code restored with `git checkout`, and
`git status`/`git diff` were empty afterwards):
- **M2** (driver error read passes 16384 instead of `MaxBodyBytes`): **red**, 2 failed. Both `/endless` cases failed
  with `16384 was not less than or equal to 5120`, on the fetch path (spec :96) and the connection-test path (:103).
  The emitted-byte assertion can fail.
- **M1** (`MaxBodyBytes = 1000`): **red**, exactly 1 failed: the `/multibyte` byte-identity guard, as design D6
  predicted.

Entity handling on every branch:
- issueAndParse 2xx: `toStrict` reads the entity.
- non-2xx (both builders): `readBodyPrefix` cancels upstream once `takeWhile` completes; on timeout the stream fails
  and upstream is cancelled.
- issueTest 2xx with Content-Length over the limit: `Sink.cancelled`. Otherwise the count fold runs to completion,
  or fails past the limit and cancels.
- fetchUrl non-2xx: `Sink.cancelled`; fetchUrl 2xx is unchanged.
- No branch leaves an entity unread and uncancelled.

DRY, readability, types, error handling: `errorText` and `maxStrictBytes` are shared between the two builders. No
`Any` escape hatches beyond the `Source[ByteString, Any]` input type. Failures still go through the existing
`.recover` paths to `Request failed`. Nothing silently swallowed; no dead code or TODOs.

Issues: none blocking.

### Phase 3: UI Review — N/A
No changed file matches `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**` or
`openspec/specs/**`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `RestApiConnectorDriver.scala` is now 578 lines. CONTRIBUTING.md:24 says to propose a split in the PR description
  once a file passes ~400 lines. `countWithinLimit` and `maxStrictBytes` could move to a small sibling, for example
  next to `RemoteErrorText`. The PR body should mention it either way.
- `readBodyPrefix` keeps at most `maxBytes` plus the last chunk until `take(maxBytes)`. That chunk can be up to the
  client parser's `max-chunk-size` (1 MiB), and `ByteString.take` may still share that chunk's backing array until
  decoding. This is still bounded and well under the old 8 MiB, but the scaladoc could say so.
- `RestApiConnectorDriverErrorCapSpec.scala`: the new `spray.json` and `java.util.UUID` imports come after the `scala.*`
  imports, unlike the grouping elsewhere in the file. Cosmetic.
- Proposal D5's message change for fetchUrl (a non-2xx body over 100 MiB or slower than 30 s now reports
  `Upstream returned HTTP <code>`) has no spec delta. Consider one line in the PR body.
