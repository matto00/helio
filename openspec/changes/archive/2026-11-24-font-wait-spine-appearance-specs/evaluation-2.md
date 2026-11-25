## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD 88a5ca006dd07db513fe7dcdafe17f324afd38c3 against the live base 793802e50a8de763f905a431ca120490c372404d. The only new commit since cycle 1 is 88a5ca006, and it touches evidence and summaries only. The e2e diff against the base is unchanged: the same four sites, +5/-4.

### Phase 1: Spec Review — PASS

Cycle-1 change requests:

1. **Discriminating S4 pair: resolved.**
   - **Harness:** the gate now has `FONT_SITE_RELEASE_MS`, which releases the holds 1000ms after the site's before-wait dump. The source is committed in `evidence/scratch/zzfontgate.ts.txt`. `gen.py.txt` now builds the pre variant from `git show 793802e50:`.
   - **My re-run:** I used the committed gate with my own generated scratch copies.
     - Pre-conversion `siteCss`: RED, `Received: 2.99822998046875`, ones 24.97 / eights 27.96. This is the assertion right after the site; the old `fonts.ready` resolved after 6ms with `media:"print"`.
     - Post-conversion `siteCss`: GREEN. All 3 iterations reached the site still held (`media:"print"`, `held={"css":N}`), measured diff 0 (sans 32/32, mono 28/28, serif 32/32), and the real `getByRole` dialog count was 1 each time.
   - **Committed evidence agrees:**
     - green-S4 `siteCss`: before-wait is `media:"print"` 3/3.
     - green-S4 `siteAll` / `siteSch`: before-wait is loading>=1 in 3/3 iterations of each mode.
     - red-S4 `siteCss`: fails with `Received: 2.9996...`.
   - **Labelling is honest:** `siteAll`/`siteSch` also pass on the pre-conversion code, because the real `fonts.ready` blocks while a face loads. They are stated not to be a red/green pair; only `siteCss` is claimed as the pair.
2. **green-summary.txt: resolved.** The false sentence is gone. The timer modes are now labelled "released before the site: non-discriminating", with the exact iteration counts I found (S4 all, S1 jbT 2/8, S3 jbT 1/4, S3 frT 1/4). These are not credited.
3. **red-summary.txt: resolved.** It now cites real-spec line 767 (scratch file line 768).
4. **Non-blocking items: also done.**
   - The S4 container is proven by `CONTAINER-LOCATOR count=1` on the real `getByRole` locator (9 of 9 iterations).
   - The `domcontentloaded` harness deviation is recorded in both summaries.

Everything else verified in cycle 1 still holds, and no code changed since then:
- Scope (C15).
- The delay mechanism (C16).
- The C19 red placement.
- The never-released runs fail loudly at the 10s bound.
- The 20x partition counts (C17).
- The hel1572:126 note.

### Phase 2: Code Review — PASS
The code is unchanged since cycle 1, where eslint, prettier and the e2e `tsc` were all clean. `prettier --check` on the change directory, run from the worktree, is clean.

### Phase 3: UI Review — N/A
No trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions
- `evaluation-1.md` was committed to the branch with 88a5ca006. That is harmless, but confirm it is intended to ship with the change archive.
