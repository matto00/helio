# HEL-1037: Mechanical guard — every var(--*) reference must resolve to a defined token

## Description

An undefined CSS custom property **fails open**. `var(--does-not-exist)` silently falls back to the inherited or initial value, so the element renders — just wrong. Nothing in this repo catches it: not ESLint, not `tsc`, not Prettier, not any unit test.

Found during HEL-451's evaluation: `var(--weight-normal)` was used where `theme.css` defines `--weight-regular`. The typo'd token fell back and rendered per-column filter inputs at computed weight **600** instead of 400 — a visible design-system violation that passed every gate.

Parent: HEL-346 (Design-System Hardening). This is the cheapest possible guard for that failure class.

## Measured scope (re-measured independently against `origin/main` @ `3a0c0fe8`)

* **81** unique token names defined in `frontend/src/theme/theme.css` (83 across all `frontend/src` CSS — two are defined outside `theme.css`).
* **89** unique `var(--*)` references across `frontend/src/**/*.css` pre-strip; **88** post-strip
  (the difference is exactly `--app-top-chrome-`, the comment artifact described below). Quote the
  precondition with either number.
* **8** genuinely unresolved references = **3 real defects** + **5 runtime-injected**.
* The 3 defects, at exactly these counts:
  * `var(--radius-sm)` ×2 — `features/pipelines/ui/PipelineDetailPage.css`
  * `var(--text-small)` ×1 — `features/pipelines/ui/PipelineDetailPage.css`
  * `var(--space-sm)` ×1 — `features/sources/ui/AddSourceModal.css`
* The 5 runtime-injected, each with its verified setter:
  * `--dashboard-background-override` — `app/App.tsx`
  * `--dashboard-grid-background-override` — `features/panels/ui/PanelList.tsx`
  * `--panel-surface-override` — `features/panels/ui/PanelCard.tsx`
  * `--panel-text-override` — `features/panels/ui/PanelCard.tsx`
  * `--mobile-panel-height` — `features/panels/ui/grid/MobilePanelStack.tsx:104` (inline `CSSProperties`)

## Scope

1. A check that every `var(--*)` reference under `frontend/src` resolves to a definition in `theme.css` (or another declared token source).
2. **Strip CSS comments before extracting references.** Required, not optional — see below.
3. An explicit allowlist for the runtime-injected tokens, each entry **naming its setter**, not merely asserting a reason.
4. Wire into the pre-commit hooks and CI alongside the other `check:*` scripts.
5. Fix the 3 known defects in the same change.

## Acceptance criteria

* The guard **fails** on a newly introduced undefined token reference, **demonstrated by mutation** — add a bogus `var(--nope)`, watch it go red, remove it.
* The guard passes on `main` **only once comment-stripping exists** — fixing the 3 defects alone leaves it red.
* A `var()` embedded in a CSS comment does **not** trip it, demonstrated against `shared/chrome/MobileNavSheet.css:54-55` specifically.
* Each allowlist entry names the file that sets the token at runtime.
* The check runs in CI, not only locally.

## Why comment-stripping is a design driver, not a nicety

A naive extraction reports **9** unresolved references. The ninth, `--app-top-chrome-`, is a **false positive**: `shared/chrome/MobileNavSheet.css:54-55` contains a comment whose text wraps mid-token —

```
 * entirely from the wrapper's anchor. Repeating `top: var(--app-top-chrome-
 * -height)` here would be a RELATIVE offset ...
```

The real token `--app-top-chrome-height` is defined in `theme.css` and used correctly at `App.css:60`, `MobileNavSheet.css:12`, `:44`, `:69`.

Without comment-stripping the guard is **red on `main` from its first run, against a correctly-defined token**. A guard that cries wolf on day one is a guard someone disables — a worse outcome than never building it.

## Out of scope

* HEL-830's 119 off-scale spacing literals, HEL-680, HEL-732. This is a **guard**, not a token cleanup.
* Any token rename or consolidation beyond the 3 defects above.
