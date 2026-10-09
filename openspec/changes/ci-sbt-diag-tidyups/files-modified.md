- `scripts/lib/ci-sbt-diag.sh` — capture returns 0/2/1 (dump / SIGQUIT-only / nothing); hard budget ceiling (every cap incl. kill grace and every sleep clamped; candidates skipped+logged when <3 s remain); `_diag_socket_owner`/active.json removed
- `scripts/ci-sbt.sh` — `--mode` removed (unknown option, exit 2); distinct deadline messages for rc 0/2/1
- `scripts/e2e-backend.sh` — empty-`E2E_SBT_SERVER_FLAG` client mode removed (`--server` fixed, `mode=server` token kept); die distinguishes SIGQUIT-only from no JVM
- `scripts/check-ci-sbt-no-pattern-kill.mjs` — rules run over logical lines (backslash / trailing `|`,`||`,`&&` joined, comment lines dropped, YAML `key: |` headers not joined)
- `scripts/check-ci-sbt-no-pattern-kill.selftest.mjs` — split-pipeline positives/negatives, YAML pair, first-line-number check
- `scripts/ci-sbt.selftest.mjs` — (e) lever removed, (f)/(g) SIGQUIT-only for ci-sbt.sh and e2e-backend.sh, (h) budget ceiling (4 JVMs, hanging jcmd, external timing)
- `.github/workflows/ci.yml` — comment-only: timing note and "client mode" wording (no key/path/step/timeout change)
- `openspec/changes/archive/2026-10-07-ci-sbt-hang-diagnostics/ci-logs/run37583797617-backend2-FAIL.log.txt` — removed (2,266,058 B, unrelated flaky test)
- `openspec/changes/archive/2026-10-07-ci-sbt-hang-diagnostics/ci-logs/run37586488590-attempt4-backend3-FAIL.log.txt` — removed (3,203,939 B, unrelated flaky test)
- `openspec/changes/archive/2026-10-07-ci-sbt-hang-diagnostics/ci-evidence.md` — correction note appended

## Red-first evidence (new cases run against the UNCHANGED scripts/guard)
ci-sbt.selftest.mjs on unchanged scripts:
```
FAIL (e) ci-sbt.sh rejects --mode (exit 2, unknown option) -- status 7
FAIL (e) e2e-backend.sh ignores an emptied E2E_SBT_SERVER_FLAG (mode stays server) -- e2e-backend: mode=client ...
FAIL (f) ci-sbt.sh: message says SIGQUIT sent, not 'thread dump captured'
FAIL (g) e2e-backend.sh die: stderr says SIGQUIT sent (not 'no verified JVM') -- status 1
ok   (h) setup: 4 verified JVMs in the recorded group
FAIL (h) capture finished within budget+1s (measured 11.74s, budget 6s, wall 11.75s)
FAIL (h) candidates with no budget left are logged as skipped
6 check(s) FAILED
```
Guard selftest on the unchanged guard: FAIL flags (split): backslash then | grep / trailing | then grep / three-line split /
comment inside a continuation does not hide the rest / YAML run: | body with a split pipeline / reports the FIRST physical line number.

Budget root-cause probe (systematic-debugging): the red run above IS the probe: budget 6 s, 4 JVMs, jcmd that ignores TERM. Candidate 1: `timeout -k 1 6` ran
6+1 = 7 s (cap + kill grace), then the unclamped `sleep 1`; candidates 2-4 got `_diag_timeout` -> 124 instantly but each still did
SIGQUIT + `sleep 1`: 7 + 4x1 = 11 s (log: "capture finished in 11s (budget 6s)"). Both suspects confirmed (kill grace not
inside the cap; unclamped sleep per candidate). Fix: caps include the grace, sleeps only with >=2 s left, candidate skipped when <3 s left.

Green after the fix (local): all 27 checks pass incl. `(h) capture finished within budget+1s (measured 4.80s, budget 6s)`.

D6 grep proof: no `--mode`, `active.json`, `E2E_SBT_SERVER_FLAG`/`SERVER_FLAG` consumer remains outside the selftest (grep over scripts/ .github/ docs/).

## CI proof (PR #869, draft)
- Run 37870529638 (PR head a5e5a845): all jobs green (backend 0-3, e2e 1-4, frontend, security, ci-complete). No reruns needed.
- (SUPERSEDED in cycle 2, see below) first-cycle timing figures.
- backend (0) selftest log lines (job 113627330552), all `ok`, ending `all ci-sbt checks passed`:
  `(a) deadline exits 1` ... `(a) dump of the RECORDED pid has 'Full thread dump'` (real deadline path, real jcmd);
  `(e) ci-sbt.sh rejects --mode (exit 2, unknown option)`; `(e) e2e-backend.sh ignores an emptied E2E_SBT_SERVER_FLAG (mode stays server)`;
  `(f) ci-sbt.sh: message says SIGQUIT sent, not 'thread dump captured'`; `(g) e2e-backend.sh die: stderr says SIGQUIT sent (not 'no verified JVM')`;
  `(h) setup: 4 verified JVMs in the recorded group`; `(h) capture finished within budget+1s (measured 5.06s, budget 6s, wall 5.07s)`;
  `(h) candidates with no budget left are logged as skipped`.
- frontend job (113627330549): `check-ci-sbt-no-pattern-kill: ok (4 files scanned)` and guard selftest all `ok` incl. the six
  `flags (split): ...` cases and three `allows (split): ...` cases.
- Run 37871617663 (head 9ed3fa45, timing comment + evidence note): all jobs green.

## Cycle 2 (evaluation-1 change requests)
- Guard selftest: added `logicalLines` cases (YAML `run: |` header stays its own logical line; flagged body line reports line 2).
  Mutation red: deleting `!YAML_BLOCK_HEADER.test(line) &&` in the guard gives
  `FAIL YAML run: | header is its own logical line (not joined to the body)` and `FAIL flagged YAML body line reports the body's line number`;
  restored guard: 0 FAIL (25 ok).
- Comment-only: `_diag_remaining` SECONDS-truncation note; re-wrapped an e2e-backend.sh comment line.
- Cycle-2 timing restatement (backend (0), job start -> "Compile and test" start): runs 37870529638 = 83 s, 37871617663 = 90 s,
  37872469892 = 73 s, 37874061808 (cycle-2 push 83d484f0) = 77 s. Selftest step 41-46 s. Worst 90 s -> 780 + 90 = 870 s < 900 s,
  about 30 s to spare. The 55 s main figure (run 37869010952) predates the longer selftest (25 s then) and is not cited as representative.
  ci.yml comment and the ci-evidence.md correction note restated accordingly (comment-only).
- Run 37874061808 (83d484f0): all jobs green.
