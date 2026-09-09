# Design — Accessible accent-as-text

## How this document is written

Five rules, stated because violating them produced every consistency defect this plan has had:

1. **Corrections replace decision text; they never accumulate beneath it.** A superseded ruling left in place
   with a correction appended below it puts stale text *in the position of authority* — and a reader who stops
   at the heading gets the wrong answer, which is the expected reading behaviour, not a careless one. All
   correction history lives in the non-authoritative appendix at the end.
2. **A definition that says "the set is X" is the complete set at that point, or says explicitly that it is
   not.** A definition completed 200 lines later is an incomplete definition.

3. **A D-number is an identifier, not a position. Once assigned it is never reassigned.** If a decision is
   removed its number is retired with a tombstone, never reused and never backfilled; a new decision takes the
   next free number regardless of where it sits in the file — and a retired number is **never** revived.
   Order is presentation; the number is identity.
   This rule exists because renumbering during a regeneration **silently invalidated every cross-reference
   while leaving each one resolvable** — a dangling `D13` is caught by any reader, but `D9` quietly meaning
   what `D8` used to mean is caught by nobody.
4. **A check is only "mechanical" if its input set was enumerated mechanically.** A hand-picked input fed to
   an automated comparison is a manual check wearing a machine's clothes. **Rule 5** was once reported as
   mechanically verified when the figures compared had been chosen by hand; two duplicates survived it.
5. **A measured figure is stated once, in the section that owns it**; elsewhere the section is referenced
   rather than the figure restated. If the same measurement appears twice, one of them is a future defect —
   that is how every stale number in this plan's history survived.
   Three things this rule does *not* cover, learned from running it exhaustively: identifiers (ticket ids,
   file line numbers), the 4.5:1 threshold itself (a constant, not a measurement), and numerals that collide
   across unrelated measurements — the selection tint's 26% and the light adjustment for Blue are both "26%"
   and are not duplicates. Within its owning section, a figure may be reused as a *label* for the thing it
   identifies (D6 calls them "the 22% and 20% sites").

## Context

Accent used as readable text fails WCAG's 4.5:1 floor. HEL-1046 (merged) solved the *focus ring* — a 3:1
non-text obligation — with a single theme-**independent** derived colour. That approach provably cannot work
here.

**Binding surfaces.** Light: `--app-surface-soft` `#efece6` (L=0.8405), the *darkest* light surface and so the
hardest for dark text. Dark: `--app-surface-strong` `#262320` (L=0.0172), the *lightest* dark surface and so
the hardest for light text.

**The impossibility.** A single colour clearing 4.5:1 in both themes needs luminance **L ≤ 0.1479** (light) and
**L ≥ 0.2523** (dark). The window is empty; the gap is **0.1044**. This constrains **luminance alone**, so it
rules out *every* colour — not "zero of eight presets", which invites the reading that a ninth might escape it.
None can. That is why this ticket exists and why it could not be settled inside HEL-1046.

**Measurement note.** The accent renders as the user's chosen hex in *both* themes: `applyAccentTokens` writes
inline style on `<html>`, which outranks both `:root[data-theme]` blocks, so the per-theme `--app-accent`
declarations in `theme.css` are dead code. A light-theme reading of `#ea580c` is a too-fast probe, not a
finding.

## Owner rulings — settled inputs

Made against rendered contact sheets, not a contrast table:

1. **`text-only-token`** — a separate token carries the text obligation; `--app-accent` fills stay bright.
2. **`accept-hue-shift` on all eight presets** — full conformance now. A half-conforming palette was rejected
   outright, since deferring presets would reproduce what this ticket was pulled into v0.7 to prevent.
3. **`fix-here` for accent-tinted surfaces** — not split out.

## Decisions

### D1 — A per-theme, per-accent derived TEXT token; `--app-accent` untouched.

A separate token carries the 4.5:1 obligation for text. This mirrors HEL-1046's shape: give the obligation its
own token rather than bending the shared one.

Unlike `--app-focus-ring-color`, this token **is theme-aware** — forced by the impossibility above, not chosen.
`--app-focus-ring-color` must remain theme-**independent** (AC-3). Two tokens with deliberately opposite
properties live in one file; the code must say why, or someone will unify them.

### D2 — The scored background set.

**This is the single complete statement of the set. Every other mention in this document or in `tasks.md`
defers to it.**

