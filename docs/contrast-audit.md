# Color-contrast audit (HEL-533)

This table is the committed record of `frontend/src/theme/theme.css`'s
text-on-surface contrast audit. **Evaluator CR1 (cycle 2) correction:** an
earlier version of this file claimed these numbers "cannot silently drift
from the guard" because both are "generated" from the same logic — that
claim was false as written: no emitter exists, the numbers below were
hand-transcribed, and four blocks were already wrong at commit time. The
honest status is: **transcribed by hand from the same parse-and-compute
logic `tokenContrastGuard.css.test.ts` uses**, re-verified against
`theme.css` as of this file's own commit. It CAN drift if a future token
edit changes `theme.css` without this file being regenerated — the guard
will still catch the regression (that's its job), but this table's numbers
will go stale silently until someone re-runs the reproduction below and
updates it by hand.

**How to regenerate.** Add a temporary `it(...)` block **inside
`tokenContrastGuard.css.test.ts` itself** — `assertedMatrix`/
`crossIntentCells`/`tintComposites` are module-private (not exported), so
only a block written in that same file can call them; a sibling
`*.test.ts` file cannot import them. Have the temporary block call those
helpers for both themes and `console.log` the results, run it with
`npx jest tokenContrastGuard.css.test.ts -t <name>`, transcribe the printed
ratios into the tables below, then delete the temporary block. This is
exactly how the corrected numbers in this revision were produced (verified
against a live `--runTestsByPath` run, not computed separately by hand).

**Scope boundary (design.md D9).** The audited backdrop set is the five
neutral surface tokens (`--app-bg`, `--app-surface`, `--app-surface-soft`,
`--app-surface-raised`, `--app-surface-strong`) plus the three intent tints
(`--app-success-surface`, `--app-warning-surface`, `--app-error-surface`),
each resolved as a `color-mix(..., transparent)` composite over every neutral
parent it can sit on. Accent-derived backdrops (`--app-accent-surface`,
`--app-accent-dim`, `--app-accent-mid`, `--app-bg-accent`,
`--app-bg-secondary`) are **excluded** from this audit's guard: per C1,
`applyAccentTokens` writes the accent tokens as inline style on `<html>` at
runtime, so `theme.css`'s declared accent values never render and a
source-parsed guard cannot score them. The accent-text-on-accent-tint case
that matters most is already covered for all 8 presets by
`accentTextSourceSyncGuard.css.test.ts`. The residual — non-accent
foregrounds on accent tints, and all foregrounds on `--app-accent-mid`
(measured 3.17–3.63:1 for the default light accent) — is real and
**unguarded by this change**, recorded honestly in the residual section
below rather than hidden. `--app-bg-accent`/`--app-bg-secondary` have zero
background call sites. `--app-text` on every tint in both themes measures
well above AA (worst 10.57:1 pre-edit) and carries no obligation.

## 1. Neutral-surface pairs (both themes, post-remediation)

Threshold: 4.5:1 (normal-size text).

### Light theme

| foreground                   | `--app-bg` | `--app-surface` | `--app-surface-soft` | `--app-surface-raised` | `--app-surface-strong` |
| ---------------------------- | ---------- | --------------- | -------------------- | ---------------------- | ---------------------- |
| `--app-text` `#211d19`       | 14.96      | 16.33           | 14.20                | 16.74                  | 16.74                  |
| `--app-text-muted` `#645e56` | 5.73       | 6.25            | 5.43                 | 6.41                   | 6.41                   |
| `--app-success` `#166d43`    | 5.68       | 6.20            | 5.39                 | 6.36                   | 6.36                   |
| `--app-warning` `#85551a`    | 5.67       | 6.18            | 5.38                 | 6.34                   | 6.34                   |
| `--app-error` `#af3325`      | 5.65       | 6.16            | 5.36                 | 6.32                   | 6.32                   |

All PASS at >= 4.5:1.

### Dark theme

| foreground                   | `--app-bg` | `--app-surface` | `--app-surface-soft` | `--app-surface-raised` | `--app-surface-strong` |
| ---------------------------- | ---------- | --------------- | -------------------- | ---------------------- | ---------------------- |
| `--app-text` `#f2efe9`       | 16.44      | 15.43           | 15.89                | 14.16                  | 13.62                  |
| `--app-text-muted` `#aaa49c` | 7.63       | 7.17            | 7.38                 | 6.58                   | 6.33                   |
| `--app-success` `#4cc38a`    | 8.51       | 7.99            | 8.23                 | 7.34                   | 7.06                   |
| `--app-warning` `#f5b944`    | 10.69      | 10.04           | 10.34                | 9.21                   | 8.86                   |
| `--app-error` `#f17b67`      | 6.98       | 6.55            | 6.75                 | 6.01                   | 5.78                   |

All PASS at >= 4.5:1 (dark's neutral-surface pairs were already clean before
this change and remain so — `--app-error` was untouched here; its edit below
was driven by the tint-composite check, not this table).

## 2. Intent-tint composites — the intent token on its own `-surface` tint

Threshold: 4.5:1 (confirmed rendering as normal-size text — see "Rendered
confirmation" below). Each row is `<intent> on <intent>-surface, composited
over <parent>`.

### Light theme (before -> after this change's remediation)

| pair                                             | parent                           | before   | after |
| ------------------------------------------------ | -------------------------------- | -------- | ----- |
| `--app-success` on `--app-success-surface` (11%) | `--app-bg`                       | 3.89     | 4.87  |
| `--app-success` on `--app-success-surface` (11%) | `--app-surface`                  | 4.23     | 5.29  |
| `--app-success` on `--app-success-surface` (11%) | `--app-surface-soft`             | **3.71** | 4.63  |
| `--app-success` on `--app-success-surface` (11%) | `--app-surface-raised`/`-strong` | 4.33     | 5.41  |
| `--app-warning` on `--app-warning-surface` (11%) | `--app-bg`                       | 3.97     | 4.87  |
| `--app-warning` on `--app-warning-surface` (11%) | `--app-surface`                  | 4.31     | 5.29  |
| `--app-warning` on `--app-warning-surface` (11%) | `--app-surface-soft`             | **3.78** | 4.64  |
| `--app-warning` on `--app-warning-surface` (11%) | `--app-surface-raised`/`-strong` | 4.41     | 5.42  |
| `--app-error` on `--app-error-surface` (10%)     | `--app-bg`                       | 4.01     | 4.86  |
| `--app-error` on `--app-error-surface` (10%)     | `--app-surface`                  | 4.36     | 5.28  |
| `--app-error` on `--app-error-surface` (10%)     | `--app-surface-soft`             | **3.82** | 4.62  |
| `--app-error` on `--app-error-surface` (10%)     | `--app-surface-raised`/`-strong` | 4.46     | 5.41  |

All PASS at >= 4.5:1 after remediation. Bold "before" figures are the
worst-case backdrop that sized each token's correction (design.md D4).

### Dark theme

| pair                                             | parent                             | before    | after                      |
| ------------------------------------------------ | ---------------------------------- | --------- | -------------------------- |
| `--app-success` on `--app-success-surface` (14%) | `--app-bg`..`--app-surface-strong` | 5.45-6.79 | unchanged (already >= 4.5) |
| `--app-warning` on `--app-warning-surface` (14%) | `--app-bg`..`--app-surface-strong` | 6.50-8.17 | unchanged (already >= 4.5) |
| `--app-error` on `--app-error-surface` (14%)     | `--app-bg`                         | 5.53      | 5.74                       |
| `--app-error` on `--app-error-surface` (14%)     | `--app-surface`                    | 5.10      | 5.30                       |
| `--app-error` on `--app-error-surface` (14%)     | `--app-surface-soft`               | 5.29      | 5.50                       |
| `--app-error` on `--app-error-surface` (14%)     | `--app-surface-raised`             | 4.64      | 4.81                       |
| `--app-error` on `--app-error-surface` (14%)     | `--app-surface-strong`             | **4.46**  | 4.63                       |

`--app-success`/`--app-warning` in dark were genuinely clean and untouched.
`--app-error` was **not** — design.md's Non-Goals stated the dark intent
tokens "measure comfortably above AA on every in-scope backdrop" and held
them fixed; re-measuring against this change's own tint-composite backdrop
(D9) found that premise false for `--app-error` alone: 4.46:1 on
`--app-error-surface` over `--app-surface-strong`, confirmed rendering as
normal-size text (see below). Corrected with a 4% lighten (`#f07561` ->
`#f17b67`); every other dark pair was already compliant and is listed
unchanged.

## 3. `--app-text-muted` on intent tints (design.md D8)

Threshold: 4.5:1. `--app-text-muted` was darkened/lightened for exactly this
obligation (D8) — it is not only a neutral-surface token.

### Light theme (before -> after)

| parent                           | success-tint     | warning-tint     | error-tint       |
| -------------------------------- | ---------------- | ---------------- | ---------------- |
| `--app-bg`                       | 4.47 -> 4.90     | 4.48 -> 4.92     | 4.47 -> 4.93     |
| `--app-surface`                  | 4.85 -> 5.33     | 4.86 -> 5.34     | 4.85 -> 5.35     |
| `--app-surface-soft`             | **4.25** -> 4.67 | **4.27** -> 4.69 | **4.25** -> 4.69 |
| `--app-surface-raised`/`-strong` | 4.96 -> 5.45     | 4.98 -> 5.47     | 4.97 -> 5.48     |

### Dark theme (before -> after)

| parent                 | success-tint | warning-tint     | error-tint   |
| ---------------------- | ------------ | ---------------- | ------------ |
| `--app-bg`             | 5.01 -> 6.09 | 4.80 -> 5.83     | 5.21 -> 6.28 |
| `--app-surface`        | 4.62 -> 5.61 | 4.40 -> 5.35     | 4.81 -> 5.80 |
| `--app-surface-soft`   | 4.79 -> 5.82 | 4.58 -> 5.56     | 4.99 -> 6.01 |
| `--app-surface-raised` | 4.19 -> 5.10 | 3.98 -> 4.84     | 4.38 -> 5.27 |
| `--app-surface-strong` | 4.03 -> 4.89 | **3.82** -> 4.64 | 4.20 -> 5.06 |

All PASS after remediation. Bold figures were the worst-case backdrops.

`Toggle.css:53` uses `--app-text-muted` as a **background** (the toggle
thumb, a 3:1 UI-boundary role against `--app-surface-soft`, not a 4.5:1 text
role): 4.87 -> 5.43 (light), 6.08 -> 7.38 (dark). Both moved further from
their parent surface, improving separation as expected.

## 4. Cross-intent cells (design.md D10 — recorded, not remediated)

An intent token rendered on a **different** intent's tint (e.g.
`--app-error` on `--app-warning-surface`). No rendered instance of this
composition was found anywhere in the app — every cross-intent cell resolves
as "never renders" (see the enumeration below) and is therefore a documented
exception, not a defect. Light theme's cross-intent cells all clear 4.5:1
incidentally, as a side effect of darkening the intent tokens for section 2;
they were never a target.

