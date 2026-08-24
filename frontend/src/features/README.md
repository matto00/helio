# Feature Modules

Feature-first structure for domain areas. Each feature owns its own slice of
state, service calls, types, and UI; a feature typically has some subset of
`hooks/`, `services/`, `state/`, `types/`, `ui/`, `utils/` (not every feature
has all of them — see each feature's own README for what it actually has).

Feature dirs: `assistant`, `auth`, `dashboards`, `dataTypes`, `layout`,
`metrics`, `onboarding`, `panels`, `patchSets`, `pipelines`, `proposals`,
`settings`, `sources`, `toasts`.

**Belongs here:** one directory per domain feature, each self-contained.
**Does not belong here:** cross-feature-shared code — that lives in the
top-level `hooks/`, `utils/`, `services/`, and `shared/` dirs alongside
`features/`.
