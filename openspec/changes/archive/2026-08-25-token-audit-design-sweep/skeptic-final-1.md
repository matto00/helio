## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every number below was re-derived by me from the tree, not taken
from `evaluation-1.md`/`evaluation-2.md`/`files-modified.md`.

### What I verified (with evidence)

**1. Enumeration re-derived from scratch (all five categories).**
Ran design.md's five widened patterns myself over `frontend/src/**/*.css|*.tsx`
(excluding tests, `theme/theme.css`, `AccentPicker`, `theme/appearance.ts`,
comment lines):

- **font-size — 3 hits, not 0.** `features/panels/ui/MarkdownPanel.css:79` (`0.85em`),
  `shared/chrome/MobileNavSheet.css:161` (`0.8em`), `shared/ui/EmptyState.css:171`
  (`0.8em`). All relative-`em` glyph sizing with no absolute `--text-*` equivalent —
  correctly `flag: no-token`. Matches the cycle-2 correction in `files-modified.md`.
- **font-weight — 0** numeric hits repo-wide. Confirmed independently.
- **font-family — 10** non-token hits, **all `inherit`** (OnboardingChecklist ×2,
  AddSourceModal, StatusMessage, InlineError, inputs.css ×2, toast.css,
  EmptyState ×2). Zero ad-hoc families. Matches the claim exactly.
- **color — 0 undocumented violations.** Only hits outside `theme.css` are
  `PreferencesEditor.tsx:28-30` (documented appearance-default exclusion),
  `MfaEnrollModal.css:40` + `.tsx:113-114` (functional QR black/white), and
  `DividerEditor.tsx`'s `#cccccc` (an equality sentinel in application logic,
  not a rendered style). No silent undercount in this category.
- **spacing — classified the whole post-fix tree with my own script**:
  **0** remaining exact-match-fixable literals, **119** off-scale (no matching
  token), **78** ≤4px optical-tweak allowance, **10** relative `em`/`%`.
  Off-scale histogram: `6px`×41, `10px`×33, `14px`×12, `7px`×10, `5px`×9,
  `0.375rem`×3, `18px`×2, `0.4rem`×2, `0.35rem`×2, `0.3rem`×2, `0.4375rem`×1,
  `60px`×1 — spread over **20 files**. This independently confirms both the
  "~120 dominated by 6px/10px/14px/7px/5px" characterisation and, more
  importantly, **restated AC #1 itself: nothing for which a matching token
  exists is left unfixed.**

**2. Every substitution is provably value-identical (no near-miss/tolerance).**
Rather than spot-check, I mechanically paired every removed/added CSS line in
`git diff -U0 main...HEAD`, expanded each `var(--space-N)` back to its px value
from `theme.css`, normalised rem→px on both sides, and compared:
**81 changed lines, 0 mismatches** (84 token insertions; some lines carry two).
This is a stronger result than a spot-check: the diff is *mathematically* a
no-op on rendered geometry, so AC #2 (no visual regression) holds by
construction. Near-misses on the same line were correctly left literal
(e.g. `padding: var(--space-2) 14px`, `padding: 0.4375rem var(--space-2)`).

**3. Guard test — what it is, and explicitly what it does NOT cover.**
`frontend/src/theme/tokenAuditSweep.css.test.ts` is a **text-matching source
scan**: it `fs.readFileSync`es each of the 15 swept CSS files, applies the five
regexes line-by-line, and asserts every surviving hit is in that category's
pinned `BASELINE` (spacing: 76 residual entries; color/font-size/font-weight/
font-family: empty). It is **not** a rendered-geometry or computed-style check,
and this is correct for this ticket — a token violation is a property of the
source text, unlike HEL-813's touch-target minimums, which genuinely required
measuring a rendered box. Stated limits, none of which are defects here:
- It cannot catch a literal introduced via **inline `style={{}}` / CSS-in-JS**,
  or any `.tsx` at all — only the 15 listed `.css` files are scanned.
- It cannot catch a **token that resolves to a wrong underlying value**
  (`var(--space-9)` where `--space-3` was meant renders wrong and passes).
- It is **scoped to the 15 swept files**, not repo-wide; a violation in an
  untouched file is invisible to it.
- Baseline is **file+line**, so pure line-number churn above a residual entry
  can make it stale (the "baseline isn't stale" test catches that as a failure,
  which is the desired direction).
I independently **demonstrated RED**: reverted `ImagePanel.css`'s
`gap: var(--space-2)` → `gap: 8px`, ran the suite → 1 failed / 75 passed with
the exact file named; reverted → 76/76 green. The guard genuinely bites.

**4. Fresh gates (re-run by me, output read).**
`npm run lint` → clean, `--max-warnings=0`, rc=0. `npm run typecheck`
(`tsc --noEmit`) → clean, rc=0. `npx jest --config frontend/jest.config.cjs`
→ **2830 total, 0 failures** (76 in the new guard suite).
`git diff main...HEAD -- frontend/src/theme/theme.css .husky` → **empty**:
no new tokens, no hook/gate-chain changes, as required.

