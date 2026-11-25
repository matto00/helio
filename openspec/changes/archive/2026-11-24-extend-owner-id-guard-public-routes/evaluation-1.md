## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 5f71bc69b260c01ec28a65b8ec84ae28737ca00d (base 258f80434f11ca9c920f50c0d8777fcff967b278, resolved live).
Diff: 2 new test files (`PublicRouteOwnerIdLeakApiSpec.scala`, `testsupport/PublicRouteScanner.scala`) plus change-dir artifacts. `git diff base...HEAD -- backend/src/main` is empty (verified).

### Phase 1: Spec Review — FAIL
- AC 1 (enumerate unauthenticated routes): met. The red output names the 11 unexercised routes.
- AC 2 (anonymous call per newly covered route, success + 404/refusal/bad-token): met. Cases match design D3.
- AC 3 (mutation per newly covered route): met. 16 `mutation-*.txt` files, each with a stated Kind and Exit 1. I re-ran two owner-entity mutations myself; both went red on the expected case and were reverted:
  - `AuthService.register` conflict branch, planting `found.id.value` → `[register duplicate] POST /api/auth/register (status 409 Conflict) leaked owner id ... at: $.message`.
  - `PublicUploadRoutes` success, appending `upload.ownerId.value` to the bytes → `[owner image, anonymous] GET /api/uploads/image/<id> (status 200 OK) leaked owner id ... non-JSON body contains id`.
- AC 4 (structural check that fails when a new public route is added without coverage): **partially met**. Design D4(b) says: "A mount in the unauthenticated region the scanner cannot classify also fails. The scanner therefore never silently passes an unreadable shape." files-modified.md claims the same. I applied two structural mutations to `ApiRoutes.scala` and both stayed **GREEN** (6/6 passing). Each was reverted afterwards:
  1. An inline route added to the optional-auth `concat`, after `new ConnectorCompletionRoutes(...).routes`: `path("leak1248") { get { complete("leak") } }`. The result was 6 succeeded, 0 failed. `GET /api/leak1248` is now public, and nothing reports it as uncovered.
  2. A bare `Route` identifier mounted in the same `concat` (`extraPublic1248`, declared `private val extraPublic1248: Route = path("leak1248") { get { complete("leak") } }`). The result was 6 succeeded, 0 failed.
  Cause: `PublicRouteScanner.classify` (PublicRouteScanner.scala:71-102) only recognises three mount shapes: `new X(...).routes`, `opt.fold(reject: Route)(_.m)` and `ident.routes`. The only leftover-text check in the region is for extra `pathPrefix(` (lines 55-57). Other text in the region is ignored without any error. That includes `path(`, method directives, bare identifiers, and calls such as `Obj.route`/`helper(...)`. These are the most likely ways someone adds a public route next to the existing three. So the check can pass when it should fail, which is exactly what D4(b) forbids.
- AC 5 (no behaviour change, no leak found): met. The main diff is empty.
- Tasks: all ticked. Item 3.2's four structural mutations reproduce as described in mutation-structural.txt. They do not cover the gap above.
- CONSTRAINTS:
  - C1 holds in substance. The owner user is inserted directly with the fixed id, never via register. `findByEmail("OWNER@Example.Test")` returns ownerId. The correct-password login reaches the MFA challenge. Upload and connector ownership are asserted through repositories.
  - C2 holds. Every mutation file states its Kind, and owner-entity plants are used where design D5 lists them.
  - See the non-blocking notes for two small C1/C2 gaps.

### Phase 2: Code Review — FAIL
Gates (fresh runs, in WORKTREE_PATH, `nice -n 19 sbt -J-Xmx3g`, `DATABASE_URL=…/helio_hel1248`, `DB_USER=$USER`, `ANTHROPIC_API_KEY=` empty):
- Targeted run: `PublicRouteOwnerIdLeakApiSpec` + `PublicRouteOwnerIdLeakSpec` + `OwnerIdGuardSpec`. 20/20 passed, 18 s.
- Shard 1: `api.routes.dashboards.*`, `api.routes.auth.*`, `api.routes.sources.*`, `testsupport.*`, `testkit.*`, `api.http.*`. 51 suites, 723/723 passed, hel1468-guard failed=0 aborted=0 unreadable=0, 163 s.
- Shard 2: `api.routes.{admin,agents,alerts,ask,assistant,audit,firstrun,home,hooks,mcp,panels,telemetry}.*` + `com.helio.api.routes.*Spec`. The trailing glob matched across sub-packages, so this shard covered most of `api.routes`, pipelines/patchsets/proposals included. 190 suites, 2282/2282 passed, guard clean, 518 s.
- Not run: domain.*, infrastructure.*, services.*, spark.*, eval.*, api.protocols.*. Full `sbt testFull` was not run either. The change is test-only and adds two files under `api.routes.dashboards` and `testsupport`, both of which ran.
- `npm run check:scala-quality`: clean. Soft warning: PublicRouteScanner.scala is 268 lines, over the 250 budget, which is informational.
- No frontend change, so the frontend gates are N/A.

