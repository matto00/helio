## Standing Constraints

- [C1] Never select a process by name/pattern (pgrep/pkill/killall/pidof/ps|grep); only recorded PIDs/PGIDs or sbt's
  own server files, verified (java exe + backend cwd) before any dump or individual signal.
- [C2] If `--server` costs real time (design D1/D1a gate: >= 10 s median regression on a measured step or startup
  metric, or any timing target breach), stop and report the numbers — do not ship it.
- [C3] CI runs one at a time; keep full logs of every failing run under the change dir's `ci-logs/`.
- [C4] Never bypass hooks (`--no-verify` / `-n` forbidden).

### Backend

## 1. Measurement baseline

- [x] 1.1 Record >= 3 thin-client runs in `ci-evidence.md`: per-step durations and D1a startup metrics; cite run/attempt/job
- [x] 1.2 Record osv install/scan and npm audit step durations from >= 5 security jobs; write the D2/D5 inequalities

## 2. Helper and diagnostics

- [x] 2.1 Add `scripts/lib/ci-sbt-diag.sh` (D3 candidates, verification, 25 s capture budget); verify with 4.1
- [x] 2.2 Add `scripts/ci-sbt.sh` (D2 pinned launch form, mode line, deadline, group stop); verify with 4.1
- [x] 2.3 Extend `scripts/e2e-backend.sh` (`--server`, capture on `die`) keeping HEL-1288 checks; verify with 4.2

## 3. Workflow

- [x] 3.1 Route backend Compile and test (step timeout 13, deadline 660 s) and SBOM (deadline 75 s) via `ci-sbt.sh`;
  verify ci.yml parses and `npm run check:precommit-ci-parity` passes
- [x] 3.2 Add `if: failure()` diagnostics artifact uploads (backend, security, e2e); verify names are shard-unique
- [x] 3.3 Add osv `timeout-minutes` + curl `--fail --connect-timeout 15 --max-time 45` per D5; record the arithmetic
- [x] 3.4 Wire `selftest:ci-sbt` into backend shard 0 and `check:ci-sbt-guard[:selftest]` into the `frontend` job

### Tests

## 4. Proof

- [x] 4.1 `scripts/ci-sbt.selftest.mjs` cases (a)-(c) of D6 pass; show red under PID-recording and cwd-check mutations
- [x] 4.2 e2e-backend.sh `die`-path capture exercised with a stand-in hanging JVM; show red under mutation
- [x] 4.3 `check:ci-sbt-guard` + selftest pass; show red with an injected `pgrep`
- [x] 4.4 D6 in-build positive control on CI (Thread.sleep frame, dumped PID == recorded PID), then reverted
- [x] 4.5 Draft PR: >= 3 sequential runs with the change; `ci-evidence.md` before/after medians + startup metrics,
  heap line, mode line; apply the C2 gate
