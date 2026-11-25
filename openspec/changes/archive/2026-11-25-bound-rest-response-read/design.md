## Context

`RestApiConnectorDriver.issueAndParse` (fetch, preview, sample, refresh, run, schema inference, ephemeral, HEL-1638 dry
run) and `issueTest` (connection tests) are the only REST request-issuing sites. Both call
`response.entity.toStrict(30.seconds)` before branching on status. With no byte argument, `toStrict` is bounded by
`pekko.http.parsing.max-to-strict-bytes` (8 MiB default, not overridden in `application.conf`; probe-confirmed in
`ContentSourceSupport.scala`'s `fetchSizeLimitBytes` comment); over it, the future fails and `.recover` yields
`Request failed`. `ContentSourceSupport.fetchUrl` reads non-2xx bodies up to 100 MiB and discards them. Pekko HTTP 1.1.0.

## Goals / Non-Goals

Goals: error-path memory and time bounded by a small constant; capped text byte-identical for bodies that had a
capped result before; success-path results identical. Non-goals: see proposal.md (no row-bounded streaming parse).

## Decisions

**D1. Branch on status before reading the body.** Status and headers are available before the entity; read the
body differently per branch. Alternative (keep one `toStrict` then branch) is the defect itself.

**D2. Error path: bounded prefix read.** A small helper (e.g. `RemoteErrorText.readBodyPrefix(dataBytes, maxBytes,
timeout): Future[ByteString]`) folds `ByteString` chunks until the accumulated length reaches `maxBytes`, then completes
(cancelling upstream, which closes the connection), and truncates to exactly `maxBytes`. The whole read keeps today's
30 s ceiling (`completionTimeout`); on timeout the future fails and `.recover` still yields `Request failed` (unchanged).
The driver then does `RemoteErrorText.cap(s"HTTP $code: ${prefix.utf8String}")` exactly as today.
`maxBytes = 4096` (`RemoteErrorText.MaxBodyBytes`). The relation `MaxBodyBytes >= 4 * MaxCodePoints + 4` is asserted
by a spec test, NOT a `require` (a `require` would make the D6 mutation fail at object initialisation and prove nothing).
The helper decodes nothing: it returns raw bytes, and the driver decodes once, after accumulation.
Byte-identity argument: a UTF-8 code point is at most 4 bytes and a malformed subsequence maps to one U+FFFD per 1-3
bytes, so the first 500 code points of the body come from its first 2000 bytes, and Java's decoder needs at most 3
bytes of lookahead; decoding the first 4096 bytes therefore yields the same first 500 code points as the full body.
A body cut at 4096 bytes has > 1000 code points, so the full text also exceeded 500 and gets the marker in both cases.
Bodies of 4096 bytes or fewer are read whole, so identity is trivial. Decoding stays `utf8String` (charset ignored, as
today). Alternative: `toStrict(timeout, maxBytes)` fails instead of truncating (would lose the text); `.take` on
elements does not bound bytes.

**D3. Success path (issueAndParse 2xx): unchanged limit, made explicit.** Pass `toStrict(30.seconds, limit)` where
`limit` is read from exactly the key and config `toStrict(timeout)` itself reads (Pekko 1.1.0 `HttpEntity.scala:86-90`):
`getPossiblyInfiniteBytes` is `private[http]` (`EnhancedConfig.scala:27,55-58`), so a local helper reproduces its logic
exactly: `system.classicSystem.settings.config`, key `pekko.http.parsing.max-to-strict-bytes`; `getString == "infinite"`
gives `Long.MaxValue`, otherwise `getBytes` (8 MiB from `reference.conf`, not overridden in `application.conf`). Same
key, same config, same logic, so the limit is identical to `toStrict(timeout)`'s, including under a config change. Not `ParserSettings.forClient` (reads
`pekko.http.client.parsing` first, which diverges under a client-only override). Over it: `Request failed`, as today.
No user-visible limit changes, so no Planning escalation. A streaming, row-limited JSON parse was rejected:
preview/fetch report `availableRowCount` and `truncated` from the full array, which a row-bounded read would change
(user-visible), and HEL-1013 (pagination) is the place to revisit large REST bodies.

**D4. Connection test 2xx: count, do not hold.** `issueTest` only needs the status, but today a 2xx body over 8 MiB
makes the test report `Request failed`. Keep that outcome exactly: if a declared Content-Length exceeds the D3 limit,
fail at once without reading (as `toStrict(t, max)` does), cancelling the entity so the connection is released; otherwise run the body through a fold that sums byte lengths
and fails past the same limit (and the same 30 s), holding no data. Alternative (cancel the body, report success for
any size) changes a visible result; rejected.

**D5. `ContentSourceSupport.fetchUrl` non-2xx: stop reading.** Its message is `Upstream returned HTTP $code` with no
body. Check status first; on non-2xx cancel the entity stream (`dataBytes.runWith(Sink.cancelled)`) and return the same
`Left`. 2xx unchanged (`toStrict(30s, 100 MiB)`). Visible effect, error path only: a non-2xx body over 100 MiB or
slower than 30 s used to give `Request failed` and now gives `Upstream returned HTTP <code>` (an improvement).

**D6. Tests (red first, committed as .txt before implementation).** Slack constant used everywhere: the bound on
bytes read is `MaxBodyBytes + k * chunk`, `k = 4`, `chunk` = the source's fixed chunk size.
- Helper unit spec: an infinite counting `Source` of 256-byte chunks; assert bytes pulled `<= 4096 + 4 * 256` and that
  the source observed cancellation; result length exactly `MaxBodyBytes`. Also a spec test asserting
  `MaxBodyBytes >= 4 * MaxCodePoints + 4`.
