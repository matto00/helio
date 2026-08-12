## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 fix present and correctly targeted at the surface issue it claimed to fix:**

- `design.md` D6 (lines 70-91) and `tasks.md` 2.3 (lines 28-38) now specify a conditional
  `"if": {"required": ["metricId"]}, "then": {"required": ["metricDeprecated"]}` block per `$def`,
  explicitly rejecting an unconditional `required` entry, and cite `schemas/create-panel-request.schema.json`'s
  existing `allOf`/`if`/`then` construct as the pattern to mirror. Both round-1 and round-2 REFUTEs are
  cited inline as resolved.
- Read `schemas/panel.schema.json` (357 lines) and `schemas/create-panel-request.schema.json` (71 lines)
  in full, fresh.
- Re-verified round-2's core claim myself, from the code, not from its narrative:
  `PanelServiceHelpers.scala:255-260` (`withMetricCleared`) strips `metricId` from
  `MetricPanel`/`ChartPanel`/`TablePanel` config whenever the referenced metric doesn't resolve to an
  owned `MetricDefinition`. Combined with `PanelService.scala:110-127` (`resolveOne`) and `:138-164`
  (`resolveSingleBinding`), this confirms that by response time, "`metricId` present" and "resolves" are
  the same condition — so `"if": {"required": ["metricId"]}` is a correct proxy for "resolves" **on the
  response side**, and this is internally consistent with `panel-datatype-binding/spec.md`'s "Whenever
  `metricId` resolves to a `MetricDefinition`... SHALL additionally carry `config.metricDeprecated`"
  language (spec.md lines 14-17, 38-49). This part of the round-2 fix is sound.

### New defect found on fresh adversarial review: the fix targets a shared, dual-purpose `$def`

The literal instruction in `tasks.md` 2.3 / `design.md` D6 is to add the conditional `if`/`then` block
**directly inside** `$defs.MetricConfig`/`$defs.ChartConfig`/`$defs.TableConfig` in
`schemas/panel.schema.json`. Those exact `$defs` are not response-only:

1. **`schemas/create-panel-request.schema.json` (lines 29-40) `$ref`s the same `#/$defs/MetricConfig`/
   `ChartConfig`/`TableConfig`** for its own `config` validation, in its `then` blocks:
   `"then": { "properties": { "config": { "$ref": "panel.schema.json#/$defs/MetricConfig" } } }` — i.e.
   this is the exact schema that validates the body of `POST /api/panels` (create), not just
   `panel.schema.json`'s own `oneOf` (used for read responses).
2. **`metricId` is a real, currently-supported, currently-exercised create-time field**, not a
   read-only artifact of this ticket: `backend/src/main/scala/com/helio/services/PanelService.scala:215`
   — `rejectUnresolvableMetric(metricIdFromCreateConfig(createConfig), user)` inside `buildForCreate` —
   confirms the backend validates and accepts `config.metricId` on `POST /api/panels` today (this is
   pre-existing HEL-500 behavior, unrelated to this ticket).
