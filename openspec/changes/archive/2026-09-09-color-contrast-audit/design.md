## Context

`theme.css` declares 29 `--app-*` tokens per `data-theme` block (symmetric; pinned by `themeParityGuard.css.test.ts`). Five of those are neutral surfaces (`--app-bg`, `--app-surface`, `--app-surface-soft`, `--app-surface-raised`, `--app-surface-strong`), and a further set are text-capable foregrounds (`--app-text`, `--app-text-muted`, `--app-success`, `--app-warning`, `--app-error`, with `--app-danger`/`--app-info` as `var()` aliases).

**The neutral surfaces are not the whole backdrop set, and the omission changes the fix** (design gate round 1, CR1). Each intent token is also rendered as text on its _own_ tint, `--app-*-surface`, which is a `color-mix(..., transparent)` and therefore composites against whatever neutral surface it sits on — e.g. `shared/chrome/StatusMessage.css:16-17` sets `background: var(--app-error-surface); color: var(--app-error)` at `--text-sm`, and ~20 further sites do the same. Those composites measure **3.71-4.37** in light theme, materially worse than the 4.25-4.48 neutral-surface figures:

| light pair                                       | over `--app-surface` | over `--app-bg` | over `--app-surface-soft` |
| ------------------------------------------------ | -------------------- | --------------- | ------------------------- |
| `--app-error` on `--app-error-surface` (10%)     | 4.37                 | 4.03            | **3.81**                  |
| `--app-warning` on `--app-warning-surface` (11%) | 4.31                 | 3.97            | **3.79**                  |
| `--app-success` on `--app-success-surface` (11%) | 4.22                 | 3.89            | **3.71**                  |

**And the tints are backdrops for every text-capable foreground, not only their own intent token** (design gate round 2, CR1). `--app-text-muted` `#6c655c` on the success / warning / error tints, each over `--app-surface-soft`, measures **4.25 / 4.27 / 4.25** — already sub-AA today, independently of anything this change does.

Intent-token-on-its-own-tint is clean in dark theme (5.11-8.13), **but the dark theme is not clean overall**: `--app-text-muted` `#9b948a` on the dark intent tints (14% each) measures as low as **3.82** (`--app-warning-surface` over `--app-surface-strong`), worse than the light theme's equivalent. Any claim that "dark is clean" is true only of the intent token on its own tint and must not be generalised. `--app-text` passes everywhere on tints in both themes (worst 10.57). The backdrop set for this audit is therefore **the five neutral surfaces plus each intent tint resolved as a composite over every neutral parent it actually occurs on** — enumerated from real parents, not assumed to be one. This matches the obligation the sibling capability already states (`accessible-accent-text/spec.md:25`: "The obligation is scored against every background the text can land on").

Three constraints shape everything below.

**C1 — declared is not rendered.** `applyAccentTokens` writes `--app-accent`, `--app-accent-ink`, `--app-focus-ring-color`, `--app-accent-text` and `--app-selection-bg` as inline style on `<html>`, which outranks both `:root[data-theme=...]` blocks. `theme.css`'s own comments now say so. Any accent value read from `theme.css` is dead. This is why the accent half of this change is measured in a browser or derived from `appearance.ts`, never parsed from the theme blocks.

**C2 — the intent tokens are not accent-derived.** `--app-success`/`--app-warning`/`--app-error` are static per-theme hexes, never written inline. For these, and for `--app-text`/`--app-text-muted`, the declared value _is_ the rendered value, so a source-parsed guard is sound. C1 and C2 apply to disjoint token sets, and the design depends on that split.

**C3 — an existing mechanism already covers this file.** Eight `*.css.test.ts` guards live in `frontend/src/theme/`, five of which parse `theme.css` by name. HEL-444's design gate refuted a script-form guard on exactly this ground and shipped a Jest test, dropping a husky line, two npm scripts, a selftest and a gate-chain surface.

## Goals / Non-Goals

**Goals:**

- A committed contrast table for both themes at a tracked path (AC1).
- Every pair that renders as normal-size text clears 4.5:1, or is a documented exception (AC1, AC2).
- A contrast floor asserted on `--app-accent-ink` across all 8 presets (AC3).
- A failable, non-vacuous guard inside the existing CI surface (AC4).

**Non-Goals:**

