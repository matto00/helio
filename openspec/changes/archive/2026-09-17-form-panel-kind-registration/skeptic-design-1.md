## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Authority record (owner rulings vs. self-approved).** Read
`.concertino/runs/HEL-1083/answer.json` and `events.jsonl` directly. `escalation.answered`
carries `answer_source=human`, `resolution_channel=cli`, `complete=true`, sub_answers
`["jsonb-column","reference-declared-field","add-to-proposal-surfaces"]`. The three ruled
values match design.md D1/D3/D7 as claimed. D1 implements `jsonb-column` faithfully
(`form_config JSONB` on `panels`). D7 implements `add-to-proposal-surfaces` faithfully
(schema + `proposal.ts`, `check-schema-drift.mjs` untouched, no `divider`-style carve-out).
D3 implements `reference-declared-field` **structurally** but contradicts its own stated
rationale — see CR1. I treat the three ruled values as settled and do not relitigate them;
CR1 and CR5 are about the plan's *implementation* of Q2/Q3, which is in remit.

**Ground truth read (not taken from the premise-validation narrative).**
- `Panel.Registry` is at `Panel.scala:87` with 5 entries; `PanelKind.All = Panel.Registry.keySet`
  (`:120`). `PanelSpec.scala:57-73` asserts the keySet against an explicit 5-element set
  (fails closed). Confirmed.
- `PanelType` (`model.scala:132-166`): `fromString` (`:151`) and `asString` (`:160`) both
  enumerate manually; `Default = Divider` (`:149`) with the comment recording exactly the
  required-config regression the plan cites. Confirmed.
- `panels_kind_check` (`V94:365`) = `CHECK (kind IS NULL OR kind IN ('output','text',
  'markdown','image','divider'))`; `ALTER COLUMN kind SET NOT NULL` at `V94:1213`; only
  occurrence repo-wide. Highest migration version is **107** (`ls | sed | sort -n | tail`),
  so V108 is correct and free. Confirmed.
- `PanelRowMapper.rowToDomain` (`:34-45`) ends `case _ => OutputPanel(...)`; `domainToRow`
  (`:73-80`) ends `case _ => base`. Both fallthroughs real. Confirmed.
- `configColumnsOf`/`configColumnValuesOf` (`PanelRepository.scala:320-348`) are 7-tuples;
  the in-file comment records the `output_id` omission defect verbatim. Confirmed.
- `PanelConfigCodec` has exactly the four dispatch sites claimed (`:23`, `:36-41`, `:45-55`,
  `:65-72`). `PanelServiceHelpers.buildNewPanel` (`:138-144`) is a fifth, exhaustive on the
  sealed `CreateConfig`. Confirmed.
- **D5's no-regression claim on `PanelType.Default` is CORRECT.**
  `resolveCreateConfig` (`PanelServiceHelpers:109-112`) routes `validatePanelType(None) =>
  PanelType.Default` through `PanelType.asString` into `decodeCreateConfig`, i.e. a typeless
  `POST /api/panels` decodes as `"divider"` → `DividerCreate` → `DividerPanel`, whose
  `validateConfig` (`DividerPanel.scala:99-103`) only constrains `weight`. Requiring a
  non-empty `dataSourceId` on `form` cannot reach that path. Verified, not assumed.
- **D7's "fails loudly, never silently dropped" is CORRECT for the no-config shape.**
  Traced: `validatePanel` (`ProposalPanelSupport:31-45`) — `form` passes `PanelType.fromString`
  once added, is not in `DataPanelKinds = Set("output")` (`DashboardProposalService:170`) so no
  `outputId` demand, not `"divider"` so no orientation check. `preValidateBindings` →
  `bindingCandidate = panel.outputId = None` → `Right`. `buildCreateRequest` →
  `buildNonDataConfig` `case _ => None` (`:187`). `DashboardProposalService:113` then calls
  `panelService.create`, reaching `validateConfig` → 400. No silent drop anywhere on that path.
  C1 is satisfied for that shape — but not for the shape in CR5.
