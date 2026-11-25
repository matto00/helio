## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 95cec30cf5d1028fdc4a04d0764fb7febc4aeb1c. The change dir is untracked, so this review covers the
artifacts on disk: ticket.md, proposal.md, design.md, specs/fetch-error-envelope/spec.md and tasks.md.

### What I verified (with evidence)

- **Current code matches the design's Context.** `RestApiConnectorDriver.scala:344-398`: both `issueAndParse` and
  `issueTest` call `toStrict(30.seconds)` before branching on status, then `RemoteErrorText.cap(s"HTTP $code: ...")`,
  and `.recover` returns `Request failed`. `ContentSourceSupport.scala:346-365` (`fetchUrl`) reads
  `toStrict(30s, fetchSizeLimitBytes)` and then discards a non-2xx body. The driver's materializer is
  `Materializer(system)` (line 65), so the config that `toStrict(timeout)` reads through `fm.system` is the driver
  system's config.
- **`toStrict(timeout)` source (Pekko HTTP 1.1.0).** `HttpEntity.scala:86-90` calls
  `toStrict(timeout, config.getPossiblyInfiniteBytes("pekko.http.parsing.max-to-strict-bytes"))`. In
  `toStrict(t, max)`, a Content-Length over `max` fails before reading. `impl/util/package.scala:150` (`ToStrict`)
  fails only when `bytes.length > max`, so a body of exactly `max` bytes is accepted.
- **`getPossiblyInfiniteBytes` is not callable from helio code.** It is defined on
  `org.apache.pekko.http.impl.util.EnhancedConfig`. That class is `@InternalApi private[http] class EnhancedConfig`
  (`EnhancedConfig.scala:27`, extracted from the coursier `pekko-http-core_2.13-1.1.0-sources.jar` into
  `.concertino/scratch/HEL-1877/skeptic2-src/`). The implicit that adds it is
  `private[http] implicit def enhanceConfig` (`impl/util/package.scala:49`). Helio builds with Scala 2.13.15
  (`build.sbt:4`), which enforces `private[http]` qualifiers, so D3's
  `system.settings.config.getPossiblyInfiniteBytes(...)` does not compile from `com.helio`. The method body is
  `underlying.getString(path) match { case "infinite" => Long.MaxValue; case _ => underlying.getBytes(path) }`
  (`EnhancedConfig.scala:55-58`). A local copy of that logic, reading the same root key from the same config, would
  match `toStrict(timeout)` exactly. See CR1.
- **Round-1 CR1 (paced bound) is mostly resolved.**
  - (a) `/endless` is now paced: 256 B every 50 ms.
  - (b) The emitted count is read at completion and checked against `<= 4096 + 4*256` (5120), with `k = 4` stated.
  - (c) `/huge` has a concrete bound, `< 8388608`, and its measured value is recorded (task 3.3).
  - (e) Tasks 1.2, 1.3 and 3.1 are updated.
  - (d) M2 exists, but at 4 MiB it does not exercise the byte assertion. See CR3.
- **The paced bound is sound.** The new code completes on the 16th chunk (4096 B, about 0.8 s). The server emits by
  timer, not by socket demand, so the only overshoot is the chunks emitted between chunk 16 leaving the server and the
  counter being read. That is loopback latency, client parsing, the fold and a future callback: milliseconds. The
  slack allows 200 ms. The stub runs in the same JVM, so a GC pause stops both sides. I judge this non-flaky, with the
  caveats in the non-blocking notes.
  - It is red today on both paths: `toStrict` waits 30 s, longer than the spec's 15 s `await`
    (`RestApiConnectorDriverErrorCapSpec.scala:41`).
  - It is red under M2 (4 MiB) on both paths only through the 15 s `await` timeout: at 5120 B/s, 4 MiB takes about
    819 s, so the driver hits its 30 s timeout. The emitted-byte assertion is never reached.
- **The `/huge` bound of under 8 MiB is plausible and is not the tight measurement.** On this machine
  `net.ipv4.tcp_rmem` max is 32 MiB and `tcp_wmem` max is 4 MiB. Autotuning grows the receive buffer only as the
  application drains it, and the client stops pulling after 4 KiB. In-flight data should therefore stay at a few
  hundred KiB plus Pekko's read buffers. It is red today: `toStrict` reads past 8 MiB and then fails.
- **M3 and M4 predictions are correct.**
  - M3 (back to `toStrict(30.seconds)`): `/huge` gives `Request failed` and `/endless` times out.
  - M4 (no limit in the count fold): the chunked `limit + 1` connection test returns `Right(())`. The Content-Length
    variant stays green because of the pre-check, and the design correctly names only the chunked case.
- **The M1 prediction is under-specified.**
  - On the driver spec: `/multibyte` at 1000 B decodes to 333 code points, so 343 with the prefix, with no marker, and
    goes red. `/big`, `/surrogate`, `/short`, `/huge` and `/endless` (all ASCII) stay green. `/malformed` stays green
    only if its filler is ASCII, and the design does not say what the filler is.
  - On the helper spec: the D6 relation test (`MaxBodyBytes >= 4*MaxCodePoints+4`) goes red, as it should. Task 3.1
    says "exactly /multibyte", which contradicts that. See CR3.
- **Round-1 CR2 (the `require` making M1 vacuous) is resolved.** D2 now uses a spec test, not a `require`.
- **Round-1 CR3 (name the accessor) is resolved in intent.** The key is named and `forClient` is rejected with a
  reason. The named call does not compile (CR1).
