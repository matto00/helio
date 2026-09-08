## Why

Motion is the one token family where the app has drifted into disagreeing with itself: two spinners with the same
visual role (`linear infinite` spin) run at two different speeds — they never co-render, so this is scale rot rather
than a side-by-side eyesore — and the auth card enters on a literal `0.45s` whose easing curve is an exact copy of
`--transition-slow`'s. The ticket's broader premise — ad-hoc
durations scattered across components — is measured and largely already fixed (51 of 136 transitions are tokenized;
only three files carry a literal duration, two of them legitimate reduced-motion overrides).

## What Changes

- **Unify the two spin loops.** `ui-spinner-spin` (0.7s) and `pipeline-run-spin` (0.8s) are the same role at two
  speeds. They never co-render, so this is not something a user sees side by side — the reason to fix it is that a
  design-system primitive and a local copy of it should not disagree on the same value, which is how a scale rots one
  component at a time. One `--app-spin-duration` token, applied to both. This is the ONLY new token.
- **Put the auth card on the entrance token.** `auth-card-in` uses `--transition-slow` instead of a literal that
  already duplicates that token's curve.
- **Deliberately leave two things alone, and say why.** `PanelGrid`'s 180ms is NOT folded: the vendor stylesheet
  `react-grid-layout/css/styles.css` (imported at `DesktopPanelGrid.tsx:26`) contributes 100ms placeholder and 200ms
  container durations that no `frontend/src` text carries, so folding items to 160ms would widen the 180/100/200
  spread rather than narrow it — filed as **HEL-1032**. `--toast-exit-duration` stays file-local: it has one consumer,
  its scoping is deliberate (HEL-535 D4), and `toast.css.test.ts:91` asserts it by name.
- **State the rule DESIGN.md is missing**: a single-use loop may carry its own literal; a loop role used by two or more
  surfaces needs a token. This is what stops the next spinner from inventing a third speed.
- **A mutation-proven guard** alongside `tokenAuditSweep.css.test.ts` that fails on a NEW ad-hoc duration while still
  allowing the legitimate ones.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — CSS tokens and documentation only, no product behaviour or contract change. `skip_specs: true` is set.

## Non-goals

- **Redesigning motion.** No new choreography, no decorative animation, no re-timing of what already feels right.
- **Over-tokenizing.** Single-use loops (`streaming-text-blink` 1s, `pipeline-run-pulse` 1.2s) keep their literals; a
  token per one-off value is scale sprawl, not cohesion.
- **`prefers-reduced-motion` itself** — the global rule already exists and works; HEL-538 owns that surface.
- HEL-350 (panel hover/tooltip motion), HEL-442/444 (this lane's later tickets), HEL-830, HEL-443, HEL-866, HEL-1006,
  HEL-1023.

## Impact

- `frontend/src/theme/theme.css` (one token), `Spinner.css`, `PipelineDetailPage.css`, `auth.css`, one new guard
  test, and `DESIGN.md`. `PanelGrid.css` and `toast.css` are deliberately NOT touched (see above).
- No backend, no migration, no API change.
