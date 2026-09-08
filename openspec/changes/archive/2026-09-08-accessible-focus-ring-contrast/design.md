## Context

See proposal.md — Why, and ticket.md's premise section for the verified mechanism. The single fact that
drives every decision: WCAG contrast is a function of **relative luminance alone**, so the problem is
solvable exactly when a luminance window exists.

## Goals / Non-Goals

**Goals.** A focus indicator clearing 3:1 everywhere, for every accent and theme; brand accent untouched;
theme-independence proved by a guard rather than asserted.

**Non-Goals (design-level).** No theme-aware accent derivation (that is HEL-1048, and it changes brand
rendering). No retuning of preset hexes. No new focus-ring *geometry* — width, style and `outline-offset`
are unchanged and remain HEL-1022's contract.

## Decisions

### Decision 1 — The luminance window is why this is fixable and HEL-1048 is not

Contrast depends only on relative luminance, so hue and colour space are irrelevant.

**The binding surfaces are NOT the palette extremes** (round-1 skeptic CR1 — the round-1 text said
`#ffffff`/`#121110` and was wrong). For a **mid-luminance** value like a focus ring, the extremes are the
**EASIEST** surfaces to contrast against. The binding ones are those *closest* in luminance, in each
direction:

- light: the **darkest** light surface — `--app-surface-soft` `#efece6` (L=0.8405). Not `#ffffff`.
- dark: the **lightest** dark surface — `--app-surface-strong` `#262320` (L=0.0172). Not `#121110`.

For a ring of luminance `L` to clear a target against every surface:
`L ≤ (0.8405 + 0.05)/target − 0.05` and `L ≥ target × (0.0172 + 0.05) − 0.05`.

| target | L ≤ (vs `#efece6`) | L ≥ (vs `#262320`) | window |
| -- | -- | -- | -- |
| **3:1** | 0.2468 | 0.1516 | **exists**, width **0.0953** |
| **4.5:1** | 0.1479 | 0.2523 | **EMPTY** (gap 0.1044) |

**This is a proof, not a search result**, and the correction strengthens it: at 4.5:1 the upper bound falls
0.1044 below the lower bound, so no colour of any hue can satisfy both. Accent-as-text (HEL-1048) is
theme-dependent *by necessity*; this ticket is settleable by measurement.

**Why the round-1 error mattered, recorded so it is not repeated:** deriving against `#ffffff`/`#121110`
yields Orange 4% / Cyan 11% / Green 14% / Yellow 21% / Pink 0% — all of which score **2.58–2.99 against
`--app-surface-soft`**, i.e. **this ticket's exact defect, shipped while passing its own proof**. The
per-preset figures in D2/D3 were computed correctly (minimum over ALL surfaces) and are unaffected; only
this section's account of *which* surfaces bind was wrong. **"Worst surface" is not "extreme surface."**

**The window is a function of the surface set, and that can move.** HEL-866 is open on light
`--app-surface-raised` == `--app-surface-strong` == `#ffffff`, which is why the light binding surface is
`--app-surface-soft` rather than either of those. The guard therefore **re-reads the surfaces from
`theme.css` and re-derives which ones bind**, so it fails loudly when the set changes instead of asserting a
stale bound (D4).

### Decision 2 — A dedicated `--app-focus-ring-color`, derived minimally (owner-ruled)

A focus indicator carries a 3:1 non-text obligation; a decorative accent does not. **Binding the two is what
produced this defect** — the ring inherited a value chosen for brand, and no one was obliged to check it.
Separating them is the fix, and it leaves `--app-accent` untouched so nothing else in the app restyles.

`--app-focus-ring` becomes `2px solid var(--app-focus-ring-color)`. Width, style and `outline-offset` are
unchanged — this is a colour fix, not a geometry change.

**Derived to the MINIMUM adjustment that clears 3:1**, so brand hue survives as far as accessibility allows.
Measured need per preset: Red/Purple/Blue **0%** (already pass, so they render unchanged), Pink 1%,
Orange 12%, Cyan 18%, Green 21%, Yellow 28%. Resulting margins: light 3.01–3.07, dark 3.95–4.40.

*Alternative rejected — a fixed CSS `color-mix` ratio.* One ratio cannot serve a 0%–28% spread: it would
either under-fix Yellow (leaving the defect) or needlessly repaint Red/Purple/Blue (changing brand for no
accessibility gain). The value must be computed per accent.

*Alternative rejected — re-pointing `--app-focus-ring` at a hand-picked colour.* That is the palette-value
treatment this design exists to prevent; see D3.

### Decision 3 — Theme-independent by construction, and no signature change

Because the 3:1 window is non-empty, **one value per accent clears both themes**. So:
- `buildAccentTokens(hex)` keeps its signature and simply emits a third token. It stays theme-unaware.
- `ThemeProvider.tsx:89-92`'s effect keys stay `[accentColor]`. **No re-application on theme change is
  needed**, because there is nothing theme-dependent to re-apply.

This mirrors `--app-accent-ink`, which is theme-independent for the same structural reason (it is chosen
against the accent, never against a surface). Keeping that property is worth more than a marginally tighter
per-theme value: it removes an entire class of "stale after theme switch" bug by construction.

**The DESIGN.md entry records the DERIVATION, not just the token** — that the value is computed as the
minimum adjustment clearing 3:1 against the worst surface in both themes. The token's entire justification
is that it is *derived rather than chosen*; without that stated, the next editor reads it as a palette value,
hand-tunes it toward brand, and silently re-couples the two obligations. That is the failure this design is
built to prevent, so it must be written where an editor will meet it.

