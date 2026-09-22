## Auditor Report

### Condition 1–3 (check-merge-readiness.sh)

```
$ scripts/concertino/check-merge-readiness.sh "$WORKTREE_PATH" "task/remaining-output-pipeline-schemas/hel-933" "HEL-933" "openspec"
PASS
EXIT=0
```

CI green, PR mergeable, run's own evaluator/skeptic gates verified from the event log (PASS/CONFIRM
at current head — no STALE), no protected paths touched.

### Condition 4 (acceptance criteria, traced cold)

Diff base resolved live: `BASE_SHA=f8953a3875161d8a95e2792ac4c569a85fc3b1b1`
(`scripts/concertino/resolve-review-base.sh`). `git diff "$BASE_SHA"...HEAD --stat` shows exactly:
the openspec change-dir artifacts, `schemas/pipelines/expand-pipeline-shape-response.schema.json`
(new), `schemas/pipelines/node-capabilities-response.schema.json` (new),
`schemas/sources/data-source.schema.json` (new), and a 2-line additive `SKIP` entry in
`scripts/check-schema-drift.mjs`. No other file touched — matches the premise-validation-narrowed
scope (`.concertino/runs/HEL-933/evidence/premise-validation.md`): items 1/4/addendum-2 are the
only genuinely-outstanding work; items 2/3/addendum-1 were already shipped on `main`.

Traced each item of the narrowed scope against the actual backend source (not the schema files'
own prose, not prior review reports):

- **Item 1 — `schemas/sources/data-source.schema.json` / `DataSourceResponse.inferredSchema`.**
  Read `DataSourceProtocol.scala` in full. Every one of the 7 `DataSourceResponse` subtypes
  (`Csv`/`Rest`/`Sql`/`Static`/`Text`/`Pdf`/`Image`) matches the schema's corresponding `$defs`
  entry field-for-field, including `inferredSchema`, the per-kind `config` shape, and the `type`
  discriminator constants (verified against `DataSourceKind` in `DataSource.scala:258-264`:
  `csv`/`rest_api`/`sql`/`dataset`/`text`/`pdf`/`image` — all match the schema's `const`s).
  `DataSourceRoutes.scala:104` (list, GET), `:213/221/229/237/245/290/303/316/329` (every create
  branch, POST) all call `DataSourceResponse.fromDomain`, confirming `inferredSchema` is exposed on
  GET (list) and POST. The `SKIP`-list addition for `"DataSourceResponse"` in
  `check-schema-drift.mjs` mirrors the pre-existing `"Panel"`/`"Dashboard"` precedent exactly (a
  discriminated union with no single matching case class) — not a new, isolated exemption.
  **One AC clause is NOT traceable**, flagged below.
- **Item 4 — `schemas/pipelines/node-capabilities-response.schema.json` /
  `NodeCapabilitiesResponse`.** `GET /api/pipelines/:id/capabilities?stepId=`
  (`PipelineRoutes.scala:64-69`) calls `pipelineService.capabilitiesAtNode`, which returns
  `Future[Either[ServiceError, NodeCapabilitiesResponse]]`
  (`PipelineService.scala:1226-1240`) — completed via `identity`, so the wire type is exactly
  `NodeCapabilitiesResponse`. `NodeCapabilitiesProtocol.scala:15-19` declares
  `stepId: Option[String], columns: Vector[PanelCapabilityColumnResponse], capabilities:
  Map[String, PanelCapabilityResponse]` — matches the schema's `required: [columns, capabilities]`
  (stepId correctly optional/absent-when-None) and inlined `$defs` for
  `PanelCapabilityColumnResponse`/`PanelCapabilityResponse`, cross-checked field-for-field against
  `PanelCapabilityProtocol.scala:17,38-45`. Title `NodeCapabilitiesResponse` matches the real case
  class 1:1 (not `SKIP`-listed) — confirmed by running `npm run check:schemas` fresh, which passes
  (see below).
- **Addendum 2 — `schemas/pipelines/expand-pipeline-shape-response.schema.json` /
  `ExpandPipelineShapeResponse`.** `PipelineShapeProtocol.scala:88` declares
  `ExpandPipelineShapeResponse(steps: Vector[ShapeStepExpansionResponse], outputs:
  Option[JsArray] = None)` — matches the schema's `required: [steps]` with `outputs` correctly
  modeled as an absent-optional key (not nullable), matching this protocol's established
  no-`NullOptions` convention used throughout the codebase. `ShapeStepExpansionResponse`
  (line 66) matches the inlined `$defs` entry field-for-field.

**Fresh mechanical evidence for the schema/case-class parity claims above (not from CI, run
myself just now):**

```
$ npm run check:schemas
check-schema-drift: raw recursive walk found 126 entries under .../schemas
schemas in sync with JsonProtocols (100 checked across 50 protocol files)
panel-type enums in sync with backend canonical sets (7 surfaces checked)
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)

$ npm run check:openspec
openspec/ is clean
```

**CON-132 gate-chain change** (`check-schema-drift.mjs` is `.husky/pre-commit`-invoked): confirmed
present and adequate, not just nominally checked off. `design.md`'s "Gate-Chain Implications
Checklist" (What does it execute? / What environment does it inherit? / Does it write outside its
sandbox? / Does it behave differently in a linked worktree? / What happens on first run?) is
answered in full with concrete, specific reasoning tied to the actual 2-line diff.
`.concertino/gate-chain-isolation-evidence/scripts__check-schema-drift.mjs.md` shows a real
isolation-test transcript against a disposable `mktemp -d` linked-worktree fixture (git
manifest/status identical before/after, real-surrounding-repo tripwire `PASS`, target script exits
`0`) — genuinely run, not fabricated.