### Dark theme (cells that measure below 4.5:1 post-remediation; all documented exceptions)

**Evaluator CR1 (cycle 2) correction:** the previous revision of this table
listed pre-remediation values (`4.45 / 4.27 / 4.22 / 4.05`) under this
"below 4.5:1" heading, presented as current. The post-change actuals are
below. All three residual cells _improved_ as a side effect of darkening
`--app-error` (the tint moves with its token) — the fourth cell from the
prior table, `--app-error` on `--app-success-surface` over
`--app-surface-raised`, now measures **4.66** and no longer belongs in a
sub-4.5 table at all; it is omitted here and PASSes with no exception
needed.

| pair                                           | parent                 | ratio (post-change) |
| ---------------------------------------------- | ---------------------- | ------------------- |
| `--app-error` on `--app-success-surface` (14%) | `--app-surface-strong` | 4.47                |
| `--app-error` on `--app-warning-surface` (14%) | `--app-surface-raised` | 4.42                |
| `--app-error` on `--app-warning-surface` (14%) | `--app-surface-strong` | 4.24                |

**Documented exception — never renders.** Enumeration performed: a
Playwright probe (`chromium`, both themes) registered a user, visited `/`,
`/settings`, `/settings/security`, `/settings/api-tokens`, `/pipelines`,
`/sources`, `/connectors`, and evaluated every element whose computed
`color` resolves to `--app-success`, `--app-warning`, or `--app-error`
against every element whose resolved painted ancestor-chain backdrop
composites to a DIFFERENT intent's tint. Zero matches in either theme — no
component in this tree pairs one intent's text color with a different
intent's tint background. Source enumeration (all `.css` files under
`frontend/src` matching `--app-(success|warning|error)-surface`) confirms
every declared `background: var(--app-*-surface)` rule is paired with
`color: var(--app-*)` of the SAME intent at its own selector — see
`shared/chrome/StatusMessage.css:16-17`,
`features/settings/ui/ApiTokensSection.css:31-32`,
`features/settings/ui/AgentMemoryList.css:34,121`,
`features/settings/ui/MfaSecuritySection.css:31,96`,
`features/pipelines/ui/schedule/PipelineScheduleDialog.css:130`,
`features/panels/ui/grid/PanelGrid.css:151,206`,
`features/assistant/ui/ToolCallIndicator.css:71,84`,
`features/assistant/ui/MessageTurn.css:45`,
`features/pipelines/ui/RunHistoryModal.css:73,92`,
`features/auth/ui/UserMenu.css:136`,
`features/dashboards/ui/DashboardList.css:445`. No cross-intent pairing
exists in the design language today; if one is introduced, this table and
`tokenContrastGuard.css.test.ts`'s "cross-intent cells are recorded, not
asserted" describe block both need re-evaluation.

