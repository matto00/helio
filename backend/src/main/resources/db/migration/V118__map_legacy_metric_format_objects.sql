-- HEL-1410: map the legacy object-valued `format` that V94 (HEL-904) copied onto metric/collection Outputs.
-- V75 stored `metrics.format` as a JSON object {unit, decimals, prefix, suffix}; V94 section 9 copied it verbatim onto
-- the Output as `config.format`. The readers (`readMetricConfig`/`readCollectionConfig`, `isMetricFormat`) accept only
-- the strings number|integer|currency|percent, so those Outputs silently rendered with no format and lost their unit,
-- prefix, suffix and decimals. Owner ruling (2026-10-08, escalation HEL-1410-1791498651450-895c84): measure, then map
-- each object to the CLOSEST supported string format, move the text into the live `unit` key where it is absent or JSON
-- null (never overwriting a non-null `unit`), and record every original in an audit table.
--
-- Scope: kind IN ('metric', 'collection') AND jsonb_typeof(config -> 'format') = 'object'. Nothing else is touched
-- (string formats, other kinds, non-object configs stay byte-identical).
--
-- Field reads:
--   decimals   VALID iff a JSON number that is a non-negative integer (2 and 2.0 are both 2). Absent or JSON null is
--              plain absent (no code). Any other value is treated as absent and records `decimals-ignored`.
--   prefix, unit, suffix   count iff a JSON string; each is trimmed with btrim(v, E' \t\r\n') (space, tab, CR, LF) and
--              an empty result is absent. Absent or JSON null is plain absent (no code). Any other non-string value
--              records `text-ignored-non-string`.
--   any other key in the object records `unknown-keys-ignored`.
--
-- Mapping (first match):
--   condition                                              new format   prefix consumed
--   valid decimals = 0                                     integer      no
--   trimmed prefix = '$' and decimals absent or valid 2    currency     yes
--   anything else (including {})                           number       no
--   `percent` is never produced (it multiplies by 100); a legacy '%' stays text.
--
-- Unit text (metric only) = the non-empty parts [prefix unless consumed, unit, suffix], in that order, joined by one
-- space:
--   metric, text non-empty, live `unit` absent or JSON null  -> write `unit`            (unit_action = written)
--   metric, text non-empty, live `unit` non-null (any type)  -> untouched               (shadowed-by-live; text-shadowed)
--   metric, no text                                          ->                         (no-text)
--   collection (has no `unit` key)                           ->                         (kind-has-no-unit; non-empty
--                                                                                        text records text-dropped-collection)
--
-- Approximation codes (hel1410_migrated_output_formats.approximations, in this order, each at most once):
--   decimals-capped   valid decimals >= 3, format number         decimals-not-fixed  valid decimals 1 or 2, format number
--   decimals-ignored  invalid decimals                           prefix-after-value  an unconsumed prefix written into unit
--   text-joined       >= 2 parts written to unit                 text-shadowed       text not written, live unit non-null
--   text-dropped-collection   collection had non-empty text      text-ignored-non-string  non-string prefix/unit/suffix
--   unknown-keys-ignored      object had keys other than the four
--
-- Audit: one row per rewritten Output. `prior_unit` is SQL NULL when the `unit` key was absent and 'null'::jsonb when
-- it was JSON null, so a rollback restores absent-vs-null exactly. Rollback: set format = original_format and, where
-- unit_action = 'written', restore unit from prior_unit. `updated_at` is deliberately untouched (storage repair).
--
-- RLS: `outputs` has FORCE ROW LEVEL SECURITY with missing_ok policies, so an UPDATE by Flyway's `helio` connection
-- (table owner, NOBYPASSRLS, no app.current_user_id) would match zero rows SILENTLY. The bracket below (NO FORCE
-- ... FORCE) is mandatory; the in-migration guard cannot see its absence (it shares the same RLS state), so the spec
-- counts object formats over a superuser connection. Do not set app.current_user_id and do not use BYPASSRLS.
--
-- Idempotent: the DO block only touches rows that still carry an object `format`; every other statement is re-runnable.
-- Additive only -- never edit this file once applied (Flyway checksums comments too).

