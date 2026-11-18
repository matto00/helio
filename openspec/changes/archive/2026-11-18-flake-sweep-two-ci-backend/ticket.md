# HEL-1758: Flake sweep 2: backend shard hashFiles/sbt timeouts and three new e2e candidates (hel1665:437, hel1583-home-375:25, hel1573:104)

## Description

origin_kind: followup
origin_ticket: HEL-1754 (first flake sweep, merged as 6e334120a)

Between 2026-11-18 01:00 and 06:30 UTC, CI failed five times on jobs unrelated to the change under test. Each passed on a single rerun. Every one needed an owner ruling or a C11 rerun, which slows every lane.

**Backend infrastructure timeouts (no tests ran):**

* `backend (1)` on main at ff667dd57, run 44223574075: "sbt did not finish within its 660s in-step deadline".
* `backend (1)` on PR matto00/helio#1153, run 44226053854: the "Restore backend compile output" step failed with "hashFiles(backend/src/** ...) couldn't finish within 120 seconds" (ci.yml:280).
* `backend (3)` on PR matto00/helio#1154, run 44244750573: the same hashFiles 120s timeout.

**e2e candidates:**

* `hel1665-home-phone-stability.spec.ts:437`: "Home settled at 1280x900 (serif dark): a long opening sentence keeps the web font's 40ch width". It failed on main at ff667dd57. It may share HEL-1757's cause, a stalled Google Fonts request.
* `hel1583-home-375.spec.ts:25`: "Home at 430px (dark)", cardCount 0 vs 4. The Home shelf cards had not rendered yet. PR matto00/helio#1153.
* `hel1573-motion-grid-chart.spec.ts:104`. PR matto00/helio#1154, run 44244750573.

## Acceptance Criteria

* Backend: root-cause the hashFiles slowness. For example, the glob may cover a huge tree, or the cache key may be computed over generated files. Fix it, or replace the key with a cheaper one, and show restore-step timings before and after. Find out whether the 660s sbt deadline is a real hang or just under-provisioned, and act on the answer.
* e2e: for each candidate, either fix the root cause and prove it red first, as HEL-1754 did with `--repeat-each=40 --workers=2 --retries=0`, or record the probes that failed to reproduce it. No sleeps, no extra retries, and no longer timeouts as a fix.
* If hel1665:437 turns out to be the fonts stall, coordinate with HEL-1757 or fold it in, and say which.

## Driver constraints (from the dispatch brief)

C1 never read/print any .env file nor dump the environment (scripts may read scripts/concertino/.concertino.env, never print it). C2 quoted heredocs only. C3 no pkill/pgrep/killall; kill by exact PID; stop servers with stop-servers.sh; DB residue deleted by exact id via buildUserDeleteSql. C4 jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19; repeat runs --workers=2. C5 timeout 600000 on long calls; sbt testFull. C6 escalate on budget exhaustion. C7 merge only via the auditor with gh pr merge --squash --match-head-commit, never --auto. C8 no prod actions, no release, no concertino sync. C9 no claude.ai session link in PR/commits. C10 Phase 4 cleanup from the main checkout. C11 known-flake rule: rerun only the failed job once and name it in the PR; second failure escalates (known: hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, plus this ticket's candidates). C12 every fix proved red first with the forced-red recorded; no sleeps, extra retries or longer timeouts; evaluator and skeptic run the FULL affected spec files. C13 scratch in .concertino/scratch/HEL-1758/. C14 dev-DB residue cleaned by exact id. No Flyway migration, no model calls. Concurrent lanes HEL-1742 (backend insight read API, V145) and HEL-1756 (frontend usePortalPopover/panelFit) must not be touched; report any overlap. The Playwright DATABASE_URL caveat: global-teardown userCleanup and e2e/support/db.cjs use the shared dev DB unless DATABASE_URL is set for the Playwright process.
