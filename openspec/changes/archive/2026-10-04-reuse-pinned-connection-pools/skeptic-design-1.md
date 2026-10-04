## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
Ground truth: main @ 9a57f7aa code; Pekko HTTP 1.1.0 pekko-http-core sources jar from ~/.cache/coursier.
- Claim (1) pool key / settings equality: Http.singleRequest (Http.scala:686) builds the pool id from
  `settings.forHost(host)`; `forHost` (ConnectionPoolSettings.scala:50-53) returns `this` unless a host-override regex matches
  (default overrides empty), so the same settings instance reaches `ConnectionPoolSetup(settings, ctx, log)` (a final case class).
  sharedPoolIdFor (Http.scala:806-814) keys on HostConnectionPoolSetup(host, effectivePort, setup). ClientTransportWithCustomResolver
  is a case class over a lambda (ClientTransport.scala:137), so each fresh lambda is unequal => new pool per call, as design states.
  Caching one settings instance per address does yield reuse. Default https context/log are stable shared values (other clients already rely on this).
- Notable extra fact (strengthens the design): the Pekko pool key already includes the hostname AND the settings, so
  an address-keyed settings cache composes safely: host rebinding A->B yields a different settings => different pool.
- Claim (2) pinning: pinnedTransport (ContentSourceSupport.scala:296) pins to the validated InetAddress; validateAndResolve still
  runs per request at fetchUrl:344 and guardedPoolSettings:328-331 and the design keeps it uncached. A hostname-keyed settings cache
  would return A-pinned settings for B, so the A,B,A two-loopback-server test (Decision 7) genuinely returns the wrong server under that
  mutation (red) and under a single-shared-settings mutation (red). Existing ContentSourceSupportSpec pinning test is single-resolution -
  design correctly notes it does not discriminate.
- Claim (3) limits/keep-alive: reference.conf confirms defaults max-connections=4, max-open-requests=32, keep-alive-timeout=infinite,
  pool idle-timeout=30s, response-entity-subscription-timeout=1s (lines 543/563/626/608/631). 256 is a power of two; maxConnections 16 satisfies
  require()s in ConnectionPoolSettingsImpl. Per-request pools never hit the 32 limit, so explicit raise is a justified regression guard.
  Non-idempotent POST stale-connection risk is real and honestly addressed by short keepAliveTimeout; residual race is disclosed.
- Claim (4) HEL-1245 paragraph: both callers do toStrict inside Future.flatMap (verified in RestApiConnectorDriver.scala:338-343, ContentSourceSupport.scala:350-352);
  it states pooling neither causes nor prevents the subscription timeout and does not re-attribute HEL-1245. Accurate.
- Line citations (:347, :328), caller list, and unpinned clients (Resend/Claude/OAuth) match the code.
- AC coverage: AC1 -> 1.1/2.1; AC2 -> 1.2/3.1/3.2; AC3 -> 2.3/3.3; AC4 -> HEL-1245 section. Spec delta present with four scenarios. No TODO/TBD placeholders; no scope drift.
- Test-restart risk: existing specs bind ephemeral ports per suite (newServerAt(...,0), unbind in afterAll), consistent with design's note.

### Verdict: CONFIRM

### Non-blocking notes
- Spec says concurrent requests are not refused "up to a stated per-destination limit" but the limit (maxOpenRequests 256) lives only in design.md; consider stating it in the spec scenario.
- Decision 7: binding 127.0.0.2 on the same port as an ephemeral 127.0.0.1 port can collide; bind A with port 0 then try B on that port, and keep the stated ::1 fallback (and skip-with-reason rather than silent pass).
- The mutation test should also assert the pool-reuse half (each address's connections counted) so an "unbounded new pool per request" mutation is also red.
- Cache eviction orphans a still-live pool under old settings until its 30s idle shutdown; harmless but worth a comment.
