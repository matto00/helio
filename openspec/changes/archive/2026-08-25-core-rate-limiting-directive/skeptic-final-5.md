## Skeptic Report — final gate (round post-split-2, skeptic-final-5.md)

Narrow re-review of commit `1667758a`, which addresses the two documentation-only
Change Requests from skeptic-final-4.md. Per the orchestrator's scoping, code and tests
were independently confirmed clean in round 4 and were not re-audited from scratch; the
full backend suite was re-run as a fast regression confirmation.

### What I verified (with evidence)

**CR1 — files-modified.md staleness (RESOLVED)**

`git diff --stat c915b100...HEAD` lists exactly these non-artifact files:
`CLAUDE.md`, `ApiRoutes.scala`, `RateLimitDirective.scala`, `InMemoryRateLimiter.scala`,
`RateLimitConfig.scala`, `RateLimiter.scala`, `RateLimitDirectiveSpec.scala`,
`InMemoryRateLimiterSpec.scala`. The rewritten files-modified.md file list matches this
set exactly — no file claimed that is absent from the diff, no source/test file in the
diff left undescribed.

Spot-checks of specific claims against the diff:
- *"application.conf and infra/deploy-backend.sh are net-zero from base"* — confirmed:
  `git diff c915b100...HEAD -- backend/src/main/resources/application.conf infra/deploy-backend.sh`
  produces **0 lines** of output. The "Scope split" section's explanation of why they are
  absent from the file list is accurate, and pre-empts exactly the misreading it needs to.
- *"`trustedProxyHops` was added and then removed during delivery"* — confirmed:
  `grep -rniE "trustedProxyHops|TRUSTED_PROXY|x-forwarded|remoteAddress|remote-address"`
  across `backend/src/main`, `backend/src/test`, `infra`, and `CLAUDE.md` returns **NONE**.
  No IP-keying remnant survives anywhere in the shipped tree. `RateLimitConfig.scala` read
  in full: two fields only (`requestsPerWindow`, `windowSeconds`), matching the description.
- *ApiRoutes wiring — "immediately inside `requireCsrfHeader`, outermost, wrapping
  `confineScopedToken` and the entire three-way auth branch"* — confirmed by reading the
  actual `ApiRoutes.scala` hunk: `rateLimitDirective.rateLimit() {` opens directly inside
  `authDirectives.requireCsrfHeader {` and above the `confineScopedToken` comment block,
  with its closing brace at the outermost position. The description is literally correct.
- *CLAUDE.md — "including the per-instance Cloud Run caveat and an explicit statement that
  unauthenticated/invalid-credential requests are not currently rate-limited (deferred to
  HEL-837)"* — confirmed: the added lines contain `RATE_LIMIT_REQUESTS_PER_WINDOW`,
  `RATE_LIMIT_WINDOW_SECONDS`, `max-instances`, `per-instance`, `not currently rate-limited`,
  and `HEL-837`.
- *Test enumerations* — confirmed test-by-test. `RateLimitDirectiveSpec` contains all seven
  named behaviours plus the three pass-through tests (unauthenticated / invalid session
  cookie / unresolvable PAT bearer). `InMemoryRateLimiterSpec` contains all five, including
  the claimed "window-boundary burst" one (`"accept more than \`limit\` total requests across
  repeated window-boundary resets (documented fixed-window limitation)"`). My first grep
  truncated that name; re-reading the file directly confirmed it exists — a measurement
  artifact, not a doc defect.

**CR2 — proposal.md still describing IP keying as shipped (RESOLVED)**

Read proposal.md in full and diffed the change. Both flagged locations are corrected:
- "What Changes" key-resolution bullet no longer says *"client IP fallback when
  unauthenticated"*; it now states the split explicitly, names HEL-837, points at design.md's
  "Scope split" section, and states the actual shipped behaviour (unkeyable requests pass
  through unconditionally, not throttled).
- "New Capabilities" no longer reads "per-user/per-PAT/per-IP" — now "per-user/per-PAT" with
  a parenthetical deferral note naming HEL-837 and design.md.

Remaining mentions of rate limiting in proposal.md were checked for consistency: the "Why",
"Impact", and "Non-goals" sections make no IP-keying claim. No surviving statement anywhere in
proposal.md describes IP-based keying as shipped.

**Regression confirmation**

`sbt -batch compile test` in `backend/`: `[success]`, `Tests: succeeded 3391, failed 0,
canceled 0, ignored 0, pending 0`, `Suites: completed 215, aborted 0`. Green, as expected —
`1667758a` touches only two markdown files.

**No UI changes** in this diff (backend + docs only), so the design-standard/screenshot review
does not apply.

### Verdict: CONFIRM

Both round-4 Change Requests are fully and accurately resolved. The documentation now matches
ground truth: every specific claim I spot-checked in files-modified.md is corroborated by the
actual diff, the two net-zero files are correctly explained rather than silently omitted, and
proposal.md accurately represents the delivered (authenticated-keying-only) scope with a clear
pointer to HEL-837. This ships.

### Non-blocking notes

- The worktree's `scripts/concertino/` predates the current main-repo copy and lacks
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`. I used the main-repo
  copies against this worktree's change dir. Not a defect in this ticket — worth a
  `concertino sync` refresh of the worktree base at some point.
