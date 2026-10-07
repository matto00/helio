## Standing Constraints

- [C1] Playwright at most 2 workers under `nice -n 19`; at most 3 niced load processes, killed only by recorded PID
- [C2] At most one CI run at a time
- [C3] No edits to `playwright.config.ts` or `.github/workflows/ci.yml` (HEL-1288 owns them)
- [C4] No quarantine, no loosened assertions, no timeout increase as a fix
- [C5] Record exact ids/emails of every dev-DB user/row created; never select deletion targets by pattern/name/time
- [C6] This lane owns all edits to both spec files; HEL-1300 does not edit them; stay within these two specs plus product code the root cause requires
- [C7] A contention config counts as reproducing only at p ≥ ~14% over ≥20 attempts; the ≥20 greens run under that config
- [C8] Throttled runs use an untracked copy whose diff vs the committed spec is recorded (hook only); any later spec edit invalidates prior greens

## 1. Reproduce (before any edit)

- [x] 1.1 Start this worktree's own servers via `scripts/concertino/start-servers.sh`; verify the dev server's process cwd is this worktree
- [x] 1.2 Run each unchanged spec's failing test under host contention (2 workers, `nice -n 19`, ≤3 niced burners by PID, `--repeat-each`); record failure rate as k/n (n ≥ 20) and failure mode per spec
- [x] 1.3 If 1.2's p < ~14% ((1−p)^20 > 0.05), calibrate CDP throttling (untracked throttled copy per design D1, diff recorded) until the unchanged spec reproduces the CI failure mode at p ≥ ~14%; record the reproducing configuration and failure rate per spec, or escalate if none reproduces

## 2. Root cause

- [x] 2.1 hel519: instrument detail-view render, localStorage entry (+title), prune per attempt; classify every failing attempt per design D2 A–D (else keep probing); confirm by flipping the cause both ways
- [x] 2.2 hel910: compare idle vs contended per-step durations for the D3 dominant steps; investigate disproportionate steps as product slowness; confirm by flipping the cause both ways
- [x] 2.3 Verify the HEL-1289/HEL-1300 claims for both files (design D4); record verdicts with evidence

## 3. Fix

- [x] 3.1 hel519: apply the D2 fix (test wait, or product fix + red-without-fix Jest test + delta spec); assertions unchanged
- [x] 3.2 hel910: apply the D3 fix; `io` interaction count and every assertion unchanged; no timeout increase
- [x] 3.3 Run lint/typecheck/format for touched files and the full pre-commit chain on commit (600000ms timeout)

## 4. Tests

- [x] 4.1 (hel519 done 25/25 at 6x; hel910 quiet-host: 20/20 green at the reproducing 8x, max 28.0s / p50 27.2s; the 27s bar is waived by owner ruling `accept-and-waive-27s`, escalation HEL-1298-1791334299309-2c65fc; product follow-up for pipeline-detail boot cost filed as HEL-1354) ≥20 consecutive green runs per test under that spec's reproducing configuration (1.2/1.3); record command, burner PIDs, throttle rate, the committed-vs-copy diff, each run's duration, max/p95; re-run if either spec changes afterwards; hel910 max must be ≤ 27s else escalate
- [x] 4.2 Run both full spec files uncontended to confirm no sibling test regressed; record durations
- [x] 4.3 Record every dev-DB user/row created (exact ids/emails) in `files-modified.md` / report
