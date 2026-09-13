## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 11f448fae67877fb0859ee3102fc4e9f04f13765 (planning artifacts are uncommitted in the worktree).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/prod-logs-missing-cloud-logging/HEL-1128`.
- (1) Disproven LOG_FORMAT-unset theory: ticket.md, proposal.md and design.md Context 1 all say the theory is disproven and state that LOG_FORMAT=json is live. Consistent with the repo. `infra/deploy-backend.sh:95` sets `LOG_FORMAT=json` via `--set-env-vars`. `.github/workflows/cd-backend.yml:76` uses additive `--update-env-vars` without it. I did not re-run gcloud myself. I accept the live readings as orchestrator-sourced claims that fit the repo state. PASS.
- (2) Neutral repro against a real DB: tasks 1.1–1.3 require a disposable `postgres:16`, the real Dockerfile image, and both LOG_FORMAT branches with the same observations. Design explains why a missing DB would give a misleading halt(1). PASS.
- (5) cd-backend.yml scoping: proposal, design Decisions and task 2.2 all call it hardening and "NOT the fix". PASS.
- (6) Constraints: C1 (no migration, escalate) and C2 (no deploy, Cloud Run config change or release) are in tasks.md. Non-goals are in proposal and design. PASS.
- (3) Jar-packaging suspect: NOT actionable as written. See CR1. `backend/build.sbt:83-90` shows `case PathList("META-INF","services",_*) => MergeStrategy.concat` and `case x => MergeStrategy.first`.
- (4) Test falsifiability: task 3.1 says "fails against pre-fix, passes post-fix, targeting the confirmed cause" and bans a generic JSON-branch check. The intent is right, but no red evidence is required. See CR2.

### Verdict: REFUTE

### Change Requests
1. **Task 1.4 (and design Decisions, jar-packaging bullet) cannot detect the conflict it names, because of the configured merge strategy.** `build.sbt:86` concatenates `META-INF/services/*`, so `jar tf` will always show exactly ONE `org.slf4j.spi.SLF4JServiceProvider` entry, even if two providers (such as logback plus a log4j/slf4j-reload4j/nop provider pulled in by Spark) were merged into it. `build.sbt:90` (`MergeStrategy.first`) likewise leaves exactly one `logback.xml`. It could be a dependency's copy that won over `backend/src/main/resources/logback.xml`, and it would still be a single entry. "Note the result either way" would then record a false negative. Revise 1.4 to require content inspection:
   (a) `unzip -p helio-backend.jar META-INF/services/org.slf4j.spi.SLF4JServiceProvider` and list every provider line;
   (b) `unzip -p helio-backend.jar logback.xml | diff - backend/src/main/resources/logback.xml`, and the same check for `logback-test.xml`, `logback.groovy` and `log4j2*.xml` present in the jar;
   (c) check for other SLF4J/JUL/log4j bridge classes in the jar (e.g. `org/slf4j/impl/`, `org/apache/logging/slf4j/`, `org/slf4j/nop/`);
   (d) run the image with `-Dslf4j.internal.verbosity=DEBUG` / `-Dlogback.debug=true` to record which provider SLF4J actually bound and which config URL logback loaded.
   Also add a step to record the verbatim content of prod's 13 logback status lines in design.md. Logback prints its status to the console only when a WARN/ERROR is present or debug is on, so those lines almost certainly name the actual warning (e.g. the deprecated `condition` attribute), and they are free evidence the plan currently leaves unread.
2. **Task 3.1 must require captured red evidence.** Add: "run the new test/script against the pre-fix code/config and paste the failing output (red) into the change dir before applying the fix, then the passing output (green) after". Also drop or tighten the "documented script under docs/" escape hatch. If the cause is packaging-level (not unit-testable), the script must run against the assembled jar/image and assert that a named app logger line appears on stdout. Asserting on config text is not enough.

### Non-blocking notes
- design.md Risks says "keeping task 1.3 open-ended", but the probe-confirm task is 1.5. Fix the reference.
- Task 1.2's env list omits `CORS_ALLOWED_ORIGINS`, which prod sets (`infra/deploy-backend.sh:95`). Include it, or confirm that its absence cannot change the startup path being compared.
- stderr in prod showed the SLF4J "1 call replayed" message but not the replayed content. That points at the binding/provider path, which makes CR1's content inspection the highest-value probe.
