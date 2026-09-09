# Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold spawn. HEAD `4d030003`, base `main` @ `fcce99b1`. Every conclusion below is
from a command I ran or a screenshot I looked at.

## What I verified (with evidence)

### 1. The round-1 fix closes the hole rather than relocating it — measured live

Served build confirmed to be *this* worktree before any judgement:
`/proc/2548822/cwd -> .../HEL-1048/frontend`, `/proc/2548560/cwd -> .../HEL-1048/backend`.
Vite serves from disk, and the served CSS carries the fix:
`curl http://localhost:6480/src/shared/chrome/SidebarBody.css?direct` → `color: var(--app-accent-text)`
at both `:46` and `:65`; `AddSourceModal.css?direct` → `--app-accent-text` at `:94`/`:104`,
no `--app-accent-strong` as text anywhere.

Driven through the real `AccentPicker` (Yellow), real Add-source modal, computed
style + full ancestor alpha compositing (including `color(srgb …/0.2)`, which a naive
`rgba()` parser silently misses and reports as pure white):

| theme | `--app-accent-text` | `.add-source-modal__type-btn--active` bg (composited) | ratio |
|---|---|---|---|
| light | `#7c5f04` | `rgb(251,240,206)` | **5.270** |
| dark  | `#eab308` | (dark tint) | **5.310** |

Pre-fix this site measured **2.876** (round 1). A whole-document sweep of every
visible element whose computed `color` equals `--app-accent-text` returned **0 failures
below 4.5:1** in both themes. Screenshots:
`skeptic2-addsource-light-yellow.png`, `skeptic2-addsource-dark-yellow.png` — the active
pill reads as a deliberate selected state in both themes, clearly distinct from its
inactive siblings; no light/dark divergence.

### 2. The `SidebarBody` hover affordance is real, not a no-op

The colour delta is gone; `text-decoration-thickness: 2px` is the sole hover signal on an
already-underlined 12px link. Rendered both states side by side against the real stylesheet
and looked at them: `skeptic2-sidebar-link-hover-dark.png`. Base resolves to
`text-decoration-thickness: auto` (~1px at 12px); hover is 2px — a visibly heavier underline,
plus `cursor: pointer`. `DESIGN.md` imposes no colour-change requirement on hover
(grep of all 20 `hover` mentions). Adequate affordance.

### 3. The guard is non-vacuous *without* its allowlist — proved by mutation

`expect(found).toEqual([])` passes trivially if the closure builder breaks, so I mutated:
`SidebarBody.css:65` `--app-accent-text` → `--app-accent-strong`. Result: **RED**, for
exactly the stated reason —
`+ {"file": "shared/chrome/SidebarBody.css", "line": 65, "prop": "--app-accent-strong"}`
at `accentTextClosureGuard.css.test.ts:127`. File restored; `git status --porcelain` clean.
(First mutation attempt hit line 62, which is now a comment line and changed nothing — the
test stayed green, correctly. Reproduced on the real declaration before concluding.)

I also checked for accent-as-text the guard's regex *cannot* see: `color: color-mix(… --app-accent …)`
in CSS → **0 hits**; any `color:` line mentioning accent outside `-text`/`-ink` → **0 hits**;
inline `color` styles referencing `--app-accent` in `.tsx` → **0 hits**. No blind spot found.

The guard scans `frontend/src` only (`SRC_ROOT = __dirname/..`), so the stale
`frontend/dist` artefact that produces a phantom "3" cannot reach it.

### 4. Collateral: the three `tokenAuditSweep` line bumps are mechanical

Ran the test's own `SPACING_PATTERN` over `AddSourceModal.css` on `main` and on HEAD:

```
main: 6, 46, 53, 58, 124, 131, 149, 240
HEAD: 6, 46, 53, 58, 133, 140, 158, 249
```

Identical multiset, uniform +9 below the comment insertion; 131→140, 149→158, 240→249 all
carry byte-identical content (`padding: 4px 4px;` / `padding: 4px 6px;` / `padding: 2px;`).
58 and 133 are excluded by `spacingIsDisallowed` (they contain `var(--space`), which is why
they are not baseline entries. Nothing added, nothing silently removed — and the suite's
"baseline isn't stale" arm would fail if an entry had been dropped rather than moved.

### 5. Hunted the seventh true-conclusion-on-absent-support defect — did not find one

I attacked the two load-bearing new figures rather than accepting them:

- **`AddSourceModal` comment, "Orange (the shipped default) at 3.28:1".** Re-derived from
  scratch (light `--app-accent-strong` = `color-mix(accent 76%, black)`, 20% accent tint over
  each neutral surface, all eight `ACCENT_PRESETS`). Orange over the *white* tint is 3.757 —
  but over the `--app-surface-soft` tint it is **3.265 ≈ 3.28**, and the worst case is the
  correct standard. Yellow reproduces round 1's **2.876** exactly, which validates my method.
  "All eight fail there" is also true on the worst-case background (2.504–4.192); Red/Blue/Purple
  pass only on the white tint. The figures are sound and the quantifier is honest.
- **`AddSourceModal` comment, "the 20% tint is in D2's scored set as a background".**
  Confirmed at source: `ACCENT_TEXT_INLINE_TINT_STRENGTHS = [0.22, 0.2]`, blended over each of
  the five neutral surfaces in `accentTextBackgrounds`. So the repoint inherits a real
  by-construction guarantee, not a restated one.
- **`SidebarBody` comment's D8 figures** are the neutral-surface figures, and that link sits on
  a neutral surface (`.sidebar-body__locked-notice` sets no background). Correctly applied.

### 6. Gates, re-run by me

`npx jest` (frontend, the suite that actually scans anything): **297 suites / 3123 tests, all
passing** — matching the stated baseline, with the removed allowlist test accounted for.
`npm run typecheck` and `npm run lint --max-warnings=0`: clean. Browser console: **0 errors**.

### 7. Acceptance criteria

- **AC-1** — closure is empty with zero carve-outs (mutation-proved), and the live sweep shows
  no rendered accent-text below 4.5:1 in either theme. Satisfied for every class in scope.
- **AC-2** — settled input (6.367/7.238), not re-derived.
- **AC-3** — no change to `--app-focus-ring-color` in the diff.
- **AC-4** — every class enumerated; the one deferred class (user-chosen panel surfaces) is owned
  by HEL-1057, verified in round 1 as owning the *obligation*.
- **AC-5** — producibility asserted mechanically (settled).

## Verdict: CONFIRM

The round-1 REFUTE was a real WCAG failure and it is genuinely fixed, not relocated: measured
5.270 (light) and 5.310 (dark) where it measured 2.876 before. The guard that would catch a
regression fails when it should. The collateral baseline bumps hide nothing. Nothing I probed
turned up a seventh unsupported claim.

## Non-blocking notes

- `accentTextClosureGuard.css.test.ts`, file header (~line 11): still says the guard proves every
  such declaration "is one of the two named, deliberate exceptions (design.md D8)". The
  allowlist was removed 90 lines below; the header is now stale in the opposite direction. Worth
  one line the next time the file is touched.
- `design.md` D8 and the commit message both say `SidebarBody.css`'s hover is "current: `:62`";
  after the comment grew it is `:65`. Harmless — D8 explicitly states the closure is authoritative
  over any restated line number — but the restated number is wrong.
- The `SidebarBody` hover is now thickness-only. Verified perceptible, but it is the weakest hover
  in that region; if it ever reads flat in use, a `--app-surface-raised` wash would restore
  separation without needing its own contrast guarantee.
