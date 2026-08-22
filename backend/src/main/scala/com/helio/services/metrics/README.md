# Services — Metrics

Semantic/metric-layer business logic.

Holds: `MetricService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/metrics/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
