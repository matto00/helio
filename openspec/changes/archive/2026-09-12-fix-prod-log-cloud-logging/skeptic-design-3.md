## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 11f448fae67877fb0859ee3102fc4e9f04f13765 (planning artifacts uncommitted in worktree).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/prod-logs-missing-cloud-logging/HEL-1128`.
- Round-2 CR1 (content, not presence): tasks.md 1.4(a) requires `unzip -p ... META-INF/services/org.slf4j.spi.SLF4JServiceProvider`, printing every line. 1.4(b) diffs the jar's `logback.xml` against `backend/src/main/resources/logback.xml`. 1.4(c) lists competing `logback*.xml`/`log4j2.*` files. design.md Decisions spells out the concat/first merge mechanism and says `jar tf` proves nothing. ADDRESSED.
- Round-2 CR1(d) (debug flags): task 1.5 runs both LOG_FORMAT branches with `-Dslf4j.internal.verbosity=DEBUG -Dlogback.debug=true`. It records the bound backend, the loaded config and any extra WARN/ERROR. ADDRESSED.
- Round-2 CR1 (verbatim 13 status lines): design.md Context 3a transcribes all 13 lines, including the two WARNs and the `jar:file:/app/helio-backend.jar!/logback.xml` resource URL. It also interprets `ExecutionStatus=DO_NOT_INVOKE_NEXT_IF_ANY`. ADDRESSED. I cannot re-query gcloud and accept the transcription as a claim. It fits the round-2 ticket evidence.
- Round-2 CR2 (red-before-green, jar/image-level): task 3.1 requires recorded failing output before the fix and passing output after it. For a packaging-level cause, it must run the real jar/image and assert that a named app log line reaches stdout. It rules out config-text assertions for that case. ADDRESSED.
- Non-blocking note (CORS_ALLOWED_ORIGINS): added to task 1.2, with an explicit confirm-irrelevant alternative. ADDRESSED in tasks.md.
- No new contradictions, placeholders or scope drift found. C1/C2 are intact. The cd-backend.yml hardening is still clearly labelled as not the fix.

### Verdict: CONFIRM

### Non-blocking notes
- The cross-reference typo is still only half fixed. design.md Risks says "keeping task 1.5 open-ended", but after renumbering the open-ended probe-confirm task is 1.6 (1.5 is the debug-flags run).
- design.md Decisions' first bullet env list still omits `CORS_ALLOWED_ORIGINS`. tasks.md 1.2 has it, so the tasks govern execution, but the list should be synced.
- design.md Decisions (e) says "prod's stderr sample already showed two WARN lines (the deprecated `<if condition>`...)". Context 3a places those WARNs in the 13 stdout lines, while stderr has the add-opens warning and the SLF4J replay notice. Minor inconsistency.
- Round-2 CR1(c)'s bridge-class scan (`org/slf4j/nop/`, `org/apache/logging/slf4j/`, etc.) is not in 1.4(c). Task 1.5's SLF4J DEBUG binding report covers the same question at runtime, so this is not blocking.
- Highest-value lead: SLF4J replayed 1 intercepted call, yet no app line appears afterward. Combined with 1.5 output, that should settle provider binding versus appender attachment quickly.
