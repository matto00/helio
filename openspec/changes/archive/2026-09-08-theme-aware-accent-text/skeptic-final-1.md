# Skeptic Report — final gate (round 1, skeptic-final-1.md)

## What I verified (with evidence)

### Ground truth / build identity

- `git diff --stat fcce99b1..2c85629d` — 53 files, 17 commits. Read the full diff of
  `theme.css`, `appearance.ts`, `ThemeProvider.tsx`, both new guard tests, and every CSS repoint.
- **Served-build identity (CON-155).** `start-servers.sh` printed *"already healthy, reusing"* for both
  ports — the exact hazard flagged. Verified rather than trusted: the Vite process serving 6480 is
  PID `2548822` with `/proc/2548822/cwd` = this worktree's `frontend`, and `curl
  http://localhost:6480/src/theme/theme.css` returns `--app-accent-text: #fa8737` and
  `--app-selection-bg: #572e12`. This is the right build. (Three *other* stale Vite processes are
  live on this box from unrelated worktrees, two with deleted cwds — worth knowing, not this
  ticket's problem.)
- **Suite genuinely runs.** `npx jest` from `frontend/` (not the root wrapper, which
  `--passWithNoTests`-passes on silence): **297 suites / 3124 tests, all passing**, 28.9s. 297 vs the
  briefed 295 is exactly the two new guard files. Not vacuous.

### Independent closure (did NOT reuse the executor's inventory or script)

Wrote my own fixpoint closure over all frontend `.css`, resolving custom properties reaching
`--app-accent` by any number of hops. Reached set matches: `--app-accent`, `-dim`, `-mid`, `-strong`,
`-surface`, `--app-bg-accent`, `--app-bg-secondary`, `--app-info`, `--toast-intent-color`.
87 `color:` declarations resolve into that set. All but **three** are now `--app-accent-text` or
`--app-accent-ink` (ink is text *on* bright fills — correctly untouched).

### Contrast model validated before use

My offline model reproduces design.md D8's own published figures for `--app-accent-strong`-as-text on
light neutrals **exactly** — Orange 3.93, Cyan 3.45, Green 3.24, Yellow 2.78, Red 5.05, Pink 4.79,
Purple 5.24, Blue 4.93. Same method, same numbers, so subsequent figures are trustworthy.

### Required deliverable 1 — the login-card pairing capture (never previously taken)

Captured on the running app, Yellow preset, both themes, driven through a real login page.

- Light: `.auth-footer a` computed `rgb(124,95,4)` (`#7c5f04`) vs `.auth-card button[type=submit]`
  fill `rgb(234,179,8)` (`#eab308`) on card `rgb(253,252,250)`. Inline `<html>` style confirmed
  carrying `--app-accent-text: #7c5f04`.
  → `.concertino/runs/HEL-1048/evidence/skeptic-final-login-card-yellow-light.png`
- Dark: link and fill are both bright yellow (Yellow needs 0% lightening in dark); AC-2 measured
  live at **9.231**.
  → `.concertino/runs/HEL-1048/evidence/skeptic-final-login-card-yellow-dark.png`

**Judgment: it reads as different, not broken. No escalation.** The dark olive link stays clearly
inside the same gold hue family as the button beside it — it reads as a deliberate darker text weight
of the brand colour, which is an entirely conventional pairing (bright fill + darker link). It is the
most legible element on its line and does not read as a mistake or a second colour. The owner's
`accept-hue-shift` ruling survives contact with the render. Dark theme is a non-issue.

### AC trace

- **AC-2** — passes, measured live (light 6.367 / dark 7.238 per prior gates; I independently
  measured dark Yellow at 9.231 and confirmed the light link colour is the derived token).
- **AC-3** — `--app-focus-ring-color` is untouched; still a single `:root` declaration, still fed by
  `deriveFocusRingColor(hex)` with no `theme` parameter. Confirmed in the diff.
- **AC-5** — producibility is structural, not asserted-after-the-fact: `deriveAccentTextColor`
  searches integer percents of the derivation itself, so it cannot return an unemittable value. This
  is the right shape.
- **AC-1 / AC-4** — **not met.** See below.

## Verdict: REFUTE

The defect is exactly the class the brief predicted a sixth instance of: **a true conclusion resting
on support that does not exist.** The suite is green *because* the closure guard hand-allowlists the
three failing declarations, and the allowlist's stated justification is false.

`accentTextClosureGuard.css.test.ts:104-112`:

> "the AddSourceModal pair is a documented false positive (text on its OWN 20% accent-tinted pill,
> **already accounted for**)"

"Already accounted for" is not true. D2/D6 account for the 20% tint as a **background** in the scored
set — i.e. `--app-accent-text` is derived to clear 4.5:1 over it. But these two declarations do not
use `--app-accent-text`; they use `--app-accent-strong`, about which the derivation guarantees
nothing. The background being scored says nothing about a *different* text colour painted on it.

And design.md D8 does not license this. Its ruling is *"repoint these at the text token — **with one
exception**"*, naming SidebarBody. The parenthetical *"(AddSourceModal.css:85/:95 has the same shape
but is a deliberate false positive.)"* says AddSourceModal is a false positive **of the link/hover
exception pattern** — it is not a base/hover pair, therefore the exception does **not** apply to it.
The guard turned D8's *one* exception into *two* and describes them as "the two named, deliberate
exceptions (design.md D8)" — a citation to text that names one.

