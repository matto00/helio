## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file or run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); scripts/concertino/.concertino.env may be read by scripts, never printed. Never copy .env files or a tree containing one.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; never a background run past the tool timeout.
- [C8] No prod, no release, no concertino sync, no MCP deploy.
- [C11] Known e2e flakes (see orchestrator brief) get one rerun; an unlisted CI failure unrelated to the diff gets ONE literal `gh run rerun --job <id>`; a refused command is parked and reported, never worked around.
- [C12] Red first: the over-1200 s before table and the selftest mutation output are recorded and committed before the implementation commit.
- [C13] Scratch in .concertino/scratch/HEL-1793/; evidence a follow-up must reference in .concertino/runs/HEL-1793/evidence/.
- [C14] If any local e2e runs: lane-private DB helio_hel1793 used by start-servers, Playwright and cleanup; ANTHROPIC_API_KEY exported empty for any backend.

## 1. Red evidence (before)

- [x] 1.1 Copy HEL-1789's measurement scripts from /home/matt/Development/helio/.concertino/runs/HEL-1789/evidence/measurement/ into /home/matt/Development/helio/.concertino/scratch/HEL-1793/ (parameterise the leg count; extend counting() to require each leg's runner record, design D4) and measure the 5 newest counting 7-leg main runs after HEL-1789 (design D3/D4 list): per run slowest and mean leg wall, per leg CPU model. Verify: openspec/changes/add-eighth-e2e-leg/measurement.md has a "Before" table with run ids, and raw outputs are in .concertino/runs/HEL-1793/evidence/measurement/.
- [x] 1.2 Show the existing selftest guard failable: (a) ci.yml matrix and max-parallel to 8 with DEFAULT_E2E_LEGS 7, (b) only max-parallel to 8; run `npm run check:e2e-shard:selftest` for each, record the failure; restore. Verify: the failing output is quoted in measurement.md "Guard red" and the tree is restored (git diff empty for those files).
- [x] 1.3 Commit 1.1-1.2 evidence alone (`HEL-1793 Record 7-leg before measurement and selftest red`). Verify: git log shows it before the implementation commit.

## 2. Eighth leg

- [x] 2.1 ci.yml e2e: `max-parallel: 8`, `shard: [1, 2, 3, 4, 5, 6, 7, 8]`, comments updated (leg count, HEL-1793 owner ruling, backend 4 + e2e 8 = 12). timeout-minutes 25 and runs-on unchanged. Verify: `git diff` of ci.yml shows only e2e-job lines (2.3 edits ci.yml:619/622/857 too); `npm run check:e2e-shard:selftest` fails until 2.2.
- [x] 2.2 scripts/e2e-shard.mjs `DEFAULT_E2E_LEGS = 8` with comment citing HEL-1793. Verify: `npm run check:e2e-shard:selftest` passes; `npm run check:ci-complete-needs:selftest` passes.
- [x] 2.3 Update every site in design D1's enumerated list (ci.yml:619,622,857; playwright.config.ts:192; e2e/README.md:140,144,146; MISTAKES.md:211). Verify: each listed site checked one by one and quoted after-edit in files-modified.md; and `git grep -n -E "7 legs|7 since|default 7|e2e 7|= 11 parallel|6 by default|\[1, 2, 3, 4, 5, 6, 7\]|max-parallel: 7" -- ':!openspec/changes/archive' ':!openspec/changes/add-eighth-e2e-leg'` returns exactly zero hits after the edit (MISTAKES.md:211 keeps its HEL-1772 history clause and appends HEL-1793 to 8, with the job total rewritten to backend 4 + e2e 8 = 12; history clauses elsewhere are kept the same way).

## 3. Weights

- [x] 3.1 Regenerate e2e/shard-weights.tsv per design D3 (`weights --legs 7 --list`, 5 counting runs including 44854332613 once complete). Verify: header lists the 5 run ids; rows exist for hel1735-feature-hover and hel1791-compact-counter-stack-height; `node scripts/e2e-shard.mjs plan 8` shows no `defaulted` file (or names why); the plan's per-leg loads recorded in measurement.md.

## 4. Gates

- [x] 4.1 Run the pre-commit hook chain on commit (no `-n`); `npm run check:e2e-shard:selftest`, `npm run check:ci-complete-needs:selftest`, `npm run lint`, `npm run format:check`. Verify: all exit 0, outputs recorded in files-modified.md notes.

## 5. After measurement (Delivery, on the PR)

- [x] 5.1 After the PR exists: measure at least 5 counting 8-leg PR runs per design D4 (first run, then `HEL-1793 CI measurement run N` empty commits one at a time; cap 6 runs; fewer than 5 counting in 6 -> stop and escalate, design D4). Verify: measurement.md "After" table with run ids, slowest/mean leg wall, per-leg CPU model, counting status, trigger of each run, and the verdict (<= 1200 s on every counting run, or the gap with its cause).
- [ ] 5.2 Post-merge: measure any main run completed before cleanup; hand the rest of the 5-run main watch to the driver and state it in the closing comment (design D4a). Verify: closing comment and final report name the pending watch and the scripts' path.
