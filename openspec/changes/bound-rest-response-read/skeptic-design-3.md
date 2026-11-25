## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c (change dir untracked; artifacts on disk: ticket.md,
proposal.md, design.md, specs/fetch-error-envelope/spec.md, tasks.md). Pekko HTTP 1.1.0 sources: the round-1/2
extractions under `.concertino/scratch/HEL-1877/`, plus the parser package freshly extracted from the coursier
`pekko-http-core_2.13-1.1.0-sources.jar` into `.concertino/scratch/HEL-1877/skeptic3-src/`.

### What I verified (with evidence)

- **Code matches the design's Context.** `RestApiConnectorDriver.scala:344-398`: both builders call
  `toStrict(30.seconds)` before the status branch; `.recover` gives `Request failed`. `ContentSourceSupport.scala:333-370`
  (`fetchUrl`): `toStrict(30.seconds, fetchSizeLimitBytes)` (100 MiB, line 73), non-2xx discarded as
  `Upstream returned HTTP $code`; it takes injectable `resolveHost`/`isBlocked`, so a localhost stub test is possible.
  The spec's stub server runs in the same `HelioRouteTest` actor system, whose config is `ConfigFactory.load()`
  (no `parsing` override in `application.conf`).
- **Round-2 CR1 (internal API) resolved.** D3 now reproduces `EnhancedConfig.scala:55-58` locally (same key, same
  config, `"infinite"` -> `Long.MaxValue`, else `getBytes`). `Materializer(system)` (driver line 65) means
  `fm.system.settings.config` in `HttpEntity.scala:86-90` is the same config as `system.classicSystem.settings.config`.
- **Round-2 CR2 (literal two-sided guard) resolved in shape.** Boundary semantics confirmed in source:
  `toStrict(t, max)`'s Content-Length pre-check fails only on `contentLength > maxBytes` (`HttpEntity.scala:97-100`)
  and `ToStrict` only on `bytes.length > max` (`impl/util/package.scala:150`), so exactly 8388608 succeeds and 8388609
  fails, for both Content-Length and chunked transport. Practicality: an 8 MiB JSON body (e.g. one long string value)
  costs tens of MB in a 3g JVM and well under a second; the client's `max-content-length` is `infinite`
  (`reference.conf:401`), so no other client limit intervenes on a Content-Length body. M5 added, but see CR2.
- **Round-2 CR3 resolved.**
  - M2 at 16 KiB at both call sites: `/endless` completes after 64 x 256 B chunks (~3.2 s, inside the 15 s await);
    the capped text is identical (ASCII), so the only red is the emitted-byte assertion (~16384 > 5120). Correct.
  - M1 at 1000 B: `/multibyte` -> 333 full chars + 1 U+FFFD = 344 code points with the prefix, no marker -> red.
    `/big`, `/surrogate` (489 + 1 + 507 cp), `/short`, `/malformed` (ASCII filler, all single-byte units) stay
    byte-identical; `/endless` completes after 4 chunks (green); helper relation test red. Prediction correct.
- **Round-2 CR4 resolved.** The `fetchUrl` case is the paced never-ending non-2xx body: today `toStrict(30s, 100 MiB)`
  waits 30 s, past the 15 s await (red); after D5 `Sink.cancelled` returns `Upstream returned HTTP 500` at once
  (green). It is in the red-first evidence (task 1.4/1.5).
- **Round-2 notes addressed:** counter read in `onComplete`, per-request counter keyed by query parameter, comment
  for computed expectations, spec.md slack wording now "four of the server's network chunks" (= design's `k = 4`).
- **Byte-identity argument re-checked:** prefix `HTTP 500: ` is 10 cp, so 490 body cp come from <= 1960 bytes (+3
  lookahead) < 4096; a 4096-byte cut has >= 1024 cp, so the marker appears in both old and new text. Holds.
- **M3 correct** (`/huge` -> `Request failed`, `/endless` -> await timeout).
- **NEW: the Pekko client rejects any HTTP chunk over 1 MiB, and the design does not fix stub chunk sizes.**
  `reference.conf` `pekko.http.parsing.max-chunk-size = 1m` (no client override); `HttpMessageParser.scala:313-315`
  fails the entity stream with "HTTP chunk of N bytes exceeds the configured limit". A Pekko server renders each
  `ChunkStreamPart` as one chunk. So a stub that emits a chunked 2xx/`/huge` body as one or a few large `ByteString`s
  makes the client fail at the chunk header, giving `Request failed` for a reason unrelated to the limit under test:
  the exactly-8388608 chunked case (if built) would fail after the fix, the chunked 8388609 cases would pass for the
  wrong reason, and M4 and M5-doubled would then NOT go red, and `/huge` would give `Request failed` after the fix.
  See CR1.
- **NEW: M5-doubled prediction is incomplete.** With the limit doubled (16 MiB), the Content-Length 8388609 cases no
  longer trip the pre-check either (fetch: `toStrict(t, 16 MiB)`; test: D4's pre-check uses the same D3 limit), so
  they return parsed JSON / `Failed to parse JSON response` / `Right(())` instead of `Request failed` and go red too.
  The design names only the chunked cases (unlike M4, where chunked-only is correct because the pre-check stays).
  See CR2.
- **Scope/contracts/escalation:** all three ACs map to tasks; no API/schema/frontend change; success path unchanged
  in user terms; error-path change is the ticket's purpose. No product decision left open, so no ESCALATION.

### Verdict: REFUTE

Every round-2 change request is genuinely resolved. Two new test-plan defects remain. Both are one-line artifact fixes,
but CR1 would silently turn two guards and two mutations into evidence-shaped non-evidence.

### Change Requests

1. **Fix the chunk size of every chunked stub body to <= 64 KiB, and state why** (design.md D6 `/huge` and
   "Success-path guard"; task 1.2). The Pekko client fails any chunk larger than `max-chunk-size = 1m`
   (`HttpMessageParser.scala:313-315`). Required: `/huge` and the chunked 8388608/8388609 2xx bodies are emitted as
   fixed chunks of at most 64 KiB (e.g. `Source.repeat(chunk).take(n)` plus one exact-size tail), with a one-line note
   that a single large chunk would fail at the client parser and make the guards and M4/M5 pass for the wrong reason.
   Also state which transport the exactly-8388608 case uses (both, or name one).

2. **Correct the M5-doubled prediction** (design.md D6 M5; task 3.1). Doubled: ALL 8388609 cases go red, chunked and
   Content-Length, on fetch and on connection test (the Content-Length pre-check uses the same limit). Halved: the
   exactly-8388608 cases go red on both builders; the 8388609 cases stay green.

### Non-blocking notes

- An assertion thrown inside `onComplete` is swallowed by the future machinery. Capture the counter value in the
  callback (e.g. into a `Promise`) and assert after `await`. M2 would expose a swallowed assertion anyway.
- Name the spec file that hosts the `fetchUrl` endless case (it needs the stub server bound; `RemoteErrorBodyStub`
  is shared by three specs, so adding routes stays additive).
- The helper spec's exact-length assertion goes red under M1 only if written with the literal 4096; either is fine,
  but the M1 prediction then lists it too.
