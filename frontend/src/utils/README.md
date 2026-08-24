# Utils

`formatRelativeTime.ts` is genuinely cross-feature (used by `features/panels`
and `features/pipelines`). `aggregate.ts`, `chartAppearance.ts`, and
`chartTypeOptions.ts` are, as of this writing, imported exclusively by
`features/panels` (verified via grep) — they live here from an earlier
intent to share them, not current usage; they are candidates for a move to
`features/panels/utils` but are left in place since this ticket is
docs-only.

**Belongs here:** utilities actually imported by more than one feature.
Verify with a real import grep before adding — do not assume a helper here
just because it isn't feature-specific by name.
**Does not belong here:** logic used by a single feature — prefer that
feature's own `utils/` (e.g. `features/dashboards/utils`) unless a second
consumer is confirmed.