- Re-deriving `--app-accent-text`, `--app-focus-ring-color` or `--app-selection-bg`. Already guarded for 8 presets x 2 themes by HEL-1048/1046/1050; re-asserting them here would duplicate a live guard.
- Closing the pre-existing light-theme **accent-on-surface** shortfall of 1.78-3.71:1 that `DESIGN.md:150-190` records. That is an app-wide visual-identity change of the kind HEL-1048 required owner sign-off for. This change **measures and documents** it in the table; it does not silently repaint the brand overnight. See D5.
- A high-contrast theme (explicitly out of scope on the ticket).
- Changing the dark theme's **intent tokens**. Dark `--app-success`/`--app-warning`/`--app-error` on every in-scope backdrop measure comfortably above AA and are held fixed. This is deliberately narrower than "do not touch the dark theme", which an earlier draft asserted on the false basis that dark "measures clean throughout" — it does not: dark `--app-text-muted` on the intent tints measures 3.82 at worst, and D8 corrects it.

## Decisions

### D1 — Guard as a Jest test parsing `theme.css`, not a script

Per C3. `frontend/src/theme/tokenContrastGuard.css.test.ts`, alongside its six siblings, run by the `frontend` job's `npm test`, feeding the required `ci-complete` check. No new npm script, husky line, or gate-chain surface. This is the same mechanism-joining call HEL-444 made after its own design gate refused the parallel-mechanism version.

### D2 — Parse token values from source; never transcribe

The guard reads `theme.css` and extracts both `data-theme` blocks, **including each `--app-*-surface` tint's mix percentage and base token**, which it resolves into a composite over each neutral parent rather than transcribing a precomputed hex (CR1b). The composite is measured in the guard, where it is cheap and deterministic, and the rendered walk confirms only _which_ parents actually occur — the number itself must reach both the guard and the table. Transcribing hexes into the test file would let `theme.css` drift while the test kept passing — the exact failure `accentTextSourceSyncGuard` exists to prevent, and which `appearance.test.ts` already partially suffers (its D2 constants are a hardcoded mirror, as its own comment concedes).

### D3 — Vacuity refusal is mandatory

The guard asserts a non-empty parsed surface set and a non-empty parsed foreground set before comparing anything, and pins expected counts. A regex that silently matches nothing must fail, not pass over zero pairs. `focusRingTokenGuard` already does this (`asserts >= 9 surfaces found`); this follows it.

### D4 — Rendered confirmation gates every token change

The five sub-AA pairs are _declared_ measurements. MISTAKES.md is explicit that a name-based enumeration cannot see what actually paints. So before any token value changes, each failing pair is confirmed on the running app: does this intent token actually render as **normal-size** text (< 18.66px, or < 24px non-bold) on **that** surface?

Three outcomes, each with a defined action:

