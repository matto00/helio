## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: d9612486fa2be6de7ce1fefed78b7f70a57366b2. Live base, resolved with resolve-review-base.sh (main/origin): 7292f77d60ff9f46cf3fc94ce83c1f110b92139f.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/owner-id-guard-public-routes/HEL-1248`.
- **Scope:** `git diff --stat BASE...HEAD` lists two code files, both test-only: `PublicRouteOwnerIdLeakApiSpec.scala` and `testsupport/PublicRouteScanner.scala`. Everything else is change-dir artifacts. **`backend/src/main` is untouched.** There is no migration and no frontend change.
- **Gates re-run by me:** `sbt -J-Xmx3g "testOnly ...PublicRouteOwnerIdLeakApiSpec ...PublicRouteOwnerIdLeakSpec com.helio.testsupport.* com.helio.testkit.*"` (lane DB env, nice 19) exited 0.
  - Totals: `Suites: completed 8, aborted 0`; `Tests: succeeded 60, failed 0`.
  - All 6 ApiSpec tests and all 8 PublicRouteOwnerIdLeakSpec tests are listed as run.
  - Log: `.concertino/scratch/HEL-1248/skeptic-final-run1.log`.
- **AC tracing:**
  - **AC1 (enumerate):** proposal.md and design.md Context list the unauthenticated region of `ApiRoutes.routes`: health, auth/oauth/mfa verify, PublicDashboardRoutes, PublicUploadRoutes, ConnectorCompletionRoutes. This matches `ApiRoutes.scala` lines ~915-965 as I read it.
  - **AC2 (anonymous calls):** each route has guarded cases. I checked the following against the spec source:
    - uploads: success, stranger, unknown and malformed.
    - connectors/completion: GET and POST, covering missing, unknown, expired, completed, stranger, empty token and empty credential.
    - history and insight: 8 caller scenarios.
    - /health.
    - auth error bodies: both email casings, unknown email, duplicate register, MFA unknown challenge, MFA bad code, bad backup code, OAuth start `Location`, and OAuth callback with bad and missing state.
  - **Non-vacuity:** the history and insight bodies are asserted (`Revenue is up.` and non-empty `points`). Ownership positive controls hold for the upload, the connectors, `findByEmail("OWNER@Example.Test")` and the MFA challenge from a correct login. Every guarded call asserts the status is below 500 and not 429.
- **Mutation spot-check, reproduced independently:** I planted `"sk " + user.id.value` in AuthService's wrong-password branch. The result was RED: `[login wrong password] POST /api/auth/login (status 401) leaked owner id ... at: $.message`. I reverted it and `git status` is clean. Log: `.concertino/scratch/HEL-1248/skeptic-final-mut-login.log`.
- **Structural-check claim probe: found an uncaught shape outside the owner ruling.**
  - I appended `~ path("leak1248") { get { complete("leak") } }` after the closing brace of `pathPrefix("api") { ... }` in `ApiRoutes.routes`. This is the same top-level position `health.routes` occupies.
  - The full ApiSpec stays **GREEN** (6/6, exit 0). Log: `skeptic-final-mut-toplevel.log`.
  - A probe request in the same harness shows the route is reachable anonymously: `SKEPTIC-PROBE status=200 OK body=leak`. Log: `skeptic-final-mut-toplevel-reach.log`.
  - Both edits were reverted, and the tree is clean at d9612486f.
  - **Cause:** `PublicRouteScanner.scan` cuts its region at `indexOf("authDirectives.authenticate {")` (PublicRouteScanner.scala:49-51). Nothing textually after that point is ever classified. That covers anything after the `/api` block's close, and any outer-concat sibling after the authenticate block.
  - Siblings inside `/api` after `authenticate` are not reachable anonymously, because `authenticate` completes 401 (AuthDirectives.scala:80-90). A top-level mount after the `/api` block, for example `/.well-known/...` or `/metrics` beside `/health`, IS reachable.
  - A `~ new XRoutes(...).routes` in that position would be missed the same way. It is the same region cut, not the n1/n2 parenthesis shape and not the allow-listed-helper body.
- **Documentation vs. behavior.** Three places claim more than the scanner checks:
  - `specs/public-dashboards/spec.md:21` ("WHEN a route class is mounted in the unauthenticated or optional-auth part of the route tree ... THEN ... fails").
  - `design.md:94` ("it fails on a new unauthenticated mount").
  - `proposal.md:20` ("fails when a route class is mounted in the unauthenticated part of `ApiRoutes.routes`").

  The probe above is a counterexample to all three. The "Known shapes" scenario and the scanner scaladoc list only n1/n2 and the helper bodies. This shape is outside the accepted owner ruling, so the overclaim stands.

### Verdict: REFUTE

### Change Requests
1. **Close the region gap (preferred).** In `backend/src/test/scala/com/helio/testsupport/PublicRouteScanner.scala:48-51`, stop discarding everything after `authDirectives.authenticate {`. Instead:
   - Find the matching close of that block (reuse `matching`).
   - Classify the text of `val routes` both before the block AND after its close (to the end of the member).
   - Any mount or unknown token in the trailing text should then fail as unclassified, the way the leading region already does. Today that text should be only closing braces and parentheses, so the check stays green.
   - Add a structural mutation to `mutation-structural.txt`: append `~ path("leak1248") { get { complete("leak") } }` after the `pathPrefix("api")` block. It must go RED. Revert it afterwards.
2. **If CR1 is not taken,** document this shape as a third known uncaught shape in the scanner scaladoc, the design.md "D4 known limitation" paragraph and the spec delta's "Known shapes" scenario. Also narrow spec.md:21, design.md:94 and proposal.md:20 so they claim only mounts textually before the `authenticate` block. This needs the same owner/HEL-1881 treatment as n1/n2, and is not something the skeptic can accept unilaterally.

### Non-blocking notes
- When any guarded case fails partway, the structural test also fails ("declared but no guarded request issued"), because `sent` is shared mutable state. This is fail-closed and harmless, but it adds noise to every mutation log.
- The guarded case "GET no token" on connectors/completion asserts no specific status, only below 500.
