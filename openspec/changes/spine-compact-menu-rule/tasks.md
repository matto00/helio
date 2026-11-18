## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); scripts may read scripts/concertino/.concertino.env but never print it; never copy .env files.
- [C2] Quoted heredocs only (<<'EOF'), or Write/Edit.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh; delete DB residue only by exact id via buildUserDeleteSql (e2e/support/userCleanupCore.cjs); throwaway emails are plain addresses.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] `timeout: 600000` on long Bash calls; `sbt testFull`, never bare `sbt test`.
- [C6] RED FIRST with recorded mutations; evaluator and skeptic run FULL affected spec files.
- [C7] Scratch lives in .concertino/scratch/HEL-1671/ (main checkout).
- [C8] E2E uses a lane-private DB (helio_hel1671), with DATABASE_URL set for start-servers.sh AND the Playwright process; clean any residue by exact id.
- [C9] Do not change the shared popover fit (usePortalPopover / panelFit) or the open-dialog registry; measure truncation with scrollWidth/clientWidth, not hard-coded pixels.
- [C10] No prod actions, no release cut, no `concertino sync`; no claude.ai session link in commits or PRs.

## 1. Red tests first

- [x] 1.1 Extend `e2e/hel1608-spine-count-overlap.spec.ts` with the compact-is-on assertion (769–1009 on, 1100 off, list default) per design D5.1; record the mutation that turns it red.
- [x] 1.2 Add the ⋮-rule assertions (design D5.2) at compact widths (769, 900, 1009 with list default; 1024 and list-max widths use the mode derived from the spine content box per design D5) and run them on unmodified CSS: record the red output.
- [x] 1.3 Add the marker-gap assertion (design D5.3); record red on unmodified CSS.
- [x] 1.4 Add the one-line empty-markers assertion at 1100px (design D5.3b); record red on unmodified CSS.
- [x] 1.5 Add the touch-context tap assertion (design D5.3c) at 1100px and a compact width, plus the mouse hover/click check; record red at BOTH widths on unmodified CSS.

## 2. Implementation

- [x] 2.1 Compact block: selected row's ⋮ always visible on line 2 per design D2 (title keeps full line-1 width; trigger does not cover count/summary/title text); unselected rows keep the hover/focus overlay reveal.
- [x] 2.2 Compact block: drop the markers track when the markers slot is empty (design D3).
- [x] 2.3 Base rules: `.spine-row:not(.spine-row--phone) .spine-row__markers:empty` leaves the flow at every desktop width; phone rows untouched (design D3).
- [x] 2.3b Regular desktop rows with a menu: the select's hit box extends under the menu slot (negative right margin + equal padding, content box unchanged), the menu slot stacks above it, and the hidden menu gets `pointer-events: none`, restored ONLY by the selected row, `.spine-row__menu:focus-within`, and `.spine-row:hover` inside `@media (hover: hover)` (design D1, last two bullets); apply the same restore set inside the compact block. Confirm the content box/title width is unchanged at 1100px.
- [x] 2.4 Keep `pipelineHoverGating.css.test.ts` green (no new ungated hover outside allowlisted units).
- [x] 2.5 Update the comments in PipelineSpine.css that describe the old compact ⋮ behaviour.

## 3. Item 4 and item 5

- [x] 3.1 Measure the "Compute column" title (hel1579 fixture) visibility at 1100px (list default and max) before and after via scrollWidth/clientWidth; record in scratch evidence and in the PR body; decision per design D4.
- [x] 3.2 Confirm the spec delta for `pipeline-schedule-config-ui` matches PipelineSpineHeader.css (800px / 600px page content width) — adjust the delta if the CSS says otherwise.

## 4. Verification

- [x] 4.1 Full `e2e/hel1608-spine-count-overlap.spec.ts` and `e2e/hel1579-pipeline-spine-layout.spec.ts` green against the lane-private DB.
- [x] 4.2 Spine jest tests and the pipeline hover-gating guard green; lint, typecheck, format.
- [x] 4.3 Screenshots of the running app at 769, 900, 1024, 1100px, light and dark, list default and max, before (main) and after, in .concertino/scratch/HEL-1671/.
- [x] 4.4 `openspec validate spine-compact-menu-rule --type change` passes.
