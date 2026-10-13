## Why

HEL-1485 gave dashboard delete one lock order ("panel rows by id, then dashboards"), but every other writer that locks
several panel rows (contents replace, batch update, output delete, and the FK cascades from pipeline / step / root /
source deletes) still locks them in scan or request order, so a dashboard delete racing one of them over two or more
shared panels can 40P01. Teardown's pre-lock misses panels on untagged dashboards. Patch-set preview projects each edit
in isolation, so a multi-edit set previews a different `after` than apply produces. `replaceContents` reads the
dashboard unlocked and can write back a layout it did not read (HEL-1526, folded in by owner decision).

## What Changes

- New SECURITY DEFINER migration function (exactly max-on-origin/main + 1, V128 at planning time) that locks, in one id-ordered statement,
  every panel a delete of the given dashboards / outputs / pipelines / steps / roots / data sources could remove,
  including panels the caller cannot see under RLS.
- Every multi-panel writer takes exactly one id-ordered panel lock as its first write: `replaceContents`,
  `batchUpdate`, output delete (now one transaction), pipeline delete, step delete, root removal, data-source delete, and teardown (whose
  lock now covers the tagged pipelines' and sources' panels on untagged dashboards).
- `replaceContents` (HEL-1526): layout becomes required; panels are locked, then the dashboard row `FOR UPDATE`; the
  response carries the stored row (fresh `layoutVersion`).
- Patch-set preview threads a cumulative overlay through its edits: `after`, impact and rejections reflect earlier
  edits in the same set exactly as apply would. `before` and the HEL-1458 fingerprint stay pre-apply.
- `PatchSetPreviewProjection.scala` split by resource kind, behaviour-preserving.
- Test tightening in `DashboardDeleteRacesPanelDeleteSpec`; the 2 ghost-layout preview guard cases labelled `GUARD:`.

## Capabilities

### New Capabilities
- `panel-row-lock-order`: the single panel-row lock order every panel writer follows.

### Modified Capabilities
- `patch-set-preview`: preview is cumulative across the edits of one patch set.
- `dashboard-contents-replace`: replace never overwrites a layout it did not read; response carries the fresh version.
- `workspace-tag-teardown`: teardown's panel lock covers untagged dashboards reached by its cascades.

## Non-goals

- Editing any applied migration (V1..V127).
- Preview modelling step-create re-parenting of existing children, or the data-source-delete cascade into
  root-attached steps/outputs/panels (documented residuals).
- The outputs-vs-dashboards lock inversion between panel create (KEY SHARE on outputs) and output-side deletes
  (follow-up).
- Preview crashing on ConvertFormat / AnalyzeWithAi / GenerateText step updates (pre-existing; follow-up).

## Impact

Backend only: `infrastructure/persistence/{dashboards,panels,pipelines,sources,workspace}`,
`services/patchsets`, `services/panels` (shared placement-size helper), one new Flyway migration, and new
concurrency/parity specs. No API shape change; `replaceContents`'s response `layoutVersion` becomes current.
