## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 94b1288aa871960ba4d1afdfc4493226c7398e7d. Base resolved live with `resolve-review-base.sh`: c42c7ddf3dfe87971f9ed209160cf81578a19e80 (exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/popover-fit-clears-bottom-nav/HEL-1762`.
- **Diff (`git diff c42c7ddf3...HEAD`):**
  - `panelFit.ts`: `bottomInset` reduces `roomBelow` only. The `top`/`bottom` anchors still use the real viewport height, as design D1 requires.
  - `readBottomInset(panel)` measures the rendered `.bottom-nav` (`innerHeight - navTop`) unless the panel is inside `dialog[open]`. Otherwise it falls back to a cached hidden probe that measures `env(safe-area-inset-bottom)`.
  - Every caller in the design's tables is wired: provenance, ActionsMenu, Select (via `fitSelectPanel`) and AppearanceEditor. `outputSchemaPanelPlacement` now uses the shared reader, with its dialog rule unchanged.
  - With no nav and no safe area the inset is 0, so desktop placement is unchanged.
- **AC 2 (full HEL-1750/1756/1759 spec files pass):**
  - I re-ran all four full spec files (hel1750, hel1756, hel1759, hel1762) myself on the lane DB `helio_hel1762`, servers on 7194/10101, `--workers=2`, `nice -n 19`.
  - Result: **40 passed, 4 skipped**, exit 0.
  - The 4 skips are the existing `test.skip(vp.name === "phone", PHONE_EDITOR_REASON)` in hel1759, at lines 100 and 156.
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1762/skeptic-e2e.txt`.
- **AC 1 (red before, green after, at 390x844 and 390x400, light and dark):**
  - **Green:** the 6 hel1762 cases passed in my run above (4 provenance cases plus 2 ActionsMenu cases). Each asserts `{clearOfNav, hitIsItem, navInStack:false}` on the real last item (`a.provenance-popover__link` / last `menuitem`). A setup guard asserts that the unfixed fit would put that item's centre inside the nav band.
  - **Red (independent, no code edits):**
    - On my own seeded dashboard at 390x844, I hid `.bottom-nav` while the popover opened. `readBottomInset` then returns the 0 safe area, which is exactly the pre-fix fit. I restored the nav before measuring.
    - Trigger bottom 455.7:
      - Pre-fix: panel 463.7–829.7 against nav top 776, item centre y=790.7. Result: `clearOfNav:false, hitIsItem:true, navInStack:true`. The `elementsFromPoint` stack contains `SPAN.bottom-nav__lozenge`, the active nav tab and `NAV.bottom-nav` under the popover.
      - Fixed: the popover flips above (57.7–423.7) and is clear.
    - Trigger bottom 399.7:
      - Pre-fix: panel bottom 773.7, so `clearOfNav:false`.
      - Fixed: the panel is capped to bottom 768 = navTop − 8.
    - This independently reproduces the executor's `red-e2e-2.txt`, which has all 6 cases red on (a) and (c), with (b) green.
  - **Interpretation of the "elementFromPoint" AC:** the literal `elementFromPoint` check (b) is green before the fix, because the popover (z 100) paints over the nav (z 5). I confirmed this in my own stack dump. So the ticket's premise that items "can't be tapped" is false as written. The real defect is that the popover overlaps the nav band, hiding the nav.
    - The red is carried by (c), the `elementsFromPoint`-family check that the nav is under the item, and by the geometric check (a).
    - This was planned in design D0/D4, before execution, and passed the design gate. (b) was kept as-is rather than weakened.
    - I judge this a faithful reading of the AC's intent: the check that sees the overlap is red before the fix and green after. It is not intent-mismatch.
- **Unit tests:**
  - `npm --prefix frontend test -- --testPathPatterns='panelFit|selectPanelFit|outputSchemaPanel|Select|ActionsMenu|Provenance|AppearanceEditor'` gives 26 suites, 195 tests passed.
  - I spot-read the mutation logs `red-unit-safearea.txt` and `red-unit-dialog.txt` (2 red each), as claimed. Lint, typecheck and build are taken from the evaluator's pasted logs (`eval2-*.txt`), which are unambiguous. I did not re-run them, because the cycle-2 code delta is tests plus one comment.
- **Visual judgment (DESIGN.md, light + dark):** I took screenshots of the capped provenance popover at 390x844.
  - Dark: `/home/matt/Development/helio/.concertino/runs/HEL-1762/evidence/.concertino/skeptic-hel1762-dark-390x844.png`
  - Light: `/home/matt/Development/helio/.concertino/runs/HEL-1762/evidence/.concertino/skeptic-hel1762-light-390x844.png`
  - In both themes the popover ends at y=768, with a clean 8px gap above the floating nav capsule (top 776). The last item, "Open pipeline", is fully visible and the nav is no longer covered.
  - The change adds no styles, tokens or new components, so there is nothing to diverge from the standard.
- **Cleanup:**
  - I deleted my throwaway user `3b665799-b77e-495a-8c82-9ca812f7869a` by exact id via `buildUserDeleteSql`. 0 `@example.test` users remain.
  - The e2e teardown deleted its 40 users.
  - Servers were stopped with `stop-servers.sh` (`STOPPED ports=7194,10101`).
  - The lane DB had 0 connections and was then dropped.

### Verdict: CONFIRM

### Non-blocking notes
- The PR body should say plainly that the literal `elementFromPoint` check (b) was green before the fix (the popover paints over the nav), and that the red is carried by `elementsFromPoint` (c) and geometry (a). That way the ticket's "can't be tapped" premise is corrected on the record.
- The safe-area branch is covered only by unit tests (Chromium reports a 0 safe area), as design D5 says. A real-device check on an iPhone with a home indicator would be the first real measurement.
- I did not drill into any evidence whose correctness depends on mtime ordering. No gate defect to record.