-- ── 1. Open the migration-context bracket ───────────────────────────────────
ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;

-- ── 2. Audit table (admin-only: it holds user config values) ────────────────
CREATE TABLE IF NOT EXISTS hel1410_migrated_output_formats (
  output_id       TEXT        NOT NULL,
  output_kind     TEXT        NOT NULL,
  original_format JSONB       NOT NULL,
  new_format      TEXT        NOT NULL CHECK (new_format IN ('number', 'integer', 'currency')),
  prior_unit      JSONB       NULL,
  unit_action     TEXT        NOT NULL CHECK (unit_action IN ('written', 'shadowed-by-live', 'no-text', 'kind-has-no-unit')),
  unit_written    TEXT        NULL,
  approximations  TEXT[]      NOT NULL CHECK (approximations <@ ARRAY[
    'decimals-capped', 'decimals-not-fixed', 'decimals-ignored', 'prefix-after-value', 'text-joined', 'text-shadowed',
    'text-dropped-collection', 'text-ignored-non-string', 'unknown-keys-ignored']::TEXT[]),
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Open in-bracket so the owner can insert on a re-run (the table is FORCEd again in section 5).
ALTER TABLE hel1410_migrated_output_formats NO FORCE ROW LEVEL SECURITY;

-- ── 3. The mapping ──────────────────────────────────────────────────────────
DO $$
DECLARE
  r          RECORD;
  fmt        JSONB;
  dec_raw    JSONB;
  dec_val        NUMERIC;       -- valid decimals, NULL when absent/invalid
  dec_bad    BOOLEAN;
  pre        TEXT;
  uni        TEXT;
  suf        TEXT;
  non_string BOOLEAN;
  new_fmt    TEXT;
  consumed   BOOLEAN;
  parts      TEXT[];
  txt        TEXT;
  live_unit  JSONB;
  act        TEXT;
  written    TEXT;
  approx     TEXT[];
  cfg        JSONB;
  k          TEXT;
  has_unknown    BOOLEAN;

BEGIN
  FOR r IN
    SELECT id, kind, config FROM outputs
    WHERE kind IN ('metric', 'collection')
      AND jsonb_typeof(config) = 'object'
      AND jsonb_typeof(config -> 'format') = 'object'
  LOOP
    fmt := r.config -> 'format';

    -- decimals
    dec_raw := fmt -> 'decimals';
    dec_val := NULL;
    dec_bad := FALSE;
    IF dec_raw IS NOT NULL AND jsonb_typeof(dec_raw) <> 'null' THEN
      IF jsonb_typeof(dec_raw) = 'number'
         AND (dec_raw #>> '{}')::numeric >= 0
         AND (dec_raw #>> '{}')::numeric = trunc((dec_raw #>> '{}')::numeric) THEN
        dec_val := (dec_raw #>> '{}')::numeric;
      ELSE
        dec_bad := TRUE;
      END IF;
    END IF;

    -- text fields
    non_string := FALSE;
    pre := NULL; uni := NULL; suf := NULL;
    FOREACH k IN ARRAY ARRAY['prefix', 'unit', 'suffix'] LOOP
      txt := NULL;
      IF fmt -> k IS NOT NULL AND jsonb_typeof(fmt -> k) <> 'null' THEN
        IF jsonb_typeof(fmt -> k) = 'string' THEN
          txt := NULLIF(btrim(fmt ->> k, E' \t\r\n'), '');
        ELSE
          non_string := TRUE;
        END IF;
      END IF;
      IF k = 'prefix' THEN pre := txt; ELSIF k = 'unit' THEN uni := txt; ELSE suf := txt; END IF;
    END LOOP;

    SELECT EXISTS (SELECT 1 FROM jsonb_object_keys(fmt) AS key WHERE key NOT IN ('unit', 'decimals', 'prefix', 'suffix'))
      INTO has_unknown;

    -- format
    consumed := FALSE;
    IF dec_val IS NOT NULL AND dec_val = 0 THEN
      new_fmt := 'integer';
    ELSIF pre = '$' AND (dec_val IS NULL OR dec_val = 2) THEN
      new_fmt := 'currency';
      consumed := TRUE;
    ELSE
      new_fmt := 'number';
    END IF;

    -- unit text
    parts := ARRAY[]::TEXT[];
    IF pre IS NOT NULL AND NOT consumed THEN parts := parts || pre; END IF;
    IF uni IS NOT NULL THEN parts := parts || uni; END IF;
    IF suf IS NOT NULL THEN parts := parts || suf; END IF;
    live_unit := r.config -> 'unit';
    written := NULL;
    approx := ARRAY[]::TEXT[];

    IF new_fmt = 'number' AND dec_val IS NOT NULL THEN
      IF dec_val >= 3 THEN approx := array_append(approx, 'decimals-capped'::text); ELSE approx := array_append(approx, 'decimals-not-fixed'::text); END IF;
    END IF;
    IF dec_bad THEN approx := array_append(approx, 'decimals-ignored'::text); END IF;

    IF r.kind = 'collection' THEN
      act := 'kind-has-no-unit';
      IF cardinality(parts) > 0 THEN approx := array_append(approx, 'text-dropped-collection'::text); END IF;
    ELSIF cardinality(parts) = 0 THEN
      act := 'no-text';
    ELSIF live_unit IS NOT NULL AND jsonb_typeof(live_unit) <> 'null' THEN
      act := 'shadowed-by-live';
      approx := array_append(approx, 'text-shadowed'::text);
    ELSE
      act := 'written';
      written := array_to_string(parts, ' ');
      IF pre IS NOT NULL AND NOT consumed THEN approx := array_append(approx, 'prefix-after-value'::text); END IF;
      IF cardinality(parts) >= 2 THEN approx := array_append(approx, 'text-joined'::text); END IF;
    END IF;

    IF non_string THEN approx := array_append(approx, 'text-ignored-non-string'::text); END IF;
    IF has_unknown THEN approx := array_append(approx, 'unknown-keys-ignored'::text); END IF;

    INSERT INTO hel1410_migrated_output_formats
      (output_id, output_kind, original_format, new_format, prior_unit, unit_action, unit_written, approximations)
    VALUES (r.id, r.kind, fmt, new_fmt, live_unit, act, written, approx);

    cfg := jsonb_set(r.config, '{format}', to_jsonb(new_fmt));
    IF act = 'written' THEN
      cfg := jsonb_set(cfg, '{unit}', to_jsonb(written), TRUE);
    END IF;
    UPDATE outputs SET config = cfg WHERE id = r.id;
  END LOOP;
END
$$;

-- ── 4. Guard (cannot detect a missing bracket -- see header; the spec's superuser-side count is the backstop) ──
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT count(*) INTO remaining FROM outputs
  WHERE kind IN ('metric', 'collection')
    AND jsonb_typeof(config) = 'object'
    AND jsonb_typeof(config -> 'format') = 'object';
  IF remaining > 0 THEN
    RAISE EXCEPTION 'HEL-1410: % metric/collection outputs rows still carry an object format after V118', remaining;
  END IF;
END
$$;

-- ── 5. Lock the audit table down and close the bracket ──────────────────────
-- Admin-only (mirrors V117 / V105 oauth_states): FORCE RLS + deny-all + explicit grant to the privileged pool.
ALTER TABLE hel1410_migrated_output_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE hel1410_migrated_output_formats FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hel1410_migrated_output_formats_deny_all ON hel1410_migrated_output_formats;
CREATE POLICY hel1410_migrated_output_formats_deny_all ON hel1410_migrated_output_formats
  USING (false);
GRANT SELECT ON hel1410_migrated_output_formats TO helio_privileged;

ALTER TABLE outputs FORCE ROW LEVEL SECURITY;
