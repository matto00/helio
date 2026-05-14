# HEL-236 — Codebase refactor — modularity, DRY, and structural restructure

**Change Set 2c-2 of HEL-236** (CS1 ✅; CS2a ✅; CS2b ✅; CS2c-1 ✅; **CS2c-2 DataSource ADT ← this**; CS2c-3 PipelineStep + Panel ADTs; CS3 frontend structure; CS4 frontend decomposition)

## CS2c-2 scope (this change)

**DataSource sealed-trait ADT remodel.** Replace the wide `DataSource(sourceType: SourceType, config: JsValue, ...)` flat case class with a sealed trait + 4 subtypes:

```scala
sealed trait DataSource { def id: DataSourceId; def name: String; def ownerId: UserId; def createdAt: Instant; def updatedAt: Instant; def kind: String }
final case class CsvSource(...,    config: CsvSourceConfig) extends DataSource
final case class RestSource(...,   config: RestApiConfig)    extends DataSource
final case class SqlSource(...,    config: SqlSourceConfig)  extends DataSource
final case class StaticSource(...) extends DataSource
```

**The JSON wire shape evolves alongside** — `DataSource` becomes a discriminated union over a `type` field with subtype-specific `config` payloads. The frontend `DataSource` TS type becomes a discriminated union; all consumers (Redux slice, source editors, preview/refresh/infer flows) update in the same PR.

This is the **first intentional wire-contract evolution in HEL-236.** It's the smallest of the three ADTs (only 4 subtypes, config already typed for SQL + REST), which is why we start here — the pattern landed in CS2c-2 becomes the template for the heavier PipelineStep and Panel work in CS2c-3.

Bundled adjacent work (touches the same `rowToDomain` / protocol path):

- `DataSourceRepository.rowToDomain` aligned with the discriminator pattern (today it does its own JSON marshalling of `config`; switches to per-subtype typed unpacking)
- `services/DataSourceService` and `services/SourceService` consume the typed ADT (no more `config.convertTo[X]` at the service layer)
- All 4 data-source routes (`DataSourceRoutes`, `DataSourcePreviewRoutes`, `SourceRoutes`, `SourcePreviewRoutes`) updated to the new typed request/response shapes

## Acceptance

- `DataSource` is a sealed trait with 4 strict subtypes; `SourceType` enum becomes redundant and is either removed or kept only as a thin `kind` string mapper used at the protocol/DB-row boundaries
- Wire shape is a discriminated union: every JSON-emitting code path produces `{ "type": "csv"|"rest_api"|"sql"|"static", ...config... }` and accepts the same on input
- Frontend `DataSource` type is a discriminated union; all consumers compile against the new types
- `DataSourceRepository.rowToDomain` dispatches on the `source_type` column and returns the typed subtype; `domainToRow` flattens back. **DB table shape unchanged.**
- `services/DataSourceService.scala` and `services/SourceService.scala` consume typed ADT (no `config.convertTo[X]` at service-layer boundaries)
- `sbt test` + frontend `npm test` + lint + format + schema + OpenSpec + scala-quality hook all green
- Manual Playwright smoke: create one source per subtype (CSV upload, REST API, Static, SQL if available), refresh / preview each, run the existing dashboard panel against a CSV-bound datatype
- AuthService byte-identical to main
- No FQN violations

## Out of scope

- **Panel ADT + PipelineStep ADT** — CS2c-3
- **Engine split, `PipelineRunService`, `PipelineRunRoutes` decomp** — CS2c-3
- **Inner-vs-left-join policy codification** — CS2c-3 (lands in `JoinStep.scala` header when JoinStep is created)
- **`PipelineService.AllowedOps` missing `"aggregate"`** — spinoff (HEL-141 or its own ticket); do not pull in unless the executor finds it trivially co-located with DataSource work
- **HEL-256** — parallel side-PR off main; may surface during CS2c-2 design (StaticSource schema disappearance is the likely root cause); if so, fix lands separately on main and CS2c-2 merges forward
- **HEL-242 / HEL-265** — handled per HEL-236 plan
- **DB migration** — discriminator stays on existing `source_type` column; no Flyway
- **New endpoints, new connectors, opportunistic fields** — wire shape evolves _because of_ the ADT; no other additions

## Standards binding

`CONTRIBUTING.md` is binding — _Imports & Qualifiers_ rule (no inline FQNs; pre-commit hook blocks) + file-size budgets (routes ≤ 150, services ≤ 300, other src ≤ 250). Refactor discipline: behavior-preserving; trivial bugs fix inline, non-trivial bugs become spinoff candidates.

**Coordinated cross-tier change.** Backend AND frontend update in the same PR. If a backend change ships without its frontend counterpart, the PR is incomplete. The Playwright smoke is the final check.

The forward-looking architectural design from CS2c-1 lives at `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` — the DataSource section + wire-shape transition spec applies directly to this PR. CS2c-3 will inherit the rest.