- `PanelResponse.fromDomain` (`PanelProtocol.scala:121-137`) and
  `DashboardSnapshotPanelEntry.fromDomain` (`DashboardProtocol.scala:174-187`) are both
  **generic** (`panel.kind` + `PanelConfigCodec.encodeConfig`) — no per-kind arm. The plan's
  omission of `PanelProtocol.scala` from its impact list is therefore correct, and the
  snapshot-wire-is-already-generic claim in design.md Context holds. Verified.
- V36:143-168 read in full for CR4. `check-schema-drift.mjs:190-305` and `:505-545` read in
  full for CR2. `PanelRoutes.scala` and `PanelRepository.insert` read in full for CR3.

### Verdict: REFUTE

Five independently actionable revisions. Four are plan defects that would surface as a broken
gate or a downstream bug; one (CR4) is a false premise recorded in a design record that five
tickets will read. The overall shape of the plan — jsonb column, one migration, explicit
mapper arm, both column tuples, loud agent failure — is sound, and the enumeration work is far
more complete than the ticket's own claim. Nothing here requires re-deciding an owner ruling.

### Change Requests

**1. Resolve the `required`/`defaultValue` contradiction inside D3, and state precedence.**
design.md D3 (line 64-66) and specs/form-panel-type/spec.md (line 57-59) both assert the
dataset declaration is "the single authoritative source of a field's type, **required-ness, and
default**" — while the same D3 (line 58) and the same requirement (line 50-51) give
`FormFieldSpec` its own `required?` and `defaultValue?` attributes. Ground truth:
`DatasetFieldDeclaration` (`DataSource.scala:168-173`) already carries `required: Boolean` and
`default: Option[JsValue]`, so these two attributes genuinely duplicate an authoritative
declaration — unlike `label`/`placeholder`/`helpText`/`options`, which are purely presentational
and have no dataset counterpart. As written the plan both forbids and mandates the duplication.
This is load-bearing and unresolved in three directions: does a form field's `required: false`
override a dataset-declared `required: true` (which `DatasetRowValidator` will then reject at
submit time, HEL-1087, producing a form that cannot submit a row it told the user was optional)?
Does `defaultValue` prefill only, or override the dataset's `default` on write? Is HEL-1084's
author-time mismatch check supposed to flag `required`/`default` divergence as a mismatch?
Pick one model, state it in D3 and in the requirement text, and add a `validateConfig` or
scenario consequence for it. (The Q2 ruling's own text lists `required, defaultValue` among the
attributes, so keeping them is consistent with the ruling — what is missing is the precedence
rule, which the ruling does not address and which is the planner's to specify.)

**2. `AssistantProposalToolSchemas.scala` is a missing task-2.4 edit, and it breaks
`npm run check:schemas` as planned.** `ProposalPanelSchema`'s `"type" -> enumSchema("text",
"markdown", "image", "output")` (`AssistantProposalToolSchemas.scala:51`) is compared for
**set equality in both directions** against `dashboard-proposal.schema.json`'s
`$defs.ProposalPanel.properties.type.enum` by the drift surface
`"ProposalPanelSchema.type enum <-> $defs.ProposalPanel.properties.type.enum"`
(`check-schema-drift.mjs:537-543`, via `scalaSchemaEnumValues`/`jsonSchemaEnumValues`, with
both `missingInScala` and `missingInJson` reported at `:643-647`). Task 2.4 adds `form` to the
JSON schema and to `proposal.ts` but leaves this Scala tree untouched, so 2.4's own stated
verification (`check:schemas` passes) will **fail**. Add it to tasks.md §2 and to proposal.md's
Impact list. This also refutes the enumeration list's completeness (see the note below for two
further sites), so restate the site count from the corrected list rather than the current one.

**3. Task 4.7's mutation cannot turn task 4.3 red — as specified it is a vacuous mutation.**
`PanelRepository.insert` is `ctx.withUserContext(...)(table += domainToRow(panel)).map(_ => panel)`
(`PanelRepository.scala:214-216`) — it returns the **in-memory** panel, never a re-read row —
and `PanelRoutes.scala` exposes **no authenticated GET** for a panel at all (only `POST`,
`POST /batch`, `POST /updateBatch`, `PATCH`, `DELETE`, `POST /:id/duplicate`). So the
`POST /api/panels` response is built by `PanelResponse.fromDomain` → `PanelConfigCodec.encodeConfig`
and **never touches `PanelRowMapper.rowToDomain`**. Deleting the `form` arm from `rowToDomain`
therefore leaves a create-then-assert-the-response test **green**, while 4.7 claims "record
tasks 4.3 and 4.4 going RED". 4.4 (export/import, which goes through
`DashboardSnapshotRepository`'s `panelRowToDomain` at `:102`) genuinely does go red; 4.3 as
worded does not. Two fixes needed: (a) name the actual read path task 4.3 uses to "read it
back" — the candidates that traverse `rowToDomain` are `PATCH /api/panels/:id`
(`patchApplier`, which re-reads), `POST /api/panels/:id/duplicate`, the dashboard export, or
the public `GET /api/dashboards/:id/panels`; and (b) correct 4.7 to name only the tests that
actually go red under that mutation, or make 4.3 use a `rowToDomain` path so that it does.
Without this, the spec scenario "A persisted form panel does not decode as another kind"
(spec.md:116-118) has no test that can fail. Task 4.8 is fine by contrast: the PATCH path
re-reads through `rowToDomain` after writing `configColumnsOf`, so removing `form_config` from
the tuple does surface a stale value.

**4. D2's RLS justification is factually wrong in two ways; correct the record.** design.md
line 53-54 states "both existing `panels` policies predicate on `dashboard_id` only". V36
(`:143-168`) defines **four** policies: `panels_select` and `panels_update` use
`helio_can_access_dashboard(dashboard_id)`, `panels_delete` joins `dashboards.owner_id` against
`current_setting`, and **`panels_insert` predicates on `owner_id`**
(`current_user_id = owner_id`), not on `dashboard_id`. The *conclusion* — a nullable column plus
a widened CHECK needs no policy change — is correct and I confirm it; the premise is not, and a
false "panels only ever predicates on dashboard_id" recorded in a design doc is precisely the
kind of claim HEL-1087's dataset-write work would inherit unchecked. Second, the
`NO FORCE`/`FORCE` bracketing precedent is misapplied: V94 §0/§22 and V106 §3/§9 bracket because
they execute **DML** (`UPDATE`/`INSERT`) against a FORCE'd table whose policy reads
`current_setting('app.current_user_id')` *without* `missing_ok` — V106's own header says exactly
this. V108 as designed runs pure DDL (`ADD COLUMN`, `DROP CONSTRAINT`, `ADD CONSTRAINT`) and
`panels`' policies use `current_setting('app.current_user_id', true)` **with** `missing_ok`, so
neither half of the V106 failure mode applies. Keeping the bracketing is harmless and I am not
asking for its removal — but label it as defensive/consistency-only rather than "the established
fix for the `app.current_user_id`-unset failure that broke three prior production deploys",
which is a claim about a failure class this migration does not enter. While there: task 1.1 says
"widening `panels_kind_check`" without specifying that a CHECK cannot be widened in place — spell
out DROP CONSTRAINT + ADD CONSTRAINT with the full six-value predicate, and decide explicitly
whether to keep V94's now-vestigial `kind IS NULL OR` disjunct given `kind` is `NOT NULL` since
`V94:1213`.

**5. "An agent-proposed form panel cannot bind a source" is false — the generic `config`
passthrough binds it.** proposal.md (line 56-57), design.md D7 (line 92-94) and the spec
requirement (spec.md:120-126, "The proposal wire carries no field for a bound data source, so an
agent-proposed `form` panel SHALL be rejected") all state this as an absolute. But
`ProposalPanel` carries a generic `config: Option[JsObject]` which `mergeConfig`
(`ProposalPanelSupport:133-149`) merges into the `CreatePanelRequest` — `buildNonDataConfig`
returning `None` only means the *derived* half is empty. An agent that emits
`{"type":"form","title":"X","config":{"dataSourceId":"ds-1","fields":[...]}}` reaches
`decodeCreateConfig("form", Some(...))` with a populated config and is **created successfully**.
So the honest statement is narrower: the proposal wire has no *typed/flat* field for a data
source, so a proposal that supplies none is rejected with a 400 — the gap is the missing
first-class field and the absent agent guidance, not an impossibility. Reword all three
artifacts accordingly (the follow-up ticket's framing depends on it), and add a test for the
passthrough shape: it should assert that a `config`-bound agent-proposed form is created, and —
more importantly — that a **cross-owner** `dataSourceId` supplied that way is still rejected by
D6. That second assertion is the security-relevant one, and I confirm D6 does cover it today
(proposal apply goes through `panelService.create` at `DashboardProposalService:113`), but
nothing in the plan pins it.

### Non-blocking notes

- **HEL-1088's counter is not foreclosed, but the discriminator is unspecified.** Because config
  is JSONB (D1), adding `step`/`min`/`max` needs no DB migration — the Planner Note is right
  about that. Two things it does not address, worth recording now rather than rediscovering in
  HEL-1088: (a) the seven-control set is closed by a `SHALL` plus an "unknown control is
  rejected" scenario, so introducing a `counter` control is a spec delta to this capability, not
  a pure addition; and (b) if the counter is instead `control: "number"` + `step`, nothing
  distinguishes a plain number input from a +/- counter, so `step` silently becomes the
  discriminator. Decide which now, in one sentence, even though neither is built here.
- **`file` is accepted as a control with nothing able to render or store it** until HEL-1086.
  Forward-compatible and consistent with a registration-only ticket, but a config carrying a
  `file` field will persist and round-trip before any upload semantics exist; state that this is
  intended.
- **`PanelPacker.Bounds` has no `form` entry**, so `clamp` falls to
  `DefaultBounds` via `getOrElse` (`PanelPacker.scala:28`, `:59`) and a form panel on the
  `/auto-layout` re-flow can be clamped to `minW = 1`. Silent-default shaped, i.e. the same
  failure family this change exists to avoid. Not in scope to fix; report it to HEL-1084/1085.
- **`helio-mcp/src/tools/write.ts:739`** (`update_panel`) enums
  `["output","text","markdown","image","divider"]` and is explicitly *not* schema-checked
  (`check-schema-drift.mjs:231-235`). A `form` panel will be un-updatable through MCP. No gate
  breaks, but given the Q3 ruling made `form` agent-proposable, either include it in 2.4 or
  record the deferral deliberately. Likewise `AssistantSystemPrompt`/`DashboardAuthoringPrompt`
  enumerate the kinds offered to the agent (pinned by `AssistantSystemPromptSpec:110` and
  `DashboardAuthoringPromptSpec:126` over `Vector("text","markdown","image","output")`), so a
  proposable-but-never-mentioned `form` will in practice never be emitted.
- `openspec/specs/panel-type-rendering/spec.md` still enumerates `metric`/`chart`/`table`, i.e.
  it is stale from the HEL-903/904 remodel independently of this change. Correctly out of scope;
  noted so it is not mistaken for a `form` obligation.
- `FormPanelConfig.Empty` (task 1.2) is invalid by construction under D5, since an empty
  `dataSourceId` fails `validateConfig`. That is the right tradeoff for the tolerant-read path
  (a malformed row stays readable rather than 500ing, per the mapper's philosophy), but it means
  a malformed stored form row cannot be PATCHed without resupplying `dataSourceId`. Worth one
  line in D1 or the Risks section.
- Evidence hygiene: `premise-validation.md`'s substantive claims held everywhere I re-derived
  them independently, including the two that most mattered (the V94 CHECK constraint and the
  `rowToDomain` fallthrough). Its stated verdict of minor-staleness is well supported. No
  mtime-ordering or positional-evidence dependency was relied on anywhere in this report; every
  finding above cites file:line content.