1. The five neutral surface tokens, per theme.
2. `--app-accent-surface` and `--app-accent-dim` composited over each of those five, per theme.
3. The two hand-rolled inline tints heavier than item 2 — see D6 for which and why only two of the three.

**Deliberately not in the set**, each with its reason:

- The opaque `::selection` background — see D7; it is checked as a fixed pair instead.
- User-chosen panel surfaces — out of scope, owned by **HEL-1057**.

**Why the set matters.** Scoring only item 1 leaves the tinted backgrounds unbounded, and they are simply
darker or lighter *fixed* backgrounds the derivation never looked at. Measured live on
`.pipeline-detail-page__add-tail-btn`, all eight presets land **4.09–4.19** — short of 4.5 — with eight of
sixteen dark tinted combinations also failing.

Note the tinted backgrounds do **not** track the text colour: under D1 `--app-accent` is unchanged, so nothing
"cancels". The defect is an omitted background class, not a moving target.

### D3 — One token per theme suffices.

A single text colour per (preset, theme) clears 4.5:1 against every background in D2's set, for all eight
presets. So neither a fixed neutral tint nor a second token is needed; the fix is to score the right set.

**Minimum adjustment, scoring item 1 only** — recorded because the difference from the full set is the cost of
D2 item 2:

| | Purple | Red | Blue | Pink | Orange | Cyan | Green | Yellow |
|---|---|---|---|---|---|---|---|---|
| light (darken) | 16% | 19% | 20% | 21% | 31% | 36% | 38% | 43% |
| dark (lighten) | 10% | 8% | 5% | 2% | 0% | 0% | 0% | 0% |

**Minimum adjustment, scoring items 1 and 2:**

| | Purple | Red | Blue | Pink | Orange | Cyan | Green | Yellow |
|---|---|---|---|---|---|---|---|---|
| light | 23% | 25% | 26% | 27% | 35% | 39% | 41% | 45% |

Adding item 3 raises these again — **both rows, not only the dark one**. **The final figures for both themes
are re-derived from the complete set at implementation time** rather than stated here, because they moved
three times during design and a restated figure is how a stale number survives. `tasks.md` task 2.0a owns the
re-derivation; task 2.0 then gates on the dark half of its output specifically, because that is the half the
owner's brand ruling did not see rendered.

### D4 — The dark-theme perceptibility gate.

The owner's brand ruling was made against contact sheets in which the dark-theme changes were characterised as
*imperceptible*. Scoring items 2 and 3 raises them well beyond what was rendered, and it moves **Orange — the
shipped default** — which the rendered sheets did not vary at all.

**Required before any site is repointed:** take the dark values from task 2.0a's re-derivation, render them
on the running app, and judge perceptibility side by side. **If any is distinguishable from its raw accent at 14px on `--app-surface`,
escalate before implementing** — the ruling would then rest on evidence that no longer matches the proposal.
Figures come from D3's re-derivation, not from this paragraph.

### D5 — Producibility is asserted, not assumed.

A colour that satisfies the ratio but that the derivation cannot **emit** is not evidence the floor is met.

`darkenTowardBlack` (`appearance.ts:352`) is `Math.round(c * (1 - percent/100))`. Worked example, Orange in
light, **scored against D2 item 1 only**: the derivation emits `#ae510f` one percentage point below the figure
D3 records for that case, measuring **4.4711**, which fails; and `#ac4f0f` at D3's figure, measuring
**4.5911**, which passes. The value `#ae500f` measures 4.5044 and would
appear to pass, but **no integer percent produces it** — so a ratio-only check would have accepted a colour the
derivation cannot emit.

**This is a producibility example, not a minimum.** Orange's actual light adjustment is set by the complete
scored set and is re-derived by `tasks.md` task 2.0a — not stated in this document at all, per D3. The whole
thesis here is that the scored set determines the number, so quoting any figure as "the minimum" would
contradict it.

The guard asserts, for every proposed value, that some integer percent of the derivation yields exactly that
hex. Checking the ratio alone would ship a failing colour behind a passing number.

### D6 — Hand-rolled inline tints.

Three stylesheets build an accent tint **inline** rather than through a token, so no scan over token names can
see them — what varies is the background:

- `shared/chrome/BottomNav.css:126` — 22%
- `features/sources/ui/AddSourceModal.css:84` and `:94` — 20%
- `features/sources/ui/InlineConnectorSetup.css:38` — 10%