## 5. Rendered confirmation (design.md D4)

Every intent-on-own-tint pair in section 2 and every muted-on-tint pair in
section 3 is confirmed rendering as **normal-size text**: every CSS site
listed above declares `font-size: var(--text-xs)` (12px), `var(--text-sm)`
(14px), or `var(--text-micro)` (10px) — all well under the 18.66px (or
24px/non-bold) large-text threshold, regardless of `font-weight`. Live
confirmation: a fresh Playwright run submitted an invalid login at `/login`
and read `.auth-error`'s computed style — `color: rgb(240, 117, 97)`
(`--app-error`, dark theme, pre-edit value), `background-color: color(srgb
0.941176 0.458824 0.380392 / 0.14)` (the `--app-error-surface` 14% tint),
`font-size: 14px`, `font-weight: 400` — confirming the pair renders as
normal-size text on its own tint. Non-blocking correction (evaluator cycle
2): this instance's resolved backdrop is the tint over `--app-surface`
(5.30), not over `--app-surface-strong` (the 4.46 pre-edit row that
actually drove the token change) — the correction was sized against the
worst parent the tint can composite over, not against this specific
instance's parent, and it is that worst-parent sizing that is load-bearing.

## 6. `--app-accent-ink` contrast floor (design.md D6, AC3)

