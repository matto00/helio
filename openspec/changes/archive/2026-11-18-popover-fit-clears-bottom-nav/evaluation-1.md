## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 21104ee1199c4c10518751f5636ba11c754136f5 (base c42c7ddf3dfe87971f9ed209160cf81578a19e80, resolved live).

### Phase 1: Spec Review — FAIL
Issues:
1. **AC 1 not met at 390x844: the e2e probes the wrong "last item".** The AC asks for an `elementFromPoint` check on the
   popover's last item that is red before the fix and green after, at 390x844 and on a short phone, in light and dark.
   The executor's own red run (`.concertino/scratch/HEL-1762/red-e2e.txt`, lines 29-32 and 108-111) shows that at
   **390x844, both themes**, `hitIsItem: true` and `navInStack: false` before the fix. Only the geometric check (a)
   `clearOfNav` was red. Checks (b) and (c) were red only for the 390x400 and actions-menu cases.
   The cause is in the spec, not in the stacking. `e2e/hel1762-popover-clears-bottom-nav.spec.ts:153` probes
   `.provenance-popover__content section` (the "Checks" section). The provenance popover's actual last item, and its
   only tappable one, is the "Open pipeline" link (`ProvenanceContent.tsx:161-165`, `a.provenance-popover__link`, the
   content div's `lastElementChild`). It sits below that section.
   I measured this on a live phone dashboard (390x844, fixed code; raw numbers in
   `/home/matt/Development/helio/.concertino/scratch/HEL-1762/eval-link-measurement.json`):
   - The last section's centre is 90.5px above the popover's bottom.
   - The link's centre is 39px above the popover's bottom.
   - With the unfixed fit ending the popover at 836 (844-8), the section's centre is about 745.5, above the nav top of
     776. That is why (c) stayed green.
   - The link's centre is about 797, inside the nav band (776-832).

   D4 required "D0 picks a trigger that puts the popover's last item centre well inside the nav band". The spec's own
   guard does not check this. At `spec.ts:83-86` it asserts `unfixedBottom - 20 > navTop`, which is about the
   **panel's** bottom, while its message claims "the unfixed fit would end the panel's last item inside the nav band".
   That message is false for the item the spec measures. So at the ticket's headline viewport, the
   elementFromPoint-family assertion proves nothing red-before. Standing constraint C1 ("record which went red") was
   honoured in probe.md. But the AC's intent for 390x844 depends on probing the real last item.
2. Task 3.2 (record the UserMenu finding and the HEL-1746 ask drawer / phone-sheet dialog check) is ticked, but neither
   finding is recorded in any artifact yet (probe.md, files-modified.md). It is deferred to the PR body. This is not
   blocking on its own; make sure it lands.

Otherwise: every caller in design.md's tables is handled.
- Callers 1-4 pass `readBottomInset(panel)`: provenance, ActionsMenu, Select via `fitSelectPanel`, and the appearance
  editor.
- Caller 5 (`outputSchemaPanelPlacement.ts`) uses the shared reader and keeps its dialog rule.
- Caller 6 (UserMenu) is untouched, as designed.
- No scope creep, and no API or schema impact.
- The spec delta matches the implementation.

### Phase 2: Code Review — FAIL
Gates, re-run by me in WORKTREE_PATH. Logs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1762/eval-*.txt`.
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test` (3 workers): exit 0. Root: 66 suites / 579 tests. Frontend: 820 suites / 9924 tests.
- `npm --prefix frontend run build`: exit 0.

Code: `fitPanelVertically`'s `bottomInset` is applied to `roomBelow` only, and the anchors keep the real viewport height
(D1, correct). `readBottomInset` follows D2: nav measured from the layout, dialog-aware, with a cached safe-area probe.
There are no type escapes, no dead code, and no CSS/token changes.

Issues:
1. **The safe-area branch is untested, and the reader tests were never shown red.**
   - D5 promised `readBottomInset` cases "nav inside an open modal dialog -> safe area only, nav absent -> safe area
     (stub rects)", and design says "the safe-area branch is unit-tested only".
   - In `panelFit.test.ts:117-139`, every no-nav and dialog case asserts `0`, which jsdom returns anyway.
   - A mutation that replaces `readSafeAreaBottom()` with `0` (`panelFit.ts:77`) passes the whole suite. So the
     safe-area exclusion that the spec requirement names has no failable test anywhere: Playwright Chromium reports
     0 safe area too.
   - `red-unit.txt` shows only the 3 `fitPanelVertically` tests red. The `readBottomInset` tests cannot be red under
     the recorded D4 mutation, and no mutation was recorded for them, contrary to D5's "each new unit test is shown
     red".

### Phase 3: UI Review — PASS (with the e2e-coverage issue carried under Phase 1)
- Servers were started with `start-servers.sh` on the lane-private DB `helio_hel1762`. I confirmed the backend migrated
  that DB (141 flyway rows).
- I ran the four full spec files myself with 2 workers: `hel1750-actions-menu-viewport-fit`,
  `hel1756-popover-viewport-fit`, `hel1759-popover-keyboard-focus` and `hel1762-popover-clears-bottom-nav`. Result:
  **40 passed, 4 skipped** (the skips are the designed ones), exit 0. Log: `eval-e2e.txt`.
- Observed behaviour after the fix is correct for the surfaces exercised. The popover clears the nav at 390x844 and
  390x400, light and dark, and the actions menu does too.
- No console errors were raised by the tested flows (all specs green).
- My live-probe user was deleted by exact id via `buildUserDeleteSql`. Servers were stopped with `stop-servers.sh`.

### Overall: FAIL

### Change Requests
1. `e2e/hel1762-popover-clears-bottom-nav.spec.ts:153` (and the `item` used by `expectClearsNav`): probe the provenance
   popover's real last item, the "Open pipeline" link (`.provenance-popover__content > :last-child`, or
   `a.provenance-popover__link`), not `.provenance-popover__content section`.
   - Keep checks (a), (b) and (c) unweakened (C1).
   - Re-record red under the same mutation (`bottomInset` ignored in `fitPanelVertically`). Show that at **390x844
     light and dark**, check (c) `navInStack` is red before the fix. On my measurement the link's centre lands at about
     797 against a nav top of 776.
   - Save the new red output to the scratch dir and update probe.md's D0 conclusion with which checks went red per case.