- **Renders as normal text** → darken the light-theme token until it clears 4.5:1 against the worst backdrop it renders on, staying within the existing token scheme (lightness only; hue and chroma held). **"Worst backdrop" explicitly includes the intent-tint composites above, not only the neutral surfaces** (CR1c). For the intent tokens today that means the target to beat is ~3.71-3.81, not ~4.25-4.38 — a substantially larger correction than the neutral-only reading would have produced. A fix sized against the neutral surfaces alone is insufficient by construction.
- **Renders only as large text, a border, an icon, or a fill** → 3:1 governs, the pair already passes, and it is recorded in the table as a documented exception with the reason. This is what AC1's "or a justified, documented exception" clause is for.
- **Never renders on that surface at all** → documented exception, token unchanged. This branch is a **universal negative justified by a failed search**, which is the exact class of claim that failed three cycles on HEL-444. So the exception SHALL name the specific enumeration that was run — the DOM query used, and the routes/dialogs/states visited — not the conclusion it reached, so the evaluator can re-run it and get the same answer. An exception whose evidence is not independently re-runnable is a defect (CR2). The large-text/non-text branch needs no such treatment: it carries a positive, checkable measurement (the instance's computed font-size and weight).

The guard's covered set is the **full matrix**, not only today's failures: every foreground x backdrop pair is asserted and appears in the table with its ratio, including comfortably-passing ones. This matters for the thin margins — `--app-warning` on `--app-bg` passes by 0.06 (4.56) and `--app-error` on `--app-bg` by 0.12 (4.62); those are precisely the pairs a future token edit breaks silently, and a guard scoped to today's failures would not catch it (CR3). The guard then holds each pair to _the threshold its rendered role earned_, not a blanket 4.5. A blanket 4.5 would force a token change that no rendered instance justifies, and this ticket's own AC2 forbids gratuitous design-language churn.

**This is the decision most likely to be wrong, and it is deliberately empirical.** The evaluator should re-derive the rendered/not-rendered classification independently rather than accept the executor's list — that exact class of claim (asserted reachability, not checked) failed three cycles running on HEL-444.

### D5 — Accent-on-surface is measured and documented, not repainted

AC3 says "verified", not "fixed". The light-theme accent-on-surface shortfall is real, pre-existing, app-wide, and already recorded in `DESIGN.md`. HEL-1048 established that changing rendered brand colour is an owner-level visual-identity decision that must not ride in on an accessibility fix's evidence. So this change measures all 8 presets against all surfaces, publishes the numbers in the table with an explicit FAIL verdict, and stops there. **No dangling reference:** a tracking ticket for this shortfall does not currently exist, so either one is filed and cited by real identifier, or the table states plainly that the shortfall is untracked. The repo's own rule is that a deferral must name a real task; a pointer to a ticket that was never filed is worse than an honest "untracked". Verified, documented, not silently changed.

### D6 — `--app-accent-ink` gets a floor, asserted over the presets

`buildAccentTokens` picks the ink by `max(contrast(dark), contrast(light))` with no floor — a max over two candidates can still be bad if both are. The fix is an assertion over all 8 presets in both themes that the selected ink clears 4.5:1 against its accent. If a preset fails, that is a genuine finding to route out, not something to paper over by widening the candidate set on the fly.

### D7 — The table lives in `docs/`, generated from source

A tracked markdown table under `docs/` (`grep -rln contrast docs/` is currently empty, so there is no existing home to extend). It records pair, ratio per theme, threshold applied, and verdict. **Plan as originally written:** it would be emitted by the same computation the guard uses, so the two cannot disagree; a hand-maintained table would rot on the first token edit.

**Correction (skeptic final-gate, cycle 3): the emitter described above was never built.** The table shipped is hand-transcribed — reproduced by adding a temporary `it(...)` block inside `tokenContrastGuard.css.test.ts` that calls its own (module-private) `assertedMatrix`/`crossIntentCells`/`tintComposites` helpers, printing the numbers, and copying them in by hand. This was accepted in place of the planned emitter because: (1) the numbers were independently re-derived and verified correct by both the evaluator and the skeptic across two review cycles, so the hand-transcription is not unverified; (2) it is the **guard**, not this table, that actually fails CI on a regression — the table is documentation, not a gate; and (3) building a real standalone emitter (a script importable from both the guard and a doc-generation step) was judged not worth its own file-size/maintenance cost for a one-time audit table, given the guard already re-derives the authoritative numbers on every `npm test` run. This is a real, accepted scope reduction from the original plan, not a fact quietly smoothed over — see `docs/contrast-audit.md`'s own header and `DESIGN.md`'s pointer, both corrected to say the same thing. `DESIGN.md` gets a short pointer to it rather than a duplicate copy — duplicating it would create two sources of truth for the same numbers.

### D8 — `--app-text-muted` on the intent tints: darken it too, only if it renders

Darkening an intent token also darkens that token's tint, because the tint is `color-mix` of the token. So this change's own remediation _degrades_ `--app-text-muted` on those tints from 4.25/4.27/4.25 to roughly 4.19/4.21/4.21. That is a pair made worse by the fix, and it needs a decided action rather than a discovery mid-execution.

The three candidate actions are not equivalent, and this design picks an order:

1. **First, run D4's rendered classification on the muted-on-tint pairs.** If muted text never lands on a tinted block as normal-size text, these are documented exceptions under D4's third branch — carrying the full re-runnable-enumeration obligation, since that branch is a universal negative.
2. **If it does render, correct `--app-text-muted` in BOTH themes as needed.** Dark theme is affected too, and worse: dark muted on the intent tints measures **3.82** at worst today. Lightening `#9b948a` -> approximately `#aba398` (~10%) clears >= 4.6 against every dark tint composite and neutral surface while staying 2.17:1 from `--app-text`. In light theme: Measured as achievable: `#6c655c` -> approximately `#676057` (a ~5% lightness-only step) clears 4.5:1 against every tint composite and every neutral surface, while remaining 2.70:1 from `--app-text` and so still reading as a distinctly muted step. Target a real margin (>= 4.6), not the bare 4.51 that the minimum step yields — a pair that passes by 0.01 is a future silent break. Note this reopens a prior deliberate decision: `theme.css:216-218` records that this token was tuned to sit just clear of AA against `--app-surface-soft`, so the change must be called out in the PR rather than slipped in.
3. **Rejected: reducing the tint percentages.** It would lift the composites, but the tint opacities are exactly the surface/opacity invariants DESIGN.md §3 protects and AC2 requires preserving, and the change would propagate to every intent surface app-wide rather than to the failing pairs. Reach for this only if 1 and 2 both fail, and escalate rather than deciding it inside this change.

### D10 — The matrix is the full cross-product, and cross-intent cells are bounded by the rendered walk

The audited matrix is **every text-capable foreground x every in-scope backdrop**, not a hand-picked list of today's known failures — that is what D4 already requires of the guard, and it is what makes a future regression detectable. Taking that literally produces _cross-intent_ cells: an intent token rendered on a **different** intent's tint, e.g. `--app-error` on `--app-warning-surface` over `--app-surface-strong`, which measures **4.05** in dark theme. No remediation in this plan reaches those cells, because D8 corrects `--app-text-muted` and section 3.1 corrects each intent token against _its own_ tint.

They are bounded, not ignored, and the bound is D4's third branch rather than a new fix: an error message rendered on a warning-coloured surface is not a composition this app builds, so each cross-intent cell is expected to resolve as "never renders" — and therefore carries CR2's re-runnable-enumeration obligation in full (name the DOM query and the states visited; a conclusion is not evidence). If the walk finds that any cross-intent cell _does_ render as normal-size text, that is a genuine finding: escalate it rather than silently darkening a token to satisfy a pairing the design language never intended.

This is the stated stopping rule the previous three rounds kept re-discovering: **the cross-product defines what gets measured and tabulated; the rendered walk defines what gets fixed.** Every cell is scored and appears in the table; only cells with a rendered normal-size instance oblige a token change.

### D9 — The backdrop set stops at the intent tints, and the boundary is stated, not implied

Extending backdrops from the five neutrals to the tints raises an obvious regress: which semi-transparent token is next? The boundary is **the neutral surfaces plus the three intent tints**, and it is drawn there for a measured reason, not for convenience:

- **Accent-derived backdrops (`--app-accent-surface`, `--app-accent-dim`, `--app-accent-mid`, `--app-bg-accent`, `--app-bg-secondary`) are out of this change's guard.** Per C1 the accent is written inline on `<html>` at runtime and varies per preset, so a source-parsed guard structurally _cannot_ score them — the values in `theme.css` are dead. The accent-text-on-accent-tint case that matters most is already covered for all 8 presets by `accentTextSourceSyncGuard`, which scores against exactly this tint set.
- **The residual is real and is recorded, not hidden.** Non-accent foregrounds on accent tints, and _all_ foregrounds on `--app-accent-mid` (measured 3.17-3.63 for the default light accent), are outside this audit and unguarded. The D7 table states this explicitly under the same rule D5/5.2a already applies: cite a filed follow-up by identifier, or say "untracked". Do not emit a dangling reference.
- **`--app-bg-accent` and `--app-bg-secondary` need no treatment** — zero background call sites.
- **`--app-text` on tints passes everywhere** (worst 10.57), so only `--app-text-muted` and the intent tokens carry obligations here.

The boundary is therefore measured on both sides: what is inside is inside because it is source-scorable and renders text; what is outside is outside because it is runtime-derived and already covered elsewhere, with its residual written down. The regress stops here.

## Risks / Trade-offs

- **The rendered-confirmation walk is the expensive, fallible part.** Mitigated by D4's explicit three-way classification and by asking the evaluator to re-derive rather than accept it. Note the HEL-444/HEL-1048 settle trap: an 800-1200ms probe intermittently reads the light accent as the dead `#ea580c` because `ThemeProvider`'s server-preference adoption has not resolved at first paint, and `ThemeProvider` seeds the accent once in a mount-time initializer, so clearing `localStorage` alone is not sufficient — reload fresh with the theme already light and let it settle.
- **Darkening an intent token is a visual change.** Bounded: lightness only, light theme only, and only where a rendered normal-size instance forces it. Margins are thin (4.25-4.48 vs 4.5), so the required correction is small — a few percent of lightness, not a new colour.
- **The remediation degrades a different sub-AA pair.** Handled explicitly by D8 rather than left to be discovered. The general lesson is encoded in tasks 3.4: a post-edit re-measure must check _already-failing_ pairs for further degradation, not only previously-passing pairs for regression.
- **Documenting an exception can become a way to avoid fixing things.** Mitigated by requiring each exception to name the rendered evidence that justifies it, so an unjustified exception is visible as an empty reason rather than as silence.
- **Publishing a known-failing accent-on-surface row could read as shipping a failure.** It is the honest outcome: AC3 asks for verification, the shortfall predates this ticket, and hiding it would be worse than recording it against a tracking ticket.
