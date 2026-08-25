## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived every claim from the source tree, not from the round-1 report or the revision narrative.

CR1 (false `double precision` bound; missing small-magnitude case) — ADDRESSED.
- `V29__data_type_rows.sql:5` reads `data JSONB NOT NULL` (read directly); design.md's rewritten
  Risks section now states this correctly and names the residual ~400-char ceiling as a deliberate,
  documented limit rather than a total fix.
- `overwriteRows` (DataTypeRowRepository.scala:26-33) does write `row.compactPrint::jsonb` with no
  range check — the corrected risk narrative matches the code.
- tasks.md 2.7 and spec.md's new "Small-magnitude value with a long fractional expansion" scenario
  add the missing denormal-side case (`5e-324` ~326-char plain expansion, inside the 400 cap).

CR2 (wrong caller list) — ADDRESSED and accurate.
- `grep -rn listRows backend/src/main/scala`: real callers are `DataTypeService.scala:52`,
  `PanelCapabilityService.scala:46`, `WorkspaceContextService.scala:342` (via DataTypeService).
- `PipelineRunService.scala:523` and `BoundPanelService.scala:313` call `overwriteRows` only —
  exactly as proposal.md now states.

CR3 (missed sibling paths) — ADDRESSED.
- `AlertEventRepository.scala:31` (`value = row.value.parseJson`) and `AlertRuleRepository.scala:30`
  (`condition = row.condition.parseJson`) confirmed present; `V61__alert_events.sql:29` confirms
  `value JSONB NOT NULL`. design.md Non-Goals and tasks.md section 3 record them as report-only,
  matching the ticket's "report, do not widen scope" AC.

Independent design-soundness checks (new this round):
- spray-json 1.3.6 sources unzipped from
  `~/.cache/coursier/.../spray-json_2.13-1.3.6-sources.jar`:
  `JsonParser.scala:142` is `else if (numberLength <= settings.maxNumberCharacters)` → the
  design's off-by-one correction (100 passes, 101 fails) is right, the ticket's ">=100" is wrong.
  `JsonParserSettings.scala:51,54` confirm default 100 and `withMaxNumberCharacters`.
  `package.scala:51` confirms the `def parseJson(settings: JsonParserSettings)` overload exists on
  `RichString` — D1 is a supported extension point, not a hack, and is a genuine one-liner at
  `DataTypeRowRepository.scala:80`.
- AC coverage traced: every ticket AC maps to a task (round-trip 2.1/2.4, empirical boundary 2.3,
  sweep 2.4-2.6, denormal 2.7, control 2.8, red evidence 2.2, migration-escalation gate D2,
  sibling audit 3.1, dev-DB cleanup 2.10). No AC uncovered; no task beyond the ticket's scope.

### Verdict: CONFIRM

The plan is unambiguous, implementable, internally consistent on the load-bearing decisions, and
all three round-1 change requests are substantively and accurately fixed against ground truth.

### Non-blocking notes

- design.md "Goals" still carries the pre-correction framing: "any numeric value Postgres can hold
  in a `double precision`/jsonb numeric column ... (~309 digits for values near
  `1.7976931348623157e308`, the max `double`)". That is the exact claim the corrected Risks section
  now disclaims. It does not change any task or decision (D1 and the sweep are unaffected), but the
  executor should reword it to "any value whose plain-decimal expansion fits the 400-char cap" so
  the document does not contradict itself.
- proposal.md "Why" likewise still says the trigger value is "well within `double precision`"
  (inherited from the ticket text). Same cosmetic inconsistency; worth a one-line fix in flight.
- The empirical boundary task (2.3) should record the result as `<= 100` passes / `>= 101` fails to
  match `JsonParser.scala:142`, so the reported boundary is not re-derived loosely from the ticket.
