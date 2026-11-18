## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file; no env-dumping commands (env, printenv, set, export -p, /proc/*/environ). scripts/concertino/.concertino.env may be read by scripts but never printed.
- [C2] Quoted heredocs only (<<'EOF'), or Write/Edit.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh; delete DB residue only by exact id via buildUserDeleteSql (e2e/support/userCleanupCore.cjs); throwaway emails are plain addresses.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout: 600000 on long Bash calls; sbt testFull, never bare sbt test.
- [C6] Budget exhausted -> escalate; overnight: one extra round for a narrow named defect, else park.
- [C7] Auditor merges only with gh pr merge --squash --match-head-commit, never --auto.
- [C8] No prod actions, no release cut, no concertino sync.
- [C9] No claude.ai session link in PRs or commits.
- [C10] cleanup.sh --phase4 runs from the main checkout.
- [C11] Known flakes: hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, hel1665-home-phone-stability:437, hel1573-motion-grid-chart:104; one rerun of an unrelated CI failure, named in the PR.
- [C12] RED FIRST with recorded mutations; evaluator and skeptic run FULL affected spec files.
- [C13] Scratch in .concertino/scratch/HEL-1752/.
- [C14] Clean dev-DB residue by exact id; e2e uses lane-private DB helio_hel1752 (DATABASE_URL set for start-servers.sh AND Playwright).
- [C15] Measure overflow via scrollWidth/clientWidth, scrollHeight/clientHeight and text range rects, never hard-coded pixel widths (HEL-1757 changes e2e fonts).
- [C16] Keep the full confirm label including the dashboard count; scope CSS to the Output editor sheet footer, never global .ui-modal-btn.

## 1. Tests (RED first)

- [x] 1.0 Before any CSS change, measure the 1280x800 footer on the running app (confirm state and create mode with add-tail): each button's left/top/height and the footer's left; record in .concertino/scratch/HEL-1752/desktop-baseline.md
- [x] 1.1 Add e2e/hel1752-output-editor-footer-fit.spec.ts: 375x812 light+dark confirm-delete (Output placed on one dashboard) and create-mode "Add as tail with aggregate" geometry checks, assert the confirm's text equals "Confirm delete (removes from 1 dashboard)", every single-line footer button's height equals getComputedStyle --control-md (at 1280, and Cancel/Save at 375), and a 1280x800 check encoding the 1.0 baseline (shared row, Delete-vs-footer-left relation); run it against unmodified CSS and record the RED output in .concertino/scratch/HEL-1752/
- [x] 1.2 Record a mutation: with the fix applied, remove `flex-wrap: wrap` (separately: `height: auto`; and `padding-block` raised to `--space-2`) and record the spec going red for each; restore (if the e2e font fits the confirm on one line so a mutation stays green, record that in the log rather than treating it as a defect; the range-rect containment check must stay)

## 2. Frontend

- [x] 2.1 In OutputEditorSheet.css add `flex-wrap: wrap` to `.output-editor-sheet__footer` and a sheet-scoped `.output-editor-sheet__footer .ui-modal-btn` rule (height: auto; min-height: var(--control-md); padding-block: var(--space-1); text-align: center) with a short comment naming the scoped DESIGN.md §5 exception (design.md Decision); verify the spec from 1.1 goes green
- [x] 2.2 Update the stale header comment in OutputEditorFooter.tsx only if needed; verify lint, typecheck, prettier and OutputEditorFooter.test.tsx pass

## 3. Verification

- [x] 3.1 Screenshot the running app at 375px light and dark (confirm state and add-tail state) and 1280px, saved under .concertino/scratch/HEL-1752/; judge the create-mode wrap against design.md's acceptable-arrangement list; confirm desktop matches the 1.0 baseline
- [x] 3.2 Run the full hel1752 spec and the full affected existing specs that open the Output editor sheet (hel1733-draft-outputs-shapes, hel1510-output-editor-table-overflow, hel908-full-flow, hel1390-chart-tail-aggregate-live, hel1744-insight-panel) green
