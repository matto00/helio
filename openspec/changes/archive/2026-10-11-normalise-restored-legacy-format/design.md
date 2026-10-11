## Context

Ground truth on origin/main 6ac99447d (see `.concertino/runs/HEL-1441/evidence/premise-validation.md`):

- `PatchSetUndoService.restoreBoundOutputs` (`services/patchsets/PatchSetUndoService.scala`, ~line 303) writes
  `LegacyOutputConfigKeys.normalise(kind, journaledConfig)` via `outputRepo.insertInternal`. The V117 mirror KEEPS
  `format` on metric/collection, so a pre-V118 object `format` is written back verbatim.
- `OutputService.update` (~line 202) applies the same V117 normalise to the MERGED config only under
  `OutputConfigWritePolicy.RestorePriorStored`.
- V118's executable mapping is section 3's DO block of
  `backend/src/main/resources/db/migration/V118__map_legacy_metric_format_objects.sql` (between the marker
  `-- ── 3. The mapping` and the first following `\n$$;`). It reads `outputs` and inserts into
  `hel1410_migrated_output_formats`. V118 ran after V117 on stored data.
- HEL-1409's pattern: `LegacyOutputConfigKeys` (pure mirror) + `LegacyOutputConfigKeysParitySpec` (runs V117's DO
  block verbatim on session TEMP tables on a `VerifiedEmbeddedPostgres`) + `PatchSetUndoDeadOutputKeysSpec` (real apply
  then undo, stored configs asserted) + `LegacyOutputConfigKeysSpec` (unit tests).
- Item 3 already satisfied on main (premise validation): `PipelineCreatePreflight.validateOutputConfig` calls
  `OutputConfigValidation.validate`; `OutputConfigKeyValidationSpec` "single-call pipeline create ... 400 an unknown key
  and persist no pipeline" pins it. `PipelineCreateTransaction` repeats `checkOutput` as defence in depth, so the
  mutation must remove the call inside `validateOutputConfig` (shared by both), not one caller.

## Goals / Non-Goals

**Goals:** every Output-config restore write equals V118(V117(captured config)); the V118 mirror is drift-pinned
against V118's own SQL; the V117 parity spec kills the two surviving mutation classes; item 3 verified with a recorded
mutation.

**Non-Goals:** journals rewritten; audit rows at restore time; any migration or stored-data change; changing
`ValidateWrite`/HEL-1313 tolerance; touching single-call create; refactoring patch-set code beyond the two call sites
(HEL-1459 is concurrently editing patch-set code -- keep the diff minimal).

## Decisions

**D1 One new pure mirror, composed after V117.** New object `LegacyOutputFormat` in `com.helio.services.pipelines`
(next to `LegacyOutputConfigKeys`), `normalise(kind: OutputKind, config: JsObject): JsObject`, mirroring the DO block:
scope = kind metric/collection AND `config.format` is a JSON object (everything else returned unchanged, same value).
Field reads exactly as the SQL: `decimals` valid iff JSON number, >= 0, integral (2 and 2.0 both valid; compare
numerically); absent/null = absent; else ignored. `prefix`/`unit`/`suffix` count iff JSON string, trimmed of ONLY
space, tab, CR, LF on both ends (`btrim(v, E' \t\r\n')` -- not Java `trim`/`strip`, which trim other characters),
empty result = absent; non-strings ignored. Format: valid decimals = 0 -> `integer`; else trimmed prefix == "$" and
decimals absent or valid == 2 -> `currency` (prefix consumed); else `number`. Unit text = non-empty
[prefix unless consumed, unit, suffix] joined by one space. Write `unit` only for metric, non-empty text, and live
`unit` absent or JSON null (a non-null live unit of ANY JSON type wins). Collection never gets `unit`. `format` is
replaced with the string. No audit output; the approximation codes are not needed (an internal classification may be
kept for tests only). A single composition helper, e.g. `LegacyOutputFormat.normaliseRestored(kind, cfg) =
normalise(kind, LegacyOutputConfigKeys.normalise(kind, cfg))`, is what the two call sites call, so the V117-then-V118
order lives in one place. Header comment points at V118 and the parity spec, like `LegacyOutputConfigKeys`.
Alternative rejected: folding V118 into `LegacyOutputConfigKeys` -- one object per migration keeps each parity spec's
subject exact.