### Decision 4 — Assert it as a guard, not a comment

A comment cannot fail. The guard computes the derived ring colour's contrast against **every surface × both
themes × all 8 presets** and fails below 3:1.

Two properties it must have:
1. **It re-reads the surfaces from `theme.css` rather than hardcoding them, and RE-DERIVES which ones bind**
   — it must not bake in `--app-surface-soft`/`--app-surface-strong` as the binding pair any more than it
   bakes in the extremes. It compares the ring against EVERY declared surface in both theme blocks and takes
   the minimum; the binding surface is then an output, not an assumption. State in-file that the window
   depends on the surface set (D1). If HEL-866 or anything else changes a surface, the guard must go red.
2. **It must be failable by mutation** — reverting `--app-focus-ring` to `var(--app-accent)` must turn it
   red. Run that mutation and confirm it landed; a probe whose pattern silently fails to match returns a
   meaningless green.

If anything genuinely must be pinned, use **HEL-442's expiring-exception construction**. An exception that
cannot expire is the defect that gate spent three rounds establishing.

### Decision 6 — The static `theme.css` value is what actually paints first, and must be specified

Round-1 skeptic CR: no task specified `--app-focus-ring-color`'s **static** value in `theme.css`, yet that
is what renders in two real cases:

1. **First paint.** `ThemeProvider.tsx:89-92` applies accent tokens in a `useEffect`, which runs *after* the
   first paint. Until it does, the static declaration is what a focused element would use.
2. **The unparseable-hex fallback.** `buildAccentTokens` returns `{}` for an unparseable hex (D2/task 1.2),
   so nothing is written inline and the static value is the only value.

Leaving it unspecified makes the spec scenario *"the shipped default is not an exception"* untraceable — the
shipped default's first paint would be governed by whatever the stylesheet happens to say.

**The symbol is `DefaultAccentColorByTheme`, and it is theme-aware** (round-2 skeptic — `DefaultAccentColor`
does not exist): `theme.ts:12-15` gives dark `#f97316`, light `#ea580c`, selected by
`getInitialAccentColor(theme)` and then persisted. So "the default accent" is not single-valued, and the
static value needs a stated rule rather than a name.

**Decision: the static value is the derived ring for the DARK default, `#f97316` → `#db6513`.** Two reasons:
`getInitialTheme` falls back to `"dark"` when nothing is stored, so dark is what renders on a cold load; and
**`#db6513` clears 3:1 in BOTH themes** (light 3.03, dark 4.38), so the floor holds even if light paints
first. Measured alternative for completeness: the light default `#ea580c` needs 0% adjustment and also
clears both (light 3.02, dark 4.39) — either is *safe*, so this is a choice about which flash is shorter,
not about accessibility. That makes the static and
runtime paths agree for the default case, and makes the fallback a *known-good* colour that clears 3:1
rather than an arbitrary one. It must be declared **once at `:root`**, not per theme — the value is
theme-independent by construction (D3), and a per-theme declaration would be exactly the dead-code pattern
D5 exists to remove.

**The guard must cover this value too**, not only the runtime-derived ones, and the anti-drift test asserts
the static value equals the derivation applied to `DefaultAccentColorByTheme.dark` — a well-defined
right-hand side, so the test can actually fail.

**On margin (round-2 ruling): keep the bare minimum, do not pad the target.** The derived value is an exact
8-bit hex applied inline, so there is no rounding path from 3.01 to 2.99. This holds **only** while the
darkening stays out of CSS `color-mix` — if it ever moves there, the margin argument collapses and must be
revisited. The guard threshold stays exactly `>= 3.0`.

### Decision 5 — Correct the dead per-theme declarations

`theme.css` declares `--app-accent` per theme (dark `#f97316` line 163, light `#ea580c` line 209) and
neither renders, because `applyAccentTokens` writes inline style on `<html>` which outranks both blocks. The
light value is dead code that reads as an intentional per-theme tuning and is not one — it is what made this
defect hard to see. Correct or remove those defaults and make the `theme.css:161-162` comment true.

**In scope because it is the same defect's cause**, not scope creep: a stylesheet asserting a per-theme
value that cannot render is how the whole problem stayed invisible.

## Risks / Trade-offs

- **The derivation is only as good as the surfaces it is computed against** → D1/D4; the guard re-reads them.
- **A future editor hand-tunes the ring toward brand** → D3's DESIGN.md entry plus D4's guard; the guard
  fails, so prose alone is not relied on.
- **Yellow shifts most (28%)** → it is a focus indicator, not brand fill, and the alternative is an indicator
  nobody can see. Accepted, and visible in the adversarial preset screenshots.
- **Margins are thin at the floor (3.01)** → the derivation targets the minimum that *clears* 3:1; the guard
  asserts `≥ 3`, so any drift fails rather than silently degrading. If rounding proves marginal in the
  running app, raise the derivation target, not the guard's threshold.
- **An accent for which no value clears both themes** → not reachable via the picker (8 presets only), but
  `setAccentColor` accepts any string and values round-trip through storage and the server. The derivation
  must be total: return a safe fallback rather than throwing or emitting nothing.
- **Downstream** → `theme.css` is the most shared frontend file, and three guards already police it
  (`check:tokens`, HEL-441 motion, HEL-442 elevation). All must stay green.

## Migration Plan

Additive and frontend-only; no schema or wire change. Rollback is a single revert — the new token is
additive and `--app-accent` is untouched, so reverting restores exactly the prior (defective) rendering with
no other consequence.
