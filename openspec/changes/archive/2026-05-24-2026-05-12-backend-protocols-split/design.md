# Design — backend-protocols-split

## Package layout

```
backend/src/main/scala/com/helio/api/
├── JsonProtocols.scala        # aggregator trait only (≤ 80 lines)
└── protocols/
    ├── ResourceProtocol.scala
    ├── AuthProtocol.scala
    ├── DashboardProtocol.scala
    ├── PanelProtocol.scala
    ├── DataTypeProtocol.scala
    ├── DataSourceProtocol.scala
    ├── PipelineProtocol.scala
    └── PermissionProtocol.scala
```

### `JsonProtocols.scala` after the split

```scala
package com.helio.api

import com.helio.api.protocols._

trait JsonProtocols
    extends ResourceProtocol
    with AuthProtocol
    with DashboardProtocol
    with PanelProtocol
    with DataTypeProtocol
    with DataSourceProtocol
    with PipelineProtocol
    with PermissionProtocol
```

Plus a `package object` re-exporting the case-class types if a transitive consumer was importing them from `com.helio.api.JsonProtocols`. (Survey first; most consumers import from `com.helio.api._` or use the types via the trait. If no transitive imports exist, skip the re-export.)

### Per-domain trait shape

```scala
package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// Case classes
final case class DashboardResponse(...)
// Companion objects
object DashboardResponse { def fromDomain(...) = ... }

trait DashboardProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val dashboardAppearanceResponseFormat: RootJsonFormat[DashboardAppearanceResponse] = jsonFormat2(DashboardAppearanceResponse.apply)
  // ... only dashboard-domain formats
}
```

### Cross-trait dependencies

Some formats reference types from other domains:
- `PanelProtocol` needs `ChartAppearance` formatters → those live in `PanelProtocol` (the chart-appearance types are panel-scoped).
- `DashboardResponse` references `ResourceMetaResponse` → `DashboardProtocol` needs `ResourceProtocol` mixed in **OR** the aggregator handles it. Choose the aggregator: per-domain traits do not extend each other; only `JsonProtocols` does the composition. This keeps the per-domain traits independent for testing.
- `DashboardSnapshotPanelEntry` uses `PanelAppearancePayload` → lives in `DashboardProtocol` but the formatter requires `panelAppearancePayloadFormat`. Solution: `DashboardProtocol extends PanelProtocol` (snapshot is a dashboard-only feature that happens to use the panel-payload type). Document this as the single inter-trait dependency.

If more inter-trait dependencies surface, the executor surfaces them in the cycle report rather than adding `extends` ad-hoc.

## ID-wrapper boundary

### Pattern (documented in `protocols/IdParsing.scala`)

```scala
package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.server.PathMatcher1
import com.helio.domain._

object IdParsing {
  /** Path matchers that produce value-class IDs at the route boundary.
   *  Use these in pathPrefix / path directives instead of raw Segment. */
  val DashboardIdSegment: PathMatcher1[DashboardId] = Segment.map(DashboardId(_))
  val PanelIdSegment: PathMatcher1[PanelId] = Segment.map(PanelId(_))
  val DataTypeIdSegment: PathMatcher1[DataTypeId] = Segment.map(DataTypeId(_))
  val DataSourceIdSegment: PathMatcher1[DataSourceId] = Segment.map(DataSourceId(_))
  val PipelineIdSegment: PathMatcher1[PipelineId] = Segment.map(PipelineId(_))
  val UserIdSegment: PathMatcher1[UserId] = Segment.map(UserId(_))
}
```

### Rollout in CS1

- `DashboardRoutes.scala`: convert `path(Segment) { dashboardId =>` → `path(DashboardIdSegment) { dashboardId: DashboardId =>` everywhere. Update repository call sites: drop the `DashboardId(...)` wraps now done inside the handler. **Behavior-preserving.**
- `PanelRoutes.scala`: same treatment.
- Other routes: leave for CS2 (engine/routes change set), inventoried in the cycle report.

### Why segments and not extractors

`PathMatcher1[T]` is the standard Pekko mechanism, idiomatic, and chains cleanly with other matchers. Building custom extractors adds boilerplate without benefit.

## Schema-drift checker

### Current behavior (`scripts/check-schema-drift.mjs`)

Reads `JsonProtocols.scala`, parses case classes with a single regex, builds a `className → fields[]` map, then walks `schemas/*.json` and checks each schema against the map.

### New behavior

```js
import { readdirSync } from "node:fs";

const protocolsDir = join(repoRoot, "backend/src/main/scala/com/helio/api/protocols");
const protocolsAggregator = join(repoRoot, "backend/src/main/scala/com/helio/api/JsonProtocols.scala");

const sources = [
  protocolsAggregator,
  ...readdirSync(protocolsDir)
    .filter((f) => f.endsWith(".scala"))
    .map((f) => join(protocolsDir, f)),
];

const classes = new Map();
for (const src of sources) {
  const fileSrc = readFileSync(src, "utf8");
  for (const [name, fields] of parseCaseClasses(fileSrc)) {
    if (classes.has(name)) {
      throw new Error(`Duplicate case class ${name} across protocol files`);
    }
    classes.set(name, fields);
  }
}
```

The duplicate-check defends against an accidental copy-paste of the same case class into two domains.

## Test strategy

- All 495 existing backend tests run unchanged. They consume formatters via `extends JsonProtocols`, so as long as the aggregator continues to compose the same formats, the tests pass.
- One **new** Scala test asserts that `JsonProtocols` continues to provide every format previously available: write a one-shot test that round-trips a representative instance of each top-level response type through the aggregator. Place in `backend/src/test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala`.
- Pre-commit gates (`lint`, `format:check`, `check:schemas`, `check:openspec`, `test`) run as normal.

## Latent-bug watch list

While moving files, the executor stays alert for:

1. **Two case classes named the same**: e.g. `UserPreferences` (auth) vs. `UserPreferencePayload` (auth) — currently fine but flag any namespace clash.
2. **Companion-object dependencies**: e.g. `DashboardSnapshotPanelEntry.fromDomain` reads `panel.appearance` fields directly — verify it round-trips after the move.
3. **Implicit ordering**: Spray JSON's `jsonFormatN` macros resolve implicits at trait-mixin time; the order in `JsonProtocols`'s `extends` chain matters if Format A depends on Format B. Document any required order with a comment in `JsonProtocols.scala`.

If the executor finds a trivial bug (e.g., a `fromDomain` is dropping a field), it fixes inline and reports it. Larger findings (e.g., a domain type with an inconsistent JSON shape) become a spinoff ticket noted in the cycle report.

## Rollback plan

If the split causes pain we cannot quickly resolve, revert is a single commit: `git revert <cs1-merge-commit>`. The change is purely structural; no migrations, no API touch.