Findings:
- **Dead code (CONTRIBUTING "No dead code")**:
  - `backend/src/test/scala/com/helio/testsupport/PublicRouteScanner.scala:266`: `@annotation.unused private val unusedRegex: Regex = "".r` exists only to keep the `scala.util.matching.Regex` import (line 6) used. Remove both.
  - `PublicRouteScanner.scala:41`: `private val Methods = Set(...)` is never referenced. The method regex at line 140 hard-codes the list. Remove it, or build the regex from it.
- Scanner correctness: see the Phase 1 structural gap. The "unresolvable" rule is enforced inside scanned member bodies (I verified the helper-reference and non-block path cases by reading the code, and they match mutation-structural.txt #3). It is not enforced in the `ApiRoutes` unauthenticated region itself.
- Tests are otherwise meaningful:
  - Every guarded case asserts status < 500 and no 429.
  - Headers are guarded as well as bodies.
  - Non-vacuity checks are present: rows contain "east", insight contains "Revenue is up.", history points are non-empty, image bytes match, and the MFA challenge comes from a real login.
  - Upload success and the 404 cases run in the same harness instance, as D3's mount-proof note requires.
- Ordering: the structural test depends on `sent` having been filled by earlier tests in the same suite instance. This works because AnyWordSpec runs tests sequentially in declaration order, and the comment "(runs last)" documents it. Running only that test (`-z`) would fail with "no guarded request issued". That is acceptable because it fails loudly.
- Type safety and security: no concerns. No main code changed.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes in the diff. The delta spec sits under `openspec/changes/`. No servers were started.

### Overall: FAIL

### Change Requests
1. **Make the region classifier fail on anything it does not recognise** (`backend/src/test/scala/com/helio/testsupport/PublicRouteScanner.scala`, `classify`, lines 71-102, and `scan`, lines 50-58). After the three known mount shapes, `pathPrefix("api")`/`pathPrefix("auth")` and the known wrapper directives are blanked out of `rest`, any remaining route-position token in the unauthenticated region must throw `ScanFailure` naming it. Specifically:
   - any `path(`, `pathEnd`, `pathSingleSlash` or method directive (`get|post|put|patch|delete|head|options`);
   - any identifier operand of the `concat(...)`/`~` that is not one of the classified mounts.
   An explicit allow-list of the known wrapper tokens in this region is the simplest robust form, so that unknown tokens fail. The wrappers are `handleRejections`, `cors`, `handleExceptions`, `traceContext.withTraceContext`, `authDirectives.requireCsrfHeader`, `rateLimitDirective.rateLimit(...)`, `authDirectives.confineScopedToken`, `authDirectives.optionalAuthenticate`, `concat` and `~`.
2. **Add the two missed structural mutations to `mutation-structural.txt`** and show that both now go RED:
   - (a) an inline `path("leak1248") { get { complete("leak") } }` in the optional-auth `concat`;
   - (b) a bare `Route`-typed identifier (`private val extraPublic1248: Route = ...`) mounted in the same `concat`.
   Revert both afterwards.
3. **Remove dead code** in `PublicRouteScanner.scala`:
   - line 266, `unusedRegex`, together with the `Regex` import on line 6;
   - line 41, the unused `Methods`.

### Non-blocking Suggestions
- C1/D2 asked for a repository read proving ownership of the history points and the `ok` insight render before guarding. The spec checks their content (non-vacuity) but not their owner. A `pipelineRepo`/`outputRepo` read asserting `ownerId` for the `seedPanels` outputs would close this. The red panel-history and panel-insight mutations, which plant `output.ownerId`, already prove it indirectly.
- `mutation-connectors-completion-get-success.txt` uses a literal. The service's success path (`ConnectorCompletionService.scala:110`, `Right(connector)`) has the connector in scope, so planting `connector.ownerId.value` into the shape would fit C2 more closely. Design D5 does not list this case, so this is a nit.
- `"GET no token"` (spec line 321) has no expected status. Pin it, for example to 400 or 404, whichever the real tree returns, so a future 200 is noticed.
- Possible related gap, not verified: in a mounted member, a route-building helper defined in another object (for example `SomeObject.route`) is not in `helperNames` for that class, so it may pass without an error. Check this when fixing CR1.
