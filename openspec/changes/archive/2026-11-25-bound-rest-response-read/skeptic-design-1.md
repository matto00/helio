## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c. The change dir is untracked, so this review covers the
artifacts as they are on disk.

### What I verified (with evidence)

- **Read sites are complete.** `grep -rn "toStrict\|singleRequest\|dataBytes" backend/src/main/scala`: the only
  remote-source body reads are `RestApiConnectorDriver.scala:351` (`issueAndParse`), `:386` (`issueTest`) and
  `ContentSourceSupport.scala:349` (`fetchUrl`, which CsvUrlFetch and SourceUrlFetch text/pdf/image use). Every other
  hit is Claude, Resend, OAuth or an inbound upload route, and the proposal excludes those correctly. No REST read site
  is missing.
- **The current behaviour matches the design.** Both driver builders call `toStrict(30.seconds)` before branching on
  status, then `RemoteErrorText.cap(s"HTTP $code: ${utf8String}")`, and `.recover` turns any failure into
  `Request failed` (lines 344-398). `fetchUrl` reads up to 100 MiB and discards the body on non-2xx (line 349-361).
- **The implicit ceiling is 8 MiB.** In the Pekko HTTP 1.1.0 sources jar (coursier cache,
  `pekko-http-core_2.13-1.1.0-sources.jar`), `HttpEntity.scala:86-90` shows that `toStrict(timeout)` reads
  `fm.system.settings.config.getPossiblyInfiniteBytes("pekko.http.parsing.max-to-strict-bytes")`, and
  `reference.conf:701` sets `max-to-strict-bytes = 8m`. `application.conf` has no `parsing` override (grep: no hits).
  `HttpEntity.scala:97-106` also shows that `toStrict(t, max)` fails before reading anything when Content-Length
  exceeds max.
- **`ParserSettings.maxToStrictBytes` exists.** It is in `ParserSettings.scala:46`. `ParserSettings.forClient` reads
  `pekko.http.client.parsing` with `pekko.http.parsing` as the fallback (`ParserSettings.scala:246-248`,
  `ParserSettingsImpl.scala:99-111`). `forServer` reads `pekko.http.server.parsing` the same way.
  `ParserSettings.apply(config)` is `@deprecated`. With today's config every route gives 8 MiB. The difference this
  makes is covered in CR3.
- **The byte-identity argument holds.** I checked it independently:
  - `ByteString.utf8String` is a one-shot `new String(bytes, UTF_8)` with replacement.
  - The JDK UTF-8 decoder is local. Each output code point, including each U+FFFD, consumes 1 to 4 input bytes, and
    deciding a malformed run needs at most 3 bytes of lookahead after the lead byte.
  - So the first 490 body code points come from at most the first 1963 body bytes, which is inside 4096.
  - A cut at 4096 bytes yields at least 1024 code points, so both the old and the new text get the marker.
  - Bodies of 4096 bytes or fewer are read whole.
  - This holds for malformed input too, provided the helper decodes once, after accumulating. D2 implies that by
    returning a `ByteString`.
- **The success path is unchanged for users.** D3 keeps the 8 MiB `toStrict` and `Request failed` above it. D4 keeps
  the connection-test outcome for oversized 2xx bodies. I found no user-visible success-path change, so the design
  correctly raises no Planning escalation. The ticket's AC 3 allows "unchanged", and the rejection of a row-bounded
  streaming parse is reasoned: it would change `availableRowCount`/`truncated`.
- **The error-path change is the ticket's intent.** Bodies over 8 MiB, and endless bodies that deliver 4 KiB within
  30 s, now return capped text instead of `Request failed`. That is not a product decision requiring escalation.
- **The planned reds are real for the driver cases.** A chunked `/huge` body over 8 MiB fails today's `toStrict` and
  gives `Request failed`. `/endless` runs into the 30 s `toStrict` timeout, which is longer than the 15 s `await` in
  `RestApiConnectorDriverErrorCapSpec.scala:41`.
- **The existing stub can be extended.** `testkit/RemoteErrorBodyStub` has literal expected strings and is shared by
  three specs (ErrorCap, AssistantToolExecutor, PipelineApplyProposal). Adding routes is additive.

### Verdict: REFUTE

