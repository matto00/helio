## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 6ac99447d07fd5bf5ee065b1141c1a31d0ea08a8 (the planning artifacts are uncommitted in the change dir).

### What I verified (with evidence)

- **cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/normalise-restored-legacy-format/hel-1441`.
- **D1 vs V118 section 3** (read `backend/src/main/resources/db/migration/V118__map_legacy_metric_format_objects.sql` in full). Every D1 rule matches the DO block:
  - Scope `kind IN ('metric','collection') AND jsonb_typeof(config->'format')='object'`.
  - Decimals are valid iff a JSON number that is `>= 0` and `= trunc(...)`; absent or null is absent.
  - Text fields: `NULLIF(btrim(v, E' \t\r\n'), '')`, and only for JSON strings.
  - Format order: integer at decimals 0, then currency when prefix is `$` and decimals are absent or 2, else number.
  - Parts are [unconsumed prefix, unit, suffix] joined by a space.
  - Shadowing: `live_unit IS NOT NULL AND jsonb_typeof <> 'null'`, which is any non-null type.
  - `unit` is written only for metric (collection is `kind-has-no-unit`).
  - `jsonb_set` replaces `format`.
  - I found no divergence.
- **V117-then-V118 composition**: `LegacyOutputConfigKeys` keeps `format` on metric/collection (`KeptOnKinds`) and renames `metricUnit` -> `unit`. Applying V117 first therefore makes a renamed live `unit` shadow V118's text, which is what stored data saw (V117 ran before V118). So the order is correct. I hand-checked all five D5 expected configs against both mappings: all correct (including `{"metricUnit":"USD","format":{"suffix":"/mo"}}` -> `{"unit":"USD","format":"number"}`).
- **No third captured-config restore site**: I grepped `LegacyOutputConfigKeys|insertInternal|RestorePriorStored` under `backend/src/main/scala`.
  - Output configs are restored only at `PatchSetUndoService.scala:303` and `OutputService.scala:202`.
  - The undo dispatch (`PatchSetUndoService.scala:107-122`) has no `output` update/delete case.
  - `PatchSetApplyRollback` `OutputDelete` is `unrecoverable`, and its `OutputUpdate` goes through `OutputService.update(RestorePriorStored)`.
  - The other `insertInternal` callers (`OutputService.create:148`, `PipelineCreateTransaction:271`) write fresh configs, not captured ones.
- **Item 3 premise**: `PipelineCreatePreflight.validateOutputConfig` (line 205) calls `OutputConfigValidation.validate(kind, config, JsObject.empty)`. `checkOutput:198` calls it, and so does `PipelineCreateTransaction:262`. `OutputConfigKeyValidationSpec:162-174` pins single-call create's 400 on an unknown key. The D6 mutation site (inside `validateOutputConfig`) is the right one to use: it is shared by both callers. The claim holds pending the recorded mutation.
- **D4 discriminates**:
  - `LegacyOutputConfigKeysParitySpec`'s `single` corpus crosses every dead key x kind x value x live state. Adding `{"layout":"asc"}` on `collectionOptions`/collection kills the enum-merge mutation, and adding a live `7`/`true` on a carried `metricUnit` kills the "only a string live key shadows" mutation.
  - Three unclosed `createStatement().executeQuery` calls are confirmed at the regclass check, the readback and the actions query.
- **`openspec validate normalise-restored-legacy-format --strict`** -> `Change 'normalise-restored-legacy-format' is valid`.
- **D3 mutation (a) does NOT discriminate with the stated corpus.** Probed with jshell:
  - `" $".trim()` and `.strip()` both leave the NBSP. This matches `btrim(E' \t\r\n')`, so the NBSP row cannot tell them apart.
  - `" $\t".trim()` == "$", which also matches btrim.
  - `"\u000B$".trim()` == "$" and `"\u000B$".strip()` == "$", while btrim keeps the VT.
  - `" $".strip()` == "$" (em space), while `.trim()` and btrim keep it.
  - Every whitespace in the D3 corpus (space, `\t`, `\n`, NBSP) is trimmed identically by btrim and `String.trim`. So mutation (a) survives, and the Risks line "D3 corpus includes NBSP and control-character cases" is wrong about the cases that matter.
- **ValidateWrite control (D5)**: `OutputConfigValidation.KnownKeys` allows `format` on metric/collection and never checks its value type. So a ValidateWrite PATCH over a stored object format succeeds. The existing HEL-1409 ValidateWrite test (`PatchSetUndoDeadOutputKeysSpec.scala:78`) is a rejection test: the write never happens, so it cannot detect "normalise under every policy". D5 says to mirror it, which would produce a control that proves nothing.

### Verdict: REFUTE

### Change Requests

1. **D3 corpus / mutation (a) (design.md D3 and Risks):** add prefix/unit/suffix values with whitespace that btrim keeps but Java trims:
   - `"\u000B$"` and `"$\f"` (`String.trim` and `strip` remove them, btrim keeps them);
   - `" $"` (`strip` removes it, trim and btrim keep it);
   - optionally `" kg\u000B"` on `unit`.

   Keep NBSP, but stop citing it as the trim discriminator. Correct the Risks line. Record mutation (a) as both `String.trim` and `String.strip`, each turning the spec red. As written, mutation (a) cannot go red.
2. **D5 ValidateWrite control (design.md D5):** specify a SUCCESSFUL ValidateWrite update that leaves an object `format` in the merged config, and assert the stored `format` is still that object. Two ways to do it:
   - seed `{"format":{"prefix":"$","decimals":2}}` and PATCH `{"label":"x"}`;
   - or PATCH `{"format":{"unit":"kg"}}` directly.

   Record a mutation (apply the composition regardless of policy at `OutputService.scala:202`) that turns it red. Do not copy the HEL-1409 rejection-style control: a rejected write cannot observe normalisation. This is what AC2's "nowhere under ValidateWrite" requires.

### Non-blocking notes

- D3 mutation (b) (currency at decimals 1) is only killed by the seeded random sample: about 1 in 65 sampled rows hits prefix `$` with decimals 1. Prefer enumerating decimals x prefix pairwise (13 x 10 rows per kind) so the kill does not depend on a seed.
- The D3 parity compare should feed Scala the same JSON text inserted into the jsonb column (or the parsed read-back of the original). Then jsonb input normalisation (key dedupe, numeric text) cannot cause a false mismatch.
- `RestorePriorStored` via mid-apply rollback restores a config captured from live (post-V118) storage seconds earlier, so the `OutputService` site is defence in depth (the same as HEL-1409). That is fine. A real gap outside this ticket: ValidateWrite still accepts a fresh object-valued `format` (no value-type check). A possible follow-up, not this ticket's scope.
