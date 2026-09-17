## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### Headline

Both of round 4's blocking change requests are **genuinely fixed, not re-worded**, and I verified
each against the compiler-visible architecture rather than against the revision's own description
of itself. The strict/tolerant seam — in front of this gate twice (round 3 CR3, round 4 CR1) — is
now closed cleanly and is implementable exactly as written by the existing `PanelConfigCodec`
machinery. Three new items are below; all three are **polish**, none would ship a defect, and I am
not asking for a round 6.

### What I verified (with evidence)

**Authority record, read myself.** `cat .concertino/runs/HEL-1083/answer.json`: `subAnswers` =
`jsonb-column`, `reference-declared-field`, `add-to-proposal-surfaces`, `"complete": true`.
D1/D3/D7 implement those three faithfully. Not relitigated. Whether the plan implements them
correctly is in remit and I found no divergence.

**Round-4 CR1 (tasks 1.2 / 1.9 / 4.9 mutually unsatisfiable) — FIXED, and I confirmed the three
layers are jointly satisfiable by ONE implementation in this codebase, not merely
self-consistent as prose.** The three layers are stated identically in D9 (`design.md:108-117`)
and task 1.2 (`tasks.md:4`) — I diffed the two texts clause by clause: strictness in
`FormFieldSpec.decode`, the 400 *mapping* in `decodeCreate`/`Patch.decode`, the catch in the row
mapper. Task 1.9 requires catch/log/`Empty`/never-500; task 4.9 asserts against exactly that.
No reading of the four texts leaves an executor a choice. Crucially, the layering matches how the
tree already works, which is what makes it implementable rather than aspirational:

- `PanelConfigCodec.safe` (`PanelConfigCodec.scala:75-87`) is the thing that actually converts a
  raised `DeserializationException` into `Left(msg)` → 400, and every write-path entry point
  routes through it: `decodeCreateConfig` (`:45-56`, each arm wrapped in `safe`) and
  `applyConfigPatch` (`:62-63`). So layer (ii)'s "the mapping, not the strictness, is the
  write-path rule" is already the established mechanism — `DividerPanelConfig.Patch.decode`
  (`DividerPanel.scala:57-83`) raises via `deserializationError` and never returns an `Either`,
  precisely as D9 describes.
- `PanelRowMapper` has **no `safe` wrapper anywhere** — `rowToDomain` (`:21-46`) calls its private
  config builders (`outputConfig`, `dividerConfig`, …) directly. So a strict `decode` called
  unguarded from the form arm genuinely would propagate to a 500 on every read of that dashboard.
  Task 1.9's mandated catch is not belt-and-braces; it is load-bearing, and D9(iii) names the
  right locus. The file's own header comment (`:14-18`) already documents this tolerant-read
  philosophy for the `type='metric'`/`type_id IS NULL` case, so the form arm follows an in-file
  precedent rather than inventing one.
- The read paths that reach it all funnel through this one mapper, so one catch covers all of
  them: `findByIdInternal` (`PanelRepository.scala:115-117`), the paged list (`:~105`), and
  `DashboardRepository.panelRowToDomain` (`:26`) which the snapshot export/import uses
  (`DashboardSnapshotRepository.scala:61`, `:102`). Task 4.9's `findByIdInternal` probe therefore
  exercises the same code the export AC depends on.

C8 and D9(iii) do not collide, and I re-derived this rather than accepting round 4's assessment:
C8 is per-attribute on the write path (an attribute the caller just supplied is never dropped),
D9(iii) is a whole-config failure on the read path degrading to a *visibly unconfigured* panel with
a logged warning, made observable by the spec scenario at `specs/form-panel-type/spec.md:160-162`.

**Round-4 CR2 ("types only" made false) — FIXED, and the Impact list is now complete.** Grepped
the change dir excluding the skeptic reports: no surviving "types only" claim anywhere.
`proposal.md:47-50` now lists `ui/PanelContent.tsx` with the parenthetical "types plus one
renderer-dispatch branch — no new components"; `tasks.md:23` is retitled "Frontend — types plus one
renderer-dispatch branch". The only remaining occurrences of the old phrase are inside C12's own
description of the defect, which is correct (a retired-constraint record, not a live claim).
The Impact list covers **every** file the tasks actually touch, which is the thing the final gate
diffs `files-modified.md` against — I enumerated tasks 3.1-3.4 against it: `types/panel.ts` (3.1),
`ui/grid/mobilePanelHeights.ts` (3.2), `state/panelNarrowing.ts` (3.3), `ui/PanelContent.tsx`
(3.4). Four tasks, four listed files, no gap.

