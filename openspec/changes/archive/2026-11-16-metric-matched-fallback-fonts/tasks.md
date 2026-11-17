## Standing Constraints

- [C1] Never read, cat, grep, source or print any `.env` file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ).
- [C2] Heredocs quoted (`<<'EOF'`) or use Write/Edit; no backticks or `$(...)` inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh; delete DB residue only by exact id.
- [C4] Caps: jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19 for heavy runs; never size to core count.
- [C5] Long Bash calls use timeout 600000; read sbt summaries (it can exit 0 with failures).
- [C6] Measure base (7d9b2ea2d) first in the CI-like docker+DejaVu environment; a red-first number is required.
- [C7] No prod actions, no release, no `concertino sync`; no claude.ai session link in commits.
- [C8] UI changes compared against the running app in light and dark (visual cohesion), not token compliance alone.
- [C9] If node_modules disagrees with the lockfile, run `npm ci` in the worktree.

### Frontend

- [x] 1.1 Write the derivation script (D3) and record its output; verify it prints four overrides per fallback face
- [x] 1.2 Add the fallback `@font-face` rules and stack entries in theme.css (D1, D4); verify in a browser that the web font is still used once loaded
- [x] 1.3 Weight-specific fallback faces only if D2's measurement needs them; record the decision
- [x] 1.4 Remove the nested `aria-hidden` in DashboardShelf.tsx; verify the Home unit tests pass
- [x] 1.5 DESIGN.md §3 sentence on matched fallbacks; archived HEL-1665 design.md:145 22-26 -> 22-24

### Tests

- [x] 2.1 Update appearanceTokens.css.test.ts for the new stack contract; verify red against the old theme.css, green after
- [x] 2.2 hel1665 spec: assert fontSwapSpread <= 4 only (620/1024 already present) and update the 605-615 comment (D6); verify green on host
- [x] 2.3 New hel1678 large-default-font e2e (D7) with a red precondition; verify green in light and dark
- [x] 2.4 D5 runs (1) base and (2) head in noble+DejaVu with Liberation kept, (3) head DejaVu-only; every hel1665 VIEWPORTS entry (incl. 375x667, 375x812), light+dark, platform font proven; table recorded
- [x] 2.4a D5 step 6: 610x900 in envs (1) and (2); state whether the 605-615 band closed
- [x] 2.4b D6a box-match measurement (sample, 400/600, line-height normal; Liberation host+docker, DejaVu docker); ratios recorded (mean within 2%, no single sample beyond 8% at weight 400; revision of the gate-approved per-size 2%, see design.md D6a)
- [x] 2.5 Serif headings and Mono swap at 540 and 1280 recorded; HEL-1665's "about 30px" claim confirmed or corrected
- [x] 2.6 Visual cohesion: screenshots of Home (fonts loaded, and fonts blocked) in light and dark, compared with base; in the fonts-blocked run record that no request is made for a fallback face
- [x] 2.7 Full frontend gates (lint, typecheck, format, jest) and the touched e2e specs green
