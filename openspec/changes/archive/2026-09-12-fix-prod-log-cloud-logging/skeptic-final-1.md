## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 774e39f073d04fc9c6e518996c7034954af981d0. Base resolved live: 11f448fae67877fb0859ee3102fc4e9f04f13765 (origin/main).

### What I verified (with evidence)
- **Diff read directly** (`git diff BASE...HEAD`). There is one commit. `logback.xml` no longer contains `<if>`. Both the `json` and `plain` appenders are always declared. The root logger uses `<appender-ref ref="${LOG_APPENDER}">`, and `LOG_APPENDER` is set to `${LOG_FORMAT:-plain}`. `cd-backend.yml` only adds `LOG_FORMAT=json` to the `--update-env-vars` list, plus a comment. `docs/verify-backend-logging.sh` is new.
- **C1 (no migration):** the diff touches nothing under `backend/src/main/resources/db/`. Confirmed with `git diff --stat BASE...HEAD -- backend/src/main/resources/db`, which printed nothing.
- **C2 (no deploy):** the only change that affects prod is the unexecuted `cd-backend.yml` edit. No deploy, tag or secret action shows up in the diff.
- **sbt test (run by me):** 4246 tests passed, 0 failed, in 277 suites. Output: "All tests passed."
- **docs/verify-backend-logging.sh (run by me against HEAD):** exit 0, `RESULT: PASS`. The captured stdout has real single-line JSON Flyway lines (for example `"message":"Successfully validated 106 migrations..."`, `"severity":"INFO"`). The script really builds the real `Dockerfile` and really runs a `postgres:16` container. Nothing is stubbed.
- **Red probe for the claimed root cause (run by me):** I ran the same built image with the pre-fix `logback.xml`, mounted in through `JAVA_TOOL_OPTIONS=-Dlogback.configurationFile=/old.xml`, and `LOG_FORMAT=json`. Joran printed the two `<if condition>` deprecation WARNs and then "End of configuration". After that, no logger-routed line reached stdout. The FATAL line and stack trace come from the `System.err` catch block, not from logback. This matches prod's 13-lines-then-silence pattern. The root cause is corroborated.
- **Mis-selection probe (run by me, reproduced for two values):** I ran the HEAD image with `LOG_FORMAT=JSON`, and separately with `LOG_FORMAT=text`. For `JSON`, logback's own status output says:
  `WARN ... Appender named [json] not referenced. Skipping further processing.`
  `WARN ... Appender named [plain] not referenced. Skipping further processing.`
  `WARN ... AppenderRefModelHandler - Appender named [JSON] could not be found. Skipping attachment to Logger[ROOT].`
  `INFO ... End of configuration.`
  The root logger ends up with no appender, and no application or Flyway output follows. This is the same silent failure the ticket is fixing. The `text` run showed the same kind of status output. On base, the removed `<if>` used `equalsIgnoreCase("json")`/else, so `JSON` gave JSON output and `text` gave plain output.
- **Binding contract check:** `openspec/specs/structured-json-logging/spec.md` lines 11 and 24-27, the scenario "Unrecognized value falls back to plain text", say: "WHEN ... LOG_FORMAT set to a value other than json THEN log lines SHALL use the human-readable plain-text format". Lines 66-71 require that the appender choice be "expressed so the conditional wraps the root logger". `CLAUDE.md:50` says "Any unrecognized value falls back to `plain`." The change dir has no spec delta and CLAUDE.md is not updated.
- **Valid `json` run:** each startup emits `WARN ... Appender named [plain] not referenced`. This is new status noise but does no harm.

### Verdict: REFUTE

### Change Requests
1. **Restore the "any non-`json` value falls back to plain" behaviour. Right now it is broken, and the failure is silent.** In `backend/src/main/resources/logback.xml` (`<property name="LOG_APPENDER" value="${LOG_FORMAT:-plain}" />` plus `<appender-ref ref="${LOG_APPENDER}">`), any value other than exactly `json` or `plain`, such as `JSON`, `text` or `Json`, leaves ROOT with no appender. That kills all logging, which is the very defect HEL-1128 fixes. My probe output above proves it. The code comment admits this trade-off but calls it "narrower in practice". The binding spec does not allow that trade-off. The fix must still use no `<if>`, and one of these would work:
   - Add a custom `PropertyDefiner` (logback `<define>`) that lower-cases and normalises `LOG_FORMAT` to exactly `json` or `plain`.
   - Attach both appenders and give each a filter, for example a small `Filter` class keyed on the normalised value. This is not Janino `<if>`.
   Either way, prove it by running the built image with `LOG_FORMAT=JSON` and `LOG_FORMAT=garbage`: the first must show JSON output, the second plain output. Put those runs in `design.md`/`files-modified.md`. Also add at least an unrecognized-value run to `docs/verify-backend-logging.sh`, so a regression goes red.
2. **Add a spec delta** to `openspec/changes/fix-prod-log-cloud-logging/specs/structured-json-logging/spec.md`. It must change the requirement at `openspec/specs/structured-json-logging/spec.md:66-71`, which currently requires "the conditional wraps the root logger", a design this change has deliberately and correctly removed. Replace it with the no-`<if>` rationale (HEL-1128). Keep or re-state the unrecognized-value scenario, and make CR1 satisfy it.
3. **Keep `CLAUDE.md:50` true.** If CR1 restores fallback, no edit is needed. If you instead narrow the behaviour on purpose, that is a contract change and needs its own spec delta and a CLAUDE.md update. My recommendation is to restore fallback rather than narrow it.
4. **Wording for the PR and ticket:** no PR body exists yet. The PR body must say plainly that AC 1 and 2 were verified only locally, with the Docker image and real Postgres, and that AC 3, "Verified against a real deploy", is still OPEN and deferred to the driver after the next release cut. It must not claim full AC satisfaction.

### Non-blocking notes
- Removing `<if>` completely is the right general fix. My red probe shows the conditional itself causes the failure in this build. Narrowing where the `<if>` sits was already tried on base and still failed.
- `docs/verify-backend-logging.sh` checks for the Flyway line with a plain grep that does not require JSON. The `severity` and startup-line checks cover the JSON part, so this is acceptable. A fixed `sleep 20` could be flaky on a slow machine. Consider polling instead.
- When `LOG_FORMAT=json` is valid, every startup now prints `Appender named [plain] not referenced` as a WARN. This is harmless, but whichever fix you choose for CR1 should ideally remove it.
- No screenshots. There are no UI changes, so step 4 does not apply.
