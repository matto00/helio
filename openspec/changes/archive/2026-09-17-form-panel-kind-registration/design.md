## Context

See proposal.md — Why; every file:line here is re-verified in
`.concertino/runs/HEL-1083/evidence/premise-validation.md`. Three facts frame the approach. The enumeration
surface is NOT registry-derived: `PanelKind.All` (`Panel.scala:120`) is, but `PanelType`
(`model.scala:132-166`) enumerates manually in `fromString` and `asString`, as do `PanelConfigCodec`, the row
mapper, the JSON schemas and the frontend union. A `form` row cannot be inserted until `panels_kind_check`
(`V94:365`) is widened — omitted by the ticket, epic, design spec and driver brief alike. And `panels` has no
`config` JSONB column, storing one typed nullable column per field. Two prior hazards shape the TESTS:
`PanelRowMapper.rowToDomain` ends in `case _ => OutputPanel(...)`, so an unregistered kind decodes silently, and
`configColumnsOf`/`configColumnValuesOf` (`PanelRepository.scala:320-348`) once omitted `output_id`, so writes
kept the old value while returning the new (HEL-909's follow-up to HEL-296). **The snapshot wire's genericity is
EXPORT-direction only (round-1 evaluation CR2 correction)** — `DashboardSnapshotPanelEntry.fromDomain` delegates to
`PanelConfigCodec.encodeConfig` and needed no per-kind change, but the IMPORT side does not: `DashboardSnapshotRepository`
reconstructs each panel from `PanelConfigCodec.decodeCreateConfig`'s `CreateConfig` result through its own closed
match (`TextCreate`/`MarkdownCreate`/`ImageCreate`/`DividerCreate`/`OutputCreate`), a SEPARATE enumeration site from
`PanelServiceHelpers.buildNewPanel`'s otherwise-identical match — see D11. `DatasetFieldDeclaration`
(`DataSource.scala:168`) is the dataset's authoritative `{name, fieldType, required, default}` schema.

## Goals / Non-Goals

**Goals:** a registered `form` kind; a config shape five downstream tickets can build on without reversal; one
migration carrying both schema changes; loud failure wherever silent degradation was possible.

**Non-Goals:** see proposal.md — Non-goals. Design-level additions only: no field-list/dataset-schema consistency
check (HEL-1084's author-time AC), and no form rendering beyond the neutral placeholder D10 requires.

## Decisions

**D1 — Persist the config as a single `form_config` JSONB column on `panels`.** Coordinator ruling (Planning
escalation Q1: `jsonb-column`). Typed columns cannot express an ordered, variable-length field list at all, and a
separate table adds a second write path and RLS surface for what is a config blob read only with its panel.
`data_sources.dataset_schema` (`V106:62`) already stores exactly this shape — a declared field list — as JSONB one
table over. Slick maps it as `Option[String]`: `panels.appearance` has been JSONB since `V33__jsonb_columns.sql:26/30`
and is mapped `MappedColumnType.base[PanelAppearance, String]` over it, which works because
`application.conf:32`/`:109` set `properties.stringtype = "unspecified"` (without it PostgreSQL rejects a VARCHAR
parameter for a JSONB column). `data_sources.dataset_schema` is written the same way as a plain `Option[String]`. A
malformed stored `form_config` therefore stays READABLE via the tolerant decode below, but cannot be PATCHed without
resupplying `dataSourceId`, since `Empty` is invalid under D5. Rejected: typed columns (cannot represent a list),
separate table (over-engineered, new ACL surface).

**D2 — One migration, V108, carrying both changes.** It widens `panels_kind_check` to admit `form` AND adds
`form_config JSONB NULL`. Two migrations would let a lane apply one without the other; the repo's
keep-schema-with-code rule and the shared dev database both argue for one atomic unit. A CHECK cannot be widened in
place, so V108 runs `DROP CONSTRAINT panels_kind_check` then `ADD CONSTRAINT` with the six-value predicate, dropping
V94's vestigial `kind IS NULL OR` disjunct (`kind` is `NOT NULL` since `V94:1213`, so admitting NULL misdescribes the
column). Statements are bracketed with `NO FORCE`/`FORCE` as **defensive consistency only, not as a fix for V94/V106's
failure mode** (CR1-round-1 correction): those bracket because they run DML against a policy lacking `missing_ok`,
whereas V108 is pure DDL and every `panels` policy uses `missing_ok`. No policy change is needed — and accurately,
`panels` has **four** policies: `panels_select`/`panels_update` on `dashboard_id`, `panels_delete` joining
`dashboards.owner_id`, and **`panels_insert` on `owner_id`** (V36:143-168). None read a config column.

**D3 — A form field references a declared dataset field; controls are orthogonal to field types.** Coordinator ruling
(Q2: `reference-declared-field`). A field entry is `{sourceField, control, label?, placeholder?, helpText?, required?,
initialValue?, step?, options?}`, a CLOSED set — an unrecognized attribute is rejected with a 400, never silently
dropped (C8). `control` is one of `text | textarea | number | date | select | checkbox | file` — a **presentation**
vocabulary, deliberately orthogonal to the dataset's seven `DataFieldType` values. A control is how a value is
entered; a field type is what the dataset declares it to be. A form field therefore never re-declares its own type:
the dataset's declaration stays the single authoritative source (design-spec Decision 3), and the form only references
it and overrides presentation. This is the only shape under which HEL-1084's AC — an author-time mismatch between form
fields and the dataset's schema — is checkable at all; a self-describing field could contradict the declaration with
nothing able to detect it. **Downstream tickets must read this distinction as load-bearing, not incidental.**

**D3a — precedence, so no form attribute can contradict the declaration (CR1).** `initialValue` (renamed from
`defaultValue`) is prefill-only: it seeds the control and never changes what is stored for an omitted field, leaving
`DatasetFieldDeclaration.default` the sole write-time fill — different names because they are different concerns, so
there is nothing to rank. `required` is tighten-only: absent inherits the declaration, `true` adds a form-level
requirement, and `required: false` is rejected by `validateConfig` as malformed, so a form can never show a
dataset-required field as optional and then fail at submit (HEL-1087). That is enforceable with no access to the
dataset schema, which a documented precedence rule alone would not be. So HEL-1084's author-time check covers field
names and control-to-type fitness only. A counter is `control: "number"` plus `step`, whose PRESENCE is the
discriminator. `step` is included in the attribute set above, so HEL-1088 needs a delta to NEITHER the control set nor
the attribute set. A future `min`/`max` would be an additive delta to the capability — additive, but a real spec
change rather than a silent extension.

**D4 — `submit` is `{writeMode, label?, resetOnSuccess?}` with `writeMode` fixed to `append`.** The design spec makes
write mode per-write, and a form submit appends. `replace` is accepted by the dataset write API but is meaningless
from a form, so it is rejected here with a message naming `append`, rather than silently coerced. Modelled as an
object, not a bare string, so HEL-1087/1088 can add submit-time concerns without a wire break.

**D5 — `validateConfig` requires a non-empty `dataSourceId`.** Mirrors `OutputPanel.validateConfig`'s `outputId` rule.
This is what makes the agent path fail *loudly* (D7). It does not disturb `PanelType.Default`: the default remains
`divider`, which is config-valid empty, so an ordinary typeless `POST /api/panels` is unaffected — the exact
regression that made `Divider` the default in the first place.

**D6 — Reject a missing or cross-owner `dataSourceId` at create/patch time.** Mirrors
`PanelService.rejectMissingOutput` verbatim, including its nullable-optional repository wiring so no existing fixture
changes behaviour, and its `findByIdOwned` → not-found mapping so existence is not leaked. Because `dataSourceId`
lives inside JSONB there is no FK to catch a dangling reference, so without this check the foundation would persist
unvalidated cross-tenant references for HEL-1087 to inherit. Structural only — schema consistency stays with HEL-1084.

**D7 — `form` is added to the agent-facing proposal surfaces; the binding gap stays open and tracked.** Coordinator
ruling (Q3), in the owner's own formulation: "file a ticket to fix the gap, add to surfaces for now." So `form`
propagates into `dashboard-proposal.schema.json`, `AssistantProposalToolSchemas.scala`, `proposal.ts` and `write.ts`,
and `scripts/check-schema-drift.mjs` is **not** touched — no carve-out beside `divider`. The proposal wire carries no
**typed** data-source field, so `buildNonDataConfig` falls to its `case _ => None` and a proposal supplying no config
is rejected by D5 with a 400. It is **not** true that an agent-proposed form can never bind a source (CR5 refuted
that): `ProposalPanel.config` is a generic passthrough merged by `mergeConfig` (`ProposalPanelSupport:133-149`) into
`decodeCreateConfig`, so a proposal emitting `config.dataSourceId` **is created successfully** — and remains subject
to D6's cross-owner rejection, which this change pins with a test. The real gap is the missing first-class field plus
absent agent prompt copy (deliberately not updated, so `form` is proposable but never suggested). **No guard silently
drops or auto-repairs either shape** — silent degradation is the failure shape this change exists to avoid, and the
same shape already found in `PanelContent.tsx` and `PanelRowMapper`. The gap is tracked as a coordinator-filed
follow-up ticket, stated plainly in proposal.md, the capability spec, and the PR body so it cannot be mistaken for an
oversight. Not touching a pre-commit-invoked script also means the CON-132 gate-chain checklist and per-script
isolation test do not apply to this change.

**D8 — Register in `PanelRowMapper.rowToDomain` explicitly and prove it.** Because that method ends in `case _ =>
OutputPanel`, a form row omitted there decodes as an output panel with every test still green. The round-trip test is
therefore mutation-proven: removing the `form` arm must turn it red, and that mutation is recorded.

**D9 — ONE strict decoder; two callers with different obligations (round-3 CR3, re-layered after round-4 CR1).**
Three layers, named explicitly because round 3 left the locus ambiguous enough that no single implementation could
satisfy tasks 1.2, 1.9 and 4.9 together: **(i)** `FormFieldSpec.decode` is STRICT — an unrecognized field attribute
is a decode FAILURE, raised as a plain decode error carrying no HTTP meaning; **(ii)** `decodeCreate`/`Patch.decode`
are the ONLY callers that MAP that failure to a 400 — the write-path rule is the MAPPING, not the strictness (C8);
**(iii)** `PanelRowMapper.rowToDomain`'s `form` arm calls `decode` inside a catch and falls back to
`FormPanelConfig.Empty` with a logged warning naming the panel id, so a row written by a later `min`/`max` version
and then rolled back reads as an unconfigured panel instead of 500-ing every read of its dashboard. The two
obligations do not collide: dropping an attribute the caller just supplied is forbidden, while a whole-config decode
failure degrades to a visibly-unconfigured, logged panel — never a pretend-valid config.

**D10 — The frontend if-chain fallthrough is FIXED here, not deferred (round-3 CR2).** `PanelContent.tsx:296-319`
dispatches panel kind through an `if`-chain of type guards and ends in `return <MetricRenderer data={data} />` beneath
a comment asserting the union is closed. An `if`-chain is not typecheck-protected (C10), so adding `form` to the
union leaves `tsc` and Jest green while a `form` panel renders as a metric. Because this change makes `form`
API-creatable, that is a live wrong render rather than a deferrable gap: task 3.4 adds an explicit `form` branch
rendering a neutral unconfigured state and corrects the now-false comment. The real form UI stays HEL-1085's.

**D11 — The dashboard-import reconstruction match is a SEPARATE enumeration site from `buildNewPanel`, and needs its
own `FormCreate` arm (round-1 evaluation CR2, C9).** `DashboardSnapshotRepository`'s panel-reconstruction match
(export/import path) and `PanelServiceHelpers.buildNewPanel` (create path) both pattern-match the same
`PanelConfigCodec.CreateConfig` ADT into the same six `Panel` subtypes, but they are two independently-maintained
`match` expressions in two files — adding a `CreateConfig` variant to one does not add the corresponding arm to the
other. This was NOT flagged in this change's own Context/Impact list before round-1 review (the Context's snapshot-wire
genericity claim was true only for the export direction, not import — see the Context correction above), and the
omission would have surfaced as a `MatchError` — not a compile error, since the match was non-exhaustive rather than
sealed-closed — on the first dashboard-import containing a `form` panel. Fixed here by adding the `FormCreate` arm;
proven load-bearing by mutation (task 4.7 removing `PanelRowMapper`'s `form` arm turns task 4.4's export/import test
RED, confirming the import path actually depends on `form`-aware reconstruction end to end). Recorded here, not
merely asserted, so a future panel kind's author checks BOTH match sites rather than inheriting this change's
original false premise that the snapshot wire needs no per-kind work at all.

