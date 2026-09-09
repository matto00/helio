## Why

DESIGN.md §8 promises keyboard operability, but the app has never had an app-wide pass proving it. Three
adjacent tickets fixed the focus ring's *colour* (HEL-1022/1046/1050) and built rendered contrast machinery
(HEL-866); none established that the ring is *present* on every interactive element, that every dialog
restores focus to its trigger, or that the primary flows are completable by keyboard at all.

The measurement gap is concrete. `e2e/support/stateContrast.mjs`'s `classifyState` deliberately returns
`"advisory"` — not `fail` — whenever a state change is conveyed only by outline/border/box-shadow, explicitly
deferring that adjudication. That is precisely the channel a focus ring uses, so the *focus* state of every
interactive element in the app is currently measured only for "something changed", never for "a perceivable
indicator appeared". Eleven live `outline: none` / `outline: 0` declarations across eight stylesheets sit
underneath that advisory verdict. Source-level conformance for those IS already guarded (two guards in
`focusRingTokenGuard.css.test.ts`); what is not is whether any of them actually PAINTS a perceivable
indicator, or how it measures against the backdrop actually composited at paint time.

## What Changes

- Adjudicate the focus channel `classifyState` currently defers: extend the shared state-contrast core so a
  focus indicator conveyed by outline/border/box-shadow is measured against the non-text floor rather than
  waved through as advisory. Reuse the existing backdrop-resolution and compositing core; do not build a
  parallel mechanism.
- Add a rendered, CI-gated keyboard guard under `e2e/` that walks the running app and fails on any focusable
  element whose focus state produces no perceivable indicator — including indicators suppressed, clipped, or
  occluded, which no DOM or jsdom assertion can see.
- Measure each of the eleven `outline` suppression sites in the running app and fix any whose indicator does
  not actually paint perceivably; name any deliberately-unfixed site with its reason and an owning item. Sites
  already pinned and owned elsewhere (`BORDER_INDICATOR_PINS`) are out of scope by construction. **Finding
  nothing to fix here is an acceptable, reportable outcome** — the deliverable is the measurement.
- Audit the dialog/overlay surfaces **not** built on the shared `Modal` for trap, restore-on-close, and
  Escape; fix the gaps. The shared `Modal` already implements all three (HEL-590/HEL-716).
- Prove the panel-create, appearance-edit, dashboard-switch and detail-modal flows completable with real Tab
  and Enter keypresses in the running app.
- Close the shared `Modal`'s Jest/RTL restore-on-close gap; its trap is already covered.
- Prove every new guard red against the pre-fix tree via the repo's existing `*.regression.spec.ts` harness
  pattern.

## Capabilities

### New Capabilities

_(none — see "Scope amendment" below)_

### Modified Capabilities

- `accessible-focus-indicator`: its existing "unconditional suppression is not a focus state" requirement is
  currently unenforced for the outline/border/shadow channel. Adds the obligation that the indicator's
  *presence* is verified by rendered measurement, and that clipping counts as absence.

## Scope amendment (cycle 3, orchestrator decision)

AC1 (dialog focus lifecycle) and AC3 (keyboard-only flow operability) were dropped from this change mid-
execution and split into follow-up tickets — **HEL-1062** (dialog focus lifecycle, AC1) and **HEL-1063**
(keyboard-only flow operability, AC3, which also owns this sweep's unmeasured surfaces) — which will carry
their own `dialog-focus-lifecycle` and `keyboard-flow-operability` capability deltas. Neither delta is implemented by this change's code, so neither
ships here (evaluation-1.md CR2) — this change's only capability delta is `accessible-focus-indicator`, whose
requirements this change's code actually implements.

## Impact

`e2e/support/stateContrast.mjs` (+ its selftest), `e2e/support/stateContrastProbe.ts`, new `e2e/` specs and a
`*.regression.spec.ts` proof harness, `frontend/src/shared/ui/Modal.test.tsx`, the eight stylesheets carrying
`outline` suppressions, and the non-shared-`Modal` overlay surfaces. No backend, schema, or API change. CI's
existing `e2e` job picks up new specs by glob — no `.husky` or gate-chain change is anticipated.

## Non-goals

- ARIA role/label coverage and screen-reader copywriting (separate ticket, same epic).
- Re-deriving the focus ring's colour — HEL-1022/1046/1050 own that and it is already enforced.
- Adding a skip-to-content affordance: one already exists (`App.tsx`, HEL-772).
- Roving-tabindex retrofits where no cluster warrants one; applied only where a real cluster is found.
