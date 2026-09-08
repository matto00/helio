## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold spawn. Every number below was re-derived or re-measured by me; nothing is
transcribed from `evaluation-*.md`, `files-modified.md`, or the orchestrator's brief.

### What I verified (with evidence)

**Content self-authentication (before any visual reading)**
- `curl localhost:6478/src/theme/theme.css | grep -o db6513 | wc -l` → `3`;
  `curl .../OutputPicker.css | grep -o app-focus-ring | wc -l` → `1`. Branch content
  is being served. `curl localhost:9385/health` → `{"status":"ok"}`.
- `location.href` re-read before every browser measurement; all readings were on
  `localhost:6478`. No peer-lane tab theft observed during this session.

**1. The binding-surface trap — CLEARED.**
- `FOCUS_RING_SURFACES` (`appearance.ts`) is `#121110 #1a1816 #161514 #232019 #262320`
  (dark) + `#f4f2ed #fdfcfa #efece6 #ffffff #ffffff` (light). I diffed that against
  `theme.css:149-153` / `199-203` — exact match, and it **includes `#efece6`**, so the
  derivation is not run against the extremes.
- I re-implemented the whole derivation independently in Python (own luminance/contrast
  code, own surface list read from `theme.css`) and reproduced every shipped value:
  `Orange #f97316→#db6513 (12%) min 3.028 · Red 0% 3.192 · Pink 1% #ea4797 3.046 ·
  Purple 0% 3.356 · Blue 0% 3.119 · Cyan 18% #0595ae 3.010 · Green 21% #1b9c4a 3.018 ·
  Yellow 28% #a88106 3.067`. In every case the **minimum is against `#efece6`** —
  i.e. `--app-surface-soft` is the binding surface, exactly as design.md D1 claims.
  The "extremes" defect (2.58–2.99 vs soft) is **not** present.
- No CSS `color-mix` anywhere in the derivation: `deriveFocusRingColor` darkens per
  channel in TypeScript and emits an 8-bit hex via `toHexColor`. Threshold constant is
  `FOCUS_RING_CONTRAST_TARGET = 3.0`, unpadded, in both the source and the guard.

**2. The 17 repointed sites — COUNT AND OFFSETS CONFIRMED INDEPENDENTLY.**
- `git grep -n outline main -- 'frontend/src/**/*.css'` at the pre-fix tip:
  `outline: 2px solid var(--app-accent);` appears **17** times across **8** files
  (DashboardAppearanceEditor 1, DashboardList 4, OutputPicker 1,
  PanelDetailModal.appearance 1, .binding 4, .css 2, .sections 3, TableDisplayFields 1).
  DESIGN.md's 17/8 tally and its 15 `:focus-visible` / 1 bare `:focus` / 1 state-class
  breakdown are **correct**; I did not trust any artifact's count.
- Every one of the 17 is repointed at `var(--app-focus-ring)` and **every
  `outline-offset` survives verbatim**, including `DashboardList.css:488`'s deliberate
  `-2px` and the two `1px` offsets. Post-fix audit of all `outline` declarations under
  `frontend/src/**/*.css` leaves exactly one non-token colour: `App.css:43`
  (`var(--app-text)`, the HEL-772 skip link).
- **Live re-measurement of the named site.** `.dashboard-list__item-row
  .actions-menu__trigger` on a genuinely `:focus-visible` element (`matches(':focus-visible')
  === true`, verified, after real `Tab` keypresses to establish keyboard modality):
  light **3.527** against its actual composited background `rgb(253,252,250)`, dark
  **4.896** against `rgb(26,24,22)`. Matches the cycle-2 figure; the cycle-1 1.87 is gone.

**3. Both guards — I landed five mutations myself, all verified present in the file
before running, all stably red, all reverted.**

| mutation | landed | result |
| -- | -- | -- |
| `outline: 2px solid #f97316;` in `OutputPicker.css` (hardcoded hex) | grep-confirmed | RED — "Found 1 unguarded outline declaration(s)" |
| `outline: 2px solid var(--app-accent-strong);` (different token, would pass a blacklist) | grep-confirmed | RED — same test |
| `--app-focus-ring-color: #dc6513;` (1-bit drift) | grep-confirmed | RED — "no drift" test |
| light `--app-surface-soft` → `#f8f6f2` | confirmed | RED — binding-pair-present test |
| **add** `--app-surface-mid: #b0aaa0;` to the light block (a genuinely harder new surface) | confirmed | RED — **both** the static-value and the all-8-presets contrast tests |

  The last one is the important one: it proves the guard genuinely **re-derives** the
  surface set from `theme.css` rather than asserting a pinned pair, so the HEL-866
  reaction claim is real and not prose.