**Only the first two extend D2's set, and the reason is measured.** Contrast against a tint is **monotonic
decreasing in tint strength**, so the heaviest tint binds. `--app-accent-surface` is 11% (light) / 15% (dark)
and is already scored, so the 10% site is bounded by it in light and is exactly `--app-accent-dim` (10%) in
dark. The 22% and 20% sites are heavier than anything in item 2 and are therefore the ones that extend the set.

`AddSourceModal.css:84`/`:94` drives the cost. The `BottomNav` lozenge adds none, because it sits over the
nav's own translucent plate rather than directly over a theme surface.

**Omitting this class entirely would ship dark Orange at 4.161** — diagnosing a class is not scoring it.

### D7 — `::selection`.

`theme.css:296` sets `::selection { background: var(--app-accent-mid); }` and no `color`, so selected accent
text keeps its accent colour on a tint heavier than anything in D2 item 2.

**Ruling.** Emit an **opaque per-theme selection background** — the accent at 26% (light) / 30% (dark),
resolved to a flat hex in TypeScript from the `--app-bg` mix base, not composited in CSS — and have
`::selection` set **both** properties, its colour being **`--app-text`** (deliberately *not* the accent-text
token: selection is not accent-coloured text).

**Do not add that hex to D2's set.** Because `::selection` sets `color`, accent text never paints on that
background, so there is nothing to score; scoring it would cost up to **+22 points** (dark Cyan 3→23,
Green 0→22, Orange 14→29). The required check is instead a **fixed pair** — `--app-text` against the opaque
selection hex, per theme — measuring **7.01–14.11**.

Setting both properties is what makes this determinate: `::selection`'s background composites over whatever is
beneath it, so neither the colour alone nor the tint alone is safe. Because the pairing is replaced wholesale,
the **34** `color: var(--app-accent-ink)` declarations painted on bright accent fills are unaffected.

### D8 — `--app-accent-strong` used as TEXT.

Eight declarations across six files render `color: var(--app-accent-strong)` (line numbers as of the
original D9 closure run; `SidebarBody.css`'s hover rule moved line as its comment grew — cited by selector below rather than by line, since line citations on this file have gone stale twice — the closure is
authoritative over any restated line number, per rule 3):
`PanelDetailModal.appearance.css:102`, `PanelDetailModal.sections.css:35`, `PanelDetailModal.binding.css:235`
and `:310`, `SidebarBody.css:55`, `AddSourceModal.css:85` and `:95`, `PipelineDetailPage.css:646`.

It is `color-mix(in srgb, var(--app-accent) 76%, black)` in light, derived from the **unchanged** accent, so
`text-only-token` leaves it untouched. Measured against the five light neutral surfaces: **Orange 3.93,
Cyan 3.45, Green 3.24, Yellow 2.78 fail**; Red 5.05, Pink 4.79, Purple 5.24, Blue 4.93 pass. Dark passes for
all eight (5.37–9.40). Orange is the shipped default, so this violates the spec's *"the shipped default is not
an exception"* scenario.

**Ruling (corrected at final gate, skeptic-final-1.md): repoint all eight, no exception.** An earlier version
of this ruling carved out `SidebarBody.css`'s `.sidebar-body__locked-notice-link` and its `:hover` (a link and its hover — repointing both makes the hover a
no-op on an already-underlined link) and treated `AddSourceModal.css:85`/`:95` as a deliberate false positive
because their background tint is in D2's scored set. Both carve-outs were wrong: D2 scores the tint as a
*background*; it says nothing about a `color: var(--app-accent-strong)` declaration painted on top of it, so
the "false positive" reasoning was a true fact about a neighbouring thing applied to a case it never covered.
Measured live, `AddSourceModal.css:85` failed 2.876:1 for light Yellow (all eight presets fail there,
including Orange, the shipped default, at 3.28). **The fix is repoint, not carve-out**: `.sidebar-body__locked-notice-link:hover`'s
hover keeps its `text-decoration-thickness` change as the state signal and drops the color override to
`--app-accent-text`, since the underline was always the non-color carrier this decision was protecting — a
color delta on hover was never load-bearing for it. Zero survivors in `accentTextClosureGuard.css.test.ts`;
the allowlist itself was removed.

### D9 — Alias chains are followed transitively.

