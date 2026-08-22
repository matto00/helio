# Protocols

Per-domain spray-json case classes/traits, split by domain
(`protocols/<domain>/`). `IdParsing.scala`, `PaginationProtocol.scala` and
`ResourceProtocol.scala` stay at this root — they are genuinely
domain-agnostic (path-segment ID parsing, the generic `PagedResult[...]`
wrapper, and the shared `ResourceMetaResponse`/`ErrorResponse`/
`HealthResponse` types every domain's responses embed or that don't belong
to a domain at all).

No other file lives directly in `api/protocols/` — every protocol trait
belongs under one of the 13 domain subdirectories. See each subdirectory's
own README for what belongs there.

`api/JsonProtocols.scala` mixes every per-domain trait into one
`JsonProtocols` aggregator (`with XProtocol`, ~39 direct mixins); per
CONTRIBUTING.md, new formatters go in the owning domain's protocol file,
never directly in the aggregator. `api/package.scala`'s `package object api`
re-exports every protocol type as `com.helio.api.X` for callers doing
`import com.helio.api._` — its aliases now target `protocols.<domain>.X`
(rewritten by this split; see design.md D5).