- **Pinned-exception mechanism cannot swallow a regression.** A pin must match
  file **and** exact normalized declaration text; a third test asserts each pin's
  **exact hit count**. So a pin cannot broaden to cover a new offending rule, and a
  pin that goes stale fails rather than silently passing.
- **The stated shorthand-only limit is accurate.** `OUTLINE_DECL_RE` is
  `/(?<!-)\boutline\s*:\s*([^;]+);/g` — it genuinely matches only the shorthand, and
  the comment says so plainly, names the exact bypass (`outline-color` longhand
  alongside a compliant shorthand), records that it was confirmed by live mutation, and
  states that zero such declarations exist today. I re-checked: `grep -rn
  "outline-color\s*:" frontend/src --include=*.css` → zero hits. The limitation is
  disclosed honestly, not overstated. `isAllowedOutline` matches
  `var(--app-focus-ring)` with a closing paren, so `var(--app-focus-ring-color)` would
  **not** be silently accepted.

**4. The static `:root` value — CONFIRMED.** `#db6513` equals my independent
`derive("#f97316")`, clears 3:1 against all ten surfaces (min 3.028), and the no-drift
test is failable (mutation 3 above).

**5. Real-browser sweep — this is the AC's "computed style, not token names" evidence.**
Driven through the real `AccentPicker` UI on `/settings` (never localStorage), with a
≥7s settle after each accent/theme change, keyboard modality re-established with real
`Tab` presses so `:focus-visible` actually matched.

| run | accent (inline on `<html>`) | ring | elements measured | non-ring colours | failures < 3.0 | worst |
| -- | -- | -- | -- | -- | -- | -- |
| dark | `#eab308` | `#a88106` | 264 | 1 (skip link `rgb(242,239,233)`) | **0** | — |
| light | `#eab308` | `#a88106` | 264 | 1 (skip link `rgb(33,29,25)`) | **0** | 3.067 (`ui-data-grid__resize-handle` on `#efece6`) |
| light | `#f97316` | `#db6513` | 49 | 1 (skip link) | **0** | 3.191 |
| dark | `#eab308` | `#a88106` | 124 | 0 | **0** | — |
| panel detail modal, light | `#eab308` | `#a88106` | 8 | 0 | **0** | 3.616 |

  Contrast was computed against the **composited** background (alpha layers flattened),
  not a token name. Two presets end-to-end, chosen adversarially (Yellow = 28%, the
  thinnest hue margin; Orange = shipped default). `--app-focus-ring-color` was
  **identical in both themes** (`#a88106` in dark and light) — theme-independence
  confirmed at runtime, not just by construction.

**Ninth-defect hunt (assumed one exists).** I attacked the axis the prior eight did not:
**negative `outline-offset` draws the ring INSIDE the element, over the element's own
background, not the parent's** — so an accent-backgrounded control with `-2px` would
paint a darkened-accent ring on accent. I re-measured all 54 negative-offset
`:focus-visible` elements against their **own** composited background: all
`dashboard-list__button` / `app-sidebar__nav-link` / `ui-icon-btn`, all 3.527, none
accent-backed. No defect on that axis. I also checked the derivation's monotonicity
(darkening toward black is monotone in luminance, so the first clearing integer percent
is the minimum over the sampled set) and the unparseable-hex path (`buildAccentTokens`
already returns `{}` before `?? hex` can matter — dead but harmless).

**Gates (run by me, from `frontend/`, not from the worktree root).**
`npm run lint` clean · `npm run typecheck` clean · `npx jest` → **292 suites / 2952
tests passed** · root `npm run check:tokens` OK · `npm run check:tokens:selftest` 10/10.
`motionTokenGuard` / `elevationTokenGuard` / `theme.css.test.ts` / `tokenAuditSweep` all
green inside the full run.

**Reproduced-before-concluding.** My first `git diff --stat main...HEAD` showed
`frontend/index.html | 21 ++`. Re-running it returned nothing for that file and a
24-file diff — local `main` had advanced between the two commands (`070133b3` →
`95b6c619`). Reproduced, so: **not a defect**, `index.html` is not part of this change.

**Deferral is real.** HEL-1048 is live, **Todo**, High, in the v0.7 project, created
2026-09-08, not archived. Its scope is accent-as-text at 4.5:1 and it explicitly claims
ownership of removing `theme.css`'s dead per-theme accent defaults. This diff does not
touch that scope: `--app-accent` is byte-identical everywhere and no `color:` site moved.

---

### Verdict: REFUTE