- **Round-1 non-blocking notes:**
  - Addressed: the malformed-input guard was added, D5's visible change is stated in proposal.md, and the D4
    Content-Length pre-check is kept.
  - Still inconsistent: the slack wording. spec.md says "a few network chunks" and design.md says `k = 4`.
- **The success-path guard cannot fail on a wrong limit.** No mutation covers the D3 limit value. The guard
  ("2xx body of `limit + 1` stays `Request failed`") does not say whether `limit` is a literal or comes from the
  production accessor.
  - If it comes from the accessor, a wrong accessor moves the test body with it.
  - If the limit is too large, the `limit + 1` body still fails.
  - If the limit is too small (for example 4 MiB), `limit + 1` still fails.
  - Nothing checks that a body of exactly 8 MiB still succeeds.

  AC 3 ("unchanged") therefore has no failable guard. See CR2.
- **The D5 test would pass without the change.** The `fetchUrl` case is "one added case with a large non-2xx body",
  with no size, no red requirement and no byte measurement. Any body under 100 MiB already gives
  `Upstream returned HTTP <code>` today, so it passes with or without D5. See CR4.
- **Scope and contracts.** All three ACs are covered by tasks. No API, schema or frontend change, so no contract delta
  is needed. The spec delta matches the design. There is no product decision the ticket leaves open: the success path
  is unchanged and the error-path change is the ticket's purpose. No ESCALATION.

### Verdict: REFUTE

The design is close. Four test-plan or implementability defects remain. Each one either stops the code compiling as
written or leaves a guard or mutation unable to prove what it claims.

### Change Requests

1. **D3 names an internal API that does not compile from helio code** (design.md D3, task 2.2).
   `getPossiblyInfiniteBytes` exists only on `@InternalApi private[http] class EnhancedConfig`, through the
   `private[http]` implicit `enhanceConfig` (`EnhancedConfig.scala:27,55-58`, `impl/util/package.scala:49`).
   Required:
   - Replace the call with a local helper that reproduces it exactly: read
     `system.classicSystem.settings.config`, key `pekko.http.parsing.max-to-strict-bytes`; if `getString` equals
     `"infinite"` return `Long.MaxValue`, otherwise return `getBytes`. Cite `EnhancedConfig.scala:55-58` as the source.
   - Keep the "identical to `toStrict(timeout)`" claim, now justified by matching key, config and logic, not by
     calling the same method.

2. **The success-path limit guard must be literal, two-sided and failable** (design.md D6 "Success-path guard",
   task 1.4). Required:
   - Use the literal `8388608` in the test, not the production accessor.
   - Assert both sides of the boundary, on fetch and on connection test: a 2xx body of exactly 8388608 bytes succeeds
     (fetch parses it as JSON, connection test returns `Right(())`). A body of 8388609 bytes gives `Request failed`,
     chunked and with Content-Length.
   - Add a mutation M5: change the driver's 2xx limit, for example halve it and also double it. Predict which side
     goes red (halved: the exactly-8-MiB case; doubled: the chunked `+1` cases) and record the red.

3. **Make M2 exercise the byte assertion, and make the M1 prediction exact** (design.md D6 mutations, task 3.1).
   - **M2.** At 4 MiB the red is the 15 s `await` timeout, the same red M3 already shows. No mutation proves that the
     emitted-byte assertion (<= 5120) can fail.
     - Required: change M2 to a limit that completes inside the await, for example 16 KiB (64 chunks, about 3.2 s,
       about 16384 emitted bytes). Predict the red as the emitted-count assertion, not a timeout.
     - Apply the mutation at both call sites, so both the fetch and the connection-test cases go red. Recording the
       4 MiB variant as well is optional.
   - **M1.**
     - Fix `/malformed`'s filler as ASCII, so its result under M1 is determined.
     - Scope "exactly `/multibyte` goes red" to the driver spec file.
     - State that the helper spec's relation test also goes red under M1 (expected, and correct).

4. **The `fetchUrl` (D5) test must be red today and must show that reading stopped** (design.md D6 "`fetchUrl`",
   task 2.4). A large non-2xx body under 100 MiB returns `Upstream returned HTTP <code>` with or without D5.
   Required:
   - Specify the case as a paced never-ending non-2xx body, for example the `/endless` route. Today it ends in a 30 s
     timeout and `Request failed`, past a 15 s await, so it is red. After D5 it returns
     `Upstream returned HTTP 500` promptly.
   - Optionally assert the same emitted-byte bound.
   - Add it to the red-first evidence (task 1.3 or 1.5).

### Non-blocking notes

- **Read the counter in a callback.** Read the `/endless` counter in the driver future's `onComplete` callback, or
  capture it in the stub when the server sees cancellation. Reading it after `Await.result` returns adds a small
  thread-wakeup gap to the 200 ms slack.
- **Keep the counter per request.** Make the emitted counter per request (reset per request, or keyed by a query
  parameter), not one cumulative global. The fetch and connection-test cases each hit `/endless`, and in a red run the
  previous stream keeps emitting for 30 s.
- **The new guards use the production `cap`.** They compute their expected values with `cap(...)`, unlike the
  existing stub's literal convention. That is acceptable, because the literal `/big` and `/surrogate` cases still pin
  `cap` itself. A one-line comment saying so would help.
- **Align the slack wording.** Change spec.md's "a few network chunks" to match design.md's `k = 4` statement.
