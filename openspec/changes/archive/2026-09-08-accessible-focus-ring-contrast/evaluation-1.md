## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit `abcbc2a9`, base `origin/main` @ `318af787`. Gates re-run by me from
`frontend/` (not the worktree root). Browser evidence self-authenticated
(`curl :6478/src/theme/theme.css` → `db6513` present; `location.href`
re-checked at every reading; theme allowed 5–6s to settle, accent read as the
live server preference, never the dead `#ea580c`).

### Phase 1: Spec Review — FAIL

Issues:

- **AC 1 ("Every `:focus-visible` element renders a focus indicator clearing
  3:1 … verified on the running app by computed style") is NOT met.** 15
  `:focus-visible` rules across 8 stylesheets hand-copy
  `outline: 2px solid var(--app-accent)` instead of consuming
  `--app-focus-ring`, so they are untouched by this diff and still paint the
  raw, undarkened accent. Measured live (light theme, Yellow accent, a
  genuinely `:focus-visible` element on the app's landing page):
  `.dashboard-list__item-row .actions-menu__trigger` painted
  `outline-color: rgb(234, 179, 8)` (`#eab308`, the raw accent — **not** the
  derived `#a88106`) against a painted background of `rgb(253, 252, 250)` —
  **contrast 1.87**. With the shipped default Orange the same site computes
  ~2.80. This is the ticket's headline defect, still live, on the Dashboards
  page. Details and the full site list in Change Request 1.
- Everything else in Phase 1 passes: the change is confined to the ring
  (no accent-as-text / "Create one" link touched → HEL-1048's scope intact,
  and HEL-1048 is confirmed live and open, Todo, v0.7); all 26 tasks are
  checked and match what was implemented; `files-modified.md` is accurate;
  DESIGN.md records the derivation, not just the token; spec deltas match.
- The dead per-theme `--app-accent`/`--app-accent-ink` defaults were
  documented rather than removed. That is acceptable — the "make the
  `theme.css:161-162` comment true" half of the AC is done, and removal is
  explicitly owned by HEL-1048 ("Correcting or removing them … belongs
  here"). Real deferral, real ticket.

### Phase 2: Code Review — PASS

Gates, all re-run by me:

| gate | where | result |
| -- | -- | -- |
| `npm run lint` | `frontend/` | clean, 0 warnings |
| `npm run format:check` | repo root | clean |
| `npm test` | `frontend/` | 292 suites / **2949 tests** passed |
| `npm run typecheck` | root → frontend tsc | clean |
| `npm --prefix frontend run build` | root | succeeded |
| `check:tokens` (HEL-1037) | root | OK |
| HEL-441 motion + HEL-442 elevation guards | `frontend/` | green (in the 8 `src/theme` suites) |
| `check:openspec` / `check:spec-structure` / `check:schemas` | root | clean |

Verification of the seven flagged design-gate defects — **all seven confirmed
by re-run mutation, not by reading the report**:

1. **Every surface, both blocks, minimum over all — CONFIRMED.**
   `FOCUS_RING_SURFACES` holds all 10 declarations (5 dark + 5 light).
   I mutated it down to the extremes `#121110`/`#ffffff` and re-ran: the
   guard went **RED** with exactly the ticket's predicted defect —
   `Orange 2.577, Pink 2.992, Cyan 2.578, Green 2.602, Yellow 2.591 < 3.0`.
   The shipped derivation does not do that, and the guard catches it if a
   future edit tries.
2. **TypeScript, never `color-mix` — CONFIRMED.** `deriveFocusRingColor`'s
   body is integer channel multiplication + `toHexColor`; zero `color-mix`
   inside `deriveFocusRingColor`. Result is an exact 8-bit hex.
3. **Guard re-derives the binding surfaces and is failable — CONFIRMED by
   three independent mutations, each verified as landed before running:**
   - static value → `#f97316`: **RED**, min contrast **2.377** (matches the
     executor's reported 2.38), 2 tests red.
   - static value → `#b45309` (a value that still clears 3:1): **RED** on the
     no-drift test alone — so the drift arm fails independently of contrast.
   - `theme.css` dark `--app-surface-strong` `#262320` → `#9a5a1f`: **RED**,
     3 tests, min contrast 1.526 — proving the guard genuinely re-parses
     `theme.css` rather than asserting a pinned pair.
   Worktree restored clean (`git status --porcelain` empty) after each.
4. **Static `:root` value — CONFIRMED.** `#db6513` ==
   `deriveFocusRingColor(DefaultAccentColorByTheme.dark)`, declared once at
   `:root`, never per theme; the no-drift test demonstrably fails (mutation 2).
5. **Threshold exactly `>= 3.0`** in both `appearance.ts`
   (`FOCUS_RING_CONTRAST_TARGET = 3.0`) and the guard — not padded.
6. **`--app-accent` unmodified** — the only `--app-accent` lines in the
   `theme.css` diff are comments; a test pins `buildAccentTokens(hex)["--app-accent"] === hex`
   for all 8 presets.
7. **HEL-1048 scope untouched** — diff touches only `theme.css`,
   `appearance.ts`, two test files and `DESIGN.md`; no link/empty-state
   component. HEL-1048 verified open in Linear.

Executor claim checks:
- **"Drove the real `AccentPicker` UI, not localStorage" — TRUE and
  reproduced.** I drove the same real controls (`button[aria-label="Yellow"]`,
  `Switch to light theme`) on `/settings`, reloaded, and the preference came
  back from the server: inline `<html>` style read
  `--app-accent: #eab308; --app-focus-ring-color: #a88106`. That is the real
  `applyAccentTokens` path.
- **Painted ring matches the derived token exactly — re-measured.** Dark /
  Orange, real `Tab` keypress, `:focus-visible` true: painted
  `outline-color: rgb(219, 101, 19)` = `#db6513`, contrast **4.960** against
  the actual painted background. Light / Yellow token resolved to `#a88106`
  as claimed. Both readings taken after a 5–6s settle, `location.href`
  re-checked.

Code quality: no FQN inlining, no dead code, no `any`, no over-engineering;
the guard states in-file what it proves and what it cannot (correctly naming
jsdom's computed-style blindness). No security or error-handling surface.
Nothing here blocks. One readability nit below.

### Phase 3: UI Review — FAIL

- Happy path works; login, dashboards, settings, accent + theme switching all
  functional. No new console errors (2 pre-existing, unrelated to this diff).
  Interactive elements have accessible names (the picker swatches are
  `aria-label`ed). Ring geometry (`2px`, `outline-offset: 2px`) unchanged.
- **FAIL for the reason in Phase 1:** measured, on the running app, by
  computed style, on a keyboard-`:focus-visible` element — contrast **1.87**.
  Evidence screenshot:
  `.concertino/runs/HEL-1046/evidence/eval-light-yellow-handcopied-accent-ring.png`.

**Two-axes answer.** *What no source text carries:* that the ring token is
not the app's only ring — DESIGN.md's amended §8 asserts "every component
references one token instead of hand-copying the literal", and 15 live rules
falsify that sentence the moment it was written. *What path the gates did not
exercise:* the 15 hand-copied sites. `check:tokens` is green because
`var(--app-accent)` **resolves** — it checks resolvability, not which token;
the new guard reads `theme.css` only; the browser evidence sampled elements
that consume `--app-focus-ring`. Every gate is green and the defect is
rendered on the landing page. That is the eighth false-passing assertion this
lane was warned to expect.

**Perceptibility (the design gate's own axis):** on token-consuming elements
the ring is visible, unclipped and in-viewport (verified geometrically:
ring rect vs every `overflow: hidden|clip` ancestor). The clipping hits I
found are all closed `.popover` subtrees, are identical on `main`, and are
untouched by this diff (which changes colour only, not width/offset) — noted,
not charged to this ticket.

**Cohesion capture (NOT ruled on — for the final gate / owner):** Yellow
derives to `#a88106`, a dark olive/gold at 28% darkening. On light surfaces
it reads as a muted bronze rather than the picker swatch's yellow; the ring
and the swatch the user chose are visibly different colours. Recorded, not
judged.

### Overall: FAIL

### Change Requests

1. **Repoint the 15 hand-copied `:focus-visible` outlines at the ring token.**
   These still paint `var(--app-accent)` and fail 3:1 in light theme,
   defeating AC 1 and contradicting the DESIGN.md §8 [mechanical] rule this
   diff itself amends. In each rule below, replace
   `outline: 2px solid var(--app-accent);` with
   `outline: var(--app-focus-ring);` — **keep each site's existing
   `outline-offset`**, which is legitimately per-component and not part of
   the token:
   - `frontend/src/features/dashboards/ui/DashboardList.css:292` (measured
     1.87 live), `:330`, `:488`, `:730`
   - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.css:57`, `:164`
   - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.sections.css:39`, `:128`, `:160`
   - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.binding.css:89`, `:116`, `:138`, `:314`
   - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.appearance.css:199`
   - `frontend/src/features/panels/ui/editors/TableDisplayFields.css:106`
   - `frontend/src/features/panels/ui/OutputPicker.css:74` — note this one is
     a state class (`.output-picker__card--focused`), not a `:focus-visible`
     rule. It is still a focus indicator; convert it too, or state in the
     diff why it is exempt.

2. **Add a [mechanical] guard that this cannot regress.** The existing guards
   all read `theme.css` only, so none of them can see a component stylesheet
   hand-copying the accent into an outline. Add an assertion (natural home:
   `focusRingTokenGuard.css.test.ts`, or `check:tokens`) that walks
   `frontend/src/**/*.css` and fails on any `outline` declaration whose colour
   is `var(--app-accent)`. Allow `App.css:43`'s `var(--app-text)` skip-link
   ring (deliberate, HEL-772, high contrast) via an explicit, commented
   exception. **Verify the guard is failable** by re-introducing one of the
   above sites and confirming it goes red.

3. **Re-measure at least two of the repointed sites in the running app** —
   one from `DashboardList.css` and one from a `PanelDetailModal` file — in
   light theme with an adversarial accent (Yellow), by computed style on a
   genuinely `:focus-visible` element after letting the theme settle. Record
   the painted `outline-color` and the ratio, not the token name.

4. **Correct DESIGN.md §8's factual claim.** The amended text states the
   token is referenced by "every component instead of hand-copying the
   literal". Once CR 1 lands that becomes true; if any site is deliberately
   exempted, say so explicitly there rather than leaving the sentence
   overstated.

### Non-blocking Suggestions

- `appearance.test.ts` — the "clears 3:1 … for all 8 accent presets" test
  destructures `label` only to discard it with `void label;`, under a comment
  claiming it "pins the concrete values" (the pinning is actually done by the
  next test). Drop `label` from the destructuring and the stale comment, or
  use `label` in the assertion message.
- `appearance.ts`'s `FOCUS_RING_SURFACES` carries a prose SYNC OBLIGATION to
  `theme.css`. The guard does make drift fail loudly (mutation 3 above proves
  it), so this is safe — but parsing the list once at build time, or asserting
  set equality between the two lists in the guard, would remove the duplicated
  literal entirely.