Threshold: 4.5:1, `--app-accent-ink` against `--app-accent` for each shipped
preset. `buildAccentTokens` picks `max(contrast(#181511, accent),
contrast(#fdfcfa, accent))` with no floor; this table (and
`tokenContrastGuard.css.test.ts`) assert the max it picks clears AA.

| preset | accent    | selected ink     | ratio | verdict |
| ------ | --------- | ---------------- | ----- | ------- |
| Orange | `#f97316` | `#181511` (dark) | 6.49  | PASS    |
| Red    | `#ef4444` | `#181511` (dark) | 4.83  | PASS    |
| Pink   | `#ec4899` | `#181511` (dark) | 5.16  | PASS    |
| Purple | `#a855f7` | `#181511` (dark) | 4.60  | PASS    |
| Blue   | `#3b82f6` | `#181511` (dark) | 4.95  | PASS    |
| Cyan   | `#06b6d4` | `#181511` (dark) | 7.49  | PASS    |
| Green  | `#22c55e` | `#181511` (dark) | 7.98  | PASS    |
| Yellow | `#eab308` | `#181511` (dark) | 9.49  | PASS    |

All 8 shipped presets clear the floor today — no preset falls in the "both
candidates fail" gap. This is a genuine finding (not a foregone conclusion):
the guard's mutation arm confirms a preset that WOULD fall in that gap
(`#7a7a7a`, the searched worst-case mid-gray, scores 4.24 against its better
candidate) is caught.

