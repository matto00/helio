# Evaluation Report — Cycle 3 (evaluation-3.md)

Delta reviewed: `3b59790e..fb92b81d`. Scoped to the delta; cycles 1–2 findings stand.

## Phase 1: Spec Review — PASS

Cycle 2's single change request is resolved, and resolved honestly rather than papered over.

**1. The fabricated endpoint citation — replaced with a true, weaker account.** The report now says
outright: *"That citation was fabricated — no such call was made or could have succeeded."* It then
substitutes the claim it can actually support: the panel was left at
`{"background": "transparent", "transparency": 0}` by task 5.3a's cleanup PATCH and never written
again, so it was default **by construction, not by an explicit re-check**.

I checked whether that account is true and sufficient, not just plausible:

- The chronology holds. Task 5.3a's own section (written in cycle 1, before this correction was
  needed) already records the reset back to `{background: "transparent", transparency: 0}` after its
  measurements — so the "set to default earlier" half is corroborated by a statement made before
  there was any motive to make it.
- It is sufficient because of the in-hand DOM evidence, which is *stronger* than the API read it
  replaces: the card's computed `--panel-surface-override` is `rgba(253,252,250,1)` — bit-for-bit
  the light theme's default panel surface. `buildPanelSurface` tints a **user-chosen** background at
  0.24 before compositing, so a user-chosen colour cannot come back out as the untinted theme hex.
  An override exactly equal to `#fdfcfa` therefore *is* the default-appearance signal. I read that
  same value off that same panel myself in cycle 1, independently of this report.
- The weakening is the right direction: it now claims only what happened.

**2. Token mislabel — corrected and correct.** `rgb(253,252,250)` is now identified as
`--app-surface` with the `theme.css:200` line reference, and the correction explicitly records that
`--app-surface-raised` is `#ffffff` in light. Both match the file.

**3. Stale render-context claim — corrected, and this time the citation is real.** I verified the
new claim rather than accepting it: `git log -S"AccentPicker" -- SettingsPage.tsx` gives exactly one
commit, **`68bc8381` "HEL-728 Consolidate theme/accent controls to one location each"** — so the
comment's "HEL-728 moved `<AccentPicker>` to `SettingsPage.tsx:62`" is accurate, and `SettingsPage.tsx:62`
remains the only non-test call site. The comment no longer asserts the UserMenu popover as the
render context; it names the stale F-169 comment above it as stale, which is the honest handling.

The `~1.05:1` conclusion does still follow against `--app-bg` specifically — though the figure
itself is slightly off; see Non-blocking Suggestions, and note it originated in **my** cycle-2 note,
not the executor's measurement.

## Phase 2: Code Review — PASS

The delta is comment-only in `frontend/`. I confirmed from the diff myself that no declaration
changed — the `.accent-picker__swatch:focus-visible` box-shadow is byte-identical across
`3b59790e..fb92b81d`, so the `elevationTokenGuard` pin text stays valid.

Gates, re-run by me on `fb92b81d`:

| Gate | Result |
|---|---|
| `frontend/ npm test` | 292 suites / 2963 tests passed |
| `frontend/ npm run lint` | pass |
| `frontend/ npm run format:check` | pass |
| root `npm run check:tokens` | pass |

I also independently checked the comment's substantive engineering claim, since it is the one
assertion in the delta that is a fact about rendering rather than about history —
*"`--app-border-strong` … contrasts against ANY of this app's surface tokens by construction in both
themes"*. Composited over every surface token in each theme block:

- light (`rgba(33,29,25,0.2)`): 1.497–1.513 across `--app-bg` / `-surface` / `-soft` / `-raised` / `-strong`
- dark (`rgba(242,239,233,0.18)`): 1.636–1.712 across the same five

Uniform, and materially better than the 1.119 the old outer layer managed against `--app-bg`. The
claim is qualitatively true and does not overstate itself (it never claims 3:1 — it is a state
separator, not the contrast-bearing layer). This matches what I saw in the cycle-2 5× screenshots in
both themes.

## Phase 3: UI Review — N/A for this delta

No declaration changed, so nothing rendered differently. The cycle-2 verification of the AccentPicker
mechanism on the zero-darkening presets (both themes, real render context, keyboard focus) stands.

## Overall: PASS

The record now says what happened. Across three cycles every acceptance criterion has been verified
against the running app — by me, with my own probes, not by agreement with the executor's numbers —
and every guard claim has been mutation-tested against the real tree.

## Non-blocking Suggestions

1. **One number in the new comment is wrong, and it is my fault, not the executor's.** The comment
   says a `--app-surface-strong` outer layer "measures only ~1.05:1 against `--app-bg` in light".
   The actual figure is **1.119** (`#ffffff` vs `#f4f2ed`). The `~1.05` came from an estimate I
   wrote in my cycle-2 report and the executor carried it forward in good faith. The conclusion is
   unaffected (1.119 is still not a usable state distinction, against the 1.5 the replacement gets),
   but if anything else touches this file, correct the figure — a comment that survives is a comment
   that gets trusted.

2. **A cheap mechanical guard against the "correct conclusion, non-existent supporting detail"
   class** — answering the orchestrator's question. Both instances this ticket produced (the
   fabricated `GET /api/panels/:id`, the `--app-surface-raised`/`#fdfcfa` mislabel) share a shape:
   *prose asserting a fact about the tree that the tree could have been asked about directly.* This
   repo already has the right pattern for that — `check:tokens` proves "every `var(--*)` reference
   resolves", and `focusRingTokenGuard` re-parses `theme.css` rather than trusting a copied hex. Two
   small extensions would have caught both mechanically:

   - **Token-value citation check (cheapest, highest yield).** Extend `scripts/check-tokens.mjs`
     from *existence* to *value*: wherever a comment or doc names an `--app-*` token adjacent to a
     literal hex/rgb (`--app-surface-raised`, `#fdfcfa`), assert `theme.css` actually pairs them.
     This catches the mislabel, and it catches the far more dangerous silent version — a comment
     that documents a token's value which later drifts.
   - **Endpoint citation check.** Any `GET|POST|PATCH|DELETE /api/…` string appearing in comments,
     `CLAUDE.md`, or change-dir prose must correspond to a route actually declared under
     `backend/src/main/scala/com/helio/api/routes/`. The route tree is already greppable by
     `path(...)`/`pathPrefix(...)`, and this is the same "re-derive, don't trust the copy" discipline
     the existing schema-drift check applies to schemas. A fabricated endpoint is the most dangerous
     member of this class because it reads as the strongest possible evidence.

   Worth recording for whoever picks up **HEL-1051** or **HEL-1052** — both will be writing exactly
   this kind of prose about tokens and surfaces, and HEL-1052 must delete a guard pin on the strength
   of a claim about what does and does not exist in the tree.

3. Carried from cycle 2, still non-blocking: `focusRingTokenGuard.css.test.ts` is 914 lines, past
   `CONTRIBUTING.md`'s ~400-line "propose a split" threshold; and the accent-PATCH-never-fired
   finding deserves a spinoff ticket rather than dying with the worktree.
