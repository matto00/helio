## Standing Constraints

- [C1] Do not change cache keys, cache paths, or the cache restore/save split (HEL-1299), nor any `timeout-minutes`.
- [C2] Every CI-only change is proven on this PR's own CI runs; cite run ids and log lines.
- [C3] Never use pkill/pgrep/killall/pidof or `ps | grep` anywhere (including tests); signal only recorded PIDs/PGIDs.
- [C4] No `--no-verify` / `HUSKY=0` without disclosure; cap local parallel work at 3-4 workers with `nice -n 19`.

### Backend

- [x] 1.1 D6: remove `--mode` from `scripts/ci-sbt.sh`, empty-flag client mode from `scripts/e2e-backend.sh`, and
  `_diag_socket_owner` from `scripts/lib/ci-sbt-diag.sh`; headers updated; grep shows no `--mode`/`active.json`/
  `E2E_SBT_SERVER_FLAG` consumer left
- [x] 1.2 D3: capture returns 0/2/1 (dump/SIGQUIT-only/nothing); `ci-sbt.sh` and `e2e-backend.sh` print distinct messages
- [x] 1.3 D4: probe-confirm the budget overrun root cause, then clamp every call/sleep to remaining budget and skip
  candidates when exhausted; record the probe in files-modified.md
- [x] 1.4 D1: `check-ci-sbt-no-pattern-kill.mjs` scans logical lines; `npm run check:ci-sbt-guard` passes on the repo
- [x] 1.5 D2: ci.yml timing comment re-stated from this PR's measured shard-0 pre-steps (comment-only diff)
- [x] 1.6 D5: `git rm` the two flaky-test logs from the archived ci-logs/; keep the control log + control-artifact/
- [x] 1.7 D2/D5: append dated "Correction (HEL-1362)" note to the archived HEL-1339 `ci-evidence.md` (timing; which
  logs were removed, why, and where they remain: d71f646cb + run ids); never calls them hang evidence; exact byte counts

### Tests

- [x] 2.1 Guard selftest: split-pipeline positives (backslash, trailing `|`, 3-line), a no-join negative, and the YAML
  `run: |` pair (header not joined; split pipeline inside the body flagged); passes, and
  fails when D1's join is mutated out
- [x] 2.2 `ci-sbt.selftest.mjs`: SIGQUIT-only cases for BOTH ci-sbt.sh and e2e-backend.sh die, budget-ceiling case
  (D4 shape: external sub-second timing, >=3 JVMs, hanging jcmd, skipped logged), removed-mode case; existing cases pass
- [x] 2.3 Red-first: run the new SIGQUIT-only and budget cases against the unchanged scripts first; record red + green
  output in files-modified.md; guard selftest likewise red on the unchanged guard
- [x] 2.4 PR CI: all jobs green; record run id(s), the selftest log lines, and measured shard-0 pre-step seconds
