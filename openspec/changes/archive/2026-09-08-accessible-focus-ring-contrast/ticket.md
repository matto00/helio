# HEL-1046: Focus ring fails WCAG 3:1 against every light-theme surface (URGENT)

## Description

`theme.css:298-300` defines `--app-focus-ring: 2px solid var(--app-accent)`, and `:focus-visible` consumes it immediately below. Because that token is centralised (HEL-1022), **every `:focus-visible` element in the app renders a focus indicator below the 3:1 non-text floor in the shipped default light theme** — the app's entire keyboard-navigation affordance, in the theme most users see. Raised to Urgent and pulled into v0.7 on reach, not depth.

## Premise validated at Setup (CON-136 — verdict `no-drift`)

Every claim was **re-derived, not transcribed**. I parsed the five light surfaces from `theme.css` and the eight `ACCENT_PRESETS` hexes from `theme.ts:22-31` and computed WCAG contrast independently; the numbers match HEL-444's table to two decimals (Orange 2.38–2.80, Yellow 1.63–1.92, Pink 2.99 at min). The mechanism holds: `ThemeProvider.tsx:89-92` calls `applyAccentTokens` in an effect keyed on `[accentColor]` only, and `appearance.ts:327-332` writes **inline style on `<html>`**, which outranks both `:root[data-theme=…]` blocks — so `theme.css`'s light `--app-accent` is dead code and light renders the un-darkened dark value.

## SCOPE — decided on proof, ratified by the owner

**IN: the focus ring only.** OUT: accent-as-text → **HEL-1048** (filed, High, in v0.7). OUT: retuning the eight brand preset hexes.

This split is **a proof about the problem, not a preference about size.** WCAG contrast is a function of relative luminance alone, so hue and colour space are irrelevant to it.

**The binding surfaces are NOT the palette extremes** (corrected at design round 1 — the first version of this table said `#ffffff`/`#121110` and was wrong). For a **mid-luminance** value like a focus ring, the extremes are the **EASIEST** surfaces. The binding ones are those nearest in each direction: light `--app-surface-soft` `#efece6` (L=0.8405), dark `--app-surface-strong` `#262320` (L=0.0172).

| target | L ≤ (vs `#efece6`) | L ≥ (vs `#262320`) | window |
| -- | -- | -- | -- |
| **3:1** | 0.2468 | 0.1516 | **exists**, width **0.0953** |
| **4.5:1** | 0.1479 | 0.2523 | **EMPTY** (gap 0.1044) |

**Why this correction matters more than the numbers:** deriving against the extremes yields Orange 4% / Cyan 11% / Green 14% / Yellow 21%, all scoring **2.58–2.99 against `--app-surface-soft`** — **this ticket's exact defect, shipped while passing its own proof.** "Worst surface" is not "extreme surface".

**At 3:1 a theme-independent value exists; at 4.5:1 none can exist for any colour.** That is why this ticket is settleable by measurement and HEL-1048 is not — accent-as-text is theme-dependent *by necessity*, requiring a theme-aware derivation that changes rendered brand colour app-wide. That is an owner-level visual-identity call and **must not ride in on this ticket's accessibility evidence**. HEL-1048 is in the same release; keep the diff to the focus ring regardless.

## The fix — owner-ruled

**Adopt a dedicated `--app-focus-ring-color` token.** A focus indicator carries a 3:1 non-text obligation that a decorative accent does not; **binding the two is what produced this defect**, and separating them leaves `--app-accent` untouched everywhere else.

**A fixed `color-mix` ratio cannot work** — measured, the darkening needed to clear 3:1 ranges from **0% (Red, Purple, Blue) to 28% (Yellow)**. One ratio would either under-fix Yellow or needlessly repaint Red/Purple/Blue. The value must be **computed per preset**.

**Derive the MINIMUM adjustment that clears 3:1** against **every declared surface in both theme blocks** (take the minimum over all of them — do NOT pick a "worst" pair), so brand hue is preserved as far as accessibility allows. Verified achievable for all 8 (light 3.01–3.07, dark 3.95–4.40), so the token is **theme-independent by construction** — the same provable property `--app-accent-ink` already has, and no `ThemeProvider` or `buildAccentTokens` signature change is needed.

**Keep the bare minimum; do not pad the target** (design round 2 ruling). The derived value is an exact 8-bit hex applied inline, so there is no rounding path from 3.01 down to 2.99. That holds **only** while the darkening stays out of CSS `color-mix`, and the guard threshold must stay exactly `>= 3.0`.