## Out-of-scope enumerations, decided explicitly (C9)

Recorded here so each omission is verifiable from the plan rather than asserted (round 2 found `PanelPacker` claimed
as deferred while appearing in no artifact — i.e. dropped):

- **`PanelPacker.Bounds` (`PanelPacker.scala:39-42`) — DEFERRED to HEL-1085.** It maps only
  `Output`/`Image`/`Markdown`, so `clamp` falls to `DefaultBounds(minW = 1)` via `getOrElse` (`:59`) and a `form`
  panel on an `/auto-layout` re-flow can be clamped to `minW = 1`. This is silent-default shaped, and it matters only
  once a form actually renders, which is HEL-1085. Reported to that lane rather than fixed here.
- **`RefinementEditShape.scala:181-219` — DEFERRED.** Its patch-set prompt copy enumerates the content kinds in worked
  examples, so a `form` panel is un-refinable through patch sets. Same family as task 2.6's deliberate prompt-copy
  deferral, and it breaks no gate (`RefinementEditShapeSpec` pins the examples, which stay untouched).
- **`create_content_panel` (`placements.ts:87`, `placementsHandlers.ts:71`, `helioApi.ts:924`) — EXCLUDED BY
  DEFINITION, not deferred.** That tool documents itself as creating a panel with "no data binding at all"; a `form`
  panel binds a source, so it is categorically not a content panel. This is why `write.ts:739` (`update_panel`, which
  spans every kind) IS updated in task 2.5 while these three are not — the asymmetry is a category distinction, not an
  oversight.

