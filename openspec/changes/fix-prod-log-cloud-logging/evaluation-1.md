## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- Ticket AC 1 ("startup and Flyway lines queryable in Cloud Logging with severity parsed") — addressed locally: `docs/verify-backend-logging.sh` was independently re-run against the current tree and confirms structured JSON lines for both a Flyway line and a startup line, with `"severity":"INFO"` present, reaching stdout from the real Docker image.
- Ticket AC 2 ("a known app log line findable by a structured field") — satisfied by the same evidence (`logger_name`, `severity`, `message` fields all present in the JSON output).
- Ticket AC 3 ("verified against a real deploy") — correctly NOT claimed as satisfied. `ticket.md`'s "Scope constraint" section and `design.md`'s Non-Goals/Risks both explicitly defer real-deploy verification to the driver after the next release cut. This is consistent with constraint C2 and is stated plainly rather than glossed over.
- No AC silently reinterpreted — the plan's own round-2 correction (LOG_FORMAT-unset theory disproven, real cause is `<if>` swallowing the appender) is followed through faithfully into the diff.
- Task list (`tasks.md`): all 11 items marked done; each is independently corroborated by either the diff (2.1, 2.2), the design.md probe transcript (1.1–1.6, 2.3), or a fresh gate re-run by this evaluator (3.1, 3.2).
- Scope: diff touches exactly `backend/src/main/resources/logback.xml`, `.github/workflows/cd-backend.yml`, `docs/verify-backend-logging.sh`, plus the OpenSpec change-dir artifacts (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `files-modified.md`, `skeptic-design-*.md`, `.openspec.yaml`). No scope creep.
- No regressions: `backend/build.sbt`'s assembly merge strategy was investigated (per design.md Decisions) and correctly left untouched once the `<if>` block was probe-confirmed as the actual cause — a good example of not touching what the evidence didn't implicate.
- API contracts/schemas: not applicable — no request/response shape changed.
- Planning artifacts reflect the final implemented behavior: yes, `files-modified.md`'s root-cause section matches the actual `logback.xml` diff exactly (verified via `git diff`).
- `workflow-state.md`'s CONSTRAINTS (C1: no migration, C2: no deploy/env/release) — both honored; see Phase 2 verification below.

### Phase 2: Code Review — PASS

Gates re-run fresh by this evaluator, not trusted from the executor's report:
- `sbt test` (from `backend/`): **4246/4246 passed, 277 suites, 0 failed** — matches the executor's reported count exactly. Full run completed in 4m23s with no errors.
- `docs/verify-backend-logging.sh`: **actually executed end-to-end against the current (fixed) tree** — built the real `Dockerfile`, ran a real throwaway `postgres:16`, and confirmed the script exits 0 with `RESULT: PASS`. Captured stdout shows `"Successfully applied 106 migrations..."` (via `sbt test`'s own Flyway) is separate from the script's own container run, which itself showed a genuine `"Schema \"public\" is up to date"`-equivalent Flyway line, `"Helio backend listening on /[0:0:0:0:0:0:0:0]:8080"` as JSON, and `"severity":"INFO"` fields throughout. This corroborates the red/green claim in `files-modified.md` (I did not additionally re-run it against the pre-fix `logback.xml`, since the pre-fix behavior is already fully transcribed with cited timestamps in `design.md`'s probe output, and reverting+rebuilding just to re-derive an already-cited red result would not add information).

`logback.xml` diff re-derivation (read directly, not trusted from the summary):
- The `<if>` block is fully removed. Both `json` and `plain` `<appender>` elements are now declared unconditionally at the top level.
- A new `<property name="LOG_APPENDER" value="${LOG_FORMAT:-plain}" />` resolves to `"json"` when `LOG_FORMAT=json`, and to `"plain"` for any other value including unset — this is a plain substitution, not a conditional block, so Joran's earlier "clean success, no appender attached" failure mode (specific to `<if>`/Janino conditional processing in this toolchain) cannot recur.
- `<root level="${LOG_LEVEL}"><appender-ref ref="${LOG_APPENDER}" /></root>` — single unconditional root-appender wiring. Both appenders are always declared, so there is no dangling/unreferenced-appender risk either.
- This matches the executor's description exactly, and the live docker run (above) empirically confirms the root logger is not just declared with an appender-ref but actually emits both a Flyway line and a startup line through it.

`cd-backend.yml` diff re-derivation:
- Change is additive only: `LOG_FORMAT=json` appended to the existing `--update-env-vars` comma list inside the same `flags:` string. No other flag, step, or deploy-flow structure changed. A new explanatory comment block was added above it (consistent with the file's existing per-var comment style). Matches the "additive, no other deploy-flow change" description.

Migration/deploy constraints (C1/C2):
- `git diff --name-only <base>...HEAD` contains no files under `backend/src/main/resources/db/migration/` — confirmed via grep, zero hits.
- No evidence in the diff of any Cloud Run deploy, secret change, or release-tag action — the only prod-facing change is the (unexecuted, PR-only) `cd-backend.yml` edit, which only takes effect on the next CD run after merge — consistent with C2.

Code-quality / CONTRIBUTING.md: the diff is XML config + a shell script + YAML; no Scala/TS files touched. `docs/verify-backend-logging.sh` is well-structured (trap-based cleanup, clear FAIL messages per assertion, `set -euo pipefail`), reasonably small (91 lines), and self-documenting. No dead code, no magic values beyond inline literals that are self-evidently test fixture values (e.g. `postgres:16`, dummy OAuth client id/secret) appropriate for a throwaway verification harness. DRY: reuses the real `Dockerfile` rather than re-deriving container setup. No over-engineering — the script does exactly one thing.

### Phase 3: UI Review — N/A

No files under `frontend/**` changed. `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, and `openspec/specs/**` are all untouched by this diff (confirmed via the file list above — only `backend/src/main/resources/logback.xml`, a non-route resource file, changed on the backend side). This is a pure backend logging-config fix with no UI-affecting surface; Phase 3 is explicitly skipped rather than silently omitted.

### Overall: PASS

### Non-blocking Suggestions

- `docs/verify-backend-logging.sh` uses a fixed `sleep 20` to wait for startup rather than polling a health endpoint or log line — functionally fine for a one-off verification script, but a future iteration could poll instead of sleeping a fixed window for slightly faster/more robust runs. Not blocking.
- The `logback.xml` comment documents the case-sensitive-exact-match trade-off (`equalsIgnoreCase` no longer applies) clearly and honestly; worth keeping in mind if `LOG_FORMAT` is ever set with unexpected casing by some other tool, but current callers (`cd-backend.yml`, local `.env`) always use lowercase `json`, so this is low risk as noted in the comment itself.
