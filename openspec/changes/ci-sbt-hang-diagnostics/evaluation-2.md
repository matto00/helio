## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `f3fdef113858d79b5d69823cba18b68eb1a4dd8e` against live base `469f4ea9377729f90d32e640a22b61be3c487439`.
The cycle-2 delta is `ac4631c69..f3fdef113`. It touches `ci.yml` (one comment line), `ci-evidence.md`,
`scripts/e2e-backend.sh` and `scripts/ci-sbt.selftest.mjs`, and commits `evaluation-1.md`.

### Phase 1: Spec Review — PASS

- **CR1 (raise the C2 escalation): done.**
  - `.concertino/runs/HEL-1339/events.jsonl` line 19 is `escalation.raised`, `escalation_id`
    HEL-1339-1791362731430-e6b288. Its options are `accept-server`, `keep-thin-client` and `halt`, and its question
    carries the corrected numbers (2/28, 441/423 s, 417 vs 412/411 s).
  - Line 20 is `escalation.answered`: `answer: accept-server`, `answer_source: human`, `resolution_channel: chat`, same
    `escalation_id`.
  - Caveat: the orchestrator role emitted that event. Its human source is recorded in the event log; I cannot
    independently observe the chat it came from.

  The C2 gate's any-run clause was tripped and is now resolved by the owner's ruling, not by an executor waiver. C2 is
  honoured.
- **CR2 (correct the evidence): done.**
  - `ci-evidence.md` now states 2 of 28 SERVER legs (441 s on 37579760599 a2 e2e(4), 423 s on a3 e2e(4)) across 2 of 7
    runs.
  - It states 1/16 for the contemporaneous thin client and 3/36 for the historical thin client.
  - It gives slowest-leg medians of 417/412/411 s.
  - The outcome now reads: step/startup clause not tripped, any-run clause tripped as written, escalated, owner ruled
    `accept-server` with the escalation id. It also explicitly owns the original "NOT tripped" miss.
  - All of these match my own cycle-1 API re-derivation.
- **Confirming run 37655563706: verified via the API.**
  - It ran on `f3fdef113` (pull_request, attempt 1) and concluded `success`. Every job succeeded: backend 0-3, e2e 1-4,
    frontend, security and ci-complete.
  - Leg times: backend 209-268 s, e2e 279-415 s (none over 420 s), security 57 s.
  - The e2e (1) log shows `e2e-backend: mode=server pgid=2759 exe=/usr/lib/jvm/temurin-21-jdk-amd64/bin/java`.

### Phase 2: Code Review — PASS

- **CR3 (derive the e2e mode label): done.**
  - `scripts/e2e-backend.sh` sets `SERVER_FLAG="${E2E_SBT_SERVER_FLAG---server}"`. When the variable is unset this is
    `--server`; when it is set to empty it is the thin client. `MODE` is derived from `SERVER_FLAG`.
  - Both the launch and the two `wait` mode lines now use it.
  - `ci.yml` never sets `E2E_SBT_SERVER_FLAG`, so CI runs `--server`.
- **CR4 (comment count): done.** `ci.yml:330` now says "20 distinct successful security jobs".
- **Fresh gates, run by me:** all pass.
  - `selftest:ci-sbt`: 18/18, including the new (d) server-label check and (e) client-label check.
  - `check:ci-sbt-guard`: OK, 4 files.
  - `check:ci-sbt-guard:selftest`: green.
  - Repo-wide `format:check` and `lint`, and `bash -n scripts/e2e-backend.sh`.
- **Mutation red, reproduced by me:** in a scratch copy I restored the hard-coded `mode=server` in `e2e-backend.sh`. The
  selftest then fails with `FAIL (e) mode line says client when the server flag is empty` (1 check failed). The new
  check can fail.
- **No residue:** a /proc cwd scan for processes under my scratch dir found none after the runs.

Issues: none.

### Phase 3: UI Review — N/A

No UI trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions

These carry over from cycle 1:
- `ci-sbt.sh --mode client` has no caller.
- The static guard is line-based.
- Spin off the two flaky specs: `OutputRoutesSpec.scala:756` and `ProductEventRollupServiceSpec.scala:85`.
