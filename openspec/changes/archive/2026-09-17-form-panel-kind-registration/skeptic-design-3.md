## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### Headline

**No change request has survived two rounds.** Round 2's CR-1 and CR-2 are both genuinely
fixed — the counter decision is now made in code-shaped terms and the out-of-scope register
exists and is accurate. The three items below are new: one is a defect introduced *by* this
revision (a second, contradictory enumeration of an explicitly CLOSED set), one is a
panel-kind dispatch site that no artifact records and that this change makes reachable, and
one is the strict/tolerant seam the revision left half-specified on the read path.

### What I verified (with evidence)

**Authority record.** `.concertino/runs/HEL-1083/answer.json` read directly: `subAnswers` =
`jsonb-column`, `reference-declared-field`, `add-to-proposal-surfaces`, `complete: true`.
D1/D3/D7 implement those faithfully. Not relitigated.

**Round-2 CR-1 (counter decision) — FIXED, and `step` is enforceable as claimed.**
`spec.md:51` now lists `step` inside the closed attribute set; `spec.md:71-79` makes it
positive, `number`-only, persisted-without-rendering (the `file` precedent), and states
`min`/`max` would be an additive delta; D3 (`design.md:52-53`) carries the same closed set;
task 1.2 requires `validateConfig` to reject a non-positive `step` and a `step` on a
non-`number` control, and task 1.2/4.1/4.1b pin rejection of an unrecognized attribute plus a
`step` PATCH round-trip. All three of those checks are local to the config object — no dataset
access, no `DatasetFieldDeclaration` read — so "enforceable with zero dataset access" is
correct. `DataFieldType`'s seven values (`model.scala:669-680`:
`StringType/IntegerType/FloatType/BooleanType/TimestampType/StringBodyType/BinaryRefType`)
match the spec's orthogonality list exactly.

**Round-2 CR-2 (dropped deferrals) — FIXED, and the exclusion reasoning is sound, not a
rationalisation.** I re-derived each of the four sites:
- `PanelPacker.Bounds` maps only `Output`/`Image`/`Markdown` (`PanelPacker.scala:39-42`) and
  `clamp` falls to `DefaultBounds(minW = 1, minH = 2, maxH = 24)` via `getOrElse` (`:59`).
  Deferral to HEL-1085 now recorded at `design.md:115-118`. Verifiable from the plan.
- `RefinementEditShape` — the content-kind enumeration is real in the prompt copy I read
  (`"text/markdown/image/divider (content panels, no data binding …"`, ~`:181-219`), and
  `RefinementEditShapeSpec` pins the examples, so "breaks no gate" holds.
- The `create_content_panel` exclusion is a genuine category distinction, not a
  rationalisation, and the tool documents it in its own words: `helioApi.ts:914` —
  "Create ONE content panel (`text`/`markdown`/`image`/`divider` -- no data binding at all)",
  `placements.ts:71` — "Create ONE panel with no data binding". Conversely `write.ts`'s own
  comment (`:737-739`) says its enum "validates against an EXISTING panel's stored kind", i.e.
  it spans every kind — which is exactly why 2.5 must include it and 2.1-2.3-style exclusion
  would be wrong. The asymmetry is correctly reasoned.

**The compressed `## Context` section — re-derived independently, and it is accurate.** Both
sentences you singled out hold:
- "the enumeration surface is NOT registry-derived": `Panel.Registry` is `Panel.scala:87`,
  `def All: Set[String] = Panel.Registry.keySet` is `Panel.scala:120` (cited line exact);
  `PanelType` spans `model.scala:132-166` with manual `fromString` (`:151`) and `asString`
  (`:160`); `PanelConfigCodec` enumerates manually at four sites (`:23-29`, `:37-41`,
  `:45-53`, `:65-71`), each with a loud `deserializationError`/`Left` fallback; the row mapper
  enumerates manually (`PanelRowMapper.scala:34-45`); the JSON schemas enumerate literally
  (four files, below); the frontend union is a literal at `panel.ts:58`. Accurate as
  compressed.
