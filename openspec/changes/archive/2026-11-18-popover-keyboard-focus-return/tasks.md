## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; never run env-dumping commands. Scripts may read scripts/concertino/.concertino.env, never print it.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill by exact PID only; stop servers with stop-servers.sh; delete DB residue only by exact id via buildUserDeleteSql; throwaway emails are plain addresses.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout 600000 on long calls; use sbt testFull, never bare sbt test.
- [C6] Budget exhausted means escalate.
- [C7] Merge only through the auditor with gh pr merge --squash --match-head-commit; never --auto.
- [C8] No prod actions, no release cut, no concertino sync.
- [C9] No claude.ai session link in the PR or commits.
- [C10] Phase 4 runs cleanup.sh --phase4 from the main checkout; confirm run.end; delete the local branch if cleanup skipped it.
- [C11] Known flakes (hel1584:493, hel1583-glass-nav:554, hel1668-phone-sheet:184, hel1665-home-phone-stability:437, hel1573-motion-grid-chart:104): rerun only the failed job once, name it in the PR; second failure escalates.
- [C12] Red first, keyboard-only, real browser, recorded mutations; compare against the running app in light and dark, desktop and phone.
- [C13] Scratch goes in .concertino/scratch/HEL-1759/, never the shared session scratchpad.
- [C14] Clean up dev-DB residue by exact id.
- [C15] Treat every driver/orchestrator claim (incl. premise-validation findings) as a claim to verify against the tree.
- [C16] Report the exact diff of every shared file (usePortalPopover.ts and any other shared/ or hooks/ file) in files-modified.md for the concurrent HEL-1744 lane.

## 1. Reproduce (red first)

- [x] 1.1 Write `e2e/hel1759-popover-keyboard-focus.spec.ts` (keyboard only after login/navigation; light + dark; desktop + phone per design D3) with the three cases: failed save keeps editor open with focus on Save and preset intact; Shift+Tab from the editor's first preset lands on its trigger; Shift+Tab from the actions menu's first item lands on its trigger. Verify: run it against unmodified source and record each case FAILING (transcript under .concertino/scratch/HEL-1759/).
- [x] 1.2 Probe in a real browser whether a synchronous `trigger.focus()` inside a document `focusout` handler sticks (design D1); record the result. Verify: probe transcript.

## 2. Shared hook

- [x] 2.1 Enumerate every `usePortalPopover` consumer and which attach `panelRef`; record the list. Verify: grep output in notes.
- [x] 2.2 Implement D1/D1a in `frontend/src/hooks/usePortalPopover.ts` (Tab-tracking ref via the existing keydown listener, cleared on pointerdown and after focusout; return focus to trigger only when focus left from inside the panel by Tab). Update the hook's doc comment and `frontend/src/hooks/README.md` if it documents focus-out. Verify: new unit cases in `usePortalPopover.test.tsx` (panel Shift+Tab -> trigger; trigger focus-out -> not refocused; pointer focus-out -> not refocused; no panelRef -> unaffected) pass, and each fails under a recorded mutation.

## 3. Appearance editor

- [x] 3.1 Implement D2/D2a in `DashboardAppearanceEditor.tsx`: `aria-disabled` while saving, early return in submit while saving backed by a savingRef, CSS parity for `:disabled` / `:hover:not(:disabled)` (DashboardAppearanceEditor.css), `tabIndex={-1}` on the editor scrim, failed-save error announced (aria-describedby or local aria-live) without changing InlineError's default. Verify: editor unit tests (aria-disabled while saving; second submit dispatches nothing; focus on Save after rejected save) pass, each red under a recorded mutation.

## 4. HEL-1756 spec emails

- [x] 4.1 Compute every `registerAndLogin` label in `e2e/hel1756-popover-viewport-fit.spec.ts` and confirm each resulting email local part matches `PLAIN_EMAIL_LOCAL`. Edit only if one does not. Verify: recorded check output.

## 5. Verification

- [x] 5.1 The 1.1 spec passes in full (light/dark, desktop/phone), Playwright workers 2, against this lane's own dev/backend ports. Verify: transcript.
- [x] 5.2 Run in full every affected unit and e2e spec file for every `panelRef` consumer (incl. hel1756 and hel1750 specs, ActionsMenu/Select/Provenance/Editor unit tests). Verify: transcripts.
- [x] 5.3 Lint, typecheck, format:check, full frontend jest (maxWorkers 3). Verify: transcripts.
- [x] 5.4 Visual compare of the Save button while saving (light + dark) against the running app before/after. Verify: evaluator-produced comparison (evaluation-1.md Phase 3): computed opacity, cursor, background and color identical before/after; only diff is Save's intended focus ring. Screenshots: /home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/eval/save-{after,before-emulated}-{light,dark}.png
- [x] 5.5 Delete this run's throwaway users by exact id (userCleanup). Verify: cleanup output.