**D2 Fix sites.** Replace the V117-only call with the composition at exactly the two existing sites:
`restoreBoundOutputs` (journaled config, journaled kind) and `OutputService.update` under `RestorePriorStored` (merged
config -- V118's live-`unit` shadow rule must see the merged result). Update the two existing HEL-1409 comments in
place. The executor re-greps (`LegacyOutputConfigKeys.normalise`, `insertInternal`, `RestorePriorStored` under
`services/`) to confirm no third captured-config write site exists after HEL-1479/1482/1475/1485, and records the
result in files-modified.md.

**D3 V118 parity spec (`LegacyOutputFormatParitySpec`).** Same mechanics as `LegacyOutputConfigKeysParitySpec`:
`VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder())`; read V118 from the classpath; extract section 3 VERBATIM
(assert the marker occurs exactly once, exactly one `DO $$` in the block, block contains
`jsonb_typeof(config -> 'format') = 'object'`); ONE JDBC connection; create TEMP `outputs(id text, kind text, config
jsonb)` and TEMP `hel1410_migrated_output_formats` with V118's columns AND its CHECK constraints (so an out-of-enum
action/approximation fails loudly); assert both resolve to `pg_temp`; insert corpus; run block; compare parsed JSON per
row against `LegacyOutputFormat.normalise` (JSON equality must treat 2 and 2.0 the same as the SQL output does --
compare `JsValue` after parsing both sides). Corpus: all 6 kinds x `format` value shapes {absent, JSON null, string
"number", number, array, `{}`} plus, for metric and collection, a cross product of decimals {absent, null, 0, 0.0, 1,
2, 2.0, 3, 7, -1, 1.5, "2", true}, prefix {absent, null, "$", " $\t", "<NBSP U+00A0>$", "<VT U+000B>$", "$<FF U+000C>",
"<EM SPACE U+2003>$", " $", "", "  ", "USD", "%", 5}, unit {absent, null, "kg", " kg\n", " kg<VT U+000B>", 3}, suffix {absent,
null, "pts", ""}, extra unknown key {absent, present}, live `unit`
{absent, JSON null, "live", 5, true, {}} -- bound the cross product (decimals x prefix FULLY enumerated for both
kinds, so every format-branch boundary is deterministic; a seeded random sample of >= 2000 rows over the remaining axes;
plus the fully enumerated single-axis rows). Feed the Scala mirror the exact JSON text inserted into the jsonb column,
parsed the same way, so jsonb input normalisation cannot cause false mismatches. Bound the run to a few seconds. Non-vacuity: assert >= N rows changed and
>= M unchanged (computed in-test), and that the audit table holds every `unit_action` value and every approximation
code. Record mutation proofs in evidence: (a1) Scala uses `String.trim` -> red (the VT/FF rows: `trim` strips every
char <= U+0020, btrim does not); (a2) Scala uses `String.strip` -> red (the EM SPACE row: `strip` strips Unicode
whitespace, btrim does not). NBSP alone discriminates NOTHING (`trim`, `strip` and btrim all keep it) -- it stays in the
corpus only as a keep-case;
(b) currency also when decimals == 1 -> red; (c) a non-string live unit does not shadow -> red. Include explicit
rows `{"unit":5|true|{}, "format":{"unit":"kg"}}` (metric) so (c) is killed deterministically, not only by the seed.
New embedded-PG specs MUST use `VerifiedEmbeddedPostgres.start`.

