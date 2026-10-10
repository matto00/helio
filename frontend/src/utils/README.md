# Utils

`formatRelativeTime.ts` is genuinely cross-feature (imported by
`features/connectors`, `features/panels`, `features/pipelines` and
`features/sources`). So is `chartAppearance.ts`: besides `features/panels` it
is imported by `features/adminUsage` (`ui/UsageChart.tsx`), by
`features/pipelines` (`ui/outputEditor/`), and by `chartClickSelection.ts` and
`chartTypeOptions.ts` in this directory. `aggregate.ts` is imported by
`features/panels` and `features/pipelines`
(`ui/outputEditor/OutputPreviewPane.tsx`). `chartTypeOptions.ts` is, as of
this writing, imported only by `features/panels` — it lives here from an
earlier intent to share it, not current usage, and is a candidate for a move
to `features/panels/utils`. These are non-test importers; re-check one (from the repo root) with
`git grep -lE 'from "[./]*(utils/)?<module>"' -- frontend/src ':!*.test.ts' ':!*.test.tsx'`.

`prefersReducedMotion.ts` is the single shared reduced-motion read (HEL-1179), imported by
`features/panels/ui/buildChartOption.ts`, `shared/ui/Toast.tsx`, and `utils/chartAppearance.ts`.

**Belongs here:** utilities actually imported by more than one feature.
Verify with a real import grep before adding — do not assume a helper here
just because it isn't feature-specific by name.
**Does not belong here:** logic used by a single feature — prefer that
feature's own `utils/` (e.g. `features/dashboards/utils`) unless a second
consumer is confirmed.
