## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 3ce5f6963ef3d8fda31a174bf6e4b1a28babb9a7 against live base 793802e50a8de763f905a431ca120490c372404d.

### Phase 1: Spec Review — FAIL

The code conversion is correct and in scope. The S4 "green" evidence does not show what it claims.

Verified, PASS:
- **Scope (C15).** `git diff 793802e5...HEAD -- e2e/ playwright.config.ts frontend/ backend/` shows only the two spec files (+5/-4). The four replaced lines are exactly base hel1579:296, :465 and hel1572:672, :764. My generator asserts each of those base lines is literally `await page.evaluate(() => document.fonts.ready);`. No tolerance, timeout, retry, assertion or helper change. The `waitForWebFonts` import was added to hel1579 only.
- **Delay mechanism (C16).** It is real. I re-ran it with my own generated scratch copies, built from `git show 793802e50:` (pre) and from HEAD (post), plus the committed gate. The `page.route` handler held the stylesheet (`held={"css":1}`). At the site the dump showed `media:"print"`, and the original `fonts.ready` resolved after 5ms (vacuous).
- **S4 red (C19).** Reproduced. Pre-conversion run, `css` mode: `Error: sans: 1111 vs 8888 / Expected: <= 0.5 / Received: 2.99725341796875`, with VALUES ones 24.97 / eights 27.96. The failing assertion is the one right after the site, so it counts as a red.
- **No-red sites are not presented as reds.** S1-S3 are labelled "NO RED POSSIBLE" everywhere. The `allrace`/`sch` S4 failures are explicitly labelled non-faithful and "NOT a red of the real code".
- **S1-S3 no-red claims.** Sampled S3 pre-conversion in `css` mode: passed, worstTextOverBox 0 at 375/768/820/1280. This matches red-S3.txt. The red-S1/S2/S3 after-wait dumps show `media:"print"` in every `css`/`cssrel` iteration, so the measurements did run held.
- **Containers.** Each resolves to exactly one element: S4 `getByRole("dialog",{name:"Run history"}).count()` was 1 in all 3 iterations of my run, and `waitForWebFonts` calls `target.evaluate`, which is strict. S1-S3 passed strict `evaluate` in my runs and the 20x runs.
- **Never-released runs (D4).** S4 post-conversion `cssnever` fails loudly at the wait: `waitForWebFonts: web fonts did not settle within 10000ms ... "stylesheetMedia":"print"` at the converted line. It does not fail at goto or at the test timeout.
- **20x counts (C17).** `--list` gives 14 tests in hel1579 and 17 in hel1572. The grep partitions are 2+4+2+3+2+1 = 14 and 8+3+5+1 = 17. Each matches the listed titles, and each partition count is its test count x 20 (280 / 340). My own sample: hel1572 S3+S4 x20 gave 40 passed; hel1579 S1[dark]+S2 x10 gave 20 passed; no failures, nothing flaky.
- **hel1572:126 note (D5).** It identifies the test by title via 943b5dd73^, cites HEL-1826's write-ordering root cause, and reports 0/20 failures in q1. The list is left unchanged.
- **Constraints C1-C19.** Honored as far as is observable. No env access is visible. The scratch scripts write under `.concertino/scratch/HEL-1622/`. The evidence commit 1af074fa6 precedes the conversion commit 7747a20cf (C12).

Issue (blocking): **the S4 green run never exercised the converted wait under a live hold (D4 / AC 2).**
- Tabulating the `before-wait` dumps in `evidence/green-S4.txt` gives the same result for every green mode (`none`, `cssT`, `allT`, `schT`, `jbT`, `frT`): every iteration reached the site with `"media":"all","status":"loaded","loading":0`. The 1.5s timer had already released the fonts before the dialog opened, so `waitForWebFonts` had nothing to wait for.
- I proved this is non-discriminating by running the **pre-conversion** S4 under the same `cssT` mode. It PASSES: diff 0 for sans, mono and serif, and `fonts.ready` sees fonts already loaded.
- So `green-summary.txt` is false where it says "S4 cssT is the state that was RED before conversion: green now because waitForWebFonts waits for media=all and the faces". It is green because the release happened before the site. The old code is green in that state too.
- S4 is the only site with a real red, so its red/green pair is the evidence this ticket exists to produce, and it currently has no discriminating green.
- A discriminating pair is achievable; I ran one. I made a scratch-only gate change that releases the holds 1000ms after the site's `before-wait` dump.
  - Pre-conversion: RED, `Received: 3`.
  - Post-conversion: GREEN. All 3 iterations reached the site with `media:"print"`, and measured 32/32, 28/28 and 32/32.
- For S1-S3 the green modes `cssT`/`allT`/`schT` did reach the site held (`media:"print"` or `loading>=1`), so those greens do exercise the wait. The issue is S4-specific.

Issue (minor, fix alongside): `red-summary.txt` cites the S4 failure "at hel1572 spec line 768". That is the scratch file's line, offset by the added import line. In the real spec the assertion is line 767.

### Phase 2: Code Review — PASS
Gates, run fresh on the touched files only (no `frontend/**` or `backend/**` changes, so the frontend and backend suites are not triggered):
- `eslint --max-warnings=0`: 0.
- `prettier --check` on both specs and the change dir: clean.
- `tsc --noEmit -p e2e/tsconfig.json`: 0.

The diff is minimal and readable. It reuses the shared helper (DRY). Each container is the narrowest that holds the measured text, as design D3 requires, and the S2 wait is called once per goto, outside the 43-width loop and outside any poll. No dead code.

### Phase 3: UI Review — N/A
No trigger paths changed (only `e2e/**` and `openspec/changes/**`).

### Overall: FAIL

### Change Requests
1. **Re-run the S4 green with a release that fires after the site is reached, and replace `evidence/green-S4.txt`.**
   - Add a release trigger to the scratch gate. Two options: release N ms (for example 1000) after the `S4 before-wait` dump, or release when `waitForWebFonts` is entered.
   - Run it on post-conversion S4 in at least the `css` hold mode, plus one face-hold mode (`all` or `sch`).
   - Show in the record that every iteration's `before-wait` dump is held (`media:"print"` or `loading>=1`) and that VALUES are diff 0.
   - Run the same mode on pre-conversion S4 and record it as the paired red. Expect `Received: ~3` for `css`. Keep or demote the old `cssT` runs, but label them "released before the site: non-discriminating".
   - Commit the updated gate source to `evidence/scratch/zzfontgate.ts.txt`.
2. **Correct `evidence/green-summary.txt`.** The sentence "S4 cssT is the state that was RED before conversion: green now because waitForWebFonts waits..." must state what the new run shows. It must not credit a run in which the fonts were already loaded.
3. **Correct `evidence/red-summary.txt` S4 line.** Change "at hel1572 spec line 768" to line 767 of the real spec (scratch file line 768).

### Non-blocking Suggestions
- In green-S1/S3, a few `jbT`/`frT` iterations also reached the site already loaded (S1 jbT 2/8, S3 jbT 1/4, S3 frT 1/4). Each of those modes has other iterations that were held, so they are fine, but a one-line note in green-summary would make that explicit.
- The S4 container proof in the gate used `dialog[open]` as a CSS stand-in. A `.count()` on the real `getByRole` locator, which I used, is the more direct proof.
