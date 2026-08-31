## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

Cold pass; every claim below re-derived from the live tree, not from prior reports.

**Round-4 finding 1 (`panel.type` vs `panel.kind`) — FIXED.**
- `grep -n "panel\.kind" design.md tasks.md` → no instruction anywhere to rename the
  field. `design.md:162-172` now states the three Scala call sites keep their logic and
  field name "byte-for-byte unchanged"; `ProposalPanel.type` stays `type`, only
  `DataPanelKinds`' value moves to `Set("output")`. `tasks.md:83-93` (3.10) says the same.
- Consistency with 5.4(c) checked against the script itself, read line-by-line:
  `check-schema-drift.mjs:231-256` reads the three PANEL schemas at
  `["properties","type","enum"]` (canonical = all 5 kinds), while `:262-271` reads
  `schemas/dashboards/dashboard-proposal.schema.json` at
  `["$defs","ProposalPanel","properties","type","enum"]` against `agentFacingPanelTypes`.
  These are genuinely two different files/pointers, and tasks 5.4(c) (three panel files,
  re-pointed to `kind`) and 5.4(d)/5.7 (proposal file, pointer unchanged, value →
  `agentFacingKinds`) name their targets by full path + JSON pointer, so an executor
  cannot conflate them. Independently confirmed the field-diff walk (`:110-140`) only
  compares a schema's TOP-LEVEL `properties` against the case class matching its `title` —
  `$defs.ProposalPanel` is not field-checked, so the asymmetry is gate-safe.

**Round-4 finding 2 (sibling kind-valued predicates) — FIXED, and the decision is sound.**
- `tasks.md:94-102` is a new task 3.10a; `design.md:235-261` is the paired decision. Both
  name the same six sites.
- I re-read `ProposalPanelSupport.scala` myself. `grep -n 'panel.`type`'` gives 35, 37, 38,
  40, 43, 46, 49, 136, 157, 176, 209, 217, 226. Every predicate the decision deletes does
  test a PRE-collapse visualization value (`"chart"` at 40/49, `TimelineKind` at 46/217,
  `MetricKind` at 209, `MetricIdSupportedKinds` at 136) and would be permanently false once
  `panel.type ∈ {output,text,markdown,image,divider}`. Deleting them (rather than
  retargeting) is defensible under this ticket's "make it compile and behave sanely" scope:
  the values they guard against (chartType, aggregation-rejection, timeline sort, metric
  label/unit) all move onto the Output's kind/config, which P1.1 explicitly does not
  validate; `MetricIdSupportedKinds`/`metricId` die with metrics anyway, and `:136`'s whole
  `validateMetricBinding` body already dies with `MetricRepository` (task 3.9).
- Crucially, the decision correctly does NOT over-delete: `:43` (`panel.type == "divider"`
  gating `validateDividerOrientation`) and `:226`'s `buildNonDataConfig` match on
  `text|markdown|image|divider` — all still-valid kinds — and are left untouched by both
  artifacts. `:35` `PanelType.fromString` and `:157` `DataPanelKinds` are separately owned
  (3.6, 3.10). That partition is complete: every one of the 13 `panel.type` sites is either
  owned by 3.6/3.9/3.10/3.10a or provably still correct post-collapse.
- Nothing else in the artifacts assumes the deleted checks survive: `grep -n
  "validateChartType\|rejectsAggregation\|validateTimelineSort\|MetricIdSupportedKinds"`
  across design.md/tasks.md/proposal.md hits only 3.10a and its paired decision.

**Round-4 finding 3 (5.4(d)/5.7 disagreement) — FIXED.** `tasks.md:172-178` now says
"value and ownership are task 5.7's, not restated here" and carries no competing enum;
5.7 (`:192-200`) is the sole owner, naming `agentFacingKinds` = `output, text, markdown,
image`. That matches `check-schema-drift.mjs:263-271`'s `canonical: agentFacingPanelTypes`
(canonical minus `divider`). Gate-consistent.

**Validation.** `npx openspec validate outputs-model-migration --type change --strict` →
`Change 'outputs-model-migration' is valid`. Run twice, same result.

**Fresh holistic pass (design.md and tasks.md read front to back, plus ticket.md).**
- Arm-count guard arithmetic re-checked against source: `PanelType.fromString`
  (`model.scala`) has 9 `Right` arms today; the post-collapse set is exactly 5, so
  5.4(a)'s `< 8 → < 5`/`=== 5` is right, and `agentFacingPanelTypes` is then 4, matching
  5.7. The `DataPanelKinds` regex (`:221-224`) matches a single-line `Set("output")` fine.
