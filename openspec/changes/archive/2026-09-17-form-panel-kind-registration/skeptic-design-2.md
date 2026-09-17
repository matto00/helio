## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### Headline: no round-1 change request was merely re-worded

All five were fixed by changing what will actually be built, and I verified each against the
tree rather than against the revision's own description. Two new items are raised below — one a
defect introduced *by* this revision, one a round-1 non-blocking note that was dropped rather
than deferred.

### What I verified (with evidence)

**Authority record.** `.concertino/runs/HEL-1083/answer.json` read directly: `subAnswers` =
`jsonb-column`, `reference-declared-field`, `add-to-proposal-surfaces`, `complete: true`. D1,
D3, D7 implement those three faithfully. Not relitigated.

**CR1 — FIXED, and mechanically enforceable.** The change is substantive, not lexical:
`defaultValue` → `initialValue` is a rename that removes the collision with
`DatasetFieldDeclaration.default` (`DataSource.scala:168-173`, `required: Boolean = false`,
`default: Option[JsValue]`) rather than ranking two same-named fields, and `required` is now
tighten-only with `required: false` **rejected** — a new rule in `validateConfig` (task 1.2),
a new spec scenario (`spec.md:90-92`), and checkable with zero access to the dataset schema
(`Option[Boolean]`: absent → inherit, `true` → tighten, `false` → 400). D3a, D3, the spec
requirement text and Planner Notes (`design.md:140-141`) all now say `initialValue`; I grepped
the change dir and found no surviving `defaultValue` and no remaining statement that a form
attribute can override the declaration. Correct and enforceable.