**5. UI / design judgment (screenshots, both themes).**
`start-servers.sh` + `assert-phase.sh servers` → `PASS servers`. Viewed
`/pipelines` (light) and `/pipelines/:id` — the largest substitution batch,
`PipelineDetailPage.css` + `PipelineDetailHeader.css` — in **light and dark**.
Screenshots: `/tmp/claude-1000/-home-matt-Development-helio/81dca7ce-a9ca-4c3a-8451-070630f82b8d/scratchpad/shots/hel439-{pipelines,detail-light,detail-dark}.png`.
Header meta bar, step card, footer chip grid, sidebar rhythm and typographic
hierarchy are consistent with sibling screens; light/dark geometry is pixel-wise
identical to each other and consistent with the pre-change design language.
No off-pattern UI, no reinvented one-offs (this change adds no markup at all).
Only console error is a pre-existing `404` on `/api/pipelines/:id/schedule`
(no schedule configured) — unrelated to CSS.

**6. Sibling-ticket reconciliation.** `ticket.md`'s "Reconciliation with sibling
tickets" section states HEL-652/HEL-677 closed as Duplicate (both strict subsets
of this spacing sweep — consistent with what shipped: a repo-wide spacing pass
including page-shell padding) and HEL-680 kept open as the new-token vehicle,
with the explicit note that the residual is materially larger than HEL-680's
stated remit. My measured 119/20-files residual **substantiates** that claim
rather than contradicting it. The written reconciliation is accurate.

**7. The one thing that does not hold — the residual enumeration deliverable.**
`ticket.md` (restated AC #1) and `design.md` make the *complete, non-silent
enumeration of the off-scale residual* this ticket's **primary deliverable**,
and `tasks.md` 1.2 / 4.4 (both ticked) require it to appear in "the executor's
final report / PR description". **That report does not exist.** I searched and
re-searched: the change dir contains no executor report, and
`.concertino/runs/HEL-439/evidence/` holds only `premise-validation.md` plus the
planning/evaluation artifacts. Yet two shipped artifacts point at it:
- `files-modified.md:16` — "RED-demonstrated ... (see executor report)";
- `frontend/src/theme/tokenAuditSweep.css.test.ts` (committed source comment) —
  "see the executor's report for the full repo-wide table".

So the delivered artifacts carry **no** enumeration of the residual: no counts
by category, no off-scale histogram, no file list. `files-modified.md` documents
only the font-size correction. The `SPACING_BASELINE` in the test enumerates 76
file+line entries **without values and only inside the 15 swept files** — it is
not the repo-wide table and was never intended as the deliverable. Nothing in
the repo would carry this into the PR description. That is exactly the "silently
left unaccounted for" outcome AC #1 was rewritten to prevent. The fix is small
and purely documentary — the code is correct and needs no change.

### Verdict: REFUTE

### Change Requests

1. **Write the residual enumeration into a durable artifact** (append a section
   to `openspec/changes/token-audit-design-sweep/files-modified.md`, or add
   `enumeration.md` in the change dir). It must state, per design.md's
   "Each hit gets a row" requirement, at minimum the by-category counts and the
   off-scale breakdown. My independently derived, verified numbers — use these
   rather than re-deriving loosely:
   - spacing: **84 fixes** across 15 files; **0** exact-match-fixable literals
     remain repo-wide; **119** off-scale residual across **20** files
     (`6px`×41, `10px`×33, `14px`×12, `7px`×10, `5px`×9, `0.375rem`×3,
     `18px`×2, `0.4rem`×2, `0.35rem`×2, `0.3rem`×2, `0.4375rem`×1, `60px`×1);
     **78** literals ≤4px under the documented optical-tweak allowance;
     **10** relative `em`/`%` spacing values with no absolute token equivalent.
   - font-size: **3** flagged (`MarkdownPanel.css:79`, `MobileNavSheet.css:161`,
     `EmptyState.css:171`), 0 fixed.
   - font-weight: **0**. font-family: **10** hits, all `inherit`, **0** ad-hoc.
   - color: **0** violations outside the documented exclusions
     (`PreferencesEditor.tsx`, `MfaEnrollModal.tsx/.css`, `DividerEditor.tsx`).
   Include the file list for the off-scale residual, or state explicitly that
   the per-file breakdown is the 20 files reachable by design.md's spacing grep.
2. **Fix the two dangling references to the non-existent executor report**:
   `files-modified.md:16` and the comment block in
   `frontend/src/theme/tokenAuditSweep.css.test.ts` (~"See the executor's report
   for the RED-state demonstration" and "see the executor's report for the full
   repo-wide table"). Point them at whatever artifact CR1 creates. A committed
   source comment citing a file that was never written is a maintenance trap.
3. **Ensure task 4.4's PR-description statement actually lands in the PR body**:
   the residual is 119 literals across 20 files, dominated by `6px`/`10px`, i.e.
   materially larger than HEL-680's stated "one known compact-chip case" — so the
   human reviewer can decide whether to broaden HEL-680 or file a follow-up. Task
   4.4 is ticked but is currently satisfied by nothing that will reach the PR.

### Non-blocking notes

- `spacingIsDisallowed` treats a line as clean if it contains `var(--space`
  anywhere. **40 lines** repo-wide mix a token and a raw literal
  (e.g. `padding: var(--space-2) 14px`), so on those lines a *reverted* fix or a
  *newly introduced* literal would go undetected while the sibling token remains.
  Narrow hole, but worth a one-line comment in the test — or tightening the
  predicate to strip `var(...)` before re-testing the pattern.
- The `.tsx` half of design.md's stated scope is never scanned by the guard
  (SWEPT_FILES is CSS-only). Correct for this change (no `.tsx` was fixed), but
  worth stating in the test's header comment so a future reader doesn't assume
  inline-style coverage.
- `evaluation-2.md` is untracked in the worktree (`?? evaluation-2.md`) — commit
  it with the CR fixes so the review trail ships with the branch.
