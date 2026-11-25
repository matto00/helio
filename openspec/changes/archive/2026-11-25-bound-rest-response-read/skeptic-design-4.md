## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c (change dir untracked; artifacts on disk: ticket.md,
proposal.md, design.md, specs/fetch-error-envelope/spec.md, tasks.md). Ground truth read fresh:
`RestApiConnectorDriver.scala:344-398` (both builders), `RemoteErrorBodyStub.scala`,
`RestApiConnectorDriverErrorCapSpec.scala`. Pekko facts re-used from the round-3 extraction under
`.concertino/scratch/HEL-1877/skeptic3-src/` (`HttpMessageParser.scala:313-315` chunk limit).

### What I verified (with evidence)

- **Code still matches the design's Context.** Both `issueAndParse` and `issueTest` call `toStrict(30.seconds)` before
  the explicit `code >= 200 && code < 300` branch (so 3xx is already on the error path, consistent with the proposal);
  `.recover` yields `Request failed`. `fetchEphemeral` returns the parsed `JsValue` directly, so "fetch parses it"
  (`Right(json)`) is a well-defined assertion for the 8388608 guard.
- **Round-3 CR1 resolved.** D6 now states every chunked stub body (`/huge`, the chunked 2xx boundary bodies) is emitted
  as fixed chunks of at most 64 KiB (`Source.repeat(chunk).take(n)` plus an exact-size tail), with the reason (client
  `max-chunk-size = 1m`, `HttpMessageParser.scala:313-315`) and the wrong-reason consequence for the guards and M4/M5.
  The transports are named: both the 8388608 and the 8388609 guards run chunked AND with Content-Length, on fetch and on
  connection test. Task 1.2 carries the same `<=64 KiB` constraint. `/endless` uses 256 B chunks, well under the limit.
- **Round-3 CR2 resolved.** M5 now reads: halved -> exactly-8388608 cases red on both builders, 8388609 green;
  doubled -> all 8388609 cases red (chunked and Content-Length, fetch and test, because D4's Content-Length pre-check
  shares the D3 limit), 8388608 green. Re-derived: halved = 4 MiB, so both 8388608 transports fail (pre-check
  `contentLength > max` / `ToStrict` `bytes.length > max`) and 8388609 still fails; doubled = 16 MiB, so 8388609 passes
  both checks and returns `Right`, changing the expected `Request failed`. Correct.
- **Round-3 non-blocking notes addressed:** the `/endless` counter is captured in `onComplete` into a `Promise` and
  asserted after `await`; the `fetchUrl` case is hosted in `RestApiConnectorDriverErrorCapSpec` (stub routes stay
  additive for the two other specs sharing `RemoteErrorBodyStub`); M1 now lists the helper spec's literal-4096
  exact-length assertion as an expected red.
- **No new defect introduced by the revisions.** Re-checked M1 (`/multibyte` red at 1000 B; `/malformed` with ASCII
  filler and single invalid bytes stays identical because every byte decodes to one code point and > 490 of them
  remain), M2 (16 KiB at both sites -> 64 paced chunks ~3.2 s, inside the 15 s await, red only on emitted bytes),
  M3 (`/huge` -> `Request failed` after reading the old 8 MiB, `/endless` -> 30 s > 15 s await), M4 (chunked 8388609
  connection test red; Content-Length variant correctly still caught by the pre-check). The success-path guards are
  green on today's code by construction (same `toStrict` limit), so they are genuine guards, failable by M4/M5.
- **Byte-identity argument holds:** 490 body code points need <= 1960 bytes plus 3 bytes of lookahead < 4096; a 4096-byte
  cut has >= 1024 code points, so the marker appears in old and new text alike.
- **AC trace:** AC-1 -> helper pulled-bytes bound + `/endless` per-request emitted counter (<= 5120) + `/huge`
  (< 8 MiB, measured value recorded); AC-2 -> `/big`, `/surrogate`, `/short`, `/multibyte`, `/malformed` guards with
  M1 as the mutation; AC-3 -> success-path limit unchanged (D3, same key/config/logic as `toStrict(timeout)`),
  literal two-sided guards on both transports and both builders, M4/M5. All tasks map to ACs; no scope drift beyond
  the self-approved `fetchUrl` error-path read (same ticket intent, error path only).
- **Contracts / escalation:** no API, schema, migration or frontend change; no user-visible success-path change; the
  error-path change (>8 MiB or never-ending non-2xx now gives capped text instead of `Request failed`) is the ticket's
  stated purpose. No product decision left unsettled, so no ESCALATION.

### Verdict: CONFIRM

### Non-blocking notes

- `/huge`'s emitted-byte counter is not explicitly per-request (only `/endless` is). Key it by query parameter the same
  way, or reset it per case, so the fetch and connection-test cases (and a red-run straggler) do not read a cumulative
  count.
- D4's Content-Length pre-check fails without reading; the implementation should still discard/cancel that entity
  (as D5 does) so the pinned connection is released rather than left with an unread body.
- `/huge` reads the counter at completion with a fast source, so loopback socket buffering inflates it; the `< 8 MiB`
  bound has wide margin, but if it ever flakes, that is a measurement artefact to record, not a driver defect.