- Data-loss check on the one AC I could falsify cheaply ("row-for-row `node_snapshots`
  equality with pre-migration `data_type_rows`"): `data_type_rows` is written from exactly
  one place, `PipelineRunService.scala:640` (`overwriteRows(outputDataTypeId, …)`), so
  companion/source types never carry rows and step 10(a)'s companion-type deletion cannot
  silently drop snapshot data. The equality assertion is therefore actually satisfiable.
- AC-to-task trace: compile/`sbt test` → 6.4; red-first fixture migration → 2.11 (+2.9);
  step-order → 2.12; real-role RLS smoke → 2.13 (+design decision 4); splice-on-delete →
  1.6/1.7; the two `grep` criteria → 6.1/6.2; `check:scala-quality`/no-FQN → 6.3;
  gate-green contracts → 5.1-5.7. No AC is unowned; no task is outside the ticket's scope.
- Every code citation I spot-checked resolves: `DashboardProposalService.scala:211`
  (`DataPanelKinds`), `:219` (`MetricIdSupportedKinds`), `ProposalPanelSupport.scala:37,49,
  136,157,209,217`, `CombinedProposalService.scala:123`, `PipelineRunService.scala:640/649`
  region, `check-schema-drift.mjs:19,195-199,205,231-271,283-297`.

### Verdict: CONFIRM

Rounds 1-4's findings are all genuinely closed, verified independently rather than taken
on report. I found no remaining internal contradiction, no task referencing a symbol that
does not exist, and no migration-correctness or data-loss gap. Nothing below is blocking;
none of it is a repeat of an already-"fixed" finding.

### Non-blocking notes

1. `tasks.md:85-88` has a garbled, unbalanced-parenthesis sentence: "the … call sites
   change only their field reference (`panel.type` → keeping the field's NAME unchanged —
   `ProposalPanel.type` stays `type`; only …". The leading clause still says the call sites
   "change" something. The intent is unambiguous from the rest of the sentence and from
   `design.md:162-172` ("byte-for-byte unchanged"), so this is editorial, but a one-line
   cleanup would remove the last trace of the round-4 confusion.
2. Citation off-by-one: `design.md:240`/`tasks.md:98` cite `ProposalPanelSupport.scala:39`
   for the `panel.type == "chart"`/`validateChartType` guard; the real line is `40` (`39`
   is the preceding `else Right(())`). `:49,46,217,209,136,157,37` are all exact. The named
   construct is unique in the file, so this cannot mislead.
3. `design.md:122` / `tasks.md:168` say "the four `panelTypeSurfaces` JSON pointers" and
   then list three files. The fourth entry is `dashboard-proposal.schema.json`, which 5.4(d)
   correctly does NOT re-point to `kind`. Saying "three of the four" would remove the
   ambiguity.
4. No task explicitly names the protocol-side field rename that 5.2's schema reshape
   forces (`CreatePanelRequest.type` → `kind`, and the batch item's equivalent, under
   `api/protocols/panels/`). It is implied by 3.6 and forced loudly by `check:schemas`'s
   title↔case-class field diff (5.6) and `sbt compile` (6.4), so it cannot be silently
   skipped — unlike the predicate inversions, this one fails noisily.
5. Related, and already covered in principle: `ProposalPanel.dataTypeId` will hold an
   Output id after the rewire while keeping its name. That is the correct default under
   `design.md:141-143` ("P1.4 still owns every other change to this schema"), and the field
   is not field-diff-checked (it lives under `$defs`), so no gate forces the issue. One
   explicit sentence saying "ProposalPanel's field NAMES are all frozen in P1.1; only the
   `type` enum's value domain changes" would close the same class of question 3.10 answers
   for `type`.
6. `check-schema-drift.mjs`'s `extractBetween` takes the FIRST `def fromString(s: String)`
   in `model.scala` (documented convention in that file: `PanelType` must stay declared
   ahead of the other `fromString`-bearing enums). If task 3.6 moves or renames the type,
   5.4(b) covers the marker strings but not this ordering assumption. Loud failure if hit.
7. Round 3/4's non-blocking notes still appear unaddressed (`design.md:156`'s inclusion of
   `"markdown"` in the never-real naive `DataPanelKinds` superset; the coverage checklist's
   "13 wholesale REMOVED" prose and "Round 1/2 (16 capabilities)" heading;
   `proposal.md`'s `data-source-persistence` listing). Still non-blocking.