`--app-info: var(--app-accent)` is rendered as text at `DashboardList.css:648`. `toast.css:90`/`:112` reach the
accent through **two** hops — `--toast-intent-color` → `--app-info` → `--app-accent` — and fail all eight
presets in light (Yellow **1.918**) and four in dark.

**One hop is not enough.** The inventory and the guard corpus are both built from a **fixpoint transitive
closure** over custom-property definitions — the script `skeptic3-accent-text-closure.py` in this run's
evidence directory — which resolves every declaration reaching `--app-accent` by any number of hops. It
returns **9 properties / 53 declarations** and independently rediscovers every class in this document without
being told about any of them. It is run by `tasks.md` task 1.1. (Named here directly: an earlier draft pointed
at a task which pointed back at this decision, and pointed at the wrong task besides.)

### D10 — Re-apply on theme change.

`ThemeProvider.tsx:89-92` runs `applyAccentTokens(accentColor)` in an effect keyed on `[accentColor]` alone. A
theme-aware token must also recompute on theme change, so the effect's dependencies and `buildAccentTokens`'
signature both change. HEL-1046 avoided touching `ThemeProvider`; this ticket cannot.

### D11 — Guard predicate written against the whole stylesheet corpus.

HEL-1050's guard predicate broke three times, each time defeated by CSS that ticket never touched. The
accent-text surface is wider, so the predicate is written against every stylesheet from the start, built from
D9's closure rather than a hand-list, and **mutation-tested against a rule this change does not edit**.

### D12 — Dead per-theme defaults and the false comment.

`theme.css`'s per-theme `--app-accent` / `--app-accent-ink` declarations are dead, outranked by inline style.
Correct or remove them and make the `theme.css:161-162` comment true.

### D14 — A static `:root` fallback for first paint.

**Numbered D14, not D13.** D13 is retired and rule 3 forbids reviving it. This is the first gap in the
sequence; a reader who finds one should look for the tombstone in the appendix rather than assume a mistake.

`applyAccentTokens` writes the derived tokens from an effect, which runs **after** first paint. Without a
static value in `:root`, the first painted frame has no text token at all. **Provenance:** this is not a new
inference — HEL-1046 shipped a static `:root` fallback for `--app-focus-ring-color` for exactly this reason,
and the same lifecycle applies unchanged here.

**Interaction with D12, stated because the two look contradictory otherwise.** D12 rules the *per-theme*
`--app-accent` / `--app-accent-ink` declarations dead and directs that they be corrected or removed. That is
consistent with this decision: those are dead because inline style on `<html>` outranks them once the effect
runs, whereas this fallback is a **single `:root` value** that is *supposed* to be superseded the moment the
effect runs. One is a value that never renders; the other is a value that renders only until the real one
arrives.

## Site inventory (AC-4)

**42** `color: var(--app-accent)` declarations across **24** files, plus D8's eight `--app-accent-strong`
declarations and D9's alias sites. **The counts here are orientation, not the inventory** — the authoritative
set is D9's closure, because every class below was invisible to at least one hand-written pattern.

**Five background classes:**

- **Neutral-backed** — text on a theme surface token. The majority.
- **Accent-tinted via tokens** — `--app-accent-surface` / `--app-accent-dim`. The rule set is re-derived
  mechanically at implementation time; hand counts of this class returned four different answers during
  design and none was right.
- **Hand-rolled inline tints** — D6.
- **`::selection`** — D7.
- **User-chosen** — text over `--panel-surface-override`, chiefly `.markdown-panel a`
  (`MarkdownPanel.css:112`), the most text-like consumer in the product. **Out of scope, owned by HEL-1057**,
  filed specifically for it. *Not* HEL-1051, which is focus indicators at 3:1 — the same component, a
  different obligation. `resolvePanelTextColor` (`appearance.ts:245`) already derives panel text from the
  resolved surface at runtime and is the precedent HEL-1057 should chase first.

**Size from rendered instances, not from counts.** `/` and `/pipelines` render zero accent text;
`PipelineDetailPage` is the densest real surface; ten rules are hover/focus-only and invisible to a
persistent-state sweep.

## Risks

- Rendered brand text changes colour in light theme for all eight presets. That is the ruling, not a side
  effect, but it is the largest user-visible change here.
- The login-card mismatch is sharpened rather than avoided — see below.
- The dark values grew past what the brand ruling saw rendered; D4 gates on it.

## The accepted consequence that must be shown, not discovered