3. **`metricDeprecated` is explicitly a read-only, server-materialized field**, per `design.md` D6's own
   text ("independent of the existing raw-vs-materialized value precedence... always reflects the
   metric's current state") and `tasks.md` 2.2 ("read/materialize side only, not a persisted/settable
   field"). A client never sends it on a create request, and `panel-datatype-binding/spec.md`'s own
   scenarios only ever describe it appearing on `GET /api/dashboards/:id/panels` responses — nothing in
   the spec delta requires or even mentions it on create.

Putting these three facts together: a legitimate, currently-working request —
`POST /api/panels {dashboardId: "d1", type: "metric", config: {metricId: "m1"}}` — validates against
`create-panel-request.schema.json` **today**. After implementing `tasks.md` 2.3 exactly as written, this
same request would **fail** schema validation, because `config` (validated via `$ref` into the now-modified
`$defs.MetricConfig`) has `metricId` present but not `metricDeprecated`, and the newly-added `if`/`then`
inside that shared `$def` now requires `metricDeprecated` whenever `metricId` is present — with no
awareness of whether the `$def` is being used to validate a response (where the requirement is correct)
or a request (where it is not). I confirmed the same collision exists for `ChartConfig` and `TableConfig`
via the identical `$ref` pattern in `create-panel-request.schema.json` lines 34-40.

This is precisely the trap the round-1/round-2 pattern should have flagged: the fix is syntactically
valid JSON Schema (an `if`/`then` pair is a legal sibling of `properties`/`additionalProperties` inside
any schema object — no `allOf` wrapper is even required for a single conditional, though one is harmless),
but it is placed at the wrong **scope**. The orchestrator's own framing of where to look is the right
diagnostic: `create-panel-request.schema.json`'s `allOf`/`if`/`then` lives at **that file's own top-level
document scope** — a scope used for exactly one purpose (request validation). The analogous single-purpose
scope in `panel.schema.json` is **its own top-level `oneOf`** (used for exactly one purpose: response
validation) — not the `$defs`, which are cross-file-shared with `create-panel-request.schema.json` for a
different purpose. Embedding the conditional in the shared `$def` silently makes it apply to both
purposes, and only one of them is correct.

I found no test that currently exercises `create-panel-request.schema.json` against real request bodies
(`grep -rl "create-panel-request" backend/src/test` returns nothing), so — exactly as with rounds 1 and
2 — this would ship as silent, unenforced contract breakage rather than a build failure, which is exactly
why it needs to be caught here rather than downstream.

### Verdict: REFUTE

### Change Requests

1. **`tasks.md` 2.3 / `design.md` D6**: do not add the `"if": {"required": ["metricId"]}, "then":
   {"required": ["metricDeprecated"]}` conditional directly inside the shared
   `$defs.MetricConfig`/`$defs.ChartConfig`/`$defs.TableConfig` — those `$def`s are also `$ref`'d by
   `schemas/create-panel-request.schema.json` (lines 29-40) to validate `POST /api/panels` request
   bodies, where `metricId` is a real, already-supported field (`PanelService.scala:215`) and
   `metricDeprecated` is correctly never sent. Instead, scope the conditional to
   `schemas/panel.schema.json`'s own top-level `oneOf` (response-only usage), e.g. for the `metric`
   branch: `{"properties": {"type": {"const": "metric"}, "config": {"allOf": [{"$ref":
   "#/$defs/MetricConfig"}, {"if": {"required": ["metricId"]}, "then": {"required":
   ["metricDeprecated"]}}]}}}`, and identically for the `chart`/`table` branches — leaving
   `$defs.MetricConfig`/`ChartConfig`/`TableConfig` themselves unconditional so
   `create-panel-request.schema.json`'s reuse of them is unaffected. Adding `metricDeprecated: {"type":
   "boolean"}` to each `$def`'s `properties` (needed so `additionalProperties: false` permits it at all)
   is unaffected by this change and should stay as tasks.md 2.3 already specifies.
   `schemas/bound-panel-response.schema.json` still "inherits the fix for free" under this corrected
   placement too, since its `$ref: "panel.schema.json"` (no fragment) pulls in the whole document
   including the top-level `oneOf`.

### Non-blocking notes

- Everything re-verified this round that round 1/round 2 already established (D1-D5, D7, D8, the
  owner-scoping/join patterns, the `withMetricCleared`/`withMaterializedMetric` mechanics, the
  "metricId present ⟺ resolves" response-side invariant) held up under fresh re-derivation and is
  unaffected by this Change Request — the fix is narrow (relocate one conditional block within the same
  file, not a redesign) and the underlying `metricDeprecated` semantics design.md D6 describes are
  correct.
- Once Change Request 1 is resolved, I'd expect this design to clear — this is the same kind of
  scope/placement error as round 2's, not a new category of problem with the overall design.
