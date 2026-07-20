## Skeptic Report — design gate (round 2)

Scope: verify the revisions made after the round-1 REFUTE genuinely resolve the four change
requests and both non-blocking notes, and check for any NEW contradictions the revisions
introduced. Per instruction, the three self-approved architecture decisions (static-text-only,
dedicated columns, wire names) are not re-litigated — the revisions did not change them.

### What I verified (with evidence)

- **Round-1 CR1/CR2 (image response contract) resolved.** `specs/image-panel-type/spec.md`
  now states (lines 30-37): the response `config` "SHALL include `caption` when a caption is set
  and SHALL omit `caption` when it is unset, following the in-repo spray-json `None`-omission
  convention ... panels of other types carry no `caption` field at all." The clear scenario
  (lines 47-49) reads "the response `config` omits `caption`", and the "string-or-null on every
  response / non-image reports null" clauses are gone, replaced by "A non-image panel config
  carries no `caption` field" (lines 51-53). This matches the real precedent verified in
  `openspec/specs/collection-panel-type/spec.md:33` ("spray-json omits `None` — fields are absent,
  not null") and `:66` ("the response omits `itemOptions`").

- **Round-1 CR3 (chart response contract) resolved identically.**
  `specs/echarts-chart-panel/spec.md` carries the same corrected language for `annotation`
  (lines 28-33 requirement; lines 43-45 null-clears-→-omits scenario; lines 47-49 "A non-chart
  panel config carries no `annotation` field"). Symmetric with the image delta and with the
  house convention.

- **Round-1 CR4 (Option-vs-String modeling ambiguity) resolved.** `design.md` Decision 3
  (lines 43-54) now explicitly specifies `Option[String]` config fields with a **two-level**
  `Option[Option[String]]` Patch (absent⇒unchanged, `Some(None)`⇒clear, `Some(Some(v))`⇒set),
  citing `ChartPanelConfig.Patch.aggregation` and **explicitly rejecting** the single-level
  non-Option `imageUrl` Patch. `tasks.md` 1.3/1.4 match this exactly. I confirmed the cited
  precedent is real: `ChartPanel.scala:218-262` — `aggregation: Option[Option[JsObject]]` with
  `None`/`Some(None)` (on `JsNull`)/`Some(Some(o))` decode; and `ImagePanel.scala:38-63` —
  `imageUrl: Option[String]` single-level with `JsNull ⇒ Some("")`. The plan now models the new
  fields on the correct (aggregation) precedent, which is the one consistent with omit-on-wire.

- **Non-blocking note 1 (PATCH persistence path) resolved.** `tasks.md` 1.2 now explicitly names
  `configColumnsOf`/`configColumnValuesOf` as the HEL-296 single-source-of-truth the PATCH
  `replace` write path uses. I confirmed both exist and are the write set:
  `PanelRepository.scala:242` and `:263`, consumed at `:207-208` by the update path. Adding two
  columns there is required and now called out. (Tuple arity there grows 17→19, still under
  Scala's 22-tuple ceiling — no HList change needed on that method.)

- **Non-blocking note 2 (blank⇒None normalization) resolved.** Decision 3 (line 52-54) requires
  `null`, empty, and whitespace-only to normalize to the cleared state so a cleared caption
  round-trips as an omitted field, "never a stored `""`". `tasks.md` 1.3 restates it
  ("absent/null/blank ⇒ None"). Consistent with CR1-3.

- **No new contradiction from the "string or null" phrasing.** The revised requirements retain
  "SHALL accept an optional `caption`/`annotation` field (string or null)" but scoped to the
  **PATCH input** (string sets, null clears) — not the response — which is accurate. The response
  half is now purely include-when-set/omit-when-unset. The two clauses no longer conflict.

- **Encoder path still yields omit-on-None.** The response emits each subtype's `config.toJson`
  via the derived `jsonFormatN` (`ImagePanel.scala:101-102`, `ChartPanel.scala:310-311`), and
  `DefaultJsonProtocol` omits `None` Option fields — the same mechanism the in-repo `ChartOptions`
  comment documents (`ChartPanel.scala:66-67`). Adding `caption: Option[String]` (jsonFormat3) /
  `annotation: Option[String]` (jsonFormat5) inherits that behavior; the spec's omit-when-unset
  contract is satisfiable as written.

- **Peripheral facts still hold.** Latest migration on disk is `V58__panel_timeline_options.sql`;
  `V59` (design + task 1.1) is the next free slot. `schemas/panel.schema.json` `ImageConfig`/
  `ChartConfig` remain `additionalProperties:false`, so task 2.1 is necessary. MCP delta
  (`specs/mcp-panel-composition-tools/spec.md`) is unchanged, pass-through, correctly de-scoped
  as stretch.

### Verdict: CONFIRM

All four round-1 change requests and both non-blocking notes are genuinely resolved against
ground truth, and the revisions introduced no new contradictions. The spec deltas now describe a
contract (Option field + two-level Patch + SQL NULL when None + omit-on-wire + no field on other
subtypes) that is consistent with the design's own mechanism, the documented spray-json house
convention, and the actual per-subtype nested-`config` wire shape. The plan is sound enough to
implement.

### Non-blocking notes

- `configColumnsOf`/`configColumnValuesOf` return a 17-tuple today; adding the two columns makes
  it 19 — safely under Scala's 22-tuple ceiling, so (unlike the `*` HList projection) those two
  methods stay plain tuples. Flagging so the executor doesn't over-engineer an HList conversion
  there.
- Task 1.6 phrases the response goal as "includes `caption`/`annotation` ... null for other panel
  types" — the "null for other panel types" wording is looser than the (correct) spec deltas,
  which say other subtypes carry no such field at all. Non-blocking since the binding spec deltas
  govern the acceptance trace, but tightening task 1.6 to match ("omitted when unset; other
  subtypes have no such field") would remove the last echo of the round-1 phrasing.