- **`PanelDetailModal.tsx` (`activeEditorRef` `:193-197`, `renderSubtypeEditor` `:313-346`) — DEFERRED to
  HEL-1084.** Two more if-chains of the same type guards, both falling to `return null`, reached via the `:447`
  ternary. A `form` panel therefore opens the detail sheet with an EMPTY subtype editor body. Unlike
  `PanelContent`'s fallthrough (D10) this is benign and literally correct — there is no form editor to show until
  HEL-1084 builds the field-type builder — so it is deferred rather than fixed. Not typecheck-protected (C10).
  Note the adjacent comment "Output-kind panels: no subtype editor" becomes INCOMPLETE, not false, once `form`
  also reaches that `return null`.

## Risks / Trade-offs

- **A knowingly-unbound agent path ships.** → Loud 400, never a silent drop; stated in three artifacts and the PR
  body; tracked by a coordinator-filed ticket.
- **A config column omitted from `configColumnsOf` silently preserves stale values.** → Folded into both tuples here,
  with a patch test that fails if it is not (C4).
- **JSONB config is unvalidated at the DB layer.** → Strict write-path validation plus the tolerant, logged read path
  of D9.
- **The migration lands in a shared dev database.** → V108 becomes visible to every lane, but is additive (nullable
  column, re-added CHECK) so it cannot break an existing lane's reads.
- **RLS is never exercised in dev or CI (superuser bypass).** → No new table and no policy change, so no RLS surface
  is added (D2).

## Planner Notes

Self-approved: the `FormFieldSpec` attribute set as defined in D3 (closed, 400-enforced) — enumerated there and in the
spec requirement, deliberately NOT re-listed here, since that duplication produced a gate finding in three consecutive
rounds — which makes HEL-1088's counter a CONFIGURATION rather than a delta to either set; modelling `submit` as an
object rather than a string (D4); and the `form-panel-type` capability name, following the existing
`divider-panel-type`/`image-panel-type` precedent.

Standing constraints C1–C11 (C1–C5 at Planning, C6–C11 promoted by the design gate; C1 retired, never deleted)
are recorded in `workflow-state.md` and mirrored in `tasks.md`.