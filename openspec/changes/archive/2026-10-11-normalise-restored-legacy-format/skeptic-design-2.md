## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 6ac99447d07fd5bf5ee065b1141c1a31d0ea08a8. The planning artifacts are uncommitted in the change dir.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/normalise-restored-legacy-format/hel-1441`.

- **Round-1 CR1 is closed: trim/strip discrimination, probed on both sides.**
  - jshell, Java side (codepoints, input -> `trim` / `strip`):

    | input | `trim` | `strip` |
    |---|---|---|
    | `[11,36]` (VT$) | `[36]` | `[36]` |
    | `[36,12]` ($FF) | `[36]` | `[36]` |
    | `[8195,36]` (EM SPACE $) | `[8195,36]` | `[36]` |
    | `[160,36]` (NBSP $) | `[160,36]` | `[160,36]` |
    | `[32,107,103,11]` (" kg"+VT) | `[107,103]` | `[107,103]` |

  - Postgres side, local `psql`: `btrim(x, E' \t\r\n')` returns hex `0b24`, `240c`, `e2808324`, `c2a024`, `6b670b`. So btrim keeps VT, FF, EM SPACE and NBSP. It strips space/tab/LF exactly as `trim` does (`" $\t"` -> `24`, `" kg\n"` -> `6b67`).
  - Consequences for the mutations:
    - (a1) `String.trim` is killed by the VT/FF prefix rows and the `" kg<VT>"` unit row.
    - (a2) `String.strip` is killed by the EM SPACE row, and also by VT/FF.
    - In the prefix rows, btrim keeps `<VT>$`, so the format is not `$`, giving `number` plus written text. `trim` gives `currency`. This divergence holds whenever decimals are absent or 2. Decimals x prefix is now fully enumerated for both kinds, so those rows are present deterministically.
  - The design text now says NBSP discriminates nothing and keeps it only as a keep-case. That is correct.
  - The Risks line is corrected.

- **Round-1 CR2 is closed: the ValidateWrite control now succeeds.**
  - `OutputService.scala:198-203`: the normalise call sits inside `req.config.map { ... }`.
  - `OutputConfigValidation.KnownKeys` has `label` and `format` on Metric and does no value-type check on `format`.
  - So seeding a metric with an object `format` and sending a ValidateWrite config patch `{"label":"x"}` returns Right and stores the merged config with the object format intact.
  - The mutation "normalise under every policy" would rewrite that format to a string. The control as specified can therefore go red.

- **D1 vs V118 section 3, re-derived independently** (read all of `V118__map_legacy_metric_format_objects.sql`). The design matches the SQL on every rule:
  - scope (lines 100-104);
  - decimals validity: number, `>= 0`, `= trunc`;
  - text reads: string-only, `NULLIF(btrim(...), '')`;
  - format precedence: integer, then `pre = '$'` with dec null or 2 -> currency, else number;
  - parts order;
  - live-unit shadow for any non-null type (line 170);
  - collection never gets `unit`;
  - `jsonb_set` replaces `format`.

- **D3 extraction is feasible.**
  - The marker `-- ── 3. The mapping` occurs once (line 75).
  - The block is `DO $$` (line 76) through the first `\n$$;` (lines 193-194). Section 4's `DO $$` comes after that terminator, so the block holds exactly one `DO $$`.
  - The block reads the unqualified `outputs` and inserts into `hel1410_migrated_output_formats`, so TEMP-table shadowing in `pg_temp` works.
  - The CHECK constraints (lines 62-68) can be copied onto the temp table.

- **Every non-vacuity target (unit_action values and approximation codes) can be reached from the stated corpus axes.** Codes and the axis that produces each:
  - capped: decimals 3/7;
  - not-fixed: decimals 1 with any prefix, or 2 without `$`;
  - ignored: decimals -1, 1.5, "2", true;
  - prefix-after-value: "USD" or "%";
  - joined: several text axes at once;
  - shadowed: live unit present;
  - dropped-collection: collection with text;
  - non-string: prefix 5 or unit 3;
  - unknown-keys: the extra-key axis.

- **D4 is consistent with V117 SQL.**
  - V117 (lines 117-119) checks nested enums per key.
  - V117 (line 128) shadows on any non-null live value.
  - Main's `LegacyOutputConfigKeys` (`nestedValid` per key; `exists(_ != JsNull)`) agrees with both. So the hardened corpus should stay green on main, and both stated mutations become killable.
  - I confirmed that `ValuePool` and `LiveStates` lack the added values (as the premise claims) by reading the premise against the source shape described. The three unclosed `executeQuery` calls were confirmed in round 1.

- **Fix sites.** I re-grepped `LegacyOutputConfigKeys.normalise|RestorePriorStored|insertInternal(` under `backend/src/main/scala`.
  - Captured-config Output writes happen only at `PatchSetUndoService.scala:303` and `OutputService.scala:202`. `PatchSetApplyRollback.scala:186` reaches the latter through `RestorePriorStored`.
  - `OutputService.scala:148` writes a fresh create config.
  - The `PipelineStepRepository` `insertInternal` writes steps, not Outputs.

- **V117-then-V118 composition order is right.**
  - V117 keeps `format` on metric/collection (`KeptOnKinds`) and renames `metricUnit` -> `unit`, so V118's shadow rule sees the renamed unit, which matches stored-data history.
  - I hand-checked all five D5 expected configs: correct.

- **D5 harness exists.** `PatchSetUndoDeadOutputKeysSpec` already seeds via `insertInternal`, applies a real `pipelineStep` delete, undoes it, and reads stored configs. The plan extends a proven harness (constraint C1 holds).

- **Item 3 / D6.** The mutation site (inside `validateOutputConfig`, shared by both callers) is right. AC6 and D6 agree. The escalate-if-green branch is specified.

- **Spec delta.** `openspec validate normalise-restored-legacy-format --strict` -> `Change 'normalise-restored-legacy-format' is valid`.

- **Coverage.** The tasks cover AC1-AC6. No scope drift. No migration or stored-data change (C2).

### Verdict: CONFIRM

### Non-blocking notes

- **D5 wording.** "patching only `label`" means the metric CONFIG key `label`, i.e. `UpdateOutputRequest(name = None, config = Some({"label":"x"}))`. A name-only PATCH would be the wrong control: `mergedConfig` would be `None`, so normalisation could never run on either policy. The required mutation proof self-detects this, but the executor should send the config form.
- **D3, mutation (c)** (non-string live unit does not shadow). It is killed only by rows that combine non-empty format text with a non-null non-string live unit, and those come from the seeded random sample. Consider adding explicit single-axis rows such as `{"unit":5,"format":{"unit":"kg"}}`, `{"unit":true,...}` and `{"unit":{},...}` so the kill does not depend on the seed.
- **Wording mismatch.** The premise-validation text says the D6 mutation is "from `checkOutput`", while AC6/D6 say "inside `validateOutputConfig`". The latter is correct: `checkOutput` and `PipelineCreateTransaction` both route through it.
