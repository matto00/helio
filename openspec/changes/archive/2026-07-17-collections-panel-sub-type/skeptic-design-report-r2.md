## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read the round-1 report (`skeptic-design-report.md`) and the revised `proposal.md`, `design.md`,
  `tasks.md`, and all `specs/*/spec.md` in full.

**Round-1 CR1 (second `PanelType` enum) — verified fixed:**
- `backend/.../domain/model.scala:58-84` still defines the hand-written `sealed trait PanelType` with
  7 case objects and `fromString`/`asString` exhaustive matches — confirms the original finding is real
  and still present in code (not yet implemented, correctly — this is a design gate).
- `PanelServiceHelpers.scala:96-106` (`validatePanelType`/`validatePanelTypeOpt`) still calls
  `PanelType.fromString` directly and gates `resolveCreateConfig` (line 51-53) — the live gate on
  `POST/PATCH /api/panels`, confirmed unchanged.
- `PanelServiceHelpers.scala:72-86` (`buildNewPanel`) is a `createConfig match` over the sealed
  `PanelConfigCodec.CreateConfig` trait with exactly 7 arms today — confirmed non-exhaustive once
  `CollectionCreate` is added, exactly as design.md D8 / task 1.7 state.
- `DashboardServiceValidation.scala:53` (`validatePanelEntries`) confirmed still calling
  `PanelType.fromString(entry.type)` on the dashboard-import path — task 1.8 targets this correctly.
- `DashboardProposalService.scala:271` (`DataPanelKinds = Set("metric","chart","table")`) confirmed;
  task 1.8 adds `"collection"` here. Also traced a *second*, closely-related call
  (`DashboardProposalService.scala:74`, `PanelType.fromString(panel.type)` inside `validatePanel`) —
  this one is **automatically** fixed by the `model.scala` case-object addition (task 1.7) since it
  calls the same shared `fromString`; it needs no separate task-list entry, and design.md/tasks.md
  correctly do not list it as a distinct file to touch.
- design.md's new "Critically, there is a SECOND independent panel-kind enum" paragraph (D8, lines
  101-108) and proposal.md's Impact section (lines 56-61) name all four required files precisely, and
  tasks 1.7/1.8 map 1:1 onto them. `specs/collection-panel-type/spec.md`'s "Collection config survives
  duplication and export" requirement (survives import specifically) and its "round-trip through list
  responses" scenario now give this an explicit acceptance signal. **CR1 is genuinely and precisely
  addressed.**

**Round-1 CR2 (silent page-size fallback) — verified fixed:**
- `frontend/.../hooks/usePanelData.ts:97-103` confirmed unchanged: `chart→200`, `table→50`, else→10 —
  `collection` still absent from the running code (expected, pre-implementation).
- design.md D4 now states explicitly: "the initial page size is a deliberate, explicit `case
  "collection"` in `usePanelData.ts`'s per-kind page-size switch set to 50 (table parity) — NOT the
  silent 10-row `else` bucket." Task 4.2b names the file and the value directly, cross-references
  "skeptic CR2." **CR2 is genuinely and precisely addressed**, with a documented rationale (table
  parity) rather than an arbitrary number.

**Fresh scrutiny beyond the two round-1 items (this round):**
- Confirmed `mobilePanelHeights.ts`'s `computeMobilePanelHeight` (lines 87-105) is a non-default
  `switch (kind: PanelKind)` with exactly 7 arms today (`metric/chart/table/markdown+text+image+
  divider`) — TS exhaustiveness genuinely forces an explicit `collection` arm; D5's claim holds.
- Confirmed `panelSlots.ts`'s `PANEL_SLOTS: Record<PanelType, PanelSlot[]>` (7 keys today) —
  TS exhaustiveness genuinely forces a `collection: []` entry; D2/Planner-Notes claim holds.
- Confirmed the HEL-248 `chartOptions`-keying precedent is real and structurally analogous
  (`ChartPanel.scala`'s `LineChartOptions`/`BarChartOptions`/etc., each independently shaped, all
  optional fields) — D3's "keyed per base type, nothing destroyed on switch" design is grounded in an
  existing, working pattern, not invented from scratch.
- Confirmed `panel.schema.json`'s `oneOf`/`$defs` dispatch mechanism (lines 26-48) supports adding a
  `collection` variant + `$defs.CollectionConfig` exactly as D1/task 2.1 describe — no structural
  surprise there.
- Confirmed `panelPayloads.ts`'s `seedCreateConfig` (lines 58-93) is an exhaustive `switch (type:
  PanelKind)` — a `collection` arm is compiler-forced, consistent with D6/task 3.3; the existing
  `metric/chart/table` arm pattern (`{...base, dataTypeId: dataTypeId ?? ""}`) is the template D6's
  proposed collection arm follows.
- Confirmed `TypeConfig` (types/panel.ts:342-346) is a narrow union (`metric | chart | image` only, not
  exhaustive over `PanelKind`) — D6's claim that collection needs no step-3 `TypeConfig` variant is
  structurally consistent (divider/text/markdown/table also have none).
- Confirmed the standalone Metric editor's actual field semantics
  (`MetricBindingFields.tsx`: `value` is bind-only via a plain field selector; `label`/`unit` use
  `BoundOrLiteralField`/`BoundOrLiteralState`) — this is exactly what D7 and the
  `collection-config-editor` spec claim the Collection editor will reuse for its `metric` base-type
  slots. Not invented — a faithful port of the existing HEL-243 pattern.
- Read all six spec deltas (`collection-panel-type`, `collection-panel-rendering`,
  `collection-config-editor`, plus the three MODIFIED deltas) in full: each requirement has a concrete,
  falsifiable scenario (import round-trip, absent-vs-null PATCH semantics, malformed-options-doesn't-500,
  390px overflow, mobile touch targets, desktop internal scroll). No placeholder/TBD language found
  anywhere in proposal.md/design.md/tasks.md/specs.
- Checked scope discipline against the ticket's binding constraints: homogeneous-only, Metric-first,
  no-schema-change-for-future-base-types, HEL-243 editor-family reuse, mobile explicit entry,
  V53/V55/V56 storage precedent (incl. both mapper directions), and the three explicit out-of-scope
  items (heterogeneous, reorder, per-item overrides) are all named and none are silently expanded into
  by any task.

### Verdict: CONFIRM

Both round-1 blocking items are genuinely fixed at the artifact level — not just asserted but traceable
1:1 to real files/line numbers I re-verified myself — and each now has an explicit spec scenario giving
it an acceptance signal. My own fresh pass across the storage mechanism, TS exhaustiveness points, editor
field-semantics reuse, and schema dispatch mechanism found nothing else load-bearing that's missing,
contradictory, or hand-waved. The plan is sound enough to implement.

### Non-blocking notes

- Same as round 1: the pre-existing `panel-creation-datatype-step` spec/code drift around `markdown`
  being data-bound in code but documented as non-data-bound in the base spec is untouched by this
  proposal (not a regression it introduces) — still worth a separate follow-up ticket, not a blocker
  here.
- design.md's Planner Note "no `DemoData` seed for collections; verification binds an existing
  multi-row demo DataType via the UI" is a reasonable scope call given the ticket's DoD, but the
  executor/evaluator should confirm a genuinely multi-row (not single-row) demo DataType actually
  exists in `DemoData` before relying on it for verification — worth a quick sanity check at execution
  time, not a design defect.
