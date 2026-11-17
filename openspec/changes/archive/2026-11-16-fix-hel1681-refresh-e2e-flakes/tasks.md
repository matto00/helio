## Standing Constraints

- [C1] Never read/cat/grep/source/print any `.env` file; never run env-dumping commands (`env`, `printenv`, `sbt show Test/envVars`)
- [C2] Heredocs quoted only (`<<'EOF'`); no backticks or `$(...)` inside echo strings
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh; delete DB residue by exact id only
- [C4] Resource caps: jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19; `timeout: 600000` on every hook/test Bash call
- [C5] No `git commit -n`; if `check:helio-mcp-types` fails, run `npm --prefix helio-mcp ci` in the worktree
- [C6] Every fixed failure is shown red first under a forced repro, then green; no fix by timeout-lengthening alone
- [C7] A product race beyond a small, obvious change is an ESCALATION, not a fix

## 1. Setup and probe

- [x] 1.1 Confirm worktree `frontend/node_modules/axios` is 1.21.1 (run `npm ci` in `frontend/` if not); record the version in evidence
- [x] 1.2 Root-cause the :128/:164 refresh-button flake per design D4 (CI traces if available, instrumented local runs under forced delays); write `root-cause.md` in this change dir with the probe, the reproduced CI symptom, and the confirmed mechanism

## 2. Fixes

- [x] 2.1 D1: `openDashboard` waits with `waitForPanelStack` (count verified live); red-first under a stretched skeleton fade or delayed panels fetch
- [x] 2.2 D2: Full-motion read via `LIVE_STACK_ITEMS` with a non-null assertion; red-first reproduction of the null-box TypeError on the old code
- [x] 2.3 D3: 1280 test reorder; record the mutation showing the count-0 check can fail
- [x] 2.4 D4: fix the :128/:164 flake at the confirmed cause (spec-side, or a small product fix with a red-first jest test, or ESCALATION); red-first under the forced repro
- [x] 2.5 D5: sweep the spec, write `sweep.md` with a verdict per hit, fix every FIX hit

## 3. Verification

- [x] 3.1 Whole spec `--repeat-each 20 --workers=2 --trace retain-on-failure` under `nice -n 19`, zero failures; record summary, load average, `free -g`
- [x] 3.2 Lint, Prettier, `check:e2e-types` clean; pre-commit hook passes