## 7. Accent-on-surface shortfall (design.md D5 — measured and documented, not fixed)

Threshold: 4.5:1, raw `--app-accent` (not the derived `--app-accent-ink` or
`--app-accent-text`) against the five neutral surfaces, per theme, per
preset. **AC3 asks for verification, not remediation** — see design.md D5:
changing rendered brand colour is an owner-level visual-identity decision
(the same call HEL-1048 required sign-off for), not something an
accessibility-audit ticket should ride in on.

| preset | accent    | light min ratio | dark min ratio | verdict        |
| ------ | --------- | --------------- | -------------- | -------------- |
| Orange | `#f97316` | 2.38            | 5.58           | light **FAIL** |
| Red    | `#ef4444` | 3.19            | 4.15           | both **FAIL**  |
| Pink   | `#ec4899` | 2.99            | 4.43           | both **FAIL**  |
| Purple | `#a855f7` | 3.36            | 3.95           | both **FAIL**  |
| Blue   | `#3b82f6` | 3.12            | 4.25           | both **FAIL**  |
| Cyan   | `#06b6d4` | 2.06            | 6.44           | light **FAIL** |
| Green  | `#22c55e` | 1.93            | 6.86           | light **FAIL** |
| Yellow | `#eab308` | 1.63            | 8.15           | light **FAIL** |

This is a real, pre-existing, app-wide shortfall — `DESIGN.md:150-190`
already records it for the bottom-nav lozenge specifically ("a pre-existing
1.78-3.71:1 shortfall for several presets... tracked as a spinoff", with no
ticket identifier attached at the time), and this table extends that same
measurement to the raw accent against all five neutral surfaces in both
themes.

**Tracking status: tracked as HEL-1061** ("Light-theme accent-on-surface
fails WCAG 3:1 across all neutral surfaces for the default accent"). D5's
honesty requirement — either cite a real filed ticket or say plainly that
the shortfall is untracked — is now satisfied by the former.

## 8. Documented exceptions (summary)

| exception                                                                                                                    | reason                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dark-theme cross-intent cells (section 4)                                                                                    | Never renders — no component pairs one intent's text with a different intent's tint. Enumerated above.                                                                                                      |
| Accent-on-surface shortfall (section 7)                                                                                      | Verified and documented per AC3/D5, not remediated — an owner-level visual-identity decision, tracked as HEL-1061 (see above).                                                                              |
| Non-accent foregrounds on accent tints, and all foregrounds on `--app-accent-mid` (3.17-3.63:1 for the default light accent) | Out of this audit's scope (D9) — accent-derived backdrops are runtime-computed (C1) and cannot be scored by a source-parsed guard. `--app-accent-mid` in particular is unguarded by any existing mechanism. |

## 9. Guard

`frontend/src/theme/tokenContrastGuard.css.test.ts` runs inside the existing
`frontend` CI job's `npm test` (no new script, husky line, or CI job). It
parses `theme.css` directly, asserts a non-empty parsed surface/foreground/
tint set (vacuity refusal), asserts every pair in sections 1-3 above clears
4.5:1 in both themes, asserts the section 6 accent-ink floor across all 8
presets, and carries mutation arms proving each assertion is failable.
