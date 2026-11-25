## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed HEAD:** b3d30b3656cec3077861a27148e5d1e0b71d5e1c. The base, resolved live, is 258f80434f11ca9c920f50c0d8777fcff967b278.

**What cycle 2 changed** (diff 5f71bc69b..b3d30b365):
- `PublicRouteScanner.scala` now has a leftover-token allow-list for the unauthenticated `ApiRoutes` region. `ident.routes` mounts are now blanked too.
- Dead code is gone: the `Methods` value, the `unusedRegex` value and the `Regex` import.
- `mutation-structural.txt` gains entries #5 and #6.
- `evaluation-1.md` was committed.

The main-code diff is still empty.

### Phase 1: Spec Review — FAIL
Cycle 1's three change requests:

**CR1 (region classifier fails on unclassified constructs): fixed for the region.** I re-applied my own mutations to `ApiRoutes.scala`, ran each, and reverted each:
- **m1:** an inline `path("leak1248") { get { complete("leak") } }` in the optional-auth `concat` went **RED**: `unclassified construct `path``.
- **m2:** a bare Route val (`extraPublic1248`) mounted in the same `concat` went **RED**: `unclassified construct `extraPublic1248``.
- **m3 (new):** a route smuggled through the fold plumbing went **RED**: `unclassified construct `path``. The changed mount was `imageUploadServiceOpt.fold(reject: Route)(svc => concat(new PublicUploadRoutes(svc).routes, path("leak1248") { ... }))`.
- **m5 (new):** a route from another object appended inside the fold went **RED**. The appended reference was `~ _root_.com.helio.api.routes.HealthLeak1248.leak`. The construct was caught, though the message is odd: `cannot resolve `api.routes``.

**CR2 (mutation evidence): done.** `mutation-structural.txt` #5 and #6 match what I observed.

**CR3 (dead code): done.**

**Still open: D4(b) fails inside a mounted member body.** Design D4(b) says: "Inside a scanned member body, any reference to another `Route`-valued identifier, helper method or `~`/`concat` operand that is not a directive literal ... fails the check naming the construct."

My cycle-1 report listed this as a possible related gap and asked for it to be checked while fixing CR1. I have now confirmed it with mutation m4:
- I appended `~ HealthLeak1248.leak` to `HealthRoutes.routes`, which is a mounted member.
- I added `object HealthLeak1248 extends Directives { val leak: Route = path("leak1248") { get { complete("leak") } } }` in the same file.
- Result: **GREEN**, 6/6 passed. The code compiled and `GET /leak1248` became a public route with no coverage entry, and the check did not report it.

The cause is in `scanMember` (PublicRouteScanner.scala, the `scanMember`/`helperNames` code at about lines 118-136):
- `helperNames` only knows the members of the mounted class's own text.
- `classText` cuts the text at the next top-level `class`/`object`.
- So a qualified reference to a Route defined elsewhere is never classified, and the same is true of a constructor-parameter `Route`.

The structural AC ("fails when a new public route is added without coverage") therefore still has a silent-pass path, just one level down from the cycle-1 gap.

**CONSTRAINTS:** C1 and C2 are unchanged from cycle 1 and still hold.

### Phase 2: Code Review — FAIL
**Gates** (fresh runs in WORKTREE_PATH, `nice -n 19 sbt -J-Xmx3g`, lane DB `helio_hel1248`, empty `ANTHROPIC_API_KEY`):
- `testOnly PublicRouteOwnerIdLeakApiSpec PublicRouteOwnerIdLeakSpec com.helio.testsupport.* com.helio.testkit.*` passed: 8 suites, 60/60 tests. The hel1468-guard reported failed=0, aborted=0, unreadable=0.
- `npm run check:scala-quality` is clean. There are soft size warnings only: the scanner is 279 lines and the API spec is 393, against a 250 budget.
- The cycle-1 wide shards (723 + 2282 tests) were not re-run. The only cycle-2 code change is in `testsupport`, and that package ran.

**Findings:**
- The cycle-2 code is clean and readable, and the dead code is removed.
- The Phase 1 member-level gap is the only blocking issue.
- **Nit:** the `RegionWrapperTokens` allow-list includes context-specific identifiers (`svc`, `userOpt`, `tokenScope`, `exempt`). That is acceptable, because each one is only plumbing, and any new token fails loudly.

### Phase 3: UI Review — N/A
There is no UI-triggering change.

### Overall: FAIL

### Change Requests
1. **Fail loudly on unclassified route operands inside scanned member bodies** (`backend/src/test/scala/com/helio/testsupport/PublicRouteScanner.scala`, `scanMember`/`routesIn`). Check every operand of `~` and every top-level argument of `concat(...)` in a scanned member body, including the bodies of `AllowedHelpers` members. Each one must start with one of these, or fail with `ScanFailure` naming the operand:
   - a known route directive: `path`, `pathPrefix`, `pathEnd`, `pathEndOrSingleSlash`, `pathSingleSlash`, `get`/`post`/`put`/`patch`/`delete`/`head`/`options`, or the wrappers the current members actually use;
   - an `AllowedHelpers` name.

   The same applies to the whole member body when it is a single expression. This catches a qualified reference to another object's Route (`Obj.route`) and a constructor-parameter Route.
2. **Add m4 to `mutation-structural.txt` and show it RED, then revert.** m4 is the cross-object Route reference in a mounted member: `HealthRoutes.routes ... ~ HealthLeak1248.leak`, with `object HealthLeak1248 extends Directives { val leak: Route = path("leak1248") { get { complete("leak") } } }` in `HealthRoutes.scala`. Also confirm that mutations #1-#6 still behave as recorded.

### Non-blocking Suggestions
- m5's failure message (`cannot resolve `api.routes``) is misleading, because the `ident.routes` regex matches inside a qualified `com.helio.api.routes.X` path. It still fails loudly, so this is cosmetic. Anchoring the `ident.routes` regex so it does not match after a `.` would give a clearer "unclassified construct" message.
- The cycle-1 non-blocking notes still apply:
  - Add a repository ownership read for the history and insight fixtures.
  - Use an owner-entity plant for the GET completion-success mutation.
  - Give the "GET no token" case an expected status.

### Critical Path (cycle 2 of 3)
- The only blocking item is CR1/CR2 above. It is a small, local change to `scanMember` plus one more piece of mutation evidence.
- Everything else (route coverage, guard cases, owner-entity mutations, the region classifier) has been verified by independent re-runs and re-applied mutations.
- Recommendation: if cycle 3 cannot close the member-level gap, the human should decide whether to ship with that gap documented as a known limitation in design.md. The ticket allowed "otherwise state why not" for structural infeasibility.

Evidence:
- The mutation helper used for m1-m5 is `/home/matt/Development/helio/.concertino/scratch/HEL-1248/mutate.py`.
- Every mutation was reverted with `git checkout -- backend/src/main`, and `git status` was clean after each one.
