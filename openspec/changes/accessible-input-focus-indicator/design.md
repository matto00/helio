# Design — Accessible focus indicators for border/shadow-based focus states

## Context

HEL-1046 gave the focus ring its own contrast-derived colour, `--app-focus-ring-color`, and guarded every
`outline` declaration. Eleven sites convey focus by other means after suppressing the outline, so they sit
inside `accessible-focus-indicator`'s existing (mechanism-neutral) requirement while sitting outside its
enforcement. This is a conformance gap, not a new obligation.

**All ratios below are computed, not estimated**, using sRGB relative luminance against the literal surface
hexes in `theme.css`. The accent renders as `#f97316` in **both** themes — `applyAccentTokens` writes inline
style on `<html>`, which outranks both `:root[data-theme]` blocks, so the light-theme `--app-accent: #ea580c`
declaration is dead. Any measurement that reads `#ea580c` is a too-fast probe, not a finding.

**Binding surfaces.** Contrast is derived against `--app-surface-soft` `#efece6` (L=0.8405) in light and
`--app-surface-strong` `#262320` (L=0.0172) in dark — the surfaces *closest in luminance* to the indicator,
not the palette extremes `#ffffff`/`#121110`. For a mid-luminance colour the extremes are the **easiest**
surfaces. HEL-1046 derived against the extremes once and would have shipped a ring scoring 2.58–2.99 — its
own defect passing its own proof. That correction binds here.

## Measured inventory

Eleven `outline: none` sites, four mechanisms. Ratios are for the shipped default (Orange) unless noted.

| # | Site | Mechanism | Light | Verdict |
|---|---|---|---|---|
| 1 | `shared/ui/inputs.css:39` | accent border + dim halo | **2.38–2.80** | fail |
| 2 | `DashboardList.css:75` filter | accent border + dim halo | **2.38–2.80** | fail |
| 3 | `DashboardList.css:144` create | accent border + dim halo | **2.38–2.80** | fail |
| 4 | `DashboardList.css:355` row-rename | accent border + dim halo | **2.38–2.80** | fail |
| 5 | `auth.css:107/113` | accent border + dim halo, bare `:focus` | **2.38–2.80** | fail |
| 6 | `DashboardList.css:687` rename | **halo only** — border is permanent | **1.08** | fail, worst |
| 7 | `PanelGrid.css:244` title | `--app-accent-strong` border-bottom | 3.93 Orange / **2.78 Yellow** | fail; **binding surface is user-chosen — see D8** |
| 8 | `PipelineDetailPage.css:805` | accent border, bare `:focus` | **2.38–2.80** | fail |
| 9 | `AddSourceModal.css:156/160` | accent border, bare `:focus` | **2.38–2.80** | **orphaned — excluded, see D9** |
| 10 | `AccentPicker.css:19` swatch (focus shadow at `:36`) | raw accent shadow ring | **2.38–2.80** | fail + state collision |
| 11 | `PipelineDetailPage.css:796` | base `--app-accent-mid` border | 1.30 light / **1.64 dark** | see below |

**Site 7 is the reason to sweep all 8 presets rather than the default.** `--app-accent-strong` is theme-aware
(mixes black in light, white in dark) and passes for seven presets — Orange 3.93, Cyan 3.45, Green 3.24 — but
**Yellow scores 2.78 in light**. Checking only the shipped default would have wrongly exempted this site.

**CORRECTION (skeptic final-gate cycle) — the paragraph immediately below is WRONG and is retracted, kept
verbatim only for the record:** *"Site 11 is the ticket's own headline number. The ticket reports **1.63:1**
and calls it 'worse than the 2.38 that made HEL-1046 Urgent' — but 2.377 *is* that number, so it compares a
value to itself. The nearest reproduction is `--app-accent-mid` against `--app-surface` in **dark** = **1.644**,
which is site 11's *base* border. The ticket's headline figure almost certainly came from this element, not
from `inputs.css`. Resolve by computed-style measurement on the running app; do not settle it by argument."*

