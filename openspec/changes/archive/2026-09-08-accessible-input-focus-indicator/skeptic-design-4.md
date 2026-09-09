## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Cold spawn. Every finding below is derived from the tree at `ca6fa48d`, not from
`skeptic-design-1..3.md` (read as claims only).

### Primary question: is part (2)'s scope test now correct, or is there a fourth wrong reading?

**It is correct, and the space of wrong readings is closed for this tree.** I enumerated the
selector universe rather than reasoning about it:

- `git grep -n "outline:\s*none" -- '*.css'` under `frontend/src` → **11 hits**, exactly the
  inventory table's eleven files/lines. No drift.
- **`:not(:focus)` selectors — exactly two, both already named in D5:**
  `grep -rEn "^[^{]*:not\([^)]*\)[^{]*:focus" --include=*.css .` returns only
  `PanelGrid.css:238` and `PipelineDetailPage.css:799`. I read both bodies:
  `:238` declares `border-bottom-color: var(--app-accent)` (the round-2/round-3 landmine) and
  `:799` declares `border-color: var(--app-accent-mid)` — a *different token name*, so even a
  wrongly-scoped implementation cannot trip part (2) there. D5's "second instance of the
  pattern rather than a second failure" is verified, not asserted.
- **`:is()` / `:where()` — zero hits** (`grep -rEn ":(is|where)\("`). Not a live hazard.
- **Nested / compound-argument `:not()` — zero hits** (`grep -rEn ":not\([^)]*\("`). The only
  shape present is the flat repeated form `:not(:disabled):not(:focus)`.
- **Is "remove the contents of every `:not(…)`" well-defined for `:not(:disabled):not(:focus)`?**
  Yes, and — checked deliberately — it is well-defined *under either regex greediness*.
  A lazy `:not\([^()]*\)` removes the two negations independently →
  `…:hover:not():not()`; a greedy `:not\(.*\)` collapses the whole span → `…:hover:not()`.
  Both yield a string containing no `:focus`, so both correctly classify `:238` as a
  non-focus rule. The greedy form is only wrong for a selector shaped
  `:not(…)…:focus` (it would swallow a real trailing `:focus`) — **zero such selectors exist**
  (the grep above returns only the two trailing-`:not(:focus)` cases). So this is not a fourth
  wrong reading, only a latent one; see note 1.
- **`:focus-within` — one hit**, `DashboardList.css:259`
  (`.dashboard-list__item-row:focus-within .popover.actions-menu`). It *does* contain the
  substring `:focus`, so it is admitted by the specified test. I checked whether that matters:
  its `:focus-within` is **not trailing** (a descendant compound follows), so base normalisation
  leaves the base as the full selector, and that base's group declares **no `outline: none`** —
  it is never evaluated. Inert. See note 2.
- **`@media`-nested rules** — for each of the 11 files, no `:focus` rule and no `outline: none`
  occurs inside any `@media` block, so a naive top-level rule parser cannot mis-group anything
  here.
- **Cross-base collision check.** I walked the bases that actually get evaluated.
  `.ui-input[aria-invalid="true"]:focus-visible` (`inputs.css:60`) normalises to a *distinct*
  base and declares `--app-error`, not accent — harmless under either reading of whether
  attribute selectors are stripped. `.accent-picker__swatch--selected` is a class, not a
  pseudo-class, so it stays out of `.accent-picker__swatch`'s group (which is what lets task 3.8's
  state-collision fix be judged separately). `.ui-input.panel-grid-card__title-input` and
  `.ui-input.pipeline-detail-page__footer-output-input` are compounds, so neither joins bare
  `.ui-input`'s group from `inputs.css`.

Conclusion: the predicate as specified in D5 / task 4.1a classifies every rule in the ten live
sites the way the design intends, and the two enumerated wrong readings (naive substring;
base-normalised selector) are the only ones this tree can actually exhibit.

### Secondary: internal coherence after three rounds of in-place patching

I read design.md, tasks.md, proposal.md and `specs/accessible-focus-indicator/spec.md` end-to-end
as a cold implementer.

- **D5 ↔ 4.1 ↔ 4.1a agree.** Granularity (split comma lists → strip trailing pseudo-classes →
  group by base), part (1) quantified over `:focus-visible` rules, part (2) scoped to focus rules
  on the raw-with-`:not()`-emptied selector, the enumerated indicator property set including
  `border-bottom-color`, and the "do not simplify / do not stop stripping `:not(…)`" warnings all
  appear in both places with the same content and no contradiction.