- the `configColumnsOf`/`output_id`/HEL-296 sentence: line numbers are exact
  (`configColumnsOf` at `PanelRepository.scala:320`, `configColumnValuesOf` at `:331`, both
  7-tuples ending ~`:348`) and the failure description ("writes kept the old value while
  returning the new") is verbatim what the in-file comment records. One citation nit — see
  non-blocking notes — the `output_id` omission incident is the tree's **HEL-909** follow-up;
  HEL-296 is the general precedent. Not wrong in substance, imprecise in attribution.
- other Context claims re-checked: `panels_kind_check` is `V94:365` with exactly the
  five-value predicate and `ALTER COLUMN kind SET NOT NULL` at `V94:1213`; highest existing
  migration is 107, so V108 is free; `panels` has no config JSONB column (per-field nullable
  columns in `PanelRow`); the snapshot wire is already generic —
  `DashboardSnapshotPanelEntry.fromDomain` (`DashboardProtocol.scala:174-187`) sets
  `` `type` = panel.kind `` and `config = PanelConfigCodec.encodeConfig(panel)`, no per-kind
  arm; `DatasetFieldDeclaration` is at `DataSource.scala:168` with
  `{name, fieldType, required, default}`. Compression introduced no false statement I could
  find.

**Drift surfaces re-enumerated from the guard itself, and from a repo-wide literal grep.**
Baseline is green on the untouched tree (fresh run):

```
$ npm run check:schemas
schemas in sync with JsonProtocols (96 checked across 50 protocol files)
panel-type enums in sync with backend canonical sets (7 surfaces checked)
AssistantProposalToolSchemas.scala in sync with schemas/ (14 surfaces checked)
```

`canonicalPanelTypes` is parsed out of `PanelType.fromString` (`check-schema-drift.mjs:215-228`),
so `form` enters automatically and is then compared against `create-panel-request`,
`panel.schema.json`, `update-panels-batch-request` (`:251-277`); `agentFacingPanelTypes`
(canonical minus `divider`, `:238`) against `dashboard-proposal.schema.json` (`:283-296`) and
`proposal.ts` `PANEL_TYPES` (`:298-309`); and `ProposalPanelSchema.type` set-equal in both
directions against the proposal schema (`:537-543`) — that Scala enum is confirmed at
`AssistantProposalToolSchemas.scala:51` (`"type" -> enumSchema("text", "markdown", "image",
"output")`), exactly where task 2.4 says. The two `dataPanelTypeSurfaces` derive from
`DataPanelKinds = Set("output")`, which `form` does not join, so they stay green untouched.
**With tasks 2.1-2.5 as written, `npm run check:schemas` is genuinely satisfiable**, and no
guard-covered surface is missing. Repo-wide literal grep for the kind strings surfaced exactly
four kind-enum JSON schemas (`panel.schema.json:24`, `create-panel-request:19`,
`update-panels-batch-request:33`, `create-panels-batch-request:27`), and no kind enum in any
`schemas/dashboards/` snapshot schema — so the export/import AC needs no schema edit beyond
those. The remaining literal sites are the Scala/TS ones the plan already names or defers,
**plus one it does not** — CR-2 below.

**Other ground truth re-checked (not accepted from the reports).** `PanelKind.All` derives
from the registry and `PanelSpec` pins the keySet against an explicit 5-element set
(`PanelSpec.scala:56-66`) plus a `PanelKind.All shouldBe Panel.Registry.keySet` assertion —
task 1.4's "registry-parity assertion is updated" is real work, not a no-op. `PanelType.Default
= Divider` with the regression comment (`model.scala:135-149`), and `DividerPanel.validateConfig`
only constrains `weight` (`DividerPanel.scala:98-103`), so D5 cannot regress a typeless create.
`PanelRepository.insert` is `.map(_ => panel)` (`:214-216`) and `findByIdInternal` re-reads
through `rowToDomain` (`:114-117`) — C7 and tasks 4.3a/4.3b are accurate (note:
`findByIdInternal` is the documented no-ACL read; fine inside a repository-level test, and the
PATCH alternative is also named). `mergeConfig`'s `case (None, Some(c)) => Some(c)` and
`buildNonDataConfig`'s `case _ => None` (`ProposalPanelSupport.scala:133-149`, `:180-190`)
confirm C6/D7 as written. `check-constraints-carryover.sh` returns `OK`; `openspec validate
form-panel-kind-registration --type change` → "Change 'form-panel-kind-registration' is valid".
`design.md` is 149 lines against the 150-line `openspec/config.yaml` design budget — within
budget, and no anchor I spot-checked is missing.

No mtime-ordering or positional evidence was relied on anywhere in this report; every finding
cites file:line content I read this round. No report I drilled into disclosed unsound evidence
mtimes, so there is no gate defect of that family to record.

### Verdict: REFUTE

Three items. None reopens an owner ruling, none undoes an earlier fix, and all three are
cheap. CR-2 is the one that matters: this change makes a currently-unreachable silent
fallthrough reachable, in the exact failure family the plan says it exists to avoid.

### Change Requests

**1. `design.md`'s Planner Notes still enumerate the closed attribute set WITHOUT `step`, so
one design record now declares the closed set two different ways.** `design.md:144-145` reads:
"the `FormFieldSpec` attribute set
(`label`/`placeholder`/`helpText`/`required`/`initialValue`/`options`) as the minimum
HEL-1084/1085 need without foreclosing HEL-1088's counter (a numeric control plus a step size
is an additive field attribute, not a new kind)" — i.e. it both omits `step` from the set and
parenthetically reasons *from* `step` being a later additive attribute. D3 (`:52-53`),
`spec.md:50-52` and task 1.2 all now include `step` in a set declared CLOSED and enforced by a
400. An executor implementing `FormFieldSpec` from the Planner Notes builds a set that rejects
`step`, which then fails task 4.1b. This is a revision-introduced contradiction inside the
document, and it is exactly the drift the closed-set decision exists to prevent. Fix: update
the Planner Notes list to include `step` and restate the self-approval as "the attribute set
including `step`, which makes HEL-1088's counter a configuration rather than a delta".

**2. `PanelContent.tsx:297-319` is an unrecorded panel-kind dispatch site, and this change
makes its silent fallthrough REACHABLE for `form`.** The renderer dispatcher is an `if`-chain
of type guards — `isOutputPanel` / `isTextPanel` / `isMarkdownPanel` / `isImagePanel` /
`isDividerPanel` — ending in:

```tsx
  // Exhaustiveness fallback — the union is closed so this is unreachable.
  return <MetricRenderer data={data} />;
```

Because it is an `if`-chain and not a `switch`, adding `form` to the `Panel`/`PanelKind` union
(task 3.1) will **not** produce a typecheck error — `npm run typecheck` and `npm test` both
stay green — while the comment's own premise ("unreachable") silently becomes false: a `form`
panel, which this change deliberately makes API-creatable (proposal.md Non-goals), will render
a `MetricRenderer` on any dashboard that contains it. Nothing upstream filters by kind
(`PanelCard.tsx:101` passes the panel straight through and renders `{panel.type}` in its
badge). This is the same silent-default family as `PanelPacker.Bounds`, which the plan DID
record — and `PanelContent.tsx` is named in `design.md:101` and in C8 as a canonical example of
the shape this change exists to avoid, which makes leaving it unrecorded the sharpest
inconsistency in the plan. A repo-wide grep of the change dir finds `PanelContent` mentioned
only as that rhetorical example, never with an include/exclude decision — a C9 violation on the
plan's own terms. Fix (either is acceptable, the first is cheapest): (a) add a fourth entry to
"## Out-of-scope enumerations, decided explicitly (C9)" naming
`PanelContent.tsx:297-319`, the reachability change, the fact that no frontend gate catches it,
and the deferral target (HEL-1085); or (b) if you judge "renders a metric for a form" too
user-visible to defer, add a bounded task-3 item rendering a neutral placeholder for `form` and
state that the `MetricRenderer` fallback stays for the genuinely-unreachable case. Do not leave
it unstated.

**3. Strict-write / tolerant-read is *stated* but the plan pins the 400 to the function the
READ path will reuse, and task 1.9 never names the tolerant wrapper.** D1 (`design.md:36-37`)
says a malformed stored `form_config` "stays READABLE via the tolerant decode below", and Risks
(`:134-135`) says "malformed decodes to `Empty` and logs" — so the two-path philosophy is
present. But task 1.2 assigns the strictness to `FormFieldSpec.decode` ("MUST REJECT an
unrecognized field attribute with a 400"), and `decode` — as opposed to `decodeCreate` /
`Patch.decode`, which the same task lists separately — is precisely the decoder the row mapper
will reuse to rebuild config from the JSONB string; task 1.9 says only "add an explicit `form`
arm … plus `domainToRow` formConfig write", with no mention of wrapping it. The executor is
therefore free to implement `rowToDomain`'s form arm as an unguarded `decode`, which turns any
stored row carrying an out-of-set attribute into a **500 on every read of that dashboard**
rather than the tolerant `Empty` D1 promises. This is reachable without hand-written SQL: a
future version that writes `min`/`max` (the additive delta `spec.md:77-79` explicitly
anticipates) followed by a rollback produces exactly such a row. Note also that a
malformed-row-to-`Empty` read is itself a whole-config silent drop, which sits awkwardly beside
C8's "never silently dropped" — so the two paths need one sentence each, not one shared
sentence. Fix: state in D1 (or a short D9) that strictness is a **write-path** rule applying to
`decodeCreate`/`Patch.decode` (and to `decode` only when called from a write path), and amend
task 1.9 to require the mapper's `form` arm to decode tolerantly — catch the strict failure,
log it, and fall back to `FormPanelConfig.Empty`, never propagate a 500 — plus a test asserting
exactly that for a row containing an unknown attribute. That test is cheap (insert the JSONB
directly, re-read via `findByIdInternal`) and it is the only thing that would make the
tolerant-read claim in D1 evidence-backed rather than asserted.

### Non-blocking notes

- **Context's `(HEL-296)` on the `output_id` incident is a slight mis-citation.**
  `PanelRepository.scala:308-319` attributes the *general* both-paths-write-the-same-tuple rule
  to HEL-296 and the *`output_id` omission that shipped* to the "HEL-909 follow-up (found live
  via e2e evidence)". `design.md`'s Context (`:11-12`) folds both onto HEL-296. C4, tasks.md and
  Risks all say "HEL-296/HEL-909" correctly, so this is the only place it drifts; one added
  citation closes it. Compression is the likely cause, but it does not change a decision.
- **`proposal.md:42` says "five files under `schemas/panels/`"; I count four that carry a kind
  enum** (`panel.schema.json:24`, `create-panel-request:19`, `update-panels-batch-request:33`,
  `create-panels-batch-request:27`) — and tasks 2.1-2.3 name exactly those four. The
  `*-batch-response` and `panel-appearance*` schemas carry no kind enum (grepped). Round 1's
  report used "five JSON schemas" too, so this predates the compression; it is an Impact-list
  count, not a plan gap.
- **`create-panels-batch-request.schema.json` is not covered by any drift surface** (grepped:
  its only repo-wide reference is its own `$id`; positive control — `update-panels-batch-request`
  returns three `check-schema-drift.mjs` hits). Including it in task 2.3 is right for wire
  correctness, but 2.3's stated verification ("`npm run check:schemas` passes") cannot observe
  that half of the task. Worth one clause so the executor does not record a green
  `check:schemas` as evidence for a file the guard never reads.
- Task 4.3b names `panelRepo.findByIdInternal`, which is documented no-ACL ("Do NOT call from
  routes or services that own the ACL decision", `PanelRepository.scala:110-113`). Correct
  inside a repository-level test, and the task already offers the PATCH re-read as the
  alternative; noting only so it is not later copied into a service path.
- `design.md:150` ("Standing constraints agreed at Planning (C1–C5)") remains literally true
  now that C6–C9 are gate-added; no change needed, but it will read as stale if another
  constraint lands.
