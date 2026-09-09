## Skeptic Report — design gate (round 7, skeptic-design-7.md)

Read-only consistency round at `f84e7e88`. No files edited, no app started, no arithmetic re-derived.

### What I verified (with evidence)

- Read `design.md` (286 lines) end to end as one argument, and `tasks.md` (167 lines) only for agreement.
- **Rule 1 (a number appears once)** — exhaustive, not sampled: scanned every numeric literal in
  `design.md` with a script and listed every value occurring on more than one line, then classified each
  occurrence by the quantity it denotes. Repeats that are distinct quantities (e.g. `30` at :118 = a darken
  percent, at :149 = the dark selection tint) are not findings; repeats of the *same* measured quantity are
  findings 1, 2 and 3 below.
- **Rule 2 (D2 is the complete set)** — checked every other mention of the scored set in both documents:
  `design.md` D3:81, D6:135-137, Site inventory :215-217, and `tasks.md` 2.2:60-66. Within `design.md`
  every mention defers correctly. `tasks.md` 2.2 restates rather than defers, and restates it wrongly
  (finding 5).
- **Rule 3 (no correction text in the body)** — the `design.md` body states current decisions only; I found
  no "this was overturned" text above the `---` at :252. The converse check found one appendix passage that
  reads as live (non-blocking note 1).
- **Cross-document** — compared every `D`-reference in `tasks.md` against the `### D` headings in
  `design.md` (`grep -n '^### D'`): findings 4, 5, 6, 7.
- **D6's new monotonicity argument (the one specific claim)** — checked as reasoning, not re-derived. It
  holds: a heavier accent tint darkens the light-theme background (dark text → contrast falls) and lightens
  the dark-theme background (light text → contrast falls), so contrast is monotonic decreasing in tint
  strength in both themes and the heaviest tint binds. The two consequences it draws are consistent with the
  tint percentages `tasks.md` 2.2:66 states (`--app-accent-surface` 11% light / 15% dark,
  `--app-accent-dim` 8% light / 10% dark): the 10% site is below 11% in light, so bounded by an
  already-scored background, and equals `--app-accent-dim`'s 10% in dark. The conclusion and its stated
  justification agree. **In `design.md` this claim is sound.** It is `tasks.md` that still carries the false
  predecessor claim it replaced (finding 6).

### Verdict: REFUTE

The regenerated `design.md` is very nearly clean on its own terms — findings 1-3 are its only internal
defects, and 3 is the only substantive one. But `tasks.md` was **not** regenerated with it, and it still
speaks the old document's decision numbering, the old scored set, and the exact false claim D6 was rewritten
to remove. Findings 4-7 are cross-document contradictions on contested points that this gate is required to
check.

### Change Requests

1. **`34` stated twice, body and appendix.**
   - `design.md:161` (current, authoritative): "the **34** `color: var(--app-accent-ink)` declarations
     painted on bright accent fills are unaffected."
   - `design.md:272` (stale restatement, appendix): "Colour-only broke the 34 accent-ink pairings (all eight
     fail dark, Yellow 1.67)."
   - The body statement is current. The appendix occurrence is the restatement, and this is precisely the
     body/appendix duplication the document's own rule 1 names as a future defect.

2. **`42` stated twice, body and appendix.**
   - `design.md:208` (current, authoritative): "**42** `color: var(--app-accent)` declarations across **24**
     files".
   - `design.md:262-264` (stale restatement, appendix): "an unanchored `color:` also matches `border-color`
     and returned 65 declarations instead of 42".
   - The body statement is current; the appendix restates it. (`65` occurs once and is fine.)

3. **`31%` stated twice — and the second occurrence asserts a minimum the first table contradicts.**
   - `design.md:89` (current): the "Minimum adjustment, scoring item 1 only" table gives light Orange
     **31%**; the "scoring items 1 and 2" table at `design.md:96` gives light Orange **35%**, and
     `design.md:98` adds "Adding item 3 raises these again."
   - `design.md:118-119` (stale): "For Orange in light it emits `#ae510f` at 30% — measuring **4.4711**,
     which fails — and `#ac4f0f` at **31%**, measuring **4.5911**, which is **the true minimum**."
   - Current is `design.md:89`+`:96`+`:98`: 31% is the minimum under the *item-1-only* set, which the
     document states is not the set being scored. D5's unqualified "the true minimum" is stale — under the
     complete set the minimum is at least 35% and rising. This is both a rule-1 duplicate and a live
     internal contradiction: D5's illustration silently reintroduces a superseded figure as authoritative.

4. **`tasks.md` uses the pre-regeneration decision numbering throughout; every reference from D6 upward
   points at a different decision than the one it names, and one names a decision that no longer exists.**
   - `design.md:48-204` (current): D5 producibility, **D6 hand-rolled inline tints**, **D7 `::selection`**,
     **D8 `--app-accent-strong`**, **D9 alias chains (the toast chain is inside D9)**, **D10 re-apply on
     theme change**, **D11 whole-corpus guard predicate**, **D12 dead per-theme defaults**. There is no D13.
   - `tasks.md` (stale): `:9` "(D9)" for `--app-accent-strong` (now D8); `:12` "(D10)" for `--app-info`
     (now D9); `:13`,`:100`,`:107` "D13" for the toast chain (no such decision — now part of D9); `:16`,
     `:43`,`:61` "(D12)" for the inline tints (now D6); `:32`,`:90` "(D11)" for `::selection` (now D7);
     `:72` "Lifecycle (D6)" (now D10); `:85` "(D8)" for the dead `theme.css` defaults (now D12);
     `:103`,`:120` "(D7)" for the whole-corpus guard predicate (now D11).
   - `design.md` is current. Every one of these references resolves in the regenerated document to a real
     but *wrong* decision, which is worse than a dangling reference: an implementer following `tasks.md` 4.3
     to "(D8)" lands on `--app-accent-strong`, not the dead defaults.