`text-only-token` with `accept-hue-shift` means Yellow's **text** renders dark olive while the Yellow **button
fill** beside it stays bright, on the same login card. The owner accepted this knowingly.

**Obligation:** capture that exact pairing for the worst preset and put it in the final-gate evidence. **If it
reads as broken rather than merely different, say so plainly and escalate — do not ship it quietly.** The owner
accepted a hue shift, not an incoherent card.

## Non-goals

- Changing `--app-accent`, or retuning the eight presets.
- Making `--app-focus-ring-color` theme-aware (AC-3 forbids it).
- User-chosen panel surfaces (HEL-1057).

---

# Appendix — correction history (NON-AUTHORITATIVE)

Nothing here states a current decision. It records how the decisions above were reached, because the *pattern*
is more useful than any single correction. This document was regenerated after six design-gate rounds produced
nineteen findings, of which the last six were self-contradictions created by patching it in place.

**Reachability routes, found one per round until the search closed.** The inventory began as a pattern over
`var(--app-accent)`. That pattern was itself a correction — an unanchored `color:` also matches `border-color`
and returned 65 declarations instead of the count the inventory records — and **the narrowing that fixed the
first error created the next
blind spot**, hiding `--app-accent-strong` (D8). Then the `--app-info` alias, then `::selection`, then the
inline tints, then the two-hop toast chain (D9). Three of five were invisible to *any* pattern over token
names. Rounds 5 and 6 found no further route; `currentColor`, `var()` fallbacks, `fill`/`stroke`,
`caret-color`, `::placeholder`, `::marker`, `text-fill-color`, inline styles and JS-set properties are all
cleared negatives.

**The numbers were not missing; the transfer was.** D8's failing figures had already been computed during
HEL-1050 as *border* colours and were never connected to the text case.

**`::selection` was ruled three times, each version defective differently.** Colour-only broke the
accent-ink pairings D7 names (all eight fail dark, Yellow 1.67). A "deterministic" `var(--app-bg)`/`var(--app-text)`
pair is what `body` already declares, so selected text would have rendered pixel-identical to unselected —
contrast 1.000. The third version was correct but was published with a "costs nothing" claim contradicted by
figures inside its own paragraph. **Every one of the three was justified by arithmetic that was correct about
the case measured and silent about the case broken.**

**Diagnosing a class is not scoring it.** D6 was documented for two rounds without entering the scored set —
see D6 for the value that would have shipped.

**D-number translation (one-time renumber, now frozen).** This document was regenerated once before rule 3
existed, and the renumber is why `tasks.md` had to be regenerated with it. The current D1–D12 assignment is
the frozen one — chosen over restoring the originals because `design.md` was already written against it.
**Scope — stated by the fact that determines it, not only by report number.** The renumber landed with the
`design.md` regeneration at commit `f84e7e88`. Reports written **before** it — `skeptic-design-1.md` through
**`-6.md`** — use the old numbering and need this table. Reports written **after** it — `skeptic-design-7.md`
onward, and anything added later — are already current-numbered and **must not be translated**. Applying the
table to a current-numbered report turns `D8` (`--app-accent-strong`) into D12 (dead defaults): an
authoritative-looking wrong lookup, which is the exact failure this table exists to prevent.

| old | new | decision |
|---|---|---|
| D1–D5 | unchanged | text token; scored set; one token per theme; dark perceptibility; producibility |
| D6 | **D10** | re-apply on theme change |
| D7 | **D11** | guard predicate corpus |
| D8 | **D12** | dead per-theme defaults |
| D9 | **D8** | `--app-accent-strong` used as text |
| D10 | **D9** | `--app-info` alias — merged into the transitive-closure decision |
| D11 | **D7** | `::selection` |
| D12 | **D6** | hand-rolled inline tints |
| D13 | **retired** | two-level alias chains — merged into D9; the number is not reused |

**First tombstone consumed.** D14 exists because D13 is retired and rule 3 forbids reviving a retired number.
The gap between D12 and D14 is deliberate. This was the freeze rule's first live test and it produced the
awkward answer rather than the tidy one, which is the point — a numbering rule that only ever yields tidy
results is not doing anything.

**Append-only correction is what made the last six findings.** Corrections were placed *below* the rulings they
overturned, leaving stale text under authoritative headings; one such rewrite also left a dangling sentence
fragment. That is why this document was regenerated rather than patched again, and why the rules at the top
exist.
