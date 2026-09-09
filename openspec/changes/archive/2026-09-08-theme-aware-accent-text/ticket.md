# HEL-1048: Accent-as-text fails 4.5:1 and cannot be fixed theme-independently

## Description

Accent used as **normal text** fails the WCAG 4.5:1 floor. HEL-1046 fixed the focus ring (a 3:1 non-text obligation) with a single theme-independent derived colour and deliberately excluded the text case; HEL-1050 fixed border/shadow focus indicators. This ticket carries the text case, which cannot be solved the same way.

## The proof — stated correctly

A single colour clearing 4.5:1 in **both** themes would need luminance:

- **L ≤ 0.1479** — against the binding light surface `--app-surface-soft` `#efece6` (L=0.8405), the *darkest* light surface and therefore the hardest for dark text;
- **L ≥ 0.2523** — against the binding dark surface `--app-surface-strong` `#262320` (L=0.0172), the *lightest* dark surface and therefore the hardest for light text.

The window is **empty**, gap **0.1044**.

**This constrains luminance alone, so it rules out every colour — not "zero of eight presets."** A ninth preset cannot escape it either. That distinction is load-bearing: this ticket exists because the constraint is structural, not because the current palette happens to be unlucky. Any restatement that says "zero of eight" is wrong and must be corrected.

## Owner rulings (2026-09-09) — all three answered before implementation

Rendered contact sheets were put in front of the owner; the brand call was made against the renders, not against a contrast table.

1. **Shape: `text-only-token`.** A separate text token. `--app-accent` fills stay bright.
2. **Brand: `accept-hue-shift` on ALL EIGHT presets** — explicitly *not* deferring the four heavy ones. Full conformance now, including Orange `−31%` and Yellow `#856605`. A half-conforming palette was rejected outright: deferring four presets would reproduce the exact thing this ticket was pulled into v0.7 to prevent.
3. **Tinted surfaces: `fix-here`.** AC-1 must be honestly satisfiable within this ticket, not split out.

## Consequence the rulings create — accepted, but must be SHOWN

`text-only-token` combined with `accept-hue-shift` **sharpens** the link/button mismatch rather than avoiding it: on the login card, Yellow's **text** goes dark olive while the Yellow **button fill** stays bright yellow. This is a known, accepted consequence — but it is ours to render and put in the final-gate evidence, not to discover at the gate. **If it looks broken rather than merely different, say so plainly and escalate again.** The owner accepted a hue shift, not an incoherent card.

## Premise corrections (validated against `main` @ `a6bde0d3`)

Full record: `.concertino/runs/HEL-1048/evidence/premise-validation.md`. Verdict **minor-staleness**; every correction sharpens the ticket.

1. **Not light-only.** Dark theme also fails 4.5:1 for four presets against its lighter surfaces: Purple **3.95**, Red **4.15**, Blue **4.25**, Pink **4.43**. The original title and framing say "in light theme"; the acceptance criteria already say "both themes", so the AC is right and only the framing was wrong.
2. **"Create one" is not an empty-state link.** It is the login-page footer (`LoginPage.tsx:129` → `.auth-footer a`, `auth.css:207`), 14px semibold on an `.auth-card` backed by `--app-surface` `#fdfcfa`. At 14px semibold it is **normal** text under WCAG (large-text threshold is 18.66px bold / 24px regular), so 4.5:1 genuinely applies. Raw Orange there measures **2.73**.
3. **`buildAccentTokens` is at `appearance.ts:419`, not `:305`** (moved by HEL-1046 and HEL-1050). Signature is still `(hex: string)` — theme-unaware, as claimed. `applyAccentTokens` is at `:443`.
4. **42 accent-as-text sites, not 22**, across 24 files — plus **8** `color: var(--app-accent-strong)` sites across 6 files and at least one via the `--app-info` alias, none of which a `var(--app-accent)` pattern can see (design gate round 1). Sizing must still come from **rendered** instances: `/` and `/pipelines` render zero.

## Measured facts — re-derived from scratch, not inherited

**Minimum adjustment to clear 4.5:1 against every NEUTRAL surface in that theme:**

| | Purple | Red | Blue | Pink | Orange | Cyan | Green | Yellow |
|---|---|---|---|---|---|---|---|---|
| light (darken) | 16% | 19% | 20% | 21% | **31%** | 36% | 38% | 43% |
| dark (lighten) | 10% | 8% | 5% | 2% | 0% | 0% | 0% | 0% |

**Minimum adjustment to clear 4.5:1 against neutral AND accent-tinted surfaces:**

| | Purple | Red | Blue | Pink | Orange | Cyan | Green | Yellow |
|---|---|---|---|---|---|---|---|---|
| light | 23% | 25% | 26% | 27% | 35% | 39% | 41% | 45% |
| dark | **22%** | **22%** | **17%** | **18%** | 2% | 0% | 0% | 0% |

**Producibility.** Any proposed colour must be one `darkenTowardBlack` can actually **emit**. `#ae500f` was reported as Orange/light 30% and does clear at 4.5044 — but it is **not producible at any integer percent**; the real 30% output is `#ae510f` at **4.4711, which fails**. The correct minimum is **31% `#ac4f0f` (4.5911)**. This must be a guard assertion, not a habit.

## Acceptance criteria

- **AC-1** — Accent used as normal text clears **4.5:1** against every surface it renders on, in **both themes**, for **all 8 presets**, verified on the running app by computed style rather than by token names. This includes **accent-tinted** backgrounds, not only the five neutral surface tokens.
- **AC-2** — The login-footer "Create one" link specifically passes.
- **AC-3** — **No regression to HEL-1046's focus ring**, which is theme-independent by construction and must stay that way. `--app-focus-ring-color` must not become theme-aware.
- **AC-4** — Every surface accent text can land on is enumerated and scored, with its class stated: **neutral**, **accent-tinted**, or **user-chosen**. A site left unfixed is named with its reason and an owning ticket.
- **AC-5** — Proposed colours are producible by the derivation; asserted mechanically.

## Scope boundary — stated explicitly, not left implied

**User-chosen surfaces are outside this ticket.** A panel with a user-picked background (`--panel-surface-override`, tinted 0.24 at user-chosen alpha) cannot be guaranteed by any derived colour — the same structural impossibility, relocated from "two themes" to "any colour the user picks", and at the stricter 4.5:1 text floor. **HEL-1057 owns that**, filed specifically for it.

**Not HEL-1051.** The round-1 design gate established that HEL-1051 is *focus indicators at 3:1* and does not accept this deferral — a ticket about the same component is not automatically a ticket about the same obligation. This is the second such miss on this lane (HEL-1050 → HEL-1049 was the first, corrected by filing HEL-1052).

This ticket covers **theme-token-bound** and **accent-tinted** surfaces only, and says so rather than discovering the limit at the final gate.