Measured live in a real browser, light theme, Yellow accent, Add source modal open:

| element | colour | effective bg | ratio |
|---|---|---|---|
| `.add-source-modal__type-btn--active` ("REST API", **12px**) | `rgb(178,136,6)` | `rgb(251,240,206)` | **2.876 FAIL** |
| inactive sibling pill (control) | `rgb(108,101,92)` | `rgb(255,255,255)` | 5.748 pass |

Reproduced on a second run, identical. Screenshot
`.concertino/runs/HEL-1048/evidence/skeptic-final-addsourcemodal-pill-light-yellow.png` shows it
visibly washed out — pale-gold-on-pale-gold. The control passing confirms the method discriminates.

This is not Yellow-only. Modelled across the palette for that pill (accent-strong text on its own 20%
tint over light neutrals): Orange **3.28**, Red 3.95, Pink 3.81, Purple 4.18, Blue 4.00, Cyan 2.93,
Green 2.79, Yellow 2.51 — **all eight fail, including Orange, the shipped default**. That is the
spec's own *"the shipped default is not an exception"* scenario.

The SidebarBody hover fails too, on design.md's **own** published figures (D8): Orange 3.93,
Cyan 3.45, Green 3.24, Yellow 2.78 — 4 of 8, again including the shipped default. D8's rationale for
that exception is a *hover-no-op* concern, not a contrast exemption, and the executor already solved
the no-op problem with `text-decoration-thickness: 2px` — which means the colour no longer has to
carry the state change at all.

So AC-1 ("clears 4.5:1 against every surface it renders on, in both themes, for all 8 presets") is
false at three rendered declarations, and AC-4 ("a site left unfixed is named with its reason and an
owning ticket") is false at the same three: no owning ticket, and one of the two reasons is incorrect.

### Change Requests

1. **Repoint `AddSourceModal.css:85` (`.add-source-modal__type-btn--active`) and `:95`
   (`...--active:hover`) from `color: var(--app-accent-strong)` to `var(--app-accent-text)`**, as
   design.md D8's ruling actually directs. Measured live at 2.876 (Yellow) and modelled failing for
   all eight presets including Orange. Note the pill's 20% tint is *already* in D2's scored set, so
   `--app-accent-text` is derived to clear 4.5:1 there — this needs no re-derivation and no new
   figures.

2. **Fix `SidebarBody.css:62` (`.sidebar-body__locked-notice-link:hover`)**, which stays on
   `--app-accent-strong` and fails 4/8 presets in light on D8's own numbers (Orange 3.93, Cyan 3.45,
   Green 3.24, Yellow 2.78). The `text-decoration-thickness: 2px` you added already supplies the
   distinct hover signal D8 was protecting, so move the colour to `--app-accent-text` and keep the
   underline as the state change. If instead you intend to keep a *colour* delta on hover, it must be
   a value that itself clears 4.5:1 against the sidebar surfaces.

3. **Delete the false justification in `accentTextClosureGuard.css.test.ts:104-112.** "text on its OWN
   20% accent-tinted pill, already accounted for" is not true — D2/D6 score that tint as a
   *background* for `--app-accent-text`, and says nothing about `--app-accent-strong` painted on it.
   Once CR-1 and CR-2 land, `ALLOWED_EXCEPTIONS` should be **empty or removed**, and the "still finds
   the two named exceptions" test (which currently pins the defect in place) removed with it. If any
   exception survives, its comment must state a *measured* ratio, not an inherited claim.

4. **Correct the stale line reference.** design.md D8 and the new `SidebarBody.css` comment both cite
   `SidebarBody.css:46/:55`; the hover rule is at **:62** (the guard's own allowlist uses `:62`, so
   the two disagree). Same class of defect as the "cited API endpoint that does not exist" this lane
   has hit before.

5. **State the honest limit in the delivery artifacts.** After CR-1–CR-3, AC-1 is satisfied for all
   theme-token-bound and accent-tinted surfaces. **One class remains unconformant: accent text on
   user-chosen panel surfaces**, chiefly `.markdown-panel a` (`MarkdownPanel.css:112`) over
   `--panel-surface-override`. I verified this deferral is real and correctly aimed: **HEL-1057**
   exists, is Backlog, and its acceptance criterion is *accent-coloured text at 4.5:1 on user-chosen
   panel backgrounds* — the obligation, not merely the component. That deferral is legitimate and
   needs no change; it just has to be said plainly in the completion claim so the CONFIRM does not
   read as full satisfaction of AC-1.

## Non-blocking notes

- The login-card capture is done and needs no repeat — CR-1–CR-4 do not touch `auth.css`, and the
  pairing renders coherently in both themes. Do not re-litigate `accept-hue-shift`.
- Four stale Vite dev servers from other worktrees are running on this machine, two with deleted
  cwds (PIDs 1703865, 1945944, 1951617 → `HEL-732`; 1802114 → `HEL-444`). Environmental, unrelated to
  this ticket, but they are why "already healthy, reusing" is dangerous here.
- `deriveAccentTextColor`'s integer-percent search making producibility structural rather than
  asserted is a genuinely good piece of design — it removes a whole class of future defect.
