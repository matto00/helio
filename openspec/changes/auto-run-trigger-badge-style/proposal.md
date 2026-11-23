## Why

HEL-1815 taught the web client the fourth trigger source, `auto-run`, but `RunHistoryModal.css` only styles the
`--scheduled` and `--external` trigger badges. An auto-run badge therefore renders exactly like a manual one, so the
Run History list cannot tell a user which runs a dataset write started.

## What Changes

- Add a `.run-history-modal__trigger--auto-run` style: the owner-chosen **neutral-filled** pairing from existing tokens
  (`--app-surface-raised` fill, `--app-border-strong` border, `--app-text` text), with no hue and no icon. It stays
  visibly different from manual (outlined, muted text, no fill) in light and dark.
- Measure the badge's text-on-fill contrast (small-text floor 4.5:1) and its fill-vs-row distinctness (HEL-866 1.10
  state-surface floor) on the rendered page in both themes, and record the numbers.
- Tidy two HEL-1815 leftovers: the `TriggerSourceMigrationSpec.scala` doc comment names only three sources (V110 added
  `auto-run` to the CHECK), and the run-history contract test also admits "Unknown"; tighten it to the four known labels.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-run-provenance`: Run History SHALL render the auto-run trigger badge visibly distinct from the manual one,
  at the contrast floor, in both themes.

## Impact

- `frontend/src/features/pipelines/ui/RunHistoryModal.css` (one new modifier rule).
- New rendered Playwright spec under `e2e/` (both themes), plus a CSS source guard in jest if useful.
- `frontend/src/features/pipelines/services/runHistory.contract.test.ts` (label list).
- `backend/src/test/scala/com/helio/infrastructure/persistence/TriggerSourceMigrationSpec.scala` (doc comment only).
- No API, schema, token or migration change.

## Non-goals

- No new theme token, no icon, no hue for auto-run (owner ruling, HEL-1822 escalation).
- No change to the home `TimelineMark` tooltip or the Output history `StatusChip`: neither is this badge, and neither
  styles any trigger source differently today.
- No change to the scheduled, external or manual badge styles.