**What is actually true:** the "compares a value to itself" argument silently assumed the shipped **Orange**
default. It does not hold across presets — raw `--app-accent` vs `--app-surface-soft` (`#efece6`) for
**Yellow** (`#eab308`) measures **1.6266**, which **is** the ticket's 1.63:1, reproduced exactly on the
element the ticket actually named (`inputs.css`'s raw-accent border), not on site 11. The `--app-accent-mid`/
1.644/site-11 hypothesis above is retracted — it is almost certainly the wrong candidate, chasing a
coincidental near-match to an already-mistaken target rather than the real source. Task 2.3's "refuted as
directly observable" finding (see `ticket.md`'s premise-validation section and
`.concertino/runs/HEL-1050/evidence/measurement-report.md`) was therefore investigating the wrong candidate
element from the start. **This does not change the fix or its scope**: the defect at every one-of-ten site is
real and independent of which preset or element produced the ticket's specific 1.63 figure — 2.38–2.80 in
light already fails 3:1 regardless of accent. Only the diagnosis of *why* 1.63 was the reported number is
corrected, and the ticket's own number turns out to have been right all along; this design doc's earlier
"does not reproduce" claim was the error.

**Site 6 is the worst and the least visible.** Its accent border is present when *unfocused*, so focusing adds
only the 1.08:1 halo. Focus is conveyed **solely by a sub-threshold layer** — the case the new spec
requirement "Decoration alone is insufficient" exists to reject.

**Site 10 has a second defect the contrast finding would hide:** `.accent-picker__swatch:focus-visible` and
`.accent-picker__swatch--selected` declare **byte-identical** `box-shadow`. A focused swatch is
indistinguishable from the selected one. Fixing only the colour would leave that intact.

## Decisions

### D1 — Keep the border as the mechanism; recolour it. Do not reinstate `outline`.

`DESIGN.md` §8's carve-out explicitly blesses a border for text inputs: *"a text input showing it's the one
accepting keystrokes… an accent border, not an outline ring."* The mechanism is deliberate, and the ticket
asks whether `outline: none` was working around a clipping problem — for site 7 (a title input inside a grid
card with `overflow` constraints) and site 10 (a 20px round swatch whose ring is drawn by layered shadows) it
demonstrably was. Reinstating outlines there would reintroduce clipping to fix contrast.

So: **the mechanism stays, the colour changes.** `border-color: var(--app-accent)` in a focus state becomes
`border-color: var(--app-focus-ring-color)`.

This satisfies AC-1 by construction **for every site whose binding surface is a theme token** —
`deriveFocusRingColor` computes, per accent, the minimum darkening clearing 3:1 against every surface in
`FOCUS_RING_SURFACES` (`appearance.ts:320-333`), and inputs are backgrounded `--app-surface-soft`, which is
one of those ten and is in fact the binding light one. The static `#db6513` measures 3.03–3.57 light and
4.38–5.28 dark. No new derivation is introduced, so **AC-3 is satisfied trivially: nothing here is
theme-aware, and HEL-1048 is not touched.**

**The scope of that guarantee is exactly ten literal hexes, and site 7 is outside it — see D8.** The
unqualified claim ("by construction", full stop) was wrong in round 1 and is corrected here rather than
softened: a guarantee against a fixed surface set is not a guarantee against a surface the user picks.

### D2 — The halo is decoration and is never credited.

`--app-accent-dim` is an 8–10% alpha tint measuring **1.08:1 light / 1.14:1 dark**. It is kept for visual
continuity but carries no part of the obligation. Where a halo is the *only* focus affordance (site 6), a
conforming border must be added — the halo is not made conforming by thickening it.

### D3 — `--app-accent-strong` is not a conforming focus mechanism.

Yellow at 2.78 disqualifies it. Site 7 repoints to `--app-focus-ring-color`, preserving `border-bottom` as the
mechanism so the grid card's layout is untouched.

### D4 — Base-rule suppressions are treated as their own hazard.

