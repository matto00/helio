- `backend/src/main/scala/com/helio/domain/model/ChartAppearance.scala` — new; ChartLegend/Tooltip/AxisLabel(s), ChartAppearance + companion moved byte-identical from model.scala 206-216, 220-374
- `backend/src/main/scala/com/helio/domain/model/PanelAppearance.scala` — new; PanelAppearance + companion moved byte-identical from model.scala 218, 399-491
- `backend/src/main/scala/com/helio/domain/model/model.scala` — spans and the two now-unused imports removed (1306 -> 1041 lines)
- `backend/src/main/scala/com/helio/domain/model/README.md` — file list updated to the full current set
- `backend/src/test/scala/com/helio/api/protocols/panels/PanelAppearanceWireGoldenSpec.scala` — new wire golden spec (committed alone, b35c5453, before the move)

Evidence: move-evidence.md, api-evidence.md, test-count-evidence.md, move-check/ (scripts, baseline counts, raw javap diffs).

## Follow-up candidates (not fixed)
- domain layer imports `com.helio.api.http.RequestValidation` (layering smell), now in both new files.
- Stale pointer comments to ChartAppearance.Default's location: `helio-mcp/src/helioApi.ts:180`, `frontend/src/theme/appearance.ts:16`.
- `domain/model/README.md` says no behavior belongs there, but appearance decode/merge logic lives there.
- model.scala is still ~1041 lines; next seams: auth/token types, alert types, pipeline types.
- Evidence-plan note: scalac's per-file `$anonfun$` counter renumbers the lambdas of whichever object lands first-in-file or is separated from earlier lambdas (here only `PanelAppearance$`, N -> N-14) (see api-evidence.md); future move tickets should normalize rather than expect byte-identity.
