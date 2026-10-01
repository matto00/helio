## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 0a8e2896abb18971b9b57eb23b7150f29f79c5a0 against base fe124863.

### What I verified (with evidence)
- Read ticket, design, spec, V113, AuthService/Scheduler diffs, ProductEventService, track.ts, useFirstDashboardRendered.ts.
- Mutation 1 (purge exemption removed from ProductEventRepository purge SQL): ProductEventRepositorySpec "never purge signup_completed or first_dashboard_rendered" FAILED ("3 was not equal to 1", spec line 192). Caught.
- Mutation 2a (V113 FORCE ROW LEVEL SECURITY removed): isolation test and mismatched-user-insert test FAILED. Mutation 2b (policy USING (true)): cross-user isolation test FAILED ("1 was not equal to 0"). Caught. Harness runs Flyway/app pool as NOSUPERUSER NOBYPASSRLS owner, so RLS tests are non-vacuous (d: V113 under non-BYPASSRLS owner is exercised; explicit GRANTs to helio_privileged present).
- Mutation 3 (recordSignup call deleted from AuthService.register): AuthServiceSpec "records exactly one signup_completed" FAILED. Caught.
- All mutations reverted (git status clean except the evaluation report); HEAD unchanged.
- (e) Purge-exemption deviation IS disclosed in proposal, design decision 4, and the Retention requirement of the spec. Good.

### Verdict: REFUTE

### Change Requests
1. Google OAuth signup emits no signup_completed (AuthService.completeOAuth, ~line 204-214: `wasCreated` already computed and used only for audit). Epic headline metrics are signups/day and TTFD; TTFD excludes users without signup_completed by design (decision 9), so every Google-created user is silently and permanently dropped from both, biasing the measured population toward password signups. None of proposal/design/spec states this (the evaluator flagged it as a suggestion only). This is a correctness gap in the change's own metric definitions, not merely a limitation. Fix: in completeOAuth, when `wasCreated`, call `productEventService.recordSignup(user.id)` (best-effort, same as register) and add a test mirroring AuthServiceSpec's register test. Minimum acceptable alternative: document the exclusion explicitly in design.md decision 9 and the TTFD/Signup spec requirements AND file a follow-up ticket; but given it is a one-line change in the same class that already does the audit, fixing is the expected resolution. A Google-created user's first dashboard event would otherwise also never pair with a signup.
2. Client once-per-user flag set before delivery is confirmed (useFirstDashboardRendered.ts: `track(...)` then `markEmitted(userId)` immediately). If the batch is later dropped (any non-429/5xx 4xx in track.ts send()), the event is never re-emitted and that user never yields a TTFD sample. Server dedupe already makes re-emission safe, so either set the flag only from a delivery-confirmed callback, or at minimum state in the design that a dropped first_dashboard_rendered is not retried. Lower severity than (1); fix or document.
3. track.ts localStorage queue (`helio.telemetry.queue.v1`) is not user-scoped. Events queued by user A and flushed after user B logs in are attributed to B server-side (session-derived user id). For first_dashboard_rendered this gives B a wrong occurred_at (possibly earlier than B's signup -> excluded, or a wrong TTFD) and the once-per-user unique index then rejects B's real event. Scope the queue to the user id (store userId per queued event and drop/skip mismatches on flush, or clear on logout/login change). Shared-browser scenario; fix or explicitly disclose.

### Non-blocking notes
- Per-user flag key is user-scoped (good); only the queue is not.
- Backend/frontend full suites: relied on the evaluator's pasted counts (5020 sbt, 4062 jest); I re-ran only the targeted specs above. No HEL-1215 flake observed in my runs.
- Did not run the UI (non-visual change, no markup/style diff).
