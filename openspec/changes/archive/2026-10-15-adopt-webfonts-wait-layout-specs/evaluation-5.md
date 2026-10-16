## Evaluation Report — Cycle 3, second base-drift re-gate after HEL-1572 (evaluation-5.md)

- **Reviewed HEAD:** `9e26e04db2a03769a47a19f1cb93a2553cd41996`, the merge of `origin/main` (`2a9f9e467`, HEL-1572) into the branch. HEAD was the same at the start and at the end of every run (`head_end=` in `v8-full-suite.log`).
- **Review base:** `2a9f9e4677f7019f5f6a36c4f72e5146cf25df85`, resolved live with `resolve-review-base.sh`. `git ls-remote origin main` returns the same SHA, and it is an ancestor of HEAD.
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/adopt-webfonts-wait-layout-specs/hel-1613`.
- **This ticket's own code is unchanged by the merge.** `git diff 2a9f9e467...HEAD -- e2e frontend backend playwright.config.ts` is exactly `e2e/support/webFonts.ts` (+27/-20) and `e2e/hel1444-footnoted-chart-canvas.spec.ts` (+4).
- **Environment:**
  - Servers: this worktree's, on 7045/9952, started with `start-servers.sh` (`PASS servers`) and stopped with `stop-servers.sh` (`STOPPED ports=7045,9952`). I confirmed both listeners by process cwd: node at `.../hel-1613/frontend` and java at `.../hel-1613/backend`, with `DATABASE_URL=.../helio`.
  - Database: the shared `helio` DB is at Flyway V135, and HEAD's newest migration is `V135__pipeline_run_step_row_counts.sql`. HEL-1572 adds no migration, so every run used the shared DB.
  - Every Playwright run went through the shared `e2e.lock` flock, with `nice -n 19` and at most 2 workers. The 1-minute load never exceeded 10 at any run start.
  - Each log header gives cwd, HEAD, ports, DB, font env and loadavg.
  - Wrappers and probe specs are saved as `evidence/scratch/eval5-*.txt`. Probe specs ran from a scratch mirror (`.concertino/scratch/HEL-1613/evaluator5/tree`), so the worktree's `e2e/` was never touched.
  - Every run's user-registry teardown logged `deleted N recorded throwaway user(s)`, including the full suite (320) and both hel1444 runs (4 each). No user is left over.
  - All new files are uncommitted.

### (a) Sweep on HEAD — `evidence/sweep-hits-v5-merged.txt`

`evidence/sweep-command.sh` gives 262 lines in 44 files. v4 had 248 lines in 43 files.

**New hit file:**
- `e2e/hel1572-appearance-preferences.spec.ts`, 14 hits at :74-88, :300, :323, :475-489, :500, :540 and :588:
  - grid-item rects;
  - the `--density-grid-gap` probe;
  - accent swatch `boundingBox`/`y`;
  - the `findClipped` Range width against `clientWidth`;
  - the tabular-digit widths.

**Changed hit files.** The hit text is the same; only line numbers moved:
- `hel813-mobile-touch-target-floor.spec.ts`: 20/51/84/85/205 → 21/56/90/91/221. These are comment lines.
- `state-surface-contrast-guard.spec.ts`: 225 → 226.

**Geometry changes the sweep cannot see:**
- **`hel813`:** every surface is now looped over `STYLES = ["sans","mono"]`, so the file went from 14 to 28 tests. Each Mono test saves the style server-side and measures the whole UI in JetBrains Mono.
- **`state-surface-contrast-guard`:** the type style is seeded through `typeStyleUnderTest()`, and `HEL1572_TYPE_STYLE=mono` re-runs it in Mono.
- **`ConnectorsPage.css`, `ContextList.css`, `SourceListTable.css`, `PipelinesPage.css`:** vertical cell padding is now `var(--density-row-pad-y)`. That is `--space-2` (unchanged) under Comfortable and `--space-1` under Compact.
- **`panelGridConfig.gridMetrics`:** unchanged under Comfortable (`rowHeight` + 0, margin 12). Under Compact the gutter is 8 and `rowHeight` is +4.
- **`AccentPicker.css`:** swatches went from 20px to 28px on a 44px pitch, in 8 columns, or 4 at 768px and below. With the new Appearance section (`SettingsPage.tsx`, `AppearanceSection.css`), this re-flows `/settings` above the rows that hel813 surfaces 2 and 3 measure.
- **`app.html`:** a pre-paint script sets `data-type-style`, `data-density` and `data-motion`. The font URL adds JetBrains Mono `0,700`. `index.html`, the landing page, still has the old URL. The helper's selector matches both.
- **`hel813-mobile-touch-target-floor.regression.spec.ts`:** now seeds the type style. It is excluded by `testIgnore` (`**/*.regression.spec.ts`) and does not run in the suite.

### (b) `waitForWebFonts` with the new URL and font stacks — holds

Probe: `eval5-zzb-webfonts-styles.spec.ts.txt`, on `/connectors` at 768px under sans, mono and serif, scoped to `#app-main-content`. Logs are `v8-webfonts-styles-*.log`, 3 tests per run.

- **Live fonts:**
  - The selector finds the live `<link>` (`all|JBM:...0,600;0,700;1,400`).
  - The first computed families are `[Schibsted Grotesk]` for sans, `[JetBrains Mono]` for mono and `[Schibsted Grotesk, Fraunces]` for serif.
  - Under mono, `JetBrains Mono/700` is `loaded`.
  - The wait takes 15, 507 and 629 ms.
- **One family held, released by the spec 1500ms after the wait starts:**
  - The wait is still `pending` at 1500ms exactly when the held family is one the scope's text uses:
    - mono with JetBrains Mono held;
    - serif with Fraunces held;
    - sans or serif with Schibsted Grotesk held.
  - After the release it resolves (1836, 2071, 4445 and 2028 ms).
  - When the held family is not used in the scope, it correctly resolves while that family is still held.
- **Stylesheet aborted:** it throws `did not settle within 10000ms ... "stylesheetMedia":"print"` under all three styles. The failure is loud, not vacuous.

No measured spec calls `waitForWebFonts` under a non-default style. hel813 and the contrast guard use Mono but do not call it. The only callers are still `rowDeleteGesture.ts` and `hel1444:407`.

### (c) hel813 surface 7 on the new `ConnectorsPage.css` — still REFUTED

Probe: `eval5-zzprobe813.spec.ts.txt`, generated from HEAD's spec. It adds held-response gating at each measurement step. Logs are `v8-probe813-*.log`, each with 4 tests: 430 and 768, sans and mono.

**States run:**
- baseline;
- fallback-only (stylesheet aborted);
- all fonts held for the whole test;
- all fonts held and released at each step (after-cta, before-dialog, after-dialog, before-row, after-row), without waiting;
- the same release, with a settle, after the CTA, the dialog and the row;
- each family (Schibsted Grotesk, JetBrains Mono, Fraunces) held and released before the dialog and before the row.

**Result: 17 runs, 68 tests passed, 0 failed.**

**Heights are identical in every state:**
- CTA: 44
- dialog buttons: 32
- row trigger: 28
- toolbar: 32

**Only widths move:**

| element | sans, web face | sans, fallback | mono, web face | mono, fallback |
| --- | --- | --- | --- | --- |
| CTA | 130 | 131.91 | 138 | 143.20 |
| dialog buttons | 80 / 147 | 78.38 / 147.36 | 82 / 160 | 84.41 / 166.41 |
| toolbar | 128 | 129.91 | 136 | 141.20 |

- The row `<tr>` is 49.5 in the web face and 50.5 in fallback. No assertion reads it.
- The density-token padding change resolves to the same 8px under Comfortable, which is all this spec runs.

### (d) Forced font states over new and changed geometry specs

**File set:** hel1572, hel813 (28 tests), state-surface-contrast-guard, plus the measured specs that touch the re-flowed `/settings` or the density-padded rows: focus-presence-guard, hel1574, hel1605, hel572 and hel588. That is 102 tests. Logs are `v8-*.log` in evidence.

| state | log | result |
| --- | --- | --- |
| baseline | `v8-A-baseline.log` | 102 passed |
| fallback-only | `v8-B-css-block.log` | 91 passed, 11 failed. All 11 are `waitForWebFonts: web fonts did not settle` (hel1574 ×4, hel1605 ×7), which is the same by-design set as v6. |
| late 1500ms | `v8-C-late-1500.log` | 102 passed |
| first measurement in fallback, blocking injector | `v8-D-fontfirst-n1.log` | 102 passed, 83 release lines |
| first measurement in fallback, non-blocking injector | `v8-D-fontfirst-n1-nowait.log` | 102 passed |
| one family held: Fraunces / JetBrains Mono / Schibsted Grotesk | `v8-E-hold-*.log` | 102 passed in each |
| contrast guard under `HEL1572_TYPE_STYLE=mono`: baseline, fallback-only, late, first-in-fallback (blocking and non-blocking), JetBrains Mono held | `v8-ssc-mono-*.log` | 18 passed in each |

**Recorded as font-insensitive, with values:**
- **state-surface-contrast-guard, sans and mono:** the guard summaries are byte-identical in all 14 runs. For example, `elements probed: 66, resolved=66, unresolved=0, pass=43, fail=2, advisory=21`. All 9 view summaries match.
- **hel813:** all 28 tests are green in every state. Surface 7 values are in (c).
- **hel1572 other assertions.** Values come from `v8-values-*.log` and `v8-hel1572-rows-*.log`:
  - **Type cards** at 375/768/1280: 110/110/106 and 132 ×3. With JetBrains Mono held they are 107/109/107 at 375. The floor is 88.
  - **Mono clipping:** `clipped=[]` at 375, 768, 820 and 1280, both live and in fallback-only, all-held and JetBrains Mono held.
  - **Tabular digits:** 1111 equals 8888 in every state:
    - sans: 31.96 web, 27.43 fallback;
    - mono: 27.96 web, 28.73 fallback.
  - **Proportional-nums mutation** (asserted > 0.5):
    - web face: 11.98;
    - fallback: 7.10;
    - mono: 0.00, which the spec only checks under sans.
  - **Grid density test:** panel tops are 72/72/392 in every state, and heights are 308 for Comfortable and 312 for Compact.

**RED from the font swap: `e2e/hel1572-appearance-preferences.spec.ts:358`, "Compact tightens overview list rows ...", at the step `:384 const comfortable = await rowHeight();` compared at `:392`.**
- **What the test does:** it measures the first source row's height on one document, right after `toBeVisible()`, with no font wait. It then reloads `/sources` under Compact and asserts `comfortable - compact ≈ 8`.
- **Row heights by face:**
  - Comfortable is 42 in the web face and 44 in fallback.
  - Compact is 34 in the web face and 36 in fallback.
- **When it goes red:** if the first document is still in the fallback face and the second has the web faces (cached by then), the difference is 10.
- **Natural failure:** the full suite on HEAD failed exactly this way: `Expected: 8, Received: 10`, at load 3.47 at the start.
- **Natural repeat:** `v8-hel1572-rows-m-F-real-spec-repeat10.log` runs the unmodified spec with `--repeat-each=10` at load 4.10. Result: 3 of 10 failed, each with `Received: 10`.
- **Deterministic red,** from probe `eval5-zzd1572-mixed.spec.ts.txt`, which is the spec verbatim plus logging:
  - Setup: all fonts held through the comfortable measurement, released, then the second document measured in the web face.
  - Log: `v8-hel1572-rows-m-B-mixed-first-fallback-second-web.log`.
  - Values: `comfortable=44 compact=34 diff=10`, failed.
  - Holding Schibsted Grotesk alone (`m-C-mixed-hold-Schibsted_Grotesk`) reproduces it with JetBrains Mono `loaded`, so the swapping family is Schibsted Grotesk.
- **Green states:**
  - live: diff 8;
  - fallback-only: 44 vs 36, diff 8;
  - converted model, `waitForWebFonts` on the row before both measurements with fonts released at 1500ms (`m-D-converted-model-held-1500`): 42 vs 34, diff 8, passed.
- **Why the injectors missed it:**
  - Fallback-only and late-1500 keep both documents in the same face.
  - `FONT_FIRST` forces only the first measurement into fallback, and the second document's fonts are then not guaranteed to have landed.
  - The failure needs a swap across documents. I added that state ("first document fallback, second document web") for this check.

### (e) hel1444 red/green pair — unaffected by JetBrains Mono 700

The mode is the same as cycle 3: `FONT_FIRST=1 FONT_FIRST_N=100000`, `-g "canvas floors"`, 1 worker.

- **Base spec:** `git show 67c434c6b:...`, sha `92273fbc…`, identical to `2a9f9e467`'s copy. It ran from a scratch mirror.
  - Log: `v8-redgreen-hel1444-base-RED.log`.
  - Result: `58px (main 57)` ×16, **4 failed, exit=1**, 0 release lines.
- **Converted spec:** run from the worktree with `FONT_FIRST_ASK_DELAY_MS=400`.
  - Log: `v8-redgreen-hel1444-converted-GREEN.log`.
  - Result: `57px (main 57)` ×16, **4 passed, exit=0**, 4 release lines.
- This time the base run passed `DATABASE_URL`, so its 4 users were deleted.

### (f) Full suite on HEAD — `evidence/v8-full-suite.log`

- **Header:** `cwd=.../hel-1613 head=9e26e04db2a0… dirty_code=0 DEV_PORT=7045 BACKEND_PORT=9952 DB=helio(shared,Flyway V135=HEAD V135) loadavg_start=3.47 4.03 4.02`.
- **Lock:** `lock_acquired=00:49:10 loadavg=3.47`.
- **Command:** `flock -w 3600 …/e2e.lock nice -n 19 npx playwright test --workers=2`.
- **Result: `Running 340 tests`, 339 passed, 1 failed (15.6m), exit=1.**
- **The failure:** `hel1572-appearance-preferences.spec.ts:358`, `Expected: 8, Received: 10`.
- **End:** `head_end=9e26e04db…`, `loadavg_end=5.83 5.82 5.17`.
- **Why I did not re-run it as load noise:** load was about 4-6, well below 15. The cause is reproduced in (d).

### (g) Gates — PASS

- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npx tsc -p e2e/tsconfig.json --noEmit`: exit 0.

---

### Phase 1: Spec Review — FAIL

- **AC3:** "each spec where the font swap can affect the measurement adopts `waitForWebFonts`" is no longer met on HEAD. The merge brought in `hel1572`'s density-rows test, which measures font-dependent row heights across two documents with no font wait. I showed it red from the font swap: naturally, 3 of 10 times, and deterministically with a held font.
- **AC5:** "the FULL e2e suite passes locally on the final head" is not met: 339 of 340 pass.
- **What still holds:**
  - AC1: the hel1510 verdict is unchanged, and hel813 surface 7 is re-probed and still REFUTED, now in sans and mono.
  - AC2: the sweep is re-run and recorded as v5.
  - AC4: no retries, timeouts, skip or fixme in the branch diff.
  - Constraints C1-C5: C3 and C5 are why this gate measured red before calling the spec font-sensitive.

### Phase 2: Code Review — PASS

- The branch's code (`webFonts.ts`, `hel1444`) is byte-identical to what evaluation-4 and skeptic-final-3 reviewed.
- Lint, format and the e2e typecheck pass fresh on HEAD.
- `npm test`, the frontend build and `sbt testFull` do not apply: the branch's own diff touches no `frontend/**` or `backend/**` file.

### Phase 3: UI Review — N/A

The branch's diff against `2a9f9e467` touches no UI-trigger file. The HEL-1572 frontend changes come from `main`.

### Overall: FAIL

### Change Requests
1. **Convert `e2e/hel1572-appearance-preferences.spec.ts` "Compact tightens overview list rows ..." (`:358`).**
   - **Change:** call `await waitForWebFonts(page.locator(".source-list-table tbody tr").first())` after each `toBeVisible()` and before each `rowHeight()`. That is:
     - before `:384 const comfortable = await rowHeight();`;
     - before the measurement inside `:392`, after the second `goto` at `:387` and its `toBeVisible()`.
   - **Import:** `waitForWebFonts` from `./support/webFonts`.
   - **Constraints:**
     - Do not put the wait inside an `expect.poll` (C4).
     - Do not change the expected `8` or add a tolerance or retry (C1).
   - **Required proof (C3, AC3):** red under a mixed cross-document state, then green. Two options:
     - Reuse `evidence/scratch/eval5-zzd1572-mixed.spec.ts.txt` with `zzfontgate` (`FONT_HOLD=all FONT_AT=after-first FONT_AFTER=settle E5_SECOND_WAIT=1`). The unconverted spec gives `diff=10`, failed.
     - Or the natural `--repeat-each=10` (3/10 red before), then green after with release-on-ask (`FONT_TIMER_MS`/ask delay), as the hel1444 pair did.
   - **Also:**
     - Record the spec in `sweep.md`'s classification as converted.
     - Record this cross-document state as a missing forced state in the sweep method.
2. **Re-run the FULL e2e suite on the resulting head:** at most 2 workers, `nice -n 19`, under the lock. Record it as the AC5 evidence.

### Non-blocking Suggestions
- **For `sweep.md`'s drift section,** record as font-insensitive, with the values above:
  - hel813 (28 tests, sans and mono);
  - state-surface-contrast-guard (sans and mono, identical guard summaries);
  - the hel1572 grid-density, type-card, mono-clip and tabular assertions;
  - the surface 7 widths and heights, including the Mono fallback widths.
- **Sweep method:**
  - Add a "first document fallback, later document web" state to the forced-state set.
  - `FONT_FIRST` and `css-block`/`late` all keep both sides of a cross-navigation comparison in the same face, so any spec that compares two measurements taken on different documents can only be caught by that state.
- **`hel1572` clip and tabular tests** use `await page.evaluate(() => document.fonts.ready)`. This ticket's own header comment documents that this is vacuous before the stylesheet applies. Both are measured font-insensitive, so this is a robustness note only.

### Critical Path
- **The one issue blocking a pass:**
  - HEL-1572's density-rows test, `hel1572:358`, is font-swap-sensitive and red on HEAD. That fails AC3 and AC5.
  - The fix is a two-line `waitForWebFonts` adoption with a red/green proof, then one full-suite run.
  - Everything this ticket shipped (`webFonts.ts`, hel1444) still passes every re-check on the new base. This includes the wait's behaviour under the Mono and Serif type styles and the new JetBrains Mono 700 face.
- **Recommendation for the human:**
  - Have the executor apply Change Request 1 in this branch, since AC3 covers "every spec that asserts pixel geometry" and this one arrived with the base.
  - If you would rather keep HEL-1613's scope fixed at the pre-merge spec set, an alternative is to file a follow-up on HEL-1572's spec. AC5 (full suite green on the final head) would then still need that fix, or an explicit owner waiver, before this branch can merge.
