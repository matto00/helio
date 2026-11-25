## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 88a5ca006dd07db513fe7dcdafe17f324afd38c3 against the live-resolved base 793802e50a8de763f905a431ca120490c372404d (`resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

- **Scope (AC1, C15).** `git diff BASE...HEAD --name-only` lists only two non-openspec files: `e2e/hel1572-appearance-preferences.spec.ts` and `e2e/hel1579-pipeline-spine-layout.spec.ts`. The e2e diff is +5/-4. It replaces exactly four `await page.evaluate(() => document.fonts.ready)` lines, at hel1579:296 → `.spine-header`, hel1579:465 → `.pipeline-detail-page--spine`, hel1572:672 → `.app-shell` and hel1572:764 → `getByRole("dialog", { name: "Run history" })`. It also adds the hel1579 import. No tolerance, timeout, assertion, helper or config changed. `grep document.fonts.ready` on both files now returns nothing. The other sites are elsewhere and left to HEL-1884.
- **Delay mechanism (C16).** I read the committed gate (`evidence/scratch/zzfontgate.ts.txt`). It uses `page.route` on `fonts.googleapis.com/css2` and `fonts.gstatic.com`, holds on a promise, then calls `route.continue()`. My own runs confirm the handler fires and holds: dumps show `held={"css":N}`, the stylesheet link stays `media:"print"`, and the counts are non-zero on every iteration.
- **Forced-delay red/green pair, re-run myself (S4, mode siteCss = stylesheet held, released 1000ms after the site).** I generated scratch specs from the committed `gen.py` into e2e/ and ran them on lane servers 7054/9961 with the lane DB. They are deleted again; `git status` is clean apart from the uncommitted evaluation-2.md.
  - **Pre-conversion (base code): RED.** `Error: sans: 1111 vs 8888 / Expected: <= 0.5 / Received: 3`, at scratch line 768. That is the assertion immediately after the site, so it satisfies C19. The original `fonts.ready` resolved after 5ms with `media:"print"`. VALUES: ones 25, eights 28.
  - **Post-conversion: GREEN.** All 3 iterations (sans/mono/serif) reached the site held (`media:"print"`, `held={"css":1..3}`). `CONTAINER-LOCATOR count=1` each time. VALUES diff 0 (32/32, 28/28, 32/32). 1 passed.
- **"No red possible", re-run (S1, mode css, pre-conversion).** 2 passed (dark and light). Every iteration was held (`media:"print"`). The values match the committed red-summary exactly: headerH 44, minItemGap 4/4/8/8, overflow 0, doc extents 0. The label is honest: nothing moves, and the summaries never present it as a red.
- **Never-released (S3 post, cssnever).** It fails loudly at the bound with `waitForWebFonts: web fonts did not settle within 10000ms ... stylesheetMedia:"print"`, at the converted line 673. It does not fail at goto or at the test timeout.
- **Repeat runs (AC3), re-run myself** with `nice -n 19 --repeat-each=20 --workers=2`, lane servers and the lane DB:
  - hel1572 tap-targets + tabular-numerals partitions (contain S3 and S4; 6 tests): **120 passed**, exit 0.
  - hel1579 `820/900/1100px|sweep 769-1100px` (S1 dark+light, S2; 3 tests): **60 passed**, exit 0.
  - The full-file counts in `repeat-counts.txt` (280 + 340, partitioned by `--grep`) are consistent with these.
- **hel1572:126 note (AC4).** `evidence/hel1572-126-note.txt` resolves the test by title. It cites HEL-1826's root cause, a preference-write ordering race. It also notes that the test contains no converted wait, and that it ran 0 failures in 20. The note is reasoned correctly and removes nothing from any list.
- **Red-first ordering (C12).** Commit 1af074fa6 (red evidence) comes before 7747a20cf (conversion). This is shown by `git log`, which is content ordering, not mtime.
- **Lint and format.** `prettier --check` and `eslint` on both touched files both exit 0.
- **UI judgment.** Not applicable. The change is e2e-only, with no frontend/ changes.

### Verdict: CONFIRM

### Non-blocking notes
- Harness deviation: besides the designed `waitUntil:"commit"`, the harness also adds `waitForLoadState("domcontentloaded")` after each goto. This is disclosed in both summaries, and it is applied identically to the red, green and never-released runs. It is acceptable.
- Only S4 has a discriminating red/green pair. S1-S3 are honestly labelled "no red possible", which follows owner ruling 2.
- evaluation-1.md is committed and evaluation-2.md is untracked. The orchestrator should decide whether evaluation-2 ships with the archive.
- No mtime-based evidence was relied on.
