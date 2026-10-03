## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket.md, proposal.md, design.md, tasks.md, specs/rest-api-connector delta.
- Checked code claims: RestApiConnectorDriver.scala:334-345 and 369-380 do singleRequest(settings=guardedPoolSettings) then flatMap toStrict(30s), recover logs "REST source request failed" -- matches design; toStrict precedes the status branch (H4 unlikely, as stated). ContentSourceSupport.fetchUrl (line 336-352) has the identical singleRequest+toStrict shape; pinnedPoolSettings exists at :308 (per-request pool settings, H2 plausible).
- AC coverage: root cause + prompt consume (Decision 1/2, task 2.1); red-then-green test (1.1, 2.1, 2.2 mutation check); no timeout-only bump (Non-Goals, Decision 2); other-connector audit (Decision 3, task 3.1). All four ACs covered. Spec delta present for the behavior requirement.
- No TBD/placeholders; no proposal/design/tasks contradictions. Backend gate command in 4.1 is `sbt testFull` as required.

### Verdict: CONFIRM

### Non-blocking notes
- Fix shape is intentionally deferred to probe results; acceptable because Decision 1 forces escalation if unreproduced, and Decision 2 constrains the fix. The executor must record the red output with the exact TimeoutException message.
- The audit (3.1) should also cover HttpResendEmailSender, HttpClaudeTransport, OAuthRoutes singleRequest callers if the cause is in shared pool/dispatcher code (they share the toStrict shape); at minimum name them in the follow-up/record.
- Task 1.1 should keep the repro deterministic (saturate dispatcher / delay continuation) rather than timing-lucky, and the mutation check in 2.2 should revert the fix, not just the test.
