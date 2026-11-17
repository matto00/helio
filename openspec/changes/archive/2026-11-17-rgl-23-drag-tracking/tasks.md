## Standing Constraints

- [C1] Never read, cat, grep, source or print any `.env` file; no env-dumping commands.
- [C2] Heredocs quoted (`<<'EOF'`) or use Write/Edit; no backticks or `$(...)` inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19 for heavy runs; bisect installs serial.
- [C5] Long Bash calls use timeout 600000.
- [C6] Never touch PR #926; never file anything upstream.
- [C7] Never install globally; write only inside the worktree and .concertino/scratch/HEL-1728/.

## 1. Measure

- [x] 1.1 Run hel1573:275 `--repeat-each 20 --workers 2` on 2.2.4 and on 2.3.0 (D1, versions recorded per D0); record counts in `red-baseline.md`
- [x] 1.2 Diff the published 2.2.4/2.3.0 `dist/` drag paths and list suspect hunks in `red-baseline.md`
- [x] 1.3 Re-run the 2.3.0 case with react-resizable 3.1.3 via a temporary override (D2); record green/red/inconclusive; undo per D0

## 2. Bisect

- [x] 2.1 Clone upstream RGL into .concertino/scratch/HEL-1728/rgl, confirm both tags, build both endpoints and show 2.2.4 green / 2.3.0 red with the D3 per-step procedure (served sha256 recorded)
- [x] 2.2 `git bisect` 2.2.4..2.3.0 serially per D3 (verdict rule, skip rule); write `bisect-log.md` naming the first bad commit
- [x] 2.3 Restore per D0 (git checkout of package.json/lockfile, npm ci, .vite cleared) and confirm 2.2.4 baseline green with `--repeat-each 3`

## 3. Characterize

- [x] 3.1 Run the D4 timing sweep plus the test-sequence control row on 2.3.0 via a persisted scratch spec (light and dark screenshots); write `running-app-check.md` with per-row counts
- [x] 3.2 Run the D5 minimal-page repro at the bisected commit and its parent; write `minimal-repro.md` naming library vs app trigger

## 4. Fix (exactly one path, per design D6)

- [x] 4.1 Apply the D6 row (Adapt test / Adapt app / Pin + draft / Pin no draft, or escalate); verify the choice cites the D4/D5 numbers
- [x] 4.2 Run hel1573:275 `--repeat-each 20 --workers 2` on the shipped version (20/20), plus hel1230 and hel908 once each (D7)
- [x] 4.3 On an Adapt path, run frontend typecheck, lint and jest (maxWorkers 3) and check desktop drag/resize in the running app in light and dark

## 5. Tests

- [x] 5.1 Delete any dev-DB residue created by these runs by exact id and list the ids in `files-modified.md`'s notes