Sites 5, 9, 10, 11 set `outline: none` on the **base** rule, not in a focus state. That is strictly worse: it
removes the outline unconditionally, so any element whose focus rule is later deleted silently becomes
unfocusable-looking. Each is given an explicit conforming focus state rather than relying on the base
suppression plus a separate rule.

### D5 — Guard shape: extend HEL-1046's guard, at selector-base granularity.

HEL-1046's whitelist guard asserts every `outline` declaration is `var(--app-focus-ring)`, `none`, or a pinned
exception. **`none` is an unconditional escape hatch** — which is precisely how ten live sites became
invisible to it. The extension closes that hatch. Round 1 specified it as "the rule declaring `outline: none`
must also declare a conforming indicator", which **cannot be written**, because at four sites the suppression
is on a *base* rule while the indicator lives in a sibling `:focus-visible` rule; a same-rule check would go
red on exactly the four correctly-fixed sites, and pinning them would hollow out the guard that exists because
of them. Specified properly:

**Granularity — selector base.** Comma-separated selector lists are **split first**, and each declaration is
attributed to *every* resulting base — `inputs.css:36-38` is a three-selector list and is the shape most
likely to be mishandled. Each selector is then normalised to its *base* by stripping trailing pseudo-classes
(`:focus`, `:focus-visible`, `:hover`, `:disabled`, `:not(…)`), and declarations sharing a base are grouped. For each base that declares `outline: none` anywhere in its group, **some rule in that group
whose selector carries `:focus-visible` must declare a conforming indicator.** This accepts D4's remedy
(suppression on the base, indicator in the sibling focus rule) without pinning anything, and still rejects a
base that suppresses the outline and never restores an indicator.

**The conforming predicate — an enumerated property set.** A declaration is an *indicator declaration* if its
property is one of: `outline`, `outline-color`, `border-color`, `border-top-color`, `border-right-color`,
`border-bottom-color`, `border-left-color`, `box-shadow`. `border-bottom-color` is in the set because task
3.5's fix for site 7 produces exactly that — round 1's predicate would have rejected its own remedy.

**Distinguishing indicator from retained decoration.** D2 deliberately keeps
`box-shadow: 0 0 0 3px var(--app-accent-dim)` inside the same focus rules the guard inspects, so a conforming
rule *will* contain a `box-shadow` referencing an accent token. The predicate is therefore two-part, and both
parts must hold for the group:

1. **At least one** indicator declaration **in some `:focus-visible` rule of the group** references
   `var(--app-focus-ring-color)` or `var(--app-focus-ring)`.
2. **No** indicator declaration **in a focus rule** references `var(--app-accent)` — the raw accent — as a
   bare token.

**"Is this a focus rule?" is evaluated on the RAW selector with the contents of every `:not(…)` removed
first**, and only then tested for `:focus`/`:focus-visible`. Both halves of that sentence are load-bearing:

- **Not a naive substring test.** `PanelGrid.css:238` is
  `.ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus)`, which literally *contains* the
  substring `:focus` — inside a negation. A `selector.includes(":focus")` implementation therefore admits this
  **hover** rule into part (2)'s scope, its `border-bottom-color: var(--app-accent)` violates part (2), and the
  guard goes red on task 3.5's own remedy. That is the same failure round 2 identified, reached through the
  wording written to fix it. A rule that matches only when *not* focused is never a focus rule.
- **Not the base-normalised selector either.** If the test is applied after pseudo-class stripping, no rule
  carries `:focus` at all, part (2) is vacuously satisfied everywhere, and the guard returns a meaningless
  green.

(`PipelineDetailPage.css:799` has the same `:hover:not(:disabled):not(:focus)` shape but declares
`--app-accent-mid`, so it is a second instance of the pattern rather than a second failure.
`DashboardList.css:259`'s `:focus-within` is likewise admitted by the substring test but is **inert** — its
group declares no `outline: none`, so it is never evaluated. Recorded so a future reader does not rediscover
it as a suspected defect.)