**D4 V117 parity spec hardening (`LegacyOutputConfigKeysParitySpec`).** Add to `ValuePool`: `{"layout":"asc"}`,
`{"layout":"desc"}`, `{"sort":"grid"}`, `{"sort":"list"}`. Add to `LiveStates`: `JsNumber(7)`, `JsTrue`,
`JsObject()`, `JsArray()`. Close every Statement/ResultSet (a small `query` helper with try/finally, or
`scala.util.Using`; no inline FQNs). Adjust non-vacuity thresholds only if the corpus growth requires it, and never
downward. Mutation proofs recorded: (a) `nestedValid` accepts `grid|list|asc|desc` for both keys -> red; (b) the shadow
check treats only a `JsString` live value as winning -> red. Both must have SURVIVED on the unhardened spec (record
that too -- it proves the hardening is what kills them).

**D5 Red first, end-to-end (Standing Constraint C1).** Extend `PatchSetUndoDeadOutputKeysSpec` (or a sibling spec
on the same `PatchSetUndoServiceFixture`) with a test that seeds Outputs bound to a step DIRECTLY via
`outputRepo.insertInternal` with pre-V118 configs, applies a REAL `pipelineStep` delete patch set, undoes it, and reads
STORED configs. Rows: metric `{"format":{"prefix":"$","decimals":2}}` -> `{"format":"currency"}`; metric
`{"format":{"unit":"kg","decimals":0}}` -> `{"format":"integer","unit":"kg"}`; metric
`{"unit":"live","format":{"unit":"kg"}}` -> `{"unit":"live","format":"number"}`; metric composing V117 then V118
`{"metricUnit":"USD","format":{"suffix":"/mo"}}` -> `{"unit":"USD","format":"number"}`; collection
`{"format":{"suffix":"pts"}}` -> `{"format":"number"}`; plus (AC5) collection `{"collectionOptions":{"layout":"list"}}`
-> `{"layout":"list"}` and chart `{"chartAnnotation":"note"}` -> `{"annotation":"note"}` (these two are V117 rows and
are green before the fix -- that is expected; they are coverage, not the red). Assert the precondition that the object
formats really are stored before apply. Run on unfixed code first; save the failing transcript to the run evidence
dir. Add a `RestorePriorStored` `OutputService.update` test for an object `format`, plus a `ValidateWrite` control that
SUCCEEDS: a ValidateWrite PATCH that leaves a stored object `format` in the merged config (a CONFIG patch, `UpdateOutputRequest(None, Some({"label":"x"}))` -- a name-only patch never reaches the normalise
call and could not go red)
must return Right and the STORED `format` must still be the object -- a rejected write would not show whether
normalisation ran, so the control must not be one. Record a mutation (normalise under every policy at the
`OutputService.update` call site) that turns this control red.

**D6 Item 3 -- verification only.** Temporarily delete the `OutputConfigValidation.validate(...)` link inside
`PipelineCreatePreflight.validateOutputConfig`; run `OutputConfigKeyValidationSpec`; the single-call test must go red;
restore (diff clean). Save the transcript to the evidence dir. If, contrary to premise validation, it stays green, STOP
and escalate (it would mean the item reproduces). No production change.

**Test running.** `[hel1468-guard]` must appear in every sbt run's output that is cited as evidence. Use `nice -n 19`;
check MemAvailable before any `sbt testFull` (wait if under ~15 GB); targeted `testOnly` for the touched specs is the
default; shut down any sbt server started. No inline FQNs.

## Risks / Trade-offs

- [Scala trim differs from `btrim` set] -> D3 corpus includes VT/FF (kill `trim`) and EM SPACE (kill `strip`); mutations (a1)/(a2).
- [Numeric equality 2 vs 2.0, BigDecimal scale] -> compare numerically; corpus includes 2.0 and 0.0.
- [Temp-table shadowing hits a real table] -> fresh embedded DB with no schema; assert `pg_temp` resolution.
- [Normalising under RestorePriorStored loses a deliberately stored object format] -> post-V118 none can be stored
  legitimately (V118's guard raises otherwise; the reader ignores objects), so nothing that renders is lost.
- [Merge conflict with HEL-1459] -> two one-line call-site edits plus new files; re-sync with origin/main before PR.

## Planner Notes

- Self-approved: all three items within the ticket's own scope; item 3 resolved as already-satisfied by premise
  validation (verification-only). No product call, no migration (next free would be V124; not needed).
