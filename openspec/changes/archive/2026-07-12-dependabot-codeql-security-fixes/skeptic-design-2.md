## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

1. **Round-1 gap (D7) is concretely closed, not just mentioned.**
   - `design.md` D7 (lines 72-86) names the exact file
     (`frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts`), the exact current mechanism
     (`sessionStorage.getItem("helio_auth_token")` + manual `Authorization` header on its own `fetch()`
     to `GET /api/pipelines/:id/run-events`), and makes an explicit, actionable decision: pass
     `credentials: "include"`, delete the sessionStorage/manual-header code, update
     `usePipelineRunEvents.test.ts` to assert `credentials: "include"` instead. A competent implementer
     could execute this without further research — I confirmed against the live source
     (`usePipelineRunEvents.ts:74-84`) that the described code (`SESSION_STORAGE_KEY`, the `token`
     variable, the spread into `headers`) is exactly what's there today, so D7's description matches
     ground truth precisely.
   - `tasks.md` 4.5 (hook fix) and 4.6 (test fix) mirror D7 exactly; `proposal.md`'s Impact section
     (line 49) now lists the file explicitly with a pointer to D7.
   - `tasks.md` 7.8 adds a Playwright scenario for the pipeline run-events SSE flow, scoped to
     "dev, via the Vite proxy — same-origin" — this scoping is *correct*, not an overclaim (see #3
     below): it matches D7's own caveat that the prod path is separately broken, so it doesn't pretend
     to verify something that can't work in prod today.
   - Verdict on this item: **closed, end-to-end** (decision + hook task + test task + live-verification
     task, all consistent with each other and with the actual source file).

2. **Fresh sweep for other untracked consumers of the removed session-token mechanism.**
   Ran my own greps (not trusting round 1's list) across `frontend/src` for `sessionStorage`,
   `Authorization`, and `auth.token`/`state.token`, excluding `.test.` files first, then re-including
   them:
   - Non-test production files touching `sessionStorage`/manual `Authorization`: only
     `authSlice.ts`, `authService.ts`, `httpClient.ts` (all in tasks.md section 4) and
     `usePipelineRunEvents.ts` (now in section 4 via D7/4.5/4.6). **No other production consumer
     found.** Also checked for other `EventSource`/`ReadableStream`/websocket-style hooks that might
     independently build auth headers — none exist beyond this one hook.
   - One test-only finding, not a production consumer: `frontend/src/app/App.test.tsx` (lines 63-64,
     488, 495) also directly pokes `sessionStorage.setItem/removeItem("helio_auth_token", ...)` to
     manipulate `rehydrateAuth`'s early-return-on-no-token behavior (confirmed in
     `authSlice.ts:42-45`, `if (!token) { return null; }`), specifically to make the
     "redirects unauthenticated user from /pipelines to /login" test (line 487) short-circuit
     `rehydrateAuth` without calling `getMeRequest`. After task 4.2.1 lands (`rehydrateAuth` calls
     `GET /api/auth/me` unconditionally), this short-circuit disappears; since `App.test.tsx` already
     mocks `getMeRequest` to always resolve successfully (line 50), removing the sessionStorage token
     will no longer force an unauthenticated state, and that specific test would start failing after
     the migration. This is a genuine, concrete piece of fallout — but it is (a) a test-only artifact
     with no production/security stake, and (b) self-revealing: task 6.3 ("npm test full suite green")
     will catch it immediately, and the fix is mechanical (mock `getMeRequest` to reject for that one
     test case rather than toggling `sessionStorage`), requiring no new design decision. I'm not
     treating this as a blocking gap of the same kind as D7 — noted as a non-blocking item below so the
     executor isn't surprised by it.

3. **Spot-checked D7's "pre-existing, out-of-scope, likely already broken in prod" claim about the
   bare relative URL — confirmed TRUE, not just asserted.**
   - `usePipelineRunEvents.ts:75`: `const url = \`/api/pipelines/${pipelineId}/run-events\`;` — a bare
     relative path, confirmed not routed through `API_BASE_URL`/`httpClient` (unlike every other
     frontend service call).
   - `frontend/firebase.json`: only rewrite rule is `{"source": "**", "destination": "/index.html"}`
     (SPA fallback) — no `/api/**` passthrough to the backend.
   - `frontend/src/config/env.ts:1` / `.github/workflows/cd-frontend.yml:29`: prod's `API_BASE_URL` is
     an absolute Cloud Run origin injected at build time; nothing rewrites relative `/api/*` calls to
     that origin in production.
   - `infra/` has no Cloud Run domain-mapping or CDN config that would proxy `helioapp.dev/api/*` to the
     backend either.
   - Consequence traced through the hook's own logic: in prod, `fetch('/api/pipelines/...')` would hit
     Firebase Hosting's `**` rewrite and get back `index.html` (status 200, `Content-Type: text/html`).
     The hook's own check (`!contentType.includes("text/event-stream")`) would then set
     `connectionError: "Unexpected response: 200"` — i.e. the feature visibly degrades today,
     independent of this ticket. D7's characterization is accurate; scoping it out as a separate
     follow-up (rather than folding a URL fix into a security-remediation change) is legitimate, not an
     excuse to skip the real gap.

4. **Everything round 1 already confirmed** (cross-site prod topology/`SameSite=None` justification,
   CSRF/CORS coherence, PAT carve-out safety, HEL-288 hard-cutover safety, dependency-override
   targeting, spec-delta consistency) — read as established ground truth per instructions; nothing on
   a fresh read of `design.md`/`proposal.md`/`tasks.md` this round contradicts those findings.

### Verdict: CONFIRM

### Non-blocking notes

- `frontend/src/app/App.test.tsx`'s "redirects unauthenticated user from /pipelines to /login" test
  (and its `beforeAll`/`afterAll` `sessionStorage` scaffolding) relies on `rehydrateAuth`'s
  soon-to-be-removed early-return-on-no-token behavior. It isn't explicitly named in tasks.md (only
  generically covered by 6.2's "any component tests relying on `auth.token`..."), but task 6.3's full
  Jest run will surface the failure immediately and the fix is mechanical — no design decision needed.
  Worth a heads-up to the executor so it isn't mistaken for an unrelated regression: after 4.2.1, that
  test should mock `getMeRequest` to reject (401) for the unauthenticated case instead of toggling
  `sessionStorage`.