Everything load-bearing about the fix is sound — derivation, binding surfaces, the 17
sites, both guards, live contrast in both themes for two adversarial presets. I found no
ninth functional defect. **One defect remains, and it is the exact class this lane has
already been burned by twice: a sentence in `theme.css` that this commit makes false.**

### Change Requests

1. **`frontend/src/theme/theme.css:306` — the `--app-focus-ring` comment now states
   something the same commit made untrue.** It reads:

   > `... and is NOT part of this token. Never used for ':focus' (bare) -- see DESIGN.md §8's focus-visible contract ...`

   As of `eada165d`, `PanelDetailModal.binding.css:138`
   (`.panel-detail-modal__type-search:focus`, a **bare** `:focus` rule) consumes
   `var(--app-focus-ring)`. The token **is** now used for bare `:focus`, at exactly one
   site — and the new adoption guard *requires* it to stay that way, since a bare-`:focus`
   `outline` must be `var(--app-focus-ring)`, `none`, or a pin. So the sentence is not
   merely stale; it is now unachievable without a separate behavioural change.

   This is the same failure mode DESIGN.md itself confesses to two paragraphs later
   ("*'Every component references one token instead of hand-copying the literal' was NOT
   true when HEL-1046 was first written*"), in the most-shared file in the frontend, and
   it is what this ticket's own AC ("*the comment made true*") exists to prevent.

   **Required:** amend that clause in `theme.css` to state the truth — that the token is
   for `:focus-visible`, with **one** bare-`:focus` consumer
   (`PanelDetailModal.binding.css`'s `.panel-detail-modal__type-search`, pre-existing,
   repointed by HEL-1046 for contrast only, behaviour unchanged), and name the ticket
   that would convert it. Do **not** convert the rule to `:focus-visible` in this diff —
   that is a behavioural change outside this ticket's scope. Comment-only fix.

   (I deliberately did **not** treat this as blocking-for-safety: the ring at that site
   is strictly better than before — it went from the raw accent to the derived colour.
   It is blocking because an untrue comment in `theme.css` is precisely the artifact this
   change is supposed to leave correct.)

### Cohesion call — CAPTURED, NOT RULED (owner escalation `accept-derived-bronze` / `constrain-hue-preserve` / `owner-review-screenshots`)

Screenshots (I looked at all three):
- `.concertino/runs/HEL-1046/evidence/skeptic-final-light-yellow-ring.png` — light,
  Yellow, ring on `.dashboard-list__item-row .actions-menu__trigger`.
- `.concertino/runs/HEL-1046/evidence/skeptic-final-light-yellow-modal.png` — light,
  Yellow, ring on the panel modal's Cancel button, **directly beside the bright-yellow
  Save button**. This is the most honest side-by-side of the gap.
- `.concertino/runs/HEL-1046/evidence/skeptic-final-dark-yellow-ring.png` — dark, Yellow,
  ring on a `sortable-th__btn`, beside the bright-yellow Edit button.

What I actually see: in **light**, `#a88106` next to `#eab308` reads as a distinctly
darker, olive-bronze gold. The relationship to the swatch is legible — it is plainly the
same hue family, not an alien colour — but at the Save/Cancel pairing the two golds sit
adjacent and the value gap is the most apparent thing in the frame. In **dark** the gap
is milder: the bronze reads as a muted gold against `#1a1816` and does not fight the
accent. Yellow is the worst case (28%); Orange's `#db6513` is visually very close to
`#f97316` and I would not have noticed it unprompted, and Red/Purple/Blue are unchanged
outright.

**My advice (not a ruling): `accept-derived-bronze`.** The alternative on the table is a
1.87:1 indicator that a keyboard user cannot see, and `constrain-hue-preserve` cannot
help here — the 3:1 obligation is a function of relative luminance alone, so preserving
hue while raising contrast still lands on essentially this colour. The affected set is
one preset out of eight, and the ring only paints on keyboard focus. I would not spend
another cycle on it.

### Non-blocking notes

- `buildAccentTokens`'s `deriveFocusRingColor(hex) ?? hex` fallback is unreachable —
  the function already returns `{}` for an unparseable hex above it. Harmless, arguably
  clearer as-is.
- The derivation searches integer percent steps, so it is the minimum over that sampled
  set rather than the true continuous minimum. Conservative in the safe direction, and
  the resulting margins (3.010–3.356) are all above the floor.
- The dark block's dead `--app-accent-ink: #16130f` does not match what the runtime
  actually writes (`#181511`). It never renders, and HEL-1048 explicitly owns removing
  these. Noting only so it is not mistaken for a live value later.
