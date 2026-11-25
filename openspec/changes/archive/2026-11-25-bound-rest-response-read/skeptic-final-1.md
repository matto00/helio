## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: c3755f0d3b34ba28d48f64a195d718543dd19cf1. Diff base, resolved live with
`resolve-review-base.sh <wt> main origin` (exit 0): 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c. Spawn-cwd guard: READY.

Evidence root (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1877/evidence/.concertino/scratch/HEL-1877/skeptic-final/`
(`shard1.txt`, `shard2.txt`, `m3.txt`, `m5-halved.txt`).

### What I verified (with evidence)

**Diff (read in full):** `RemoteErrorText.scala` (+`MaxBodyBytes = 4096`, +`readBodyPrefix`),
`RestApiConnectorDriver.scala` (status branch before body read; 2xx `toStrict(30s, maxStrictBytes)`; non-2xx `errorText`;
`issueTest` 2xx `countWithinLimit`), `ContentSourceSupport.fetchUrl` (non-2xx: `Sink.cancelled`, same message), and three
test files. No frontend, schema, API or migration change.

**AC1 — bounded error read, measured.**
- `readBodyPrefix` = `scan(++)` → `takeWhile(len < max, inclusive)` → `completionTimeout(30s)` → `Sink.last` → `take(max)`.
  `takeWhile` completing cancels upstream; `completionTimeout` failing also cancels.
- Shard 1 (my run): `/endless` emitted 4096 at completion on fetch and on test (bound 5120); `/huge` 917504 / 1114112
  (< 8388608); fetchUrl `/endless` 512.
- **Cancellation at the HTTP level, not just "stopped consuming"** (my own probe, a temporary untracked spec, deleted
  after the run): after each driver future completed I waited 3 s and re-read the server-side per-request counter.
  fetch 4096 → 4096, connection test 4096 → 4096, fetchUrl 512 → 512. A merely back-pressured (uncancelled) entity on a
  paced 256 B / 50 ms source would have kept emitting into the socket buffers (~15 KB in 3 s); it did not, so the
  connection was released (shard1.txt, lines with `SKEPTIC-PROBE`).

**AC2 — capped text unchanged for ordinary bodies.** Literal `/big`, `/surrogate`, `/short` cases unchanged and green;
`/multibyte` (cut inside a 3-byte char at 4096) and `/malformed` (invalid UTF-8 in the head) equal `cap` of the FULL
body on both paths. Argument checked independently: 490 body code points need ≤ 1960 bytes, decoder lookahead ≤ 3,
U+FFFD is one code point per ≥ 1 malformed byte, so the first 500 code points of the text are identical; a body cut at
4096 bytes has > 1000 code points, so both old and new carry the marker; ≤ 4096-byte bodies are read whole. Under M3 the
identity guards stay green while the bound guards go red — the two concerns are tested independently.

**AC3 — success path unchanged.** Checked the Pekko HTTP 1.1.0 jar myself: `toStrict(timeout)` =
`toStrict(timeout, config.getPossiblyInfiniteBytes("pekko.http.parsing.max-to-strict-bytes"))` (HttpEntity.scala),
`reference.conf` `max-to-strict-bytes = 8m`; `maxStrictBytes` reproduces exactly this. Client `max-content-length =
infinite`, so no other limit masks the guards. Two-sided literal guards (8388608 accept / 8388609 `Request failed`,
chunked and Content-Length, fetch and test) green.

**Entities on every branch:** 2xx fetch → `toStrict` consumes; non-2xx (both builders) → prefix read then cancel
(timeout also cancels); test 2xx with Content-Length over limit → `Sink.cancelled`; test 2xx otherwise → count fold runs
to end or fails/cancels; fetchUrl non-2xx → `Sink.cancelled`; guard-rejected requests never issue one. None leaked.

**Gates re-run by me** (`nice -n 19 sbt -J-Xmx3g testOnly`, lane DB, ScalaTest summary lines read, not sbt's exit):
- Shard 1 (9 suites incl. probe): RemoteErrorBodyPrefixSpec, RestApiConnectorDriverErrorCapSpec, RemoteErrorTextSpec,
  ContentSourceSupportSpec, CsvUrlFetchSpec, PinnedPoolReuseSpec, RestApiConnectorDriverBodySpec, RestApiConnectorSpec —
  `Suites: completed 9`, `Tests: succeeded 119, failed 0`, `[hel1468-guard] failed=0 aborted=0`.
- Shard 2 (13 suites): driver Kind/Pending/QueryParams/Templating/ConnectorResolution specs, RestConnectorEgressGuardSpec,
  PipelineApplyProposalRemoteErrorCapSpec, AssistantToolExecutorRemoteErrorCapSpec, ProposalDryRunRestSchemaSpec,
  ProposalDryRunEgressGuardSpec, SourceSampleServiceSpec, RestSourceConstructionSiteSpec,
  InProcessPipelineEngineUrlRefetchSpec — `Suites: completed 13`, `Tests: succeeded 103, failed 0`, guard `failed=0`.

**Mutations the evaluator did not re-run** (full RestApiConnectorDriverErrorCapSpec, restored with `git checkout`;
`git diff` empty and HEAD unchanged afterwards):
- M5-halved (`maxStrictBytes / 2`): red, exactly the two "exactly 8388608" cases (fetch, test); 8388609 cases green — as
  design D6 predicted (m5-halved.txt: `failed=2`).
- M3 (`errorText` back to whole-body `toStrict(30.seconds)`): red, exactly the four `/endless` + `/huge` bound cases
  (m3.txt: `failed=4`); the identity guards stay green.

**User-visible changes vs. plan:** non-2xx bodies > 8 MiB or never-ending now give capped `HTTP <code>: …` instead of
`Request failed` (stated, spec delta); fetchUrl non-2xx bodies > 100 MiB or slow now give `Upstream returned HTTP <code>`
instead of `Request failed` (stated, design D5). Nothing unstated found.

### Verdict: CONFIRM

### Non-blocking notes
- `HttpEntity.Strict` overrides only `toStrict(timeout)` (returns itself); `toStrict(timeout, maxBytes)` still applies
  the Content-Length check. So a 2xx entity the client parser delivered as `Strict` and larger than 8 MiB would now fail
  where it previously passed. Not reachable in practice (the client builds `Strict` only when the whole body sits in one
  input read, bounded by TCP read buffers), so the "identical" claim in D3 holds in practice, not literally. Worth one
  sentence in the PR body.
- The spec delta's "Very large error body" scenario says "having read no more than the byte bound plus four chunks";
  the `/huge` test asserts only `< 8 MiB` of server-emitted bytes (socket buffering inflates it to ~1 MiB). The tight
  read bound is proved by the helper spec and `/endless`, not `/huge` — the scenario wording slightly over-attributes.
- `readBodyPrefix` may transiently hold one last chunk up to the parser's `max-chunk-size` (1 MiB) before `take`; still
  bounded (evaluator noted the same).
- `RestApiConnectorDriver.scala` is now ~578 lines; CONTRIBUTING asks for a split proposal in the PR body.
