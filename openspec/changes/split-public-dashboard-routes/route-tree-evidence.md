# Route-tree evidence (HEL-1291, design D5)

Extractor (scratchpad `hel1291-skel.py`, not in repo): takes `val routes` to EOF, strips `//` comments, collapses the
panel-list `val resultF = ...` body to the token `RESULTF` (that body is moved to `PublicPanelListResolver.panelList`, covered by D5c), normalises
the documented receiver renames (`rows.resolveRows(` -> `resolveRows(` etc.), then emits one token per line
(`pathPrefix`/`path`/`pathEndOrSingleSlash`/`get`, every `parameters(...)` arg, every `authorizeResourceWithSharing` arg,
`ServiceResponse.run` target + mapper, `~` composition order).

## D5a Skeleton before/after

- before: 315 lines (original file at b2a0d8088, copy `hel1291-PublicDashboardRoutes.orig.scala`)
- after: 315 lines
- `diff hel1291-route-tree-before.txt hel1291-route-tree-after.txt` -> empty, exit 0.

Documented receiver renames (the only textual change inside the tree, normalised by the extractor):
`resolveRows`/`resolveFilterCapabilities`/`resolveDistinctValues` -> `rows.`; `resolveOutputMeta`/`resolveProvenance` -> `outputMeta.`;
`resolveHistory` -> `history.`; and `val resultF = panelRepo.findAllByDashboardId(...)...` -> `val resultF = panelList.panelList(dashboardId, page, access)`.
Note the `// HEL-590 ... CR-A` comment that sat directly above `val resultF` moved with the body into `PublicPanelListResolver.panelList`.

### Endpoint table (all under `pathPrefix("dashboards" / Segment / "panels")`, all `GET`, order = `~` order)

| # | Path template (relative to `/api`) | Query params | Auth gate (in PublicDashboardRoutes.scala) | Work delegated to |
|---|---|---|---|---|
| 1 | `/dashboards/{id}/panels/{panelId}/rows` | offset, limit, sort, filter, token | `authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard not found", token)` | `rows.resolveRows` |
| 2 | `.../{panelId}/filter-capabilities` | token | same | `rows.resolveFilterCapabilities` |
| 3 | `.../{panelId}/distinct-values` | column, token | same | `rows.resolveDistinctValues` |
| 4 | `.../{panelId}/output-meta` | token | same | `outputMeta.resolveOutputMeta` |
| 5 | `.../{panelId}/history` | limit, since, token | same (after `OutputHistoryQueryParsing.parse`, unchanged order) | `history.resolveHistory` |
| 6 | `.../{panelId}/provenance` | token | same | `outputMeta.resolveProvenance` |
| 7 | `/dashboards/{id}/panels` | offset, limit, token | same, block binds `access` | `panelList.panelList` |

## D5b Red run (the extractor is failable)

Scratch copy `hel1291-PublicDashboardRoutes.mutated.scala` = original with `filter-capabilities` and `distinct-values` alternatives swapped and the
`"filter".optional,` argument dropped from the `rows` `parameters(...)`. `diff before mutated` -> 60 diff lines (non-empty), including:

```
17d16
< "filter".optional,
99c98
< Segment / "filter-capabilities")
---
> Segment / "distinct-values")
...
127c134
< Segment / "distinct-values")
---
> Segment / "filter-capabilities")
```

## D5c Verbatim move

`git diff --color-moved=plain --color-moved-ws=allow-indentation-change -- backend/src/main/scala/com/helio/api/routes/dashboards/`
(new files `git add -N`). Lines NOT classed as moved (149 +/- lines total, all justified):

- Imports (old file trimmed; each new file's own import block) and `package` lines.
- Class scaffolding: the 5 `final class ...( ctor params )(implicit executionContext: ExecutionContext) {` headers + one-sentence HEL-1291 doc each.
- `private def X(` -> `def X(` for resolvers called from the entry point (resolveRows, resolvePanelOutput, resolveFilterCapabilities, resolveDistinctValues, resolveOutputMeta, resolveProvenance, resolveHistory).
- `resolvePanelOutput(dashboardId, panelId)` -> `panelOutput.resolvePanelOutput(dashboardId, panelId)` (4 call sites + history).
- New `panelList` method signature + its one-line first statement (`panelRepo.findAllByDashboardId(...)`, was `val resultF = panelRepo....`); body dedented 12 columns (allow-indentation-change).
- Entry point: 5 `private val` module declarations (declared before `val routes`), 7 receiver renames at call sites (list above).
- D4 positional/reference words in comments only: "panel-list route above" -> "... in `PublicDashboardRoutes`"; "gate below" -> "gate in `PublicDashboardRoutes`"; "convention above" -> "in `PublicPanelListResolver.resolveDataAsOf`";
  "(the panel-list route above)" -> "(the panel-list route)"; "`resolveFilterCapabilities` above," -> "`resolveFilterCapabilities`,"; "three ... routes below" -> "three ... routes"; "this class's own doc comment" -> "`PublicDashboardRoutes`'s own doc comment"; "authenticated route... `resolveRows`'s" unchanged.
- README "Holds" line.

Everything else (resolver bodies, validator, dataAsOf, orphaned-controls, ownerView rule, all doc comments) is classed as moved.

## D5d Guard scan (`ExistenceNotLeakedRoutesSpec.filesCallingAccessHelpers` replicated, scratchpad `hel1291-guard.py`)

```
$ diff hel1291-guard-before.txt hel1291-guard-after.txt && echo guard-identical
guard-identical
```
10 files before and after; `PublicDashboardRoutes.scala` present; no new file listed (the 5 new files never call an access helper:
`grep -n "authorizeResourceWithSharing(" PublicPanel*Resolver.scala` is empty). `ExistenceNotLeakedRoutesSpec` itself is green (61/61, see test-count-evidence.md).