5. **`tasks.md` restates the scored background set instead of deferring to D2, and the set it states is the
   superseded three-tint one.**
   - `design.md:59-65` (current): "**This is the single complete statement of the set. Every other mention
     in this document or in `tasks.md` defers to it.** ... 3. The two hand-rolled inline tints heavier than
     item 2 — see D6 for which and why only two of the three."
   - `tasks.md:60-62` (stale): "Score against the **full** background set: the five neutral surface tokens;
     `--app-accent-surface` and `--app-accent-dim` composited over each, per theme; **the D12 hand-rolled
     inline tints (22%/20%/10%)**".
   - `design.md` D2/D6 is current: only the 22% and 20% sites enter the set; the 10% site does not.
     `tasks.md` 2.2 both violates D2's deferral requirement and contradicts its membership.

6. **`tasks.md` still carries the exact false claim D6 was rewritten to replace.**
   - `design.md:135-137` (current): "Contrast against a tint is **monotonic decreasing in tint strength**,
     so the heaviest tint binds. `--app-accent-surface` is 11% (light) / 15% (dark) and is already scored,
     so the 10% site is bounded by it in light and is exactly `--app-accent-dim` (10%) in dark."
   - `tasks.md:16-19` (stale): "**hand-rolled inline accent tints** as BACKGROUNDS (D12) —
     `BottomNav.css:126` 22%, `AddSourceModal.css:84`/`:94` 20%, `InlineConnectorSetup.css:38` 10%. ...
     **these are heavier than `--app-accent-surface`**".
   - `design.md` is current. "These are heavier than `--app-accent-surface`" is false for the 10% site in
     both themes (10% < 11% light, 10% < 15% dark) — it is the round-6 claim whose falsity forced D6's
     rewrite, surviving verbatim in `tasks.md`.

7. **`tasks.md` classifies into four background classes; `design.md` defines five, and the class `tasks.md`
   drops is the one D6 exists for.**
   - `design.md:212-224` (current): "**Five background classes:** Neutral-backed ... Accent-tinted via
     tokens ... **Hand-rolled inline tints — D6** ... `::selection` — D7 ... User-chosen".
   - `tasks.md:31-33` (stale): "Classify every site the closure returns into **four** classes:
     **neutral-backed**, **accent-tinted**, **`::selection`-tinted** (D11), or **user-chosen**".
   - `design.md` is current. The hand-rolled inline tints are absent from `tasks.md` 1.2a's classification,
     which is the class the document repeatedly identifies as the one that gets diagnosed and then not
     scored.

8. **Final adjustment figures: `design.md` deliberately withholds them and points at `tasks.md` 2.0;
   `tasks.md` 2.0 quotes them.**
   - `design.md:98-100` (current): "**The final figures are re-derived from the complete set at
     implementation time** (`tasks.md` task 2.0) rather than stated here, because they moved three times
     during design and a restated figure is how a stale number survives." `design.md:111` repeats the
     instruction for D4: "Figures come from D3's re-derivation, not from this paragraph."
   - `tasks.md:45-47` (stale): "As of round 4 they are approximately Red **+28%**, Pink **+25%**, Purple
     **+28%**, Blue **+25%**, and critically **Orange +2% → +14%** ... Earlier drafts named
     +22/+18/+22/+17; those are stale."
   - `design.md` is current. `tasks.md` 2.0 does instruct re-derivation, but it then supplies a round-4
     figure set — including one already-superseded set beneath it — at the single location `design.md`
     nominates as the place figures are produced rather than quoted. The two documents disagree on whether
     any figure is quoted at all.

### Non-blocking notes

- **Appendix passage that reads as live.** `design.md:256` states "Nothing here states a current decision",
  but `design.md:264-267` ("Rounds 5 and 6 found no further route; `currentColor`, `var()` fallbacks,
  `fill`/`stroke`, `caret-color`, `::placeholder`, `::marker`, `text-fill-color`, inline styles and JS-set
  properties are all cleared negatives") is a current scope-closure claim the body relies on, sitting in the
  NON-AUTHORITATIVE appendix. It is not contradicted anywhere; flagging only because rule 3's converse asks
  for it.
- **Same-section figure echoes.** `design.md:130-131` lists the tints as 22% and 20%; `:137` restates
  "The 22% and 20% sites". Likewise `:132` "10%" and `:136` "`--app-accent-dim` (10%)". Both are within one
  short section and both are load-bearing to the argument, so the staleness risk rule 1 guards against is
  low here — but they are literal rule-1 duplicates and a stricter reading would count them.
- **The WCAG floor `4.5` appears at `:19`, `:27`, `:50`, `:73`, `:81`.** Not a measured figure, so not
  treated as a rule-1 violation.
- **`design.md:137` vs `:140` tension (not a contradiction).** ":137 The 22% and 20% sites ... are therefore
  the ones that extend the set" then ":140 The `BottomNav` lozenge adds none, because it sits over the nav's
  own translucent plate rather than directly over a theme surface." Reconcilable as "in the set, contributes
  no additional adjustment", and I read it that way — but if `BottomNav`'s real background is a translucent
  plate rather than a theme surface, the composite it should be scored against is not "22% over the five
  surfaces", which is what item 3 of D2 implies.
- `tasks.md` task 5 numbering runs 5.1, 5.6, 5.2, 5.3, 5.4, 5.5 (`:105-124`). Ordering only; out of scope.
