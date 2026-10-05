## Skeptic Report - design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Pekko 1.1.0 testkit sources (coursier cache): RouteTestTimeout.default is `implicit def default(implicit system)` in the companion (implicit scope); `~>` injectIntoRoute (RouteTest.scala:172,212) takes `implicit timeout: RouteTestTimeout` resolved at the spec's call site. Lexical/inherited implicit member therefore beats the companion default; a subclass-defined implicit beats an inherited one by the derived-class rule (D1 holds).
- `grep RouteTestTimeout backend/src`: only PublicRouteOwnerIdLeakSpec.scala:22,48 (private implicit val, 15s). No other implicit to collide with; no name clash with `routeTestTimeout`.
- Mixin count: 115 files mention ScalatestRouteTest; non-`with` mentions are imports/comments, consistent with the claimed 113 mixins. No multi-line `with\n ScalatestRouteTest` (PCRE grep: none), so the D4 regex covers the tree.
- build.sbt:186 forks use `workingDirectory = Some((Test / baseDirectory).value)` = backend/, so D4's `src/test/scala` relative scan root is right; D4's non-vacuity asserts would catch a wrong cwd anyway.
- Latency specs (AuditMutationInstrumentation, ApiTokenAuth, GoogleOAuthRoutes, DatasetWriteSubmitLatency, etc.) use nanoTime/currentTimeMillis; none read RouteTestTimeout; no spec references "neither completed" or timefactor.
- AC coverage: AC1 (D1,D3,D4), AC2 (D3 + D6 targeted runs), AC3 (D5), AC4 (D3 import-only, 4.4 diff check), AC5 (D6 Red A/B/C + Green with limits), AC6 (4.4). No placeholders/TBDs; D2 has an explicit escalate rule; D5 has numeric decision rule.

### Verdict: CONFIRM

### Non-blocking notes
- D3 (migrate all 113) is the right call versus a hand-picked DB subset: the timeout is inert without a Route request, latency specs only change mixin/import lines, and bounds are untouched, which satisfies "leave latency specs alone".
- D4 guard only matches `with|extends ScalatestRouteTest`; a spec using bare `RouteTest` or an anonymous `new ScalatestRouteTest {}` would bypass. Consider also matching `\bRouteTest\b` mixins; low risk.
- `this: Suite =>` self-type is redundant (ScalatestRouteTest already extends TestSuite); harmless.
- Red A may be 0 locally; Red B (lowered constant) is the real proof the trait value binds. Keep reporting that limit honestly.
- 15s also lengthens failure of a genuinely hung request; accepted in the design.