- **4.2's four arms agree with D5.** (a)→part 2, (b)→part 1 vacuity, (c)→selector-base check,
  (d)→green-assertion pinning the `:not(:focus)` handling, plus the meta-check that (d) must flip
  red under the substring implementation. I specifically tested the "all four arms pass while
  part (2) is entirely unimplemented" hole: (a)/(b)/(c) would still go red and (d) would still be
  green — but 4.2(d)'s required substring swap would then produce *no* change, which the task
  explicitly says means "this arm proves nothing either". The hole is closed by the letter of the
  task. See note 3 for a sharpening.
- **No superseded round-1/round-2 wording survives.** Round 1's "same-rule check" and
  "cannot evaluate `color-mix`" both appear only as explicitly-labelled *rejected* readings
  (D5, D5a, 4.4). D6's exclusion is by filename, not site index, as round 1 required. Task 3.7
  and 4.1b agree that AddSourceModal is HEL-1052's, not HEL-1049's.
- **AC-4 coverage traces.** Task 8.5's unfixed list (site 9 + its pin → HEL-1052; site 7 residual
  → HEL-1051; `PanelDetailModal.binding.css:137` → HEL-1049) matches the ticket's AC-4 list
  exactly. I checked one thing that looked like a gap and it is not: `PipelineDetailPage.css:796`'s
  permanent `--app-accent-mid` border (1.30/1.64) is left unfixed and is not in 8.5 — but it is a
  *permanent, unfocused* border, so it does not "convey focus" and falls outside AC-4 and the spec
  delta's third requirement. Task 2.3 still requires it measured and recorded either way.

### What I verified (with evidence)

- `git log --oneline -3` — artifacts at `ca6fa48d`, as briefed.
- `git grep -n "outline:\s*none" -- '*.css'` — 11 hits, matches inventory.
- `grep -rEn "^[^{]*:not\([^)]*\)[^{]*:focus"` / `":(is|where)\("` / `":not\([^)]*\("` /
  `"focus-within"` — the four hazard classes I was asked to consider, enumerated above.
- Read raw bodies: `inputs.css:25-65`, `PanelGrid.css:218-250`, `PipelineDetailPage.css:790-812`,
  `DashboardList.css:70-80/140-150/259-266/350-360/675-695`, `AccentPicker.css:10-45`,
  `auth.css:100-120`.
- Read `frontend/src/theme/focusRingTokenGuard.css.test.ts` (lines 1-260) to confirm what the
  extension is extending: it is comment-stripped and declaration-oriented, so rule/selector
  parsing is genuinely new work — which is why D5's granularity spec carries the weight it does.
- Per brief, did **not** re-derive contrast arithmetic and did **not** re-verify HEL-1051/1052.

### Verdict: CONFIRM

The design is sound enough to implement. I could not construct a fourth misreading of part (2)'s
scope test that any rule in this repo exhibits, and the artifacts read coherently for an
implementer who was not present for rounds 1-3.

### Non-blocking notes

1. **Pin the `:not()` removal to a non-greedy match.** Both greediness choices happen to be
   correct for the two live selectors, but a greedy `:not\(.*\)` is wrong for a hypothetical
   `:not(.x):focus`. One extra clause in 4.1a ("match `:not\([^()]*\)`") makes the implementation
   robust to a selector shape that does not exist today. No rule exhibits it, so this is a note.
2. **`:focus-within` is admitted by the substring test but is inert.** `DashboardList.css:259`
   is the only occurrence and its group declares no `outline: none`, so it is never evaluated.
   Worth one sentence in D5 so a future reader does not rediscover it as a suspected defect —
   the same cost the `PipelineDetailPage.css:799` parenthetical already pays.
3. **4.2 arm (a) does not isolate part (2).** Reverting a fixed site's declaration from
   `var(--app-focus-ring-color)` to `var(--app-accent)` removes the ring reference too, so the
   rule fails part (1) as well; the guard will report both reasons. A mutation that *adds* a bare
   `var(--app-accent)` indicator declaration **alongside** the retained ring declaration would
   fail part (2) alone and prove part (2)'s token matching is not silently matching nothing.
   4.2(d)'s substring-swap sub-check already covers the "part (2) absent entirely" case, which is
   why this is a sharpening rather than a change request.
4. **proposal.md still says "eleven sites" and "eight further stylesheets".** Eleven is the raw
   grep count (correct pre-D9), and design.md line 242 states the drop to ten explicitly, so a
   reader who reaches design.md is not misled. "Eight further stylesheets" overcounts — tasks 3.1-3.9
   touch five files besides `inputs.css`. Tasks are authoritative and enumerate exactly; harmless.