The design is substantially sound and close to implementable. Three test-plan defects would let the core AC and one
mutation pass without proving anything, so they must be fixed in the artifacts first.

### Change Requests

1. **AC 1's stub-server byte measurement has no concrete bound and is the noisiest measurement available**
   (design.md D6 driver spec, Risks bullet 1; spec.md "Very large error body"). AC 1 says "a stub server ... never makes
   the driver hold more than a small bounded amount, measured with a test". The plan has two problems:
   - It asserts the `/huge` server-side count only as "far below 8 MiB" or "a generous bound". On loopback, socket
     buffers let the server emit megabytes before cancellation lands, so the bound would have to be loose.
   - A loose bound passes an implementation that hands the helper a much larger limit than `MaxBodyBytes` (for
     example a few MiB). Nothing else catches that: the helper spec tests the helper, not the driver's argument, and
     the multi-byte guard only fails for limits below about 1470 bytes.

   Required:
   - (a) Make `/endless` paced: fixed-size chunks (e.g. 256-512 B) at a fixed interval, so 4 KiB arrives well under
     the 15 s await.
   - (b) Record the server-emitted byte count at the moment the driver's future completes, and assert it is
     `<= MaxBodyBytes + k * chunkSize` with `k` stated (e.g. 2). A paced source cannot run ahead into socket buffers,
     so this is a tight, bytes-based, stub-server measurement.
   - (c) Give the `/huge` assertion a concrete numeric bound written into design.md, and record the measured value.
   - (d) Add a mutation "driver passes 4 MiB instead of `MaxBodyBytes`" that must turn (b) red.
   - (e) Update tasks 1.2, 1.3 and 3.1 to match.

2. **The `MaxBodyBytes = 1000` mutation is vacuous as specified** (design.md D2 and D6, tasks 2.1 and 3.1).
   - If the `>= 4 * MaxCodePoints + 4` check is a `require` in the object body, which D2 offers as an option,
     setting 1000 throws when the object initialises. Every test then goes red for that reason, and the guard proves
     nothing.
   - By arithmetic, with a 1000-byte prefix `/big` (ASCII) still yields 1000 code points, and `/surrogate` yields 997.
     Both stay green, so "must turn the multi-byte/big guard red" is wrong for `/big`.

   Required: state that the mutation also removes or bypasses the `require` (or choose the spec-test form of the
   assertion), and name the single case expected to go red: the 3-byte-character body. Record that this case, and not
   an initialisation failure, is what fails.

3. **D3's claim that the success limit is "the same 8 MiB by construction" depends on which accessor is used, and the
   design does not name one** (design.md D3, task 2.2).
   - `toStrict(timeout)` reads the root key `pekko.http.parsing.max-to-strict-bytes`.
   - `ParserSettings.forClient(system).maxToStrictBytes` reads `pekko.http.client.parsing` first.
   - `ParserSettings(...)` is `@deprecated`.

   These are equal today but diverge under a client-only override. Required: name the exact source. Prefer reading the
   same root key with `getPossiblyInfiniteBytes`, which preserves `infinite`, so "unchanged by construction" is
   literally true. Otherwise name `forClient` and drop the "by construction" wording.

### Non-blocking notes

- **Malformed-input guard.** The identity argument relies on malformed-input locality. A cheap guard would be a body
  over 4096 bytes with invalid UTF-8 bytes inside the first 2000, asserted equal to `cap("HTTP 500: " + new
  String(fullBytes, UTF_8))`. It would catch a helper that decodes chunk by chunk.
- **D5 does change visible error text.** The Planner Note's "no visible change" is slightly wrong: a non-2xx `fetchUrl`
  body over 100 MiB, or a slow one, changes from `Request failed` to `Upstream returned HTTP <code>`. It is an
  improvement, but say so in proposal.md.
- **Slack wording differs.** The spec says "plus one network chunk" and the design says "one chunk plus stream-stage
  buffer". Align them with whatever CR1(b) states.
- **D4 cost on Content-Length bodies.** Counting a 2xx Content-Length body over 8 MiB now reads 8 MiB before failing,
  where `toStrict` failed without reading. The outcome is the same and only cost differs. Optionally keep the
  Content-Length pre-check.