## Acceptance criteria

* Every `:focus-visible` element renders a focus indicator clearing **3:1** against every surface it can land on, **both themes, all 8 presets**, verified on the running app **by computed style — not by token names**.
* `--app-focus-ring-color` exists as a dedicated token; `--app-accent` is unchanged.
* **DESIGN.md records the DERIVATION, not just the token** — that it is computed to the *minimum* adjustment clearing 3:1 in both themes. The token's entire justification is that it is derived rather than chosen; without that, the next editor treats it as a palette value and hand-tunes it back toward brand, silently re-coupling the two obligations.
* **A guard asserts the theme-independence and fails below 3:1** — computing the ring colour's contrast against every surface, both themes, all 8 presets. A comment is not a guard. If anything must be pinned, use **HEL-442's expiring-exception construction**; an exception that cannot expire is the defect that gate spent three rounds establishing.
* `theme.css`'s dead per-theme `--app-accent`/`--app-accent-ink` defaults are corrected or removed, and the `theme.css:161-162` comment made true.
* `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* **Accent-as-text (4.5:1) — HEL-1048.** Includes the empty-state "Create one" link.
* Retuning the eight brand preset hexes. **HEL-1047** (`readableLightText` unexercised), **HEL-866**, **HEL-1044**, **HEL-520**, **HEL-533** — none to be absorbed.

## Verification is the work, not the token change

**Do NOT size this from the 41 static grep sites.** HEL-444 found Dashboards, Sources, Pipelines and Connectors render **zero** accent instances — the static references overwhelmingly do not render. **Size from rendered surfaces**, and read HEL-444's task 4.2 inventory rather than re-deriving from grep.

**Run at least two presets end-to-end, chosen ADVERSARIALLY** — thinnest margin and worst surface pairing (Yellow needs 28% adjustment; Orange is the shipped default). Not the two that are convenient.

**MEASUREMENT TRAP — read before probing.** A too-fast probe (800–1200ms settle) intermittently reads the light accent as the dead `#ea580c`, because `ThemeProvider`'s server-preference adoption has not resolved at first paint. **That reading appears to confirm a claim HEL-444's design round 1 already retracted.** Let the theme settle, and **self-authenticate the reading** rather than trusting timing.

**Note HEL-866's interaction:** light `--app-surface-raised` == `--app-surface-strong` == `#ffffff`. Those are the *easiest* light surfaces, not the hardest — the binding light surface is `--app-surface-soft` `#efece6`. If HEL-866 changes the light surface set, the window moves and the guard must react.

## Evidence discipline (binding on executor, evaluator, skeptic)

1. **A green gate is not evidence until you check what it scans.** Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test` — in a worktree root jest finds zero tests. **Run gates from `frontend/`.**
2. **Hand-built fixtures find nothing.** Contrast must be computed from rendered values, not from token names or assumed hexes.
3. **jsdom proves nothing about computed style** (HEL-1005). Measure in a real browser.
4. **A deferral is only real if it names a task that exists and a ticket that owns it.**
5. **"No wire impact" != "no downstream impact"** — `theme.css` is the most shared file in the frontend.

**VERIFY THE MUTATION ACTUALLY LANDED.** A probe whose pattern silently fails to match returns a meaningless green. **Vacuity has a level above the test.**

**CONTENT SELF-AUTHENTICATION before any visual observation** — `curl` port 6478 for a string that exists ONLY on this branch, and **not a TypeScript type** (Vite strips types, so it would read as a failure for the wrong reason). **The shared browser is contested**: two lanes have independently reported a peer Playwright session stealing the tab. Re-check `location.href` before every reading.

**For every guard, state what it PROVES and what it CANNOT.** A check that structurally cannot fail must not be added — say so instead.

**Screenshots go to `.concertino/runs/HEL-1046/evidence/` ONLY** — never `openspec/**`, never `git add -f`.

## Do not disturb lane C

HEL-444's worktree is parked at `a3a0e7f2` on `task/light-dark-parity-audit/HEL-444`, evidence at `.concertino/runs/HEL-444/evidence/`. **Read from it; do not modify it.**

## Binding standards

`CONTRIBUTING.md`, `DESIGN.md` (§8 focus contract, HEL-1022), `.concertino/laws/`.