**The two parts are deliberately asymmetric in scope, and an implementer must not "simplify" them to match.**
Part (1) quantifies over `:focus-visible` rules; part (2) is restricted to focus rules rather than evaluated
group-wide. Evaluating part (2) group-wide **rejects the ticket's own remedy for a second time**:
`PanelGrid.css:239-242` is
`.ui-input.panel-grid-card__title-input:hover:not(:disabled):not(:focus) { … border-bottom-color: var(--app-accent); }`
— a **hover** declaration this ticket does not touch and has no reason to touch. Stripping `:not(…)` collapses
it into the same base group as the `:focus-visible` rule, and `border-bottom-color` is in the indicator
property set by design, so a group-wide part (2) would go red on site 7 immediately after task 3.5 correctly
fixes it.

Note the tempting wrong fix: *not* stripping `:not(…)` would also make the collision disappear, by giving the
hover rule its own base — but that weakens D4's base-rule check for every site, and makes the collision vanish
for the wrong reason. Scope part (2); keep the stripping.

`--app-accent-dim` is a *different token name* from `--app-accent`, so the retained halo satisfies (2) by name
without the guard needing to reason about alpha or luminance. This is the whole reason D2's decision to keep
the halo is safe to guard: the separation is lexical, not numeric. Without part (1), any `box-shadow` at all
would satisfy the guard and it would prove nothing — the single most likely way task 4.2's mutation check
returns a meaningless green.

**One pin is required, and it is enumerated rather than left abstract.**
`.add-source-modal__cell-input, .add-source-modal__cell-select` declares `outline: none` on its **base** rule
(`AddSourceModal.css:156`) and its only sibling focus rule is a bare `:focus` (`:160`) — there is no
`:focus-visible` anywhere in that group, so it fails D5's check. D9 forbids editing it (orphaned CSS), so the
guard carries a pin matched on {file `frontend/src/features/sources/ui/AddSourceModal.css`, the exact
normalised selector text, count 1}, with the reason "orphaned CSS, zero markup references" and the owner
**HEL-1052**. **The pin is expected to be deleted by HEL-1052**, whichever way that ticket resolves — it is a
temporary owned exception, not a permanent hole, and the guard comment says so.

**Stated limitations, recorded in the guard itself.** The guard reasons about CSS text. It cannot see a colour
composed at runtime, an indicator applied by inline style, or a token whose *value* is conforming while its
*name* is not. It matches token references by name, so renaming a token without updating the guard defeats it.

### D5a — `--app-accent-strong` is rejected by re-derivation, not by a hardcoded number.