**The two corrections from my predecessor's non-blocking notes — both verified exact.**
`PanelContent.tsx` really is `:296` `// Dispatcher:` comment, `:297-316` the five guards, `:318-319`
the `// Exhaustiveness fallback — the union is closed so this is unreachable.` + `return
<MetricRenderer data={data} />`. D10 and task 3.4 both now cite `:296-319`. Correct. The
`role="status"` choice matches the sibling no-data state, and `panel-content--state` already exists
in the file, so 3.4 adds no CSS and no component.

**Ruling (4) — you are right and round 4 was wrong. I re-ran the grep myself.** Excluding the
skeptic reports, `DashboardSnapshotPanelEntry` and `DataSource.scala:168` appear in the change dir
**only** at `design.md:13-14`, Context's closing sentence. D3 (`:62`) mentions
`DatasetFieldDeclaration.default` by name but carries **no file:line**. So cutting that sentence
would delete the sole grounding citation for both facts, not a duplicate — your reading, not round
4's. (I verified both facts independently anyway: `DashboardSnapshotPanelEntry.fromDomain`
(`DashboardProtocol.scala:174-187`) sets `` `type` = panel.kind `` and `config =
PanelConfigCodec.encodeConfig(panel)` with no per-kind arm, so the snapshot wire is genuinely
generic; `DatasetFieldDeclaration` is at `DataSource.scala:168` exactly.) Declining cuts (2) and
(3) on transcription-risk grounds was also the right call — MISTAKES.md's "read values from source;
never transcribe them" is the same lesson, and a corrupted design record costs more than 7 lines.

**Ruling on 165-vs-150 — 165 with a correct D9 is the right trade, and I am not asking for a
cut.** `openspec/config.yaml:48` states "Maximum 150 lines; wrap prose at 120 chars per line" for
`design`. I grepped `check-openspec-hygiene.mjs` and `check-spec-structure.mjs` for any line-count
or width enforcement and found **none**, and ran the gate myself: `npm run check:openspec` →
`openspec/ is clean`, exit 0. So it cannot break delivery. Your reflow claim also holds on
measurement: design.md's longest line is **118** chars, 0 lines over 120. Nothing genuinely
redundant remains that I would trade against D9's correctness — the three-place duplication of the
closed attribute set is the one structural redundancy left, and cut (1) already removed the copy
that had been producing findings.

**Nothing forecloses the downstream tickets**, re-checked individually against the artifacts:
`step` is a configuration and `min`/`max` an additive delta (HEL-1088); the author-time
schema-consistency check is explicitly HEL-1084's (`spec.md:125-127`); `file` persists without
upload semantics (HEL-1086); `submit` is an object so submit-time concerns add without a wire
break (HEL-1087); the placeholder is explicitly HEL-1085's to replace (D10). Scope stays
registration / config schema / `PanelType` / round-trip.

**Other ground truth re-derived cold (not accepted from any report).** `Panel.Registry`
(`Panel.scala:86-92`) has 5 entries and `PanelKind.All = Panel.Registry.keySet` (`:118`);
`PanelSpec` pins `Registry.keySet` against an explicit 5-element set plus per-kind strings, so task
1.4 is real work. `PanelType` (`model.scala:132-166`) enumerates manually in `fromString` (`:151`)
and `asString` (`:160`) with `Default = Divider` (`:149`) and the regression comment intact;
`PanelServiceHelpers:154` is the sole `PanelType.Default` consumer, reached via
`resolveCreateConfig` → `decodeCreateConfig`, so D5 cannot regress a typeless create.
`panels_kind_check` is `V94:365` with the five-value predicate; highest migration is 107, so V108
is free. `configColumnsOf`/`configColumnValuesOf` are 7-tuples (`PanelRepository.scala:321-348`)
whose in-file comment records the `output_id` omission as the "HEL-909 follow-up (found live via
e2e evidence)" — design.md's "HEL-909's follow-up to HEL-296" attribution is accurate.
`check-schema-drift.mjs` parses `canonicalPanelTypes` from `fromString`'s `case "x" => Right` arms
only (`:215-228`) and derives `agentFacingPanelTypes` as canonical-minus-`divider` (`:236`), so
`form` propagates automatically into the proposal surfaces and tasks 2.1-2.5 are what make
`check:schemas` satisfiable. `openspec validate … --type change` → valid;
`check-constraints-carryover.sh` → `OK`.

