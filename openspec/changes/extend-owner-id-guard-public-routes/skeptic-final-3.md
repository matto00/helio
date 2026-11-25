## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `fc872a2b9e72a361617f51b5a1cef4f305f034c2`. The base came from `resolve-review-base.sh`: `7292f77d6` (origin/main), which is an ancestor of HEAD.
Scope (owner ruling): the 17-route owner-id guard only. The structural check has moved to HEL-1881 and was not assessed.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned READY on the expected branch.
- **(e) Main code unchanged:** `git diff 7292f77d6 HEAD --stat -- backend/src/main` is empty. The only code in the diff is the new test `PublicRouteOwnerIdLeakApiSpec.scala`; everything else is change-dir docs and evidence. The worktree was clean before and after my review.
- **(a) Anonymous route enumeration, from `ApiRoutes.routes` (ApiRoutes.scala:915-1191):**
  - `health.routes` serves `/health`.
  - `pathPrefix("auth") { auth.routes, oauth.routes, mfa verifyRoute }` serves register, login, google, google/callback and mfa/verify (AuthRoutes.scala:39/50, OAuthRoutes.scala:102/113, MfaRoutes.scala:37). `logout` sits inside `authenticate`.
  - `optionalAuthenticate { PublicDashboardRoutes, PublicUploadRoutes, ConnectorCompletionRoutes }` serves:
    - 8 panel routes: panels, rows, filter-capabilities, distinct-values, output-meta, history, insight, provenance (PublicDashboardRoutes.scala:63-211);
    - `GET uploads/image/:id`;
    - `GET` and `POST connectors/completion`. The `completion-token` and `pending` routes are separate classes mounted inside `authenticate`.
  - Everything else is inside `authenticate`. `Main.scala:333` binds only `apiRoutes.routes`, and `HttpServer` adds nothing.
  - That is 17 routes, and the spec exercises all 17.
- **(f) Re-run:** `sbt testOnly PublicRouteOwnerIdLeakApiSpec PublicRouteOwnerIdLeakSpec com.helio.testsupport.* com.helio.testkit.*` ran 8 suites, 59/59 passed, exit 0. Log: `.concertino/scratch/HEL-1248/skeptic3-run1.log`.
- **(b) Non-vacuity.** I added a temporary status/body probe to `guarded` (reverted with `git checkout`). It printed 148 guarded requests (`skeptic3-probe.log`):
  - No 5xx or 429 anywhere.
  - Public dashboard and share-token/viewer reads return real seeded content with 200: rows `east`, filter-capabilities, distinct-values, output-meta schema, history points, and insight `Revenue is up.`. Private, wrong-token and stranger requests get the 404 "Dashboard not found".
  - Upload returns 200 with `PNG-BYTES-1248` for both anonymous and stranger callers; unknown and malformed ids return 404.
  - Completion GET with a valid token returns 200 `{"authType":"bearer"}`. Every refusal returns the fixed 400 body. No-token GET returns 401.
  - Login and register errors for the owner's email in both casings return 401 and 409. MFA verify with an unknown challenge, and with a valid challenge plus a bad code, returns 401.
  - Google start returns 302 with a `Location` header, which was guarded. The callback with a bad or missing state returns 400.
  - Ownership positive controls are asserted in the spec: `findByEmail("OWNER@Example.Test")` returns ownerId, the correct-password login returns an MFA challenge, and the upload owner, connector owner/pending flag and token row are all checked.
- **(c) Mutations I applied myself** (in main code, run against the HEAD spec, then reverted with `git checkout`; `git status` was clean afterwards). Log: `skeptic3-mut.log`.
  - Owner-entity kind: in `PublicPanelInsightResolver.scala` I appended `output.ownerId.value` to the public render's markdown. The spec went red: `[anonymous / public] GET .../insight (status 200 OK) leaked owner id ... at: $.render.markdown`.
  - Literal kind: in `HealthRoutes.scala` I set the status to `"ok 0badc0de-1248-..."`. The spec went red: `[health] GET /health (status 200 OK) leaked owner id ... at: $.status`.
  - 3 passed, 2 failed, exactly as expected.
- **(d) Docs:**
  - The spec delta (`specs/public-dashboards/spec.md`) lists the full route set and makes no claim about catching new routes.
  - `proposal.md`, `design.md` D4, `tasks.md` 1.3/3.2 and the spec scaladoc (lines 41-42) all say the structural check is not part of this change and moves to HEL-1881.
- **Ticket ACs:**
  - Enumeration: design.md Context.
  - Anonymous calls per new route: traced above.
  - Per-route mutations: the `mutation-*.txt` files, plus my two re-applications.
  - Structural check: owner-ruled to HEL-1881.
  - No behaviour change and no leak found: the main-code diff is empty.
  - Backend tests only: confirmed.

### Verdict: CONFIRM

### Non-blocking notes

- Provenance through `ApiRoutes` is error-body-only. The spec does not pass `pipelineRunRepo`, so `provenanceServiceOpt` is `None` and every provenance call returns 404 "Output not found". The provenance success body is still guarded by the sibling `PublicRouteOwnerIdLeakSpec` (it builds `ProvenanceService` directly), so overall coverage holds. Passing a `PipelineRunRepository` here would close this.
- The committed `mutation-*.txt` evidence was captured against the pre-reduction spec. For example, `mutation-connectors-completion-stranger.txt` shows the removed `should have exactly the scanned set declared` test failing. `evaluation-4.md` also assesses the removed scanner. These are history; my own two mutations re-establish the property against HEAD.
- Some doc text is stale:
  - `proposal.md` "What Changes" and "Impact" say `PublicRouteOwnerIdLeakSpec` gains the cases, but a sibling spec was used.
  - `design.md` D1 says the HEL-1216 walk is "now passed real OutputHistoryService", but that spec is unchanged.
  - `design.md` Goals has a broken fragment ("a (a structural check ...").
  - D5 still refers to "D4(b)'s unresolvable rule" and the "red-first structural evidence".

No gate defect: no report I drilled into relied on mtime ordering.
