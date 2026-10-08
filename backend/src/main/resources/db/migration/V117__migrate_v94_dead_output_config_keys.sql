-- HEL-1387: repair the dead Output `config` keys that migration V94 (HEL-904) and HEL-877 left behind.
-- Nothing reads them, so Outputs migrated from panels silently lost their label, unit, annotation, timeline sort
-- and collection layout. HEL-1313 rejects writing these keys but tolerates stored ones; this migration repairs the
-- stored data. Owner rulings (2026-10-08): rename where a live equivalent exists (null live key counts as absent),
-- drop the rest, drop V94's wrong-kind keys too, and keep a permanent audit table.
--
-- Mapping (a dead key is dead whatever the Output's id; "live key" must be accepted by the kind):
--
--   dead key                          kinds renamed        live key   rename only if the value is        otherwise
--   metricLabel                       metric               label      a JSON string                      drop
--   metricUnit                        metric               unit       a JSON string                      drop
--   chartAnnotation                   chart                annotation a JSON string                      drop
--   collectionOptions.layout          collection           layout     "grid" or "list"                   drop
--   timelineOptions.sort              timeline             sort       "asc" or "desc"                    drop
--   collectionOptions (whole object)  -                    none       -                                  drop (baseType/itemOptions kept in audit)
--   timelineOptions (whole object)    -                    none       -                                  drop
--   columnWidths, tableDensity        -                    none       -                                  drop
--   legend, tooltip, seriesColors,
--     axisLabels                      -                    none       -                                  drop
--   format on chart/table/timeline/markdown                none       -                                  drop
--   columnOrder on a non-table, chartOptions on a non-chart        none       -                           drop
--
-- A non-null live key is never overwritten. A renamed key is written only when the live key is absent or JSON null.
-- Exactly one audit row is written per removed top-level key (config_value = the full original value of that key),
-- with `action` the first match of: kind-inapplicable, no-live-equivalent, null-value, invalid-value,
-- shadowed-by-live, renamed. `live_key` is set only for `renamed`. `updated_at` is deliberately untouched.
--
-- RLS: `outputs` has FORCE ROW LEVEL SECURITY with missing_ok policies, so an UPDATE by Flyway's `helio` connection
-- (table owner, NOBYPASSRLS, no app.current_user_id) would match zero rows SILENTLY. The bracket below (NO FORCE
-- ... FORCE) is mandatory; the in-migration guard cannot see its absence (it shares the same RLS state), so the spec
-- counts dead keys over a superuser connection. Do not set app.current_user_id and do not use BYPASSRLS.
--
-- Idempotent: the DO block only touches rows that still carry a dead key; every other statement is re-runnable.
-- Additive only -- never edit this file once applied (Flyway checksums comments too).

-- ── 1. Open the migration-context bracket ───────────────────────────────────
ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;

-- ── 2. Audit table (admin-only: it holds user config values) ────────────────
CREATE TABLE IF NOT EXISTS hel1387_dropped_output_config_keys (
  output_id    TEXT        NOT NULL,
  output_kind  TEXT        NOT NULL,
  config_key   TEXT        NOT NULL,
  config_value JSONB       NOT NULL,
  action       TEXT        NOT NULL CHECK (action IN
    ('kind-inapplicable', 'no-live-equivalent', 'null-value', 'invalid-value', 'shadowed-by-live', 'renamed')),
  live_key     TEXT        NULL,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Open in-bracket so the owner can insert on a re-run (the table is FORCEd again in section 5).
ALTER TABLE hel1387_dropped_output_config_keys NO FORCE ROW LEVEL SECURITY;

-- ── 3. The repair ───────────────────────────────────────────────────────────
DO $$
DECLARE
  all_keys CONSTANT TEXT[] := ARRAY[
    'metricLabel', 'metricUnit', 'chartAnnotation', 'collectionOptions', 'timelineOptions',
    'columnWidths', 'tableDensity', 'legend', 'tooltip', 'seriesColors', 'axisLabels',
    'format', 'columnOrder', 'chartOptions'];
  r         RECORD;
  k         TEXT;
  cfg       JSONB;
  v         JSONB;
  nested    JSONB;
  rename_kind TEXT;
  live      TEXT;
  act       TEXT;
  carry     JSONB;
  live_val  JSONB;
BEGIN
  FOR r IN
    SELECT id, kind, config FROM outputs WHERE jsonb_typeof(config) = 'object' AND jsonb_exists_any(config, all_keys)
  LOOP
    cfg := r.config;
    FOREACH k IN ARRAY all_keys LOOP
      CONTINUE WHEN NOT jsonb_exists(r.config, k);
      v := r.config -> k;
      rename_kind := NULL;
      live := NULL;
      act := NULL;
      carry := NULL;

      IF k IN ('columnWidths', 'tableDensity', 'legend', 'tooltip', 'seriesColors', 'axisLabels') THEN
        act := 'no-live-equivalent';
      ELSIF k = 'format' THEN
        CONTINUE WHEN r.kind IN ('metric', 'collection');
        act := 'kind-inapplicable';
      ELSIF k = 'columnOrder' THEN
        CONTINUE WHEN r.kind = 'table';
        act := 'kind-inapplicable';
      ELSIF k = 'chartOptions' THEN
        CONTINUE WHEN r.kind = 'chart';
        act := 'kind-inapplicable';
      ELSE
        -- rename sources
        IF k = 'metricLabel' THEN rename_kind := 'metric'; live := 'label';
        ELSIF k = 'metricUnit' THEN rename_kind := 'metric'; live := 'unit';
        ELSIF k = 'chartAnnotation' THEN rename_kind := 'chart'; live := 'annotation';
        ELSIF k = 'collectionOptions' THEN rename_kind := 'collection'; live := 'layout';
        ELSE rename_kind := 'timeline'; live := 'sort';
        END IF;

        IF r.kind <> rename_kind THEN
          act := 'kind-inapplicable';
        ELSIF jsonb_typeof(v) = 'null' THEN
          act := 'null-value';
        ELSIF k IN ('metricLabel', 'metricUnit', 'chartAnnotation') THEN
          IF jsonb_typeof(v) <> 'string' THEN act := 'invalid-value'; ELSE carry := v; END IF;
        ELSE
          IF jsonb_typeof(v) <> 'object' THEN
            act := 'invalid-value';
          ELSE
            nested := v -> live;
            IF nested IS NULL OR jsonb_typeof(nested) = 'null' THEN
              act := 'null-value';
            ELSIF (k = 'collectionOptions' AND nested IN ('"grid"'::jsonb, '"list"'::jsonb))
               OR (k = 'timelineOptions' AND nested IN ('"asc"'::jsonb, '"desc"'::jsonb)) THEN
              carry := nested;
            ELSE
              act := 'invalid-value';
            END IF;
          END IF;
        END IF;

        IF act IS NULL THEN
          live_val := cfg -> live;
          IF live_val IS NOT NULL AND jsonb_typeof(live_val) <> 'null' THEN
            act := 'shadowed-by-live';
          ELSE
            act := 'renamed';
          END IF;
        END IF;
      END IF;

      INSERT INTO hel1387_dropped_output_config_keys (output_id, output_kind, config_key, config_value, action, live_key)
      VALUES (r.id, r.kind, k, v, act, CASE WHEN act = 'renamed' THEN live END);

      cfg := cfg - k;
      IF act = 'renamed' THEN
        cfg := cfg || jsonb_build_object(live, carry);
      END IF;
    END LOOP;

    IF cfg IS DISTINCT FROM r.config THEN
      UPDATE outputs SET config = cfg WHERE id = r.id;
    END IF;
  END LOOP;
END
$$;

-- ── 4. Guard (cannot detect a missing bracket -- see header; the spec's superuser-side count is the backstop) ──
DO $$
DECLARE
  remaining INT;
BEGIN
  SELECT count(*) INTO remaining FROM outputs
  WHERE jsonb_typeof(config) = 'object'
    AND (jsonb_exists_any(config, ARRAY['metricLabel', 'metricUnit', 'chartAnnotation', 'collectionOptions', 'timelineOptions',
                                        'columnWidths', 'tableDensity', 'legend', 'tooltip', 'seriesColors', 'axisLabels'])
     OR (kind NOT IN ('metric', 'collection') AND jsonb_exists(config, 'format'))
     OR (kind <> 'table' AND jsonb_exists(config, 'columnOrder'))
     OR (kind <> 'chart' AND jsonb_exists(config, 'chartOptions')));
  IF remaining > 0 THEN
    RAISE EXCEPTION 'HEL-1387: % outputs rows still carry a dead config key after V117', remaining;
  END IF;
END
$$;

-- ── 5. Lock the audit table down and close the bracket ──────────────────────
-- Admin-only (mirrors V105 oauth_states): FORCE RLS + deny-all + explicit grant to the privileged pool.
ALTER TABLE hel1387_dropped_output_config_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE hel1387_dropped_output_config_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hel1387_dropped_output_config_keys_deny_all ON hel1387_dropped_output_config_keys;
CREATE POLICY hel1387_dropped_output_config_keys_deny_all ON hel1387_dropped_output_config_keys
  USING (false);
GRANT SELECT ON hel1387_dropped_output_config_keys TO helio_privileged;

ALTER TABLE outputs FORCE ROW LEVEL SECURITY;