2. `e2e/hel1762-popover-clears-bottom-nav.spec.ts:83-86`: make the setup guard assert the condition the message claims.
   The **last item's** centre under the unfixed fit must lie inside the nav band (compute it from the item's offset to
   the panel bottom measured in pass 1), not just the panel's bottom minus 20. Without this, the case can silently prove
   nothing again.
3. `frontend/src/shared/ui/panelFit.test.ts` (`readBottomInset` block): add a failable test for the safe-area branch.
   For example, stub `HTMLElement.prototype.getBoundingClientRect` (or spy it for the probe element) so the probe
   reports 34. Then assert:
   - nav absent -> 34;
   - nav present but panel inside `dialog[open]` -> 34;
   - nav visible -> the nav band, not the safe area.

   Record the mutation `readSafeAreaBottom` -> `0` showing these red, plus a mutation for the dialog rule (for example,
   drop the `closest("dialog[open]")` check) showing the dialog test red. Save the output under
   `.concertino/scratch/HEL-1762/`.

### Non-blocking Suggestions
- Record task 3.2's UserMenu and ask-drawer/phone-sheet dialog findings in files-modified.md or probe.md now, so the
  PR body is not their only home.
- `readSafeAreaBottom` leaves a permanent hidden probe node in `<body>`. This is harmless and designed, but a one-line
  comment noting it is intentional would stop a future reader from "cleaning it up".
