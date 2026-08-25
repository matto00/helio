## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Scope / commit is real.** `git log --oneline -3` → `7329d0d6 HEL-777 Extend
DESIGN.md's hit-expander clause with gap/tiling rule` on top of main tip
`3ecfad26`. `git diff main...HEAD --stat` → 10 files, the only non-change-dir
file is `DESIGN.md` (+16/-1). No code, test, CSS, or schema file touched
(satisfies task 2.2). Working tree carries only `workflow-state.md` (M) and the
untracked `evaluation-1.md` — both change-dir bookkeeping.

**Every numeric/factual claim re-derived cold from HEL-772's archive**
(`openspec/changes/archive/2026-08-21-anchor-mobile-command-bar/`), not from any
prior agent's narrative:

| Claim now in DESIGN.md | Ground truth |
| --- | --- |
| expander extends `(44 - controlSize) / 2` per side; 8px for a 28px control | archive `design.md:118-119` ("A 44px hit region around a 28px box extends 8px per side"); `--control-sm` 28px per `skeptic-design-3.md:112` |
| cluster needs gap ≥ twice that (16px for 28px controls) | archive `design.md:123` (gap becomes `var(--space-4)` = 16px); `tasks.md:36` (4.7) |
| later-painted sibling steals the earlier control's taps in the overlapping band | archive `design.md:120-121` verbatim in substance ("the later sibling paints on top and wins the hit test, truncating the earlier control's own tap area") |
| real horizontal extent **35.75px** at an 8px gap while `::after` still computed a full **44px** | archive `design.md:122-123`; corroborated independently by `evaluation-1.md:178` and `skeptic-design-5.md:36` (gap8 → 35.75 @0.25px step) |
| neither computed `::after` size nor neighbouring-**painted-box** sampling can detect it — failure is region-vs-region | archive `design.md:127-129` ("Because the failure is region-vs-region, a check that samples neighbouring painted boxes cannot see it"); `skeptic-design-5.md:84-89` shows the gap8 case where region 1 ends at 354.00 and painted box 2 *starts* at 354.00 — touch, never overlap |
| verification must bisect real hit extent with `elementFromPoint` | archive `tasks.md:78` (7.11), `evaluation-1.md:35-36,177` |
| correctly tiled abutting region reads ~**43.75px at a 0.25px sampling step** | `evaluation-1.md:177` (43.75 horizontal for abutting icon buttons, 44.5 for the last-in-row); `skeptic-design-5.md:34` (43.75 @0.25px) |
| threshold needs an epsilon `>= 44 - samplingStep`, never a literal `>= 44` | archive `tasks.md:78` (7.11) states exactly this |
| never widen the gap past the tiling point to force the number over 44 — "the threshold takes the epsilon, not the gap" | archive `tasks.md:78`; `skeptic-design-5.md:230-232` ("16px is right; the threshold is what needs the epsilon") |

No number in the new prose is unsupported, and none is rounded, inverted, or
attributed to the wrong build. The 35.75 / 43.75 pair is stated with the correct
polarity (broken vs. correct), which is the specific way this class of doc
ticket has failed before.

**Acceptance criteria traced to actual text** (`DESIGN.md:206-226`, read in full):
1. per-side extension + minimum-gap rule — sentence beginning "The expander
   extends `(44 - controlSize) / 2` per side… needs a gap of at least twice that". **MET**
2. computed size insufficient + `elementFromPoint` bisection named — sentence
   "Neither `getComputedStyle(el, "::after").width` nor sampling neighbouring
   painted boxes … so verification must bisect each control's real hit extent
   with `elementFromPoint`". **MET**
3. sub-44px abutting reading + epsilon + explicit no-widen warning — final
   sentence, all three elements present including "the gap must never be widened
   past the tiling point". **MET**
4. consistent with the existing section; the `44px` literal tap-target-floor
   sentence is untouched (diff shows the only removal is the line-break rejoin of
   "…which would grow the box."). The addition sits immediately before
   `**[mechanical]** No other control heights.`, matching the section's
   rule-then-mechanical-tag layout and its ~72-col prose wrapping. **MET**

**Gates re-run by me, output read:**
- `npx prettier --check DESIGN.md` → "All matched files use Prettier code style!"
- `node scripts/check-openspec-hygiene.mjs` → "openspec/ is clean", exit 0
- `node scripts/check-spec-structure.mjs` → "spec-structure check passed (320 canonical specs, 0 issues)", exit 0

**Spec delta** (`specs/design-doc-hit-expander-guidance/spec.md`) is present, is a
proper `## ADDED Requirements` block with three scenarios, and each scenario's
THEN is now literally true of `DESIGN.md` — verified against the text, not the
tasks list.

**UI/design judgment: N/A.** Zero `frontend/**` changes, so no view was altered
and no rendered surface exists to screenshot. DESIGN.md is a repo document, not a
shipped view; the servers were deliberately not started (nothing to observe).
This is not a skipped check — it is an inapplicable one.

### Verdict: CONFIRM

### Non-blocking notes
- The new prose is one long paragraph; if this section grows again, the
  hit-expander guidance would read better promoted to its own sub-bullet. Not a
  divergence from the section's current style, so not a change request.
- `scripts/concertino/next-report-number.sh` / `persist-evidence.sh` /
  `emit-event.sh` are absent from this worktree's `scripts/concertino/` (present
  only in the main checkout). I used the main-checkout copies. Worth a look, but
  it did not impede verification, so it is not a BLOCKER.