- Chunked stub bodies: every chunked body (`/huge`, the chunked 2xx boundary bodies) is emitted as fixed chunks of
  at most 64 KiB (`Source.repeat(chunk).take(n)` plus one exact-size tail). A single large chunk would fail at the
  client parser (`max-chunk-size = 1m`, `HttpMessageParser.scala:313-315`) and make the guards and M4/M5 pass for the
  wrong reason.
- Driver spec (extend `RemoteErrorBodyStub` + `RestApiConnectorDriverErrorCapSpec`), each case on BOTH
  `fetchEphemeral` and `testConnectionEphemeral`, expecting `cap("HTTP 500: " + body head)`:
  - `/endless` (the tight AC-1 measurement): status 500, chunked, 256-byte ASCII chunks paced at one per 50 ms,
    never completing, with a PER-REQUEST server-side counter of bytes emitted (keyed by a query parameter, so a
    still-running stream from an earlier red case cannot pollute it). Read the counter in the driver future's
    `onComplete` callback into a `Promise` (an assertion thrown inside `onComplete` would be swallowed), then assert
    after `await` that it is `<= 4096 + 4 * 256` (5120). A paced source cannot run ahead into socket buffers, so this is a tight,
    bytes-based measurement at the stub server. Red today: `toStrict` waits 30 s, past the spec's 15 s await.
  - `/huge`: status 500, chunked, fast, 64 MiB of ASCII, with a per-request (query-keyed) emitted-byte counter. Assert the capped text and an
    emitted count `< 8 MiB` (8388608), the old read ceiling that today's code must exceed before failing (red today:
    `Request failed`); record the measured value in evidence.
- GUARD (failable by mutation): existing `/big`, `/surrogate`, `/short`; `/multibyte`: 2000 three-byte characters
  (6000 bytes, cut at 4096 falls inside a character); `/malformed`: 6000 bytes, all ASCII filler except a few invalid
  UTF-8 bytes inside the first 2000. Each expected value is `cap("HTTP 500: " + new String(fullBytes, UTF_8))`,
  computed from the full body (acceptable: the literal `/big` and `/surrogate` cases still pin `cap` itself; say so in a
  comment).
- Success-path guard, literal and two-sided, on fetch AND connection test (the literal `8388608` in the test, never
  the production accessor): a 2xx JSON body of exactly 8388608 bytes succeeds (fetch parses it, test returns
  `Right(())`), both chunked and with Content-Length; a 2xx body of 8388609 bytes gives `Request failed`, both
  chunked and with Content-Length.
- `fetchUrl` (D5), red today, hosted in `RestApiConnectorDriverErrorCapSpec` (it already binds the stub server; the
  new stub routes stay additive for the other two specs sharing `RemoteErrorBodyStub`): a paced never-ending non-2xx
  body (the `/endless` shape). Today: 30 s timeout and
  `Request failed`, past a 15 s await (red). After D5: `Upstream returned HTTP 500` promptly, emitted bytes recorded.
- Mutations, each run on the full spec file and its red recorded in evidence:
  (M1) `MaxBodyBytes = 1000` with nothing else changed: in the driver spec file exactly `/multibyte` goes red (1000
  bytes is 333 code points < 490); `/big`, `/surrogate`, `/malformed` (ASCII filler) stay green by arithmetic; the red
  is an assertion, not an init failure. The helper spec's relation test, and its exact-length assertion (written with the literal 4096), also go red
  (expected and correct).
  (M2) driver passes 16 KiB instead of `MaxBodyBytes`, at BOTH call sites: the `/endless` cases complete inside the
  await (64 chunks, about 3.2 s) and go red on the emitted-byte assertion (about 16384 > 5120), on fetch and on test.
  (M3) driver back to `toStrict(30.seconds)`: `/huge` and `/endless` red.
  (M4) drop the D4 limit from the 2xx count fold: the `8388609` connection-test guard (chunked case) red.
  (M5) the driver's 2xx limit halved: the exactly-8388608 cases red on both builders, the 8388609 cases stay green;
  doubled: ALL 8388609 cases red (chunked and Content-Length, fetch and connection test; the Content-Length pre-check
  uses the same limit), the 8388608 cases stay green.

## Risks / Trade-offs

- [Loopback socket buffers make server-side byte counts noisy] -> the tight driver-level bound uses the paced
  `/endless` source; `/huge` asserts only the old 8 MiB ceiling and records its measured value.
- [Cancelling the entity closes the pinned connection] -> pinned pools are per-address and already tolerate closed
  connections; no reuse expectation for error responses.
- [Error path visible change for >8 MiB / never-ending bodies] -> strictly more informative capped text instead of
  `Request failed`; the ticket's purpose. Success path untouched.

## Planner Notes

- Self-approved: D3 keeps the existing success-path size limit instead of a row-bounded read (ticket allows
  "unchanged"); no user-visible change, so no escalation.
- Self-approved: D5 includes `fetchUrl`'s discarded non-2xx body (same remote-source HTTP client; error-path text
  improves for >100 MiB or slow bodies, success path unchanged).
- No migration, schema, API or frontend change. Files disjoint from HEL-1160 (helio-mcp) and HEL-1587 (frontend).
