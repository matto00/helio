## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD d60b1f799d78291e165bcc1226b4a3c625c66fa0 (unchanged since round 1). The change dir is untracked and holds planning artifacts only.

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/panel-card-skeleton-reads/HEL-1723`.
- **Round-1 CR1 (pinned ports, plus a nonzero RED): addressed.**
  - design.md D5 now prescribes `DEV_PORT=7155 BACKEND_PORT=10062 nice -n 19 npx playwright test ...`. It says an unpinned run is not evidence, and every transcript must show the command line and the absence of the `DEV_PORT is unset` warning.
  - tasks.md 4.1 repeats this as C1.
  - The ports match workflow-state.md:11-12 (7155/10062).
  - The warning text in D5 matches `playwright.config.ts:15-18` (`[playwright.config] DEV_PORT is unset — ...`), so the absence check is concrete and greppable.
  - D3 now requires the mutated-run RED to fail on the handle-count assertion with a nonzero received count. A failure inside the wait, or a received count of 0, is ruled out. tasks.md 3.2 and C2 say the same.
  - The `CONSTRAINTS` in workflow-state.md:31 record C1 and C2.
- **Round-1 CR2 (empty Standing Constraints section): addressed.** tasks.md now lists C1 and C2, plus these lane constraints: hel1685 not edited, hel1681 changed only at :332/:343, no product code in the final diff, no `.env` reads, quoted heredocs only.
- **Round-1 non-blocking notes: all taken up.**
  - D4 now says both hel1681 hits are in desktop tests and "no phone helper applies".
  - D2 explicitly accepts the HEL-1633 `openDashboard` pattern, where a skeleton-satisfiable anchor is followed by `Loading panels` = 0. It requires both lines to be cited.
  - D3 cites the seed loop at :39.
  - D4 lists hel1681:330-331 as a follow-up candidate.
- **New-defect check: none found.**
  - **Mutation reaches the browser.** I checked that the mutation proof can reach the browser. Without `PROD_BUILD`, `playwright.config.ts:151-165` runs only the `dev` project (`grepInvert: /@prod-build/`) against the Vite dev server. A source mutation of `MobilePanelStack.tsx` will therefore be served, so the D3 proof is achievable, and C2's nonzero-count requirement catches it if it is not.
  - **Tree claims still hold.**
    - `git grep -n "panel-grid-card" HEAD -- e2e | wc -l` = 72.
    - `panelGridReady.ts` exports `LIVE_GRID_ITEMS` (:11), `waitForPanelGrid` (:24), `LIVE_STACK_ITEMS` (:41) and `waitForPanelStack` (:54).
    - hel1681:332 and :343 are bare `.panel-grid-card.first()).toBeVisible()` reads at 1280 px.
    - hel1028:310-311 are the count-0 asserts straight after `goto` at 430 px, and the 2-panel seed loop is at :39.
  - **No contradictions.** I found none between proposal, design and tasks. No placeholders remain. AC1 maps to tasks 1.x and 2.x, and AC2 maps to 3.x. There is no scope drift, and no contract delta is needed (test-only).

### Verdict: CONFIRM

### Non-blocking notes

- D5 uses `npx playwright` pinned by env vars. The CON-165 hazard is the unpinned form, so this is acceptable. The executor should still start servers only via `start-servers.sh` and stop them only via `stop-servers.sh`.
- D3's mutation edits product code while lanes HEL-1711/HEL-1692 run against their own dev servers. That is fine because each worktree has its own Vite server, but the revert must be confirmed in `git diff` before commit, as D3 says.