**CR2 — FIXED; drift guard is now satisfiable.** I re-enumerated independently (repo-wide grep
for panel-kind literals, not a read of the plan's list), then re-derived the guard's own
surfaces from `scripts/check-schema-drift.mjs:215-303` and `:526-545`:
`canonicalPanelTypes` is parsed from `PanelType.fromString`, so `form` enters it automatically;
it is compared against `create-panel-request`, `panel`, `update-panels-batch` (tasks 2.1-2.3);
`agentFacingPanelTypes` (canonical minus `divider`) against `dashboard-proposal.schema.json`
(2.4) and `proposal.ts` `PANEL_TYPES` (2.5); and `ProposalPanelSchema.type` is compared
**set-equal in both directions** against the proposal schema (`:537-543`), which task 2.4 now
covers by naming `AssistantProposalToolSchemas.scala:51` (confirmed at that exact line:
`"type" -> enumSchema("text", "markdown", "image", "output")`). With 2.1-2.5 as written,
`check:schemas` is satisfiable. `write.ts:739` is confirmed at that line and is in task 2.5.
2.6's prompt deferral is stated, and `AssistantSystemPromptSpec:110` /
`DashboardAuthoringPromptSpec:126` are the pins that make "untouched" verifiable.
My enumeration turned up three sites the plan does not mention — see CR-2 below; none of them
break a gate.

**CR3 — FIXED, and the named read path genuinely reaches the mutated code.** Verified, not
accepted: `PanelRepository.findByIdInternal` exists at `:115` and returns
`.map(_.map(rowToDomain))` (`:117`); `rowToDomain` delegates to `PanelRowMapper.rowToDomain`
(`:27-28`); the PATCH path `replace` also re-reads through it (`:259-267`), and
`PanelMutationRepository.batchUpdate` rebuilds via `rowToDomain(row)` (`:104`). So task 4.3b's
path does traverse the `case _ => OutputPanel` fallthrough (`PanelRowMapper.scala:35-46`) and
the spec scenario "A persisted form panel does not decode as another kind" (`spec.md:137-139`)
now has a test that can fail. 4.3a's inline NOTE correctly records why the POST-response
assertion cannot: `insert` is `... .map(_ => panel)` (`PanelRepository.scala:214-216`) and
`PanelRoutes.scala` exposes no authenticated GET (routes read: `updateBatch`, `batch`,
`pathEndOrSingleSlash` POST, `PATCH`/`DELETE` on id, `:id/duplicate`). 4.7 now names only 4.3b
and 4.4 as red and explicitly requires confirming 4.3a stays green. C7 captures the general
rule. Genuine fix.

**CR4 — FIXED; premise re-derived from V36 myself.** `V36:143-168` read in full: four policies
— `panels_select`/`panels_update` on `helio_can_access_dashboard(dashboard_id)`,
`panels_delete` joining `dashboards.owner_id`, and `panels_insert` `WITH CHECK (NULLIF(
current_setting('app.current_user_id', true), '')::uuid = owner_id)`. D2 (`design.md:54-56`)
now states exactly that, including `panels_insert` on `owner_id`, and relabels the
`NO FORCE`/`FORCE` bracketing as defensive-consistency-only with the correct reason (pure DDL;
every `panels` policy uses `missing_ok`). **Dropping V94's `kind IS NULL OR` disjunct is safe:**
`V94:365` created `CHECK (kind IS NULL OR kind IN (...))` and `V94:1213` later runs
`ALTER COLUMN kind SET NOT NULL`, so the disjunct can only ever match a row the NOT NULL
constraint already forbids — removing it tightens nothing reachable and makes the CHECK
describe the column honestly. Task 1.1 now spells out DROP + ADD with the six-value predicate.

**CR5 — FIXED, and the narrowed claim is accurate on the real path.** Re-derived:
`mergeConfig` (`ProposalPanelSupport:136-148`) has `case (None, Some(c)) => Some(c)`, so a
passthrough `config` survives even when `buildNonDataConfig` returns `None` (`:187`, `case _ =>
None`), and the `outputId` re-application only fires when `outputId` is present — so
`config.dataSourceId` does reach `decodeCreateConfig` and a config-bound agent form IS created.
proposal.md:58-68, D7 (`:100-114`) and the spec requirement (`:141-153`) now all say "no
**typed/first-class** field" rather than "cannot bind", and task 4.6b pins both halves,
including the security-relevant cross-owner rejection. C1 is marked RETIRED (not deleted) and
C6 carries the corrected rule in both `workflow-state.md` CONSTRAINTS and tasks.md.

**Round-1 non-blocking notes.** `file`-persists-before-upload is now a stated spec scenario
(`spec.md:94-96`) — actioned. The counter discriminator is decided (D3a, `spec.md:70-72`) but
incompletely — see CR-1. `FormPanelConfig.Empty` is in task 1.2 and the tolerant-read tradeoff
is in Risks (`design.md:128-130`), though the "a malformed row cannot be PATCHed without
resupplying `dataSourceId`" consequence is still unstated (non-blocking). `PanelPacker.Bounds`
appears nowhere in any artifact — see CR-2.

**No mtime/positional evidence was relied on anywhere in this report**; every finding cites
file:line content I read this round.

### Verdict: REFUTE

Two items, both cheap and specific. Neither reopens an owner ruling, and neither undoes any of
round 1's five fixes — which all stand.

### Change Requests

**1. The counter decision is half-made: `step` is normative in the spec but absent from the
type being built, and unknown-attribute handling is unspecified.** `spec.md:70-72` says a
counter "SHALL be expressed as `control: "number"` carrying a `step` attribute, whose PRESENCE
is the counter discriminator", and D3a (`design.md:78-79`) concludes HEL-1088 "needs no new
control value and no delta to the closed control set". But the enumerated field-entry attribute
set — `spec.md:50-51` ("MAY additionally carry `label`, `placeholder`, `helpText`, `required`,
`initialValue`, and — for `select` — `options`"), D3 (`design.md:60`), and task 1.2's
`FormFieldSpec` — does **not** include `step`, and nothing in the plan states whether
`FormFieldSpec.decode` rejects, ignores, or preserves an attribute outside that set. The two
outcomes are both bad and the plan does not choose: if decode is strict, HEL-1088 *does* need a
spec delta here (contradicting D3a's own claim, and the closed-control-set argument does not
rescue it because the delta is to the attribute set, not the control set); if decode is
tolerant, a config carrying `step` round-trips with `step` silently dropped — the exact
silent-degradation shape D7/D8 exist to prevent, and it would surface as an HEL-1088 counter
that loses its step size on the first PATCH. Fix: either add `step?` to the field-entry
attribute set in `spec.md:50-51`, D3 and task 1.2 (it is inert here, like `file`, and a
`file`-style "persists before semantics exist" scenario is the established precedent in this
very spec), or delete the normative `step` sentence and say plainly that HEL-1088 will add
`step` as a spec delta to this capability. Either way, state explicitly in task 1.2 whether
`FormFieldSpec.decode` preserves or rejects unrecognized field attributes — that is an
implementation decision this ticket's executor has to make and currently cannot look up.

**2. Round-1's `PanelPacker.Bounds` note was dropped, not deferred, and two non-gate
enumeration sites are undocumented.** (a) `PanelPacker.Bounds` (`PanelPacker.scala:39-42`) maps
only `Output`/`Image`/`Markdown`; `clamp` falls to `DefaultBounds(minW = 1, ...)` via
`getOrElse` (`:59`), so a `form` panel on `/auto-layout` re-flow can be clamped to `minW = 1`.
A repo-wide grep of the change dir finds **no mention of `PanelPacker` in proposal.md,
design.md, tasks.md, or either spec** — so the claim that it is "deferred and reported to
HEL-1084/1085" is not evidenced anywhere I can verify from the artifacts, and a reader of this
change cannot tell the omission was deliberate. Add one line (Risks or Non-goals) recording the
silent-default and where it was reported; a report I cannot see in the plan is indistinguishable
from the note being dropped. (b) Two further kind enumerations exist that the plan neither
updates nor records: `helio-mcp` content-panel creation
(`placements.ts:87`, `placementsHandlers.ts:71`, `helioApi.ts:924`, all
`"text" | "markdown" | "image" | "divider"`) and `RefinementEditShape.scala:181-219`, whose
patch-set prompt copy enumerates the content kinds, making a `form` panel un-refinable through
patch sets. Neither breaks a gate and both are defensibly out of scope — but the plan picked up
`write.ts:739` for exactly this reason (un-updatable via MCP), so the asymmetry needs one
sentence deciding it, not silence. State the deferral, the same way 2.6 states the prompt one.

### Non-blocking notes

- D1 (`design.md:43-44`) calls `appearance` a "`MappedColumnType`-over-text precedent".
  `panels.appearance` has been **JSONB** since `V33__jsonb_columns.sql:26/30`; the mapping is
  `MappedColumnType.base[PanelAppearance, String]` (`PanelRepository.scala:293`) over a JSONB
  column, which works because `application.conf:32`/`:109` set
  `properties.stringtype = "unspecified"`. The conclusion is *better* supported than the
  wording suggests (`data_sources.dataset_schema` is JSONB written as a plain
  `Option[String]` — `DataSourceRepository.scala:380`, `:1081`), but the phrase "over-text" is
  wrong and will mislead a downstream reader. Fix the wording, not the decision.
- Spec scenario "Create then read preserves the whole config" (`spec.md:129-131`) says
  "created and then fetched", but there is no authenticated GET (C7). Tasks 4.3a/4.3b implement
  it correctly via the route response plus a repository re-read; the scenario's wording is the
  only thing that implies an endpoint that does not exist.
- The `FormPanelConfig.Empty` consequence from round 1 — a malformed stored form row stays
  readable but cannot be PATCHed without resupplying `dataSourceId` — is still unstated in D1
  or Risks. One line would close it.
- design.md Risks (`:135-136`) still describes the bracketing as "follows the established
  V94/V106 pattern". That is now accurate as written (a pattern, not a failure class), so I am
  not asking for a change; noting only that D2 and Risks should not drift apart if either is
  edited again.