No mtime-ordering or positional evidence was relied on anywhere in this report; every finding cites
file:line content I read this round. No report I drilled into disclosed unsound evidence mtimes, so
there is no gate defect of that family to record.

### Verdict: CONFIRM

Both round-4 blocking CRs are fixed in substance. Round 4's own condition for escalation was that
the strict/tolerant seam be closed cleanly this round; measured against the codebase rather than
the prose, it is — the layering matches the existing `safe`-wraps-the-write-path /
mapper-has-no-wrapper reality, which is the strongest form the fix could take. The three items
below are polish and can be actioned in the executor's own edit or dropped; none is a reason to
hold the plan.

### Non-blocking notes

1. **[polish] `proposal.md:47` is 129 chars, over the 120-char wrap rule for `proposal` —
   self-inflicted by the CR2 fix.** `openspec/config.yaml:44` sets the same 120 wrap for proposals
   that design.md now respects, and the over-width line is the one the Impact-list edit touched
   (`…deliberately NOT touched. Frontend: \`features/panels/types/panel.ts\`,`). No gate enforces
   it (`check:openspec` is clean, exit 0), and proposal.md is 70 ≤ 80 lines. One reflow closes it.
   Worth naming only because it is the same "the fix introduced the next finding" pattern you
   flagged: the remaining over-width line in the change dir is in the paragraph most recently
   edited. (tasks.md's long lines are **not** a violation — its rule is "one line per task, no
   prose blocks", with no width clause.)

2. **[polish] `PanelDetailModal.tsx` is a fourth panel-kind dispatch site that no artifact
   records (C9).** `activeEditorRef()` (`:192-197`) and `renderSubtypeEditor()` (`:313-346`) are
   both if-chains over `isMarkdownPanel`/`isTextPanel`/`isImagePanel`/`isDividerPanel` ending in
   `return null`, and `:447` reads `isOutputPanel(panel) ? <OutputPanelSection … /> :
   renderSubtypeEditor()`. A `form` panel — which this change makes API-creatable and which will
   therefore appear on a dashboard and be clickable — takes neither branch and renders an **empty
   edit body**. I am labelling this polish rather than blocking because, unlike `PanelContent`'s
   fallthrough, it degrades *benignly*: `null` is "no subtype editor", which is the literally
   correct answer until HEL-1084 builds the field-type builder, and no gate breaks. But it is the
   same family as `PanelPacker.Bounds` (recorded) and `PanelContent` (fixed), and C9's rule is that
   a deferral must be recorded in an artifact rather than merely being true. One entry in the
   out-of-scope register naming `PanelDetailModal.tsx:192-197`/`:313-346`, the benign-`null`
   outcome, and HEL-1084 as the target would close it. (For completeness: `MobilePanelStack.tsx:75`
   special-cases only `divider` and routes every other kind through `PanelCardBody` →
   `PanelContent`, so it is covered transitively once task 3.4 lands; `OutputPicker.tsx:26`'s
   content-kind list is already an explicit stated non-goal.)

3. **[polish] Task 1.5 does not mention `fromString`'s error-message literal.**
   `PanelType.fromString`'s fallback is `Left(s"Unknown panel type: '$other'. Valid values: text,
   markdown, image, divider, output")` (`model.scala:157`) — a hand-written string, not derived
   from the arms. Adding the `Form` arm without updating it leaves an error message that omits
   `form` while `form` is valid, i.e. a stale-string of exactly the kind CONTRIBUTING.md's
   "when a value moves, update every place that asserts it" warns about. `check-schema-drift.mjs`
   parses only the `case "x" => Right` arms (`:218-220`), so no gate catches this. Half a clause in
   task 1.5. (`Panel.companionFor` and `PanelKind.parseKind` build their equivalents from
   `Registry.keySet`, so they self-update — this literal is the only one that does not.)