Round 1 asked the guard to pin Yellow's 2.78 while simultaneously declaring the guard cannot evaluate
`color-mix` — self-contradictory. The resolution follows HEL-1046's own precedent (it re-parses surface hexes
out of `theme.css` at test time rather than trusting copies): the guard **parses the mix percentage and base
colour out of `theme.css`'s `--app-accent-strong` declaration** — `color-mix(in srgb, var(--app-accent) 76%,
black)` — and evaluates that two-colour sRGB mix against the eight presets itself.

So the guard *can* evaluate a simple two-colour mix **it has parsed from the stylesheet**; what it cannot do
is evaluate arbitrary runtime composition. D5's limitation note is worded to say exactly that, so the guard's
own comment is not false. Hardcoding 2.78 would drift silently the moment `76%` or `black` changes — the exact
class of defect HEL-1046 answered with a `SYNC OBLIGATION` comment at `appearance.ts:~310`.

### D6 — Bare `:focus` sites are fixed here, not deferred.

Sites 5, 8, 9 use bare `:focus`, contradicting HEL-1022's binding contract (`:focus-visible` only, so a ring
is not painted on programmatic or pointer focus). They are already being edited for colour; converting them is
a one-token change to the selector in the same rule. **This is not scope creep by reflex — it is declining to
leave a file half-corrected in a way the next reader would have to re-derive.** **Excluded by filename, not by site index** (the round-1 draft cited "site 11" for a file that is not in the
inventory table, which an implementer could reasonably have read as excluding `PipelineDetailPage.css:796` —
a site task 3.6 requires to be *fixed*): `PanelDetailModal.binding.css` is excluded because HEL-1049 owns it
as orphaned CSS, and `AddSourceModal.css` is excluded per D9 on the same basis. Every other bare-`:focus`
site is converted.

### D7 — Carry HEL-1046's derivation rationale into the code.

Per owner instruction: the corrected binding-surface derivation, and **why the palette extremes are wrong**,
are recorded alongside `deriveFocusRingColor` in `frontend/src/theme/appearance.ts` — not only in run
artifacts that die with the worktree. This ticket edits that file's neighbourhood and is the right carrier.

### D8 — Site 7 is fixed as far as a colour can fix it, and its residual is named, not hidden.

`.ui-input.panel-grid-card__title-input` is `background: transparent` with `border: none; border-bottom: …`
(`PanelGrid.css:222-231`), so its indicator renders against the **panel card**, which is
`background: var(--panel-surface-override, var(--app-surface))` (`PanelGrid.css:41`). `PanelCard.tsx:29` sets
that override from `buildPanelSurface(theme, appearance.background, appearance.transparency)`
(`appearance.ts:229-243`) — a **user-chosen colour**, tinted 0.24, at a **user-chosen alpha** falling to 0.15,
below which the user-chosen *dashboard* background shows through.

`FOCUS_RING_SURFACES` is ten literal theme hexes and deliberately excludes even `--app-bg-accent`. So no
derived colour can be guaranteed here: **no single colour clears 3:1 against an arbitrary user-chosen
background.** That is a mechanism problem, not a value problem — structurally the same impossibility HEL-1048
proved for accent-as-text, relocated from "two themes" to "any colour the user picks".

**Ruling: fix what a colour can fix, and name the rest.** Site 7 repoints to `--app-focus-ring-color` — a
strict improvement that conforms for default appearance, every theme surface, and all eight presets, and that
removes the Yellow failure D3 identified. The residual case — a user-chosen panel background near the derived
ring colour — is **declared a known non-conformance**, owned by **HEL-1051**. This is what AC-4 and the spec
delta's third requirement demand; silence is not an option they permit.

### D9 — Site 9 is orphaned CSS and is excluded on the same criterion as `PanelDetailModal.binding.css`.

`grep -rn "cell-input\|cell-select" frontend/ --exclude-dir=node_modules`, excluding `AddSourceModal.css`
itself, returns **zero** hits. No markup sets `add-source-modal__cell-input` or `add-source-modal__cell-select`.

The round-1 draft excluded one orphan (`PanelDetailModal.binding.css:137`, owned by HEL-1049) while fixing
another, applying its own criterion inconsistently — and did so while the ticket explicitly requires sizing
from **rendered instances, not grep counts**. Site 9 is therefore folded into HEL-1049's orphan sweep rather
than fixed here. Editing dead CSS would manufacture the appearance of coverage without changing anything a
user can reach.

**This drops the live inventory from eleven sites to ten.**

## Risks

- **Every focused input in the app changes colour.** No wire impact; substantial visual impact. Requires
  running-app verification in both themes, per the UI-cohesion gate.
- **Site 10's state collision** must be fixed as part of the same edit or the swatch stays ambiguous.
- **Site 7 ships knowingly non-conforming for user-chosen panel backgrounds** (D8, HEL-1051). Verification
  must include at least one non-default panel appearance so this is recorded as a measured number rather than
  an asserted caveat — measurements taken only on default panels return a green that is silent on it.
- The derived ring is a *darkened* accent; on `--app-surface-soft` in light the difference from the raw accent
  is visible but subtle. Cohesion is judged against the running app, not against the hex.

## Non-goals

- **HEL-1048 (accent-as-text at 4.5:1) is owner-ruled out of this diff.** No theme-aware derivation is
  introduced here; D1 deliberately reuses an existing theme-independent token so that boundary is structural.
- The permanent (unfocused) accent border at site 6 is *decorative* accent-as-border. It is out of scope as a
  contrast question and is noted for HEL-1048, but the **focus** affordance is fixed here.
