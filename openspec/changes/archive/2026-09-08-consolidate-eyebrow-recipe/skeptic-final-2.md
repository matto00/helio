## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn, narrowly scoped: verify the three corrections in `eb079306` are accurate and
complete, and that no source moved. I did not re-litigate round 1's code clearance. I used no
file mtimes as evidence.

### What I verified (with evidence)

**1. Zero source delta since `f7aaf433`.**
`git diff f7aaf433 HEAD --stat` returns exactly four files, all under
`openspec/changes/consolidate-eyebrow-recipe/`: `evaluation-2.md`, `evaluation-3.md`,
`files-modified.md`, `skeptic-final-1.md`. No `.css`/`.tsx`/`.ts` path appears. `eb079306`'s own
`--stat` touches only `evaluation-3.md`, `files-modified.md`, `skeptic-final-1.md`. The
HEL-1043 boundary (`theme.css`, `DESIGN.md`, `--eyebrow-*`) is untouched.

**2. All evidence is tracked. (CR3 — fully resolved.)**
`git status --porcelain` is empty; the change dir holds `evaluation-1..3.md`,
`skeptic-design-1..4.md`, `skeptic-final-1.md`, all committed. Nothing in the change dir dies
with the worktree.

**3. Byte-comparison correction (CR1) — numbers re-derived myself.**
Fresh `md5sum` + `stat -c%s` sweep of the six pairs in `.concertino/runs/HEL-732/evidence/`:

| pair | md5 | BEFORE/AFTER size |
| --- | --- | --- |
| `th-sources-dark` | SAME | 169230 / 169230 |
| `badge-mfa-settings-light` | SAME | 56845 / 56845 |
| `badge-mfa-settings-dark` | SAME | 56703 / 56703 |
| `label-login-light` | SAME | 88271 / 88271 |
| `th-sources-light` | **DIFF** | 170037 / 170037 |
| `label-login-dark` | **DIFF** | 87064 / **87099** |

`cmp -l th-sources-light-{BEFORE,AFTER}.png | wc -l` = **164995**. So: 4-of-6 is correct, the four
pairs the document names as identical are exactly the four that are, both differing pairs are
named, and 164,995 is exact. The document no longer says "byte-for-byte" anywhere; it now states
the original check was **file size only** and calls that insufficient. It correctly rests the
no-visual-change conclusion on the live computed-style measurement in the P4 section rather than
on the screenshots. CR1's substance is resolved — with two wording imprecisions noted below.

**4. Remaining-population correction (CR2) — resolved, and the scoping is correct.**
The closing paragraph now qualifies the P1/P2/P3/P5 lists as the remaining population *"under the
strict `var(--eyebrow-*)` reading only"*, states that the loose value-identical reading (40/27)
surfaces blocks outside the P1..P6 classification, and instructs HEL-1043 to **"re-scan under
whichever reading it adopts rather than treat this list as exhaustive"** — which is exactly the
downstream warning CR2 asked for. I spot-checked both named examples against the tree:
`.dashboard-list__pinned-badge` (`DashboardList.css:523`, `--font-mono` + `--text-micro`) and
`.panel-grid-card__footer` (`PanelGrid.css:169`, `--font-mono` + `--text-micro` +
`--weight-medium`) are real, are loose-reading-only (no `--eyebrow-*` token), and each occurs
exactly **once** in `files-modified.md` — i.e. only in this new paragraph, confirming they are
genuinely absent from the P1..P6 lists as claimed.

### Verdict: CONFIRM

All three change requests are addressed with substantively true statements, and nothing outside
the three documents moved. The residual issues below are wording-level, do not mislead HEL-1043
about any action it must take, and do not justify blocking at the final round.

### Non-blocking notes

1. **One sentence in the CR1 fix is factually wrong in a small way.**
   `files-modified.md` now reads "`th-sources-light` and `label-login-dark` differ **despite
   matching file size**". That is true of `th-sources-light` (170037/170037) but **false of
   `label-login-dark`**, whose sizes differ (87064 vs 87099) — the original size-only check *did*
   catch that pair. Round 1's suggested wording had this right and separated the two cases; the
   rewrite merged them and lost the distinction. It errs conservatively (it makes the old check
   look weaker than it was), but the bar for this document is "only true statements". A one-line
   fix: attribute "despite matching file size" to `th-sources-light` alone.
2. **Provenance is misattributed.** The same passage credits "the skeptic's independent per-pixel
   delta analysis". The per-pixel measurement is the **evaluator's** (`evaluation-3.md:180-186`:
   `th-sources-light` 6px @ max channel Δ4, `label-login-dark` 26px @ Δ2, of 1,152,000);
   `skeptic-final-1.md:123-124` explicitly *accepts* it rather than performing it. The numbers and
   the antialiasing conclusion are sound and do cover both differing pairs — only the attribution
   is off. A reader following the citation into `skeptic-final-1.md` will find an endorsement, not
   the analysis.
3. **Stray punctuation.** The final line of `files-modified.md` ends
   `…treat this list as exhaustive across both).` — an unmatched closing paren.
