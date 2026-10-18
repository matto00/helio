## Standing Constraints

- [C1] Driver run rules: scratch only in /home/matt/Development/helio/.concertino/scratch/HEL-1608/; jest and Playwright at most 2 workers under nice -n 19; full Playwright suites under flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/e2e.lock, sbt testFull under sbtfull.lock; load gate (1-min load >10 -> sleep 60, recheck, up to 30 min); never kill/pkill/pgrep/killall; stop servers only via scripts/concertino/stop-servers.sh; Playwright --trace retain-on-failure
- [C2] Phone layout (<=768px) stays exactly as HEL-1582 left it; hel1582-* e2e specs stay green; no HEL-1668/HEL-1669 scope; report before committing if touching HEL-1630 or HEL-1620 files
- [C3] hel1579 spec edit confined to the 769-1100px sweep test; never touch the :174 accent test or seedPipeline/shared setup; if merging after HEL-1620, keep its shared setup, adapt seeding, re-run the WHOLE hel1579 spec (both themes) on the merged head before CI

### Tests (red first)

- [x] 1.1 Extend the "sweep 769-1100px" test per design D3 (1280 spine-width check, branch seed, title readability + two-end occlusion probe); verify it type-checks and lints
- [x] 1.2 Run that test against unchanged CSS; verify it FAILS on title readability and persist the output to openspec/changes/spine-container-keyed-width/red-proof.txt

### Frontend

- [x] 2.1 Replace the spine track with the container-keyed expression (design D1); verify by the sweep's D3(i) 1280 spine-width assertion
- [x] 2.2 Make .spine-body__spine the named container spine-column and add the D2 compaction levers needed (hidden ⋮ MUST be opacity 0 + pointer-events none, restored on row :hover/:focus-within; verify Tab still reaches it); verify no unnamed @container subject sits inside the spine (grep, recorded in the commit body)
- [x] 2.3 Fix the doc nits (D4): both CSS comments (:295, :331), archived HEL-1579 design D2; verify by grep for "clamp(270px" and "1100px block"

### Tests

- [x] 3.1 Re-run the sweep test; verify it passes with every title readable, both themes, list default and max
- [x] 3.2 Run the whole hel1579 spec and all hel1582-* specs (2 workers); verify green and phone layout unchanged
- [x] 3.3 Capture screenshots at 769/900/1024/1100 and 390px, light and dark, into scratch with the mouse away from the rows; verify titles readable
- [x] 3.4 Run frontend lint, typecheck, format:check and the jest suite (2 workers); verify all pass