**Finding — one AC clause is not traceable to any real route.** `ticket.md`'s AC #1 reads:
`GET/POST /api/data-sources and GET /api/data-sources/:id responses include inferredSchema`.
I read the entirety of `DataSourceRoutes.scala` and `DataSourcePreviewRoutes.scala`: the bare
`path(DataSourceIdSegment)` block (`DataSourceRoutes.scala:114-125`) wires only `patch` and
`delete` — **there is no `get` at that path**. Every `GET` under `/api/data-sources/:id/...` in
this codebase is scoped to a subpath (`/preview`, `/rows`, `/schema`) — confirmed independently by
grepping the test suite: every `Get(s"/api/data-sources/$sourceId/...")` in
`DataSourceRoutesSpec.scala` and `ApiRoutesSpec.scala` hits a subpath, never the bare id. **A bare
`GET /api/data-sources/:id` route does not exist anywhere in this backend.** The newly-added
`schemas/sources/data-source.schema.json`'s own `description` field repeats this same unverified
claim (`"GET/POST /api/data-sources, GET /api/data-sources/:id -- a discriminated union..."`),
inherited uncritically from `ticket.md` through `proposal.md`'s "What Changes" bullet — none of
`design.md`, `evaluation-1.md`, `skeptic-design-1.md`, or `skeptic-final-1.md` catch this specific
gap, and `premise-validation.md`'s Item-1 analysis verified `fromDomain` is used by the list-GET,
create-POST, and update-PATCH branches but never separately established that a bare GET-by-id
route exists (it uses "update" (PATCH) as its stand-in for "single-resource response," which is
not the same claim as the ticket's literal "GET /api/data-sources/:id").

This is confined to descriptive prose (the schema's `oneOf`/`$defs` structure itself is fully
correct and verified against the real wire shape returned by the routes that do exist) — it does
not affect `check:schemas`'s mechanical pass, and no runtime behavior depends on it. But per my
mandate ("an AC you cannot trace to real evidence is not met"), this one clause of AC #1 is
genuinely untraceable, and the same unverified claim was carried, uncorrected, all the way into
the shipped file. A trivial fix (drop the `GET /api/data-sources/:id` clause from the schema's
description, and correct `proposal.md`'s parallel claim) closes this cleanly.

### Verdict: ESCALATE

category=spec-divergence

### Reason

- `schemas/sources/data-source.schema.json`'s `description` (and `proposal.md`'s "What Changes"
  bullet) assert `GET /api/data-sources/:id` returns this response shape. No such route exists:
  `DataSourceRoutes.scala`'s bare `path(DataSourceIdSegment)` wires only `patch`/`delete`
  (lines 114-125), and every `GET` under a data-source id in both `DataSourceRoutes.scala` and
  `DataSourcePreviewRoutes.scala` is scoped to a subpath (`/preview`, `/rows`, `/schema`) — no bare
  `GET /:id` anywhere, confirmed independently against the test suite
  (`DataSourceRoutesSpec.scala`, `ApiRoutesSpec.scala`).
- Everything else — the schema/case-class field parity for all three new files (fresh
  `check:schemas` run, exit 0), the CON-132 gate-chain checklist and isolation-test evidence, CI
  green, PR mergeability, and this run's own evaluator PASS / 2× skeptic CONFIRM at the current
  head — checks out cleanly. This is a narrow, low-blast-radius finding (inaccurate prose in a
  `description` field, not a structural or functional defect), but it is genuinely untraceable to
  real evidence and was not caught anywhere earlier in this run's review chain, so I'm surfacing it
  rather than resolving it myself. Recommend: correct the `data-source.schema.json` description
  (drop the `GET /api/data-sources/:id` claim) and `proposal.md`'s matching bullet, then re-review
  and re-audit — the fix is a one-line prose edit, not a code change, so this should clear fast.
