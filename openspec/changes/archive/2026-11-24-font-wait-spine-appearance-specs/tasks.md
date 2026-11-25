## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (incl. scripts/concertino/.concertino.env); no env-dumping commands (env, printenv, set, export -p, /proc/*/environ); never copy a directory containing an env file.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; delete test residue by exact id (buildUserDeleteSql).
- [C4] jest <=3 workers, Playwright <=2 workers TOTAL (sibling lane HEL-1621 also runs e2e), sbt -J-Xmx3g, everything nice -n 19.
- [C5] Bash timeout 600000; never a background run past the tool timeout.
- [C6] Budget exhausted means escalate.
- [C11] Known flakes per driver C11 list; an unlisted CI failure gets one literal `gh run rerun --job <id>`; a refused command is never retried or worked around.
- [C12] Red first: record and COMMIT the forced-delay pre-conversion run (as .txt) before the conversion commit; full spec files.
- [C13] Scratch/tool output only in /home/matt/Development/helio/.concertino/scratch/HEL-1622/ (never /tmp, never in the worktree); TMPDIR=/tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/HEL-1622 only for git-hook runs; committed evidence under this change's evidence/.
- [C14] Lane DB: DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1622 and DB_USER=matt exported in the SAME command as start-servers.sh, every Playwright run, every cleanup and commit-hook run; ANTHROPIC_API_KEY exported empty for servers. Run `cd frontend && nice -n 19 npm ci` before any jest/e2e.
- [C15] Scope is exactly hel1579:296, hel1579:465, hel1572:672, hel1572:764; no other e2e/helper/config change; no tolerance, timeout, retry or assertion change.
- [C16] Verify and name the font-delay mechanism (page.route vs HEL-1757 host rules) before any red run; a site that stays green under the delay is recorded "no red possible", never presented as a red, then converted anyway.
- [C17] Each touched spec file passes 20/20 (--repeat-each=20, --workers=2, nice -n 19), counts recorded.
- [C18] Held-font scratch runs: `page.goto(url, { waitUntil: "commit" })` is the only deviation (red, green, never-released alike); hold re-armed per goto; fonts state dump recorded at each held measurement; a goto/test-timeout failure is an invalid run, not a red.
- [C19] A red counts only if the failing assertion is at/after the converted site (e.g. S1 failures at hel1579:276-293 are not S1 reds); name which measurement phase ran held (S2: spine-track check vs sweep); held-ness is proven by the per-iteration fonts state dump, never by the route handler firing.

## 1. Delay mechanism and red runs

- [x] 1.1 Scratch probe on base: prove which mechanism holds the fonts requests under HEL-1757 (handler fires, non-zero held count, faces held), evidence/delay-mechanism.txt (D1)
- [x] 1.2 Forced-delay runs of S1-S4 on pre-conversion code (waitUntil commit, hold re-armed per goto, release at measurement + fallback-only + each measured family held alone incl. Fraunces for S3 and S4/serif; fonts state per held iteration); per site RED or NO RED POSSIBLE with values, evidence/red-S<n>.txt; commit before conversion (D2, C12)

## 2. Conversion

- [x] 2.1 Replace the four waits with waitForWebFonts(<measured container>) per D3; name each container and confirm it resolves to exactly one element; add the import to hel1579
- [x] 2.2 Same forced-delay runs with the conversion (timer release): green; never-released run fails at the 10s bound; evidence/green-S<n>.txt (D4)

## 3. Verification

- [x] 3.1 lint, typecheck, format:check pass on the touched files
- [x] 3.2 Each touched file --repeat-each=20 --workers=2 under nice -n 19, lane servers + lane DB: 20/20, evidence/repeat-*.txt (D5)
- [x] 3.3 hel1572:126 note by TITLE ("re-renders headings with no reload and survives a fresh browser context", per 943b5dd73^), checked against HEL-1826's recorded root cause; failed in the 20x runs or not
