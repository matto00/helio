# HEL-236 — Codebase refactor — modularity, DRY, and structural restructure

**Change Set 2c-1 of HEL-236** (CS1 ✅; CS2a ✅; CS2b ✅; **CS2c-1 foundations ← this**; CS2c-2 DataSource ADT; CS2c-3 PipelineStep + Panel ADTs + engine + run-lifecycle; CS3 frontend structure; CS4 frontend decomposition)

## CS2c-1 scope (this change)

**Foundations for the domain ADT remodel.** Internal-only changes that don't touch the wire shape:

- Add `PipelineRunId` value class to `domain/model.scala`
- Add `PipelineStepIdSegment` and `PipelineRunIdSegment` to `api/protocols/IdParsing.scala`
- Narrow pipeline repository signatures (`PipelineRepository`, `PipelineStepRepository`, `PipelineRunRepository`) to accept value-class IDs (`PipelineId`, `PipelineStepId`, `PipelineRunId`)

These are the prerequisites for CS2c-2 (DataSource ADT) and CS2c-3 (PipelineStep + Panel ADTs). Splitting them out means the wire-shape-evolving work in CS2c-2/CS2c-3 sits on a typed-ID baseline rather than mixing the two concerns in one large PR.

## Why split CS2c

The original CS2c brief bundled all three ADTs (Panel, DataSource, PipelineStep) + engine split + run-lifecycle decomp + frontend lockstep + schemas + Playwright into a single PR. After exploration, the executor flagged that the full scope (~50 backend + ~25 frontend files + 4+ schemas + wire-contract evolution) is too concentrated for one PR — risk of half-shipped wire shape, evaluator pushback on rigor, and reviewer cognitive load.

Split plan:

- **CS2c-1 (this PR)** — foundations, no wire shape change
- **CS2c-2 (next session)** — DataSource ADT + frontend lockstep + DataSource schema + `DataSourceRepository.rowToDomain` alignment + inner-vs-left-join codified in domain
- **CS2c-3 (session after)** — PipelineStep ADT + engine split + `PipelineRunService` + `PipelineRunRoutes` decomp + Panel ADT + frontend lockstep + Panel schema + snapshot import/export + Playwright smoke

`design.md` in this change folder preserves the architectural design for the full series — CS2c-2 and CS2c-3 will reference back to it.

## Acceptance

- `PipelineRunId` value class exists
- `PipelineStepIdSegment` and `PipelineRunIdSegment` added to `IdParsing.scala`
- All pipeline repos accept value-class IDs throughout (no remaining `String` ID signatures on Pipeline / PipelineStep / PipelineRun)
- All call sites (services, routes, Spark submitter, tests) thread value-class IDs
- `sbt test` — 511 passing (baseline)
- `npm test` — 664 passing
- Lint / format / schemas / OpenSpec / scala-quality hook all green
- AuthService byte-identical to main
- No wire shape change

## Out of scope

- **All three domain ADTs** (Panel, DataSource, PipelineStep) — deferred to CS2c-2 and CS2c-3
- **Engine split, run-lifecycle decomp, `PipelineRunService`** — CS2c-3
- **Schema updates, OpenSpec spec updates** — CS2c-2 and CS2c-3
- **Inner-vs-left-join policy codification** — CS2c-2 (in domain comment when JoinStep lands)
- **HEL-242 / HEL-256 / HEL-265** — handled per HEL-236 plan

## Standards binding

`CONTRIBUTING.md` is binding — _Imports & Qualifiers_ rule + file-size budgets. Refactor discipline: behavior-preserving. AuthService stays untouched.
