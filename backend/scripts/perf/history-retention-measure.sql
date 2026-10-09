-- HEL-1284: seed + measure the history-retention tick's DELETEs at volume.
--
-- Scratch database only. Fail-stop guard FIRST (\set ON_ERROR_STOP on, then a DO ... RAISE, which ends
-- psql with exit 3; \if/\quit would exit 0). Keep this one file, no \c. Dropping the scratch database is
-- deliberately NOT in here: run `DROP DATABASE helio_hel1284_scratch` by hand from another database.
--
-- Prereq: helio_hel1284_scratch migrated to the repo head (see measurements.md for the jshell/Flyway recipe).
--
-- Usage (one psql session per phase, so seeding's work_mem never leaks into measuring):
--   psql -X -w -d helio_hel1284_scratch -v n_outputs=10000 -v mix=M -v backlog=0 -v do_seed=on   -f history-retention-measure.sql
--   psql -X -w -d helio_hel1284_scratch -v do_report=on  -f history-retention-measure.sql
--   psql -X -w -d helio_hel1284_scratch -v idx=none|captured_at|pipeline_captured|both -v do_index=on -f ...
--   psql -X -w -d helio_hel1284_scratch -v do_measure=on -f history-retention-measure.sql 2>&1 | tee run.log
--   psql -X -w -d helio_hel1284_scratch -v do_insert_path=on -f history-retention-measure.sql
-- Variables: n_outputs (multiple of 6), mix = M (70/25/5 free/beta/owner by user) | owner (all owner),
--            backlog = 0 (thinned steady state) | 1 (7 days of un-thinned 5-minute points).
-- Measurement output is NOTICE lines starting with '@@' (parsed by the evidence tooling); plans are text
-- EXPLAIN (ANALYZE, BUFFERS) of the exact statement text from OutputHistoryRepository.thinAndPurge and
-- NodePayloadHistoryRepository.purge (origin/main 023aa4bb), bind parameters substituted as literals.

\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'helio_hel1284_scratch' THEN
    RAISE EXCEPTION 'refusing: this script only runs in helio_hel1284_scratch, not %', current_database();
  END IF;
END
$guard$;
\echo MARKER_AFTER_GUARD

\if :{?do_seed} \else \set do_seed off \endif
\if :{?do_report} \else \set do_report off \endif
\if :{?do_index} \else \set do_index off \endif
\if :{?do_measure} \else \set do_measure off \endif
\if :{?do_insert_path} \else \set do_insert_path off \endif
\if :{?idx} \else \set idx none \endif
\if :{?pg16_view} \else \set pg16_view off \endif
\if :{?n_outputs} \else \set n_outputs 1000 \endif
\if :{?mix} \else \set mix M \endif
\if :{?backlog} \else \set backlog 0 \endif

-- ======================================================================================================
-- SEED
-- ======================================================================================================
\if :do_seed
SET work_mem = '256MB';
SET maintenance_work_mem = '512MB';
SET synchronous_commit = off;

-- Tier caps/payload limits below are the repository defaults: history free 30 d / beta 90 d / owner 365 d;
-- payloads free none / beta 10 runs, 7 d / owner 30 runs, 30 d. Mix M by USER (6 outputs, 2 pipelines per
-- user): (user % 20) < 14 free (70%), < 19 beta (25%), else owner (5%). The anchor T is the hour-aligned
-- tick time; the table is seeded as the previous tick (T0 = T - 1 h) left it, plus one hour of new points.
DROP TABLE IF EXISTS perf_anchor;
CREATE TABLE perf_anchor AS SELECT date_trunc('hour', now()) AS t;
TRUNCATE users, pipelines, outputs, pipeline_roots, data_sources, output_snapshot_history, node_payload_history CASCADE;
DROP INDEX IF EXISTS perf_osh_captured_at;
DROP INDEX IF EXISTS perf_osh_pipeline_captured;
DROP INDEX IF EXISTS perf_nph_captured_at;
DROP INDEX IF EXISTS perf_nph_pipeline_captured;

CREATE TEMP TABLE o AS
SELECT n AS o, n / 6 AS u, n / 3 AS p,
       CASE WHEN :'mix' = 'owner' THEN 'owner'
            WHEN (n / 6) % 20 < 14 THEN 'free'
            WHEN (n / 6) % 20 < 19 THEN 'beta'
            ELSE 'owner' END AS tier
FROM generate_series(0, :n_outputs - 1) n;
ALTER TABLE o ADD COLUMN cap int;
UPDATE o SET cap = CASE tier WHEN 'free' THEN 30 WHEN 'beta' THEN 90 ELSE 365 END;

INSERT INTO users (id, email, tier)
SELECT md5('u' || u)::uuid, 'u' || u || '@perf.invalid', min(tier) FROM o GROUP BY u;
INSERT INTO pipelines (id, name, owner_id)
SELECT 'p' || p, 'p' || p, md5('u' || min(u))::uuid FROM o GROUP BY p;
INSERT INTO data_sources (id, name, source_type, config, created_at, updated_at)
VALUES ('ds0', 'perf', 'csv', '{}', now(), now());
INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
SELECT 'r' || p, 'p' || p, 'ds0', 0 FROM o GROUP BY p;
INSERT INTO outputs (id, pipeline_id, root_id, owner_id, name, kind)
SELECT 'o' || o, 'p' || p, 'r' || p, md5('u' || u)::uuid, 'o' || o, 'metric' FROM o;

-- Payload plan, per NODE (here: one root per pipeline, so one payload stream per pipeline): 20% of beta/owner
-- pipelines opt in (hashed, not modulo: a plain k % n aliases with the user/tier layout). Each holds its newest N
-- payloads (N = tier max runs), each linked from the history point of EVERY output of that pipeline at the same
-- instant (as the writer does: one payload per node run, one summary point per Output), plus the retention
-- pass's real hourly work:
--   * 1 in 10 opted-in pipelines: one payload beyond the newest N (linked to the (N+1)th newest points)
--   * 1 in 24: one payload just past the tier's max age (linked to the points at that age)
--   * 1 in 20: one unreferenced payload (no history point links it; it sits older than the newest N, so the
--     newest-N pass removes it before the unreferenced pass would)
-- and, as downgrade residue, one linked payload on 1 in 60 free pipelines (a tier that stores none).
-- Row count per payload: 70% x 20 rows, 25% x 200, 5% x 1000 (mean ~114 rows).
CREATE TEMP TABLE pp AS
WITH t0 AS (SELECT t - interval '1 hour' AS t0 FROM perf_anchor),
pl AS (SELECT DISTINCT p, tier FROM o),
base AS (
  SELECT pl.p, pl.tier, CASE pl.tier WHEN 'beta' THEN 10 ELSE 30 END AS n_keep,
         CASE pl.tier WHEN 'beta' THEN interval '7 days' ELSE interval '30 days' END AS max_age
  FROM pl WHERE pl.tier IN ('beta', 'owner') AND abs(hashtext('optin' || pl.p)) % 5 = 0
)
SELECT p, ts, linked FROM (
  SELECT b.p, (SELECT t0 FROM t0) + (12 - i) * interval '5 min' AS ts, true AS linked
    FROM base b, LATERAL generate_series(0, b.n_keep - 1) i
  UNION ALL
  SELECT b.p, (SELECT t0 FROM t0) + (12 - b.n_keep) * interval '5 min', true FROM base b WHERE abs(hashtext('beyondn' || b.p)) % 10 = 0
  UNION ALL
  SELECT b.p, (SELECT t0 FROM t0) - b.max_age, true FROM base b WHERE abs(hashtext('age' || b.p)) % 24 = 0
  UNION ALL
  SELECT b.p, (SELECT t0 FROM t0) - interval '3 hours' + interval '1 second', false FROM base b WHERE abs(hashtext('unref' || b.p)) % 20 = 0
  UNION ALL
  SELECT f.p, (SELECT t0 FROM t0) + 12 * interval '5 min', true FROM pl f WHERE f.tier = 'free' AND abs(hashtext('resid' || f.p)) % 60 = 0
) x;
ALTER TABLE pp ADD COLUMN id uuid DEFAULT gen_random_uuid();
ALTER TABLE pp ADD COLUMN nrows int;
UPDATE pp SET nrows = CASE WHEN abs(hashtext(p::text || ts::text)) % 100 < 70 THEN 20
                           WHEN abs(hashtext(p::text || ts::text)) % 100 < 95 THEN 200 ELSE 1000 END;

INSERT INTO node_payload_history (id, pipeline_id, root_id, run_id, trigger_source, captured_at, row_count, byte_size, rows)
SELECT pp.id, 'p' || pp.p, 'r' || pp.p, 'run-' || extract(epoch FROM pp.ts)::bigint, 'schedule', pp.ts, pp.nrows, 0,
       (SELECT jsonb_agg(jsonb_build_object('region', 'R' || (i % 12), 'revenue', round((i * 1.37)::numeric, 2),
                                            'n', i, 'label', md5(pp.p::text || i::text)))
          FROM generate_series(1, pp.nrows) i)
FROM pp ORDER BY pp.ts;
UPDATE node_payload_history SET byte_size = length(rows::text);

-- History points, inserted in captured_at order (as live ingest does, so heap order ~ time order).
--   steady state: 300 x 5-min points (T0-287*5min .. T0+12*5min), 144 hourly (24 h .. 7 d), one daily
--   from 7 d to the tier cap; backlog: 5-min points for the whole 7 days, daily beyond.
--   1 in 24 Outputs (hashed) also holds one daily point past its tier cap by 30 min (the age purge's hourly work).
-- summary: a ~330-byte JSONB of the shape OutputSummaryReducer stores (dev mean pg_column_size 340).
CREATE TEMP VIEW hv AS
SELECT o.o, o.p, o.cap, x.ts FROM o,
LATERAL (
  SELECT (SELECT t - interval '1 hour' FROM perf_anchor) - k * interval '5 min' AS ts
    FROM generate_series(-12, CASE WHEN :backlog = 1 THEN 7 * 288 - 1 ELSE 287 END) k
  UNION ALL
  SELECT (SELECT t - interval '1 hour' FROM perf_anchor) - interval '24 hours' - j * interval '1 hour'
    FROM generate_series(0, 143) j WHERE :backlog = 0
  UNION ALL
  SELECT (SELECT t - interval '1 hour' FROM perf_anchor) - interval '7 days' - d * interval '1 day'
    FROM generate_series(0, o.cap - 8) d
  UNION ALL
  SELECT (SELECT t FROM perf_anchor) - o.cap * interval '1 day' - interval '30 minutes' WHERE abs(hashtext('pastcap' || o.o)) % 24 = 0
) x;
INSERT INTO output_snapshot_history (output_id, pipeline_id, root_id, run_id, trigger_source, captured_at, row_count, summary, payload_id)
SELECT 'o' || h.o, 'p' || h.p, 'r' || h.p, 'run-' || extract(epoch FROM h.ts)::bigint, 'schedule', h.ts,
       1 + abs(hashtext(h.o::text || h.ts::text)) % 1000,
       '{"v":1,"metric":null,"series":{"x":"day","y":"revenue","agg":null,"mode":"rows","points":[["d01",100.0],["d02",101.0],["d03",102.0],["d04",103.0],["d05",104.0],["d06",105.0],["d07",106.0]]}}'::jsonb,
       pp.id
FROM hv h LEFT JOIN pp ON pp.p = h.p AND pp.ts = h.ts AND pp.linked
ORDER BY h.ts;

RESET work_mem;
VACUUM (ANALYZE) users, pipelines, outputs, pipeline_roots, output_snapshot_history, node_payload_history;
\endif

-- ======================================================================================================
-- REPORT (seed verification; read-only)
-- ======================================================================================================
\if :do_report
\echo '--- anchor / counts'
SELECT t AS tick_time_T FROM perf_anchor;
SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM pipelines) pipelines, (SELECT count(*) FROM outputs) outputs,
       (SELECT count(*) FROM output_snapshot_history) history_rows, (SELECT count(*) FROM node_payload_history) payload_rows;
\echo '--- outputs / history rows / rows per output by tier'
SELECT u.tier, count(DISTINCT out.id) AS outputs, count(h.id) AS history_rows,
       round(count(h.id)::numeric / NULLIF(count(DISTINCT out.id), 0), 1) AS rows_per_output,
       round(100.0 * count(DISTINCT out.id) / (SELECT count(*) FROM outputs), 1) AS pct_outputs
FROM outputs out JOIN pipelines p ON p.id = out.pipeline_id JOIN users u ON u.id = p.owner_id
LEFT JOIN output_snapshot_history h ON h.output_id = out.id
GROUP BY u.tier ORDER BY u.tier;
\echo '--- summary size, payload size/rows distribution'
SELECT round(avg(pg_column_size(summary)), 1) AS avg_summary_bytes, min(pg_column_size(summary)) AS min_b, max(pg_column_size(summary)) AS max_b FROM output_snapshot_history;
SELECT u.tier, count(*) AS payloads, round(avg(n.row_count), 1) AS mean_rows, round(avg(n.byte_size)) AS mean_bytes, max(n.byte_size) AS max_bytes
FROM node_payload_history n JOIN pipelines p ON p.id = n.pipeline_id JOIN users u ON u.id = p.owner_id GROUP BY u.tier ORDER BY u.tier;
\echo '--- relation sizes'
SELECT relname, pg_size_pretty(pg_relation_size(oid)) AS heap, pg_size_pretty(pg_total_relation_size(oid) - pg_relation_size(oid)) AS indexes_and_toast
FROM pg_class WHERE relname IN ('output_snapshot_history', 'node_payload_history') ORDER BY relname;
SELECT indexrelid::regclass AS index, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_index
WHERE indrelid IN ('output_snapshot_history'::regclass, 'node_payload_history'::regclass) ORDER BY 1::text;
\endif

-- ======================================================================================================
-- INDEX VARIANTS (D4 candidates; names are scratch-only). idx = none | captured_at | pipeline_captured | both
-- ======================================================================================================
\if :do_index
DROP INDEX IF EXISTS perf_osh_captured_at;
DROP INDEX IF EXISTS perf_osh_pipeline_captured;
DROP INDEX IF EXISTS perf_nph_captured_at;
DROP INDEX IF EXISTS perf_nph_pipeline_captured;
\timing on
SELECT :'idx' IN ('captured_at', 'both') AS want_a, :'idx' IN ('pipeline_captured', 'both') AS want_b \gset
\if :want_a
CREATE INDEX perf_osh_captured_at ON output_snapshot_history (captured_at);
CREATE INDEX perf_nph_captured_at ON node_payload_history (captured_at);
\endif
\if :want_b
CREATE INDEX perf_osh_pipeline_captured ON output_snapshot_history (pipeline_id, captured_at);
CREATE INDEX perf_nph_pipeline_captured ON node_payload_history (pipeline_id, captured_at);
\endif
\timing off
ANALYZE output_snapshot_history;
ANALYZE node_payload_history;
SELECT indexrelid::regclass AS index, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_index
WHERE indrelid IN ('output_snapshot_history'::regclass, 'node_payload_history'::regclass) ORDER BY 1::text;
\endif

-- ======================================================================================================
-- MEASURE: three runs of (a) EXPLAIN (ANALYZE, BUFFERS) per statement and (b) a plain timed pass, each
-- repository transaction in its own BEGIN ... ROLLBACK (lock hold time = lock + all its statements).
-- ======================================================================================================
\if :do_measure
-- Statement catalogue, in origin/main execution order. repo 1 = OutputHistoryRepository.thinAndPurge
-- (named-tier age purges free/beta/owner, unnamed catch-all, thin); repo 2 = NodePayloadHistoryRepository.purge
-- (disallowed, then per allowed tier [beta, owner]: age, newest-N; then unreferenced).
CREATE TEMP TABLE perf_stmts (repo int, seq int, label text, sql text);
SELECT t AS tick FROM perf_anchor \gset
INSERT INTO perf_stmts
SELECT 1, 10 + i, 'history age purge ' || tier,
       format($q$DELETE FROM output_snapshot_history h
             USING pipelines p, users u
             WHERE h.pipeline_id = p.id AND p.owner_id = u.id AND u.tier = %L AND h.captured_at < %L::timestamptz$q$,
              tier, (:'tick'::timestamptz - cap * interval '1 day'))
FROM (VALUES (1, 'free', 30), (2, 'beta', 90), (3, 'owner', 365)) v(i, tier, cap);
INSERT INTO perf_stmts VALUES
(1, 20, 'history age purge unnamed-tier catch-all',
 format($q$DELETE FROM output_snapshot_history h
             USING pipelines p, users u
             WHERE h.pipeline_id = p.id AND p.owner_id = u.id
               AND u.tier <> ALL (string_to_array('free,beta,owner', ',')) AND h.captured_at < %L::timestamptz$q$,
        (:'tick'::timestamptz - 30 * interval '1 day'))),
(1, 30, 'history thin (protected newest 101)',
 format($q$DELETE FROM output_snapshot_history WHERE id IN (
               SELECT id FROM (
                 SELECT id, row_number() OVER (
                   PARTITION BY output_id, age_class, floor(epoch / bucket_secs)
                   ORDER BY captured_at DESC, id DESC) AS rn
                 FROM (
                   SELECT id, output_id, captured_at,
                          extract(epoch FROM captured_at) AS epoch,
                          CASE WHEN extract(epoch FROM (%1$L::timestamptz - captured_at)) < 86400::bigint THEN 0
                               WHEN extract(epoch FROM (%1$L::timestamptz - captured_at)) < 604800::bigint THEN 1
                               ELSE 2 END AS age_class,
                          CASE WHEN extract(epoch FROM (%1$L::timestamptz - captured_at)) < 86400::bigint THEN 300::bigint
                               WHEN extract(epoch FROM (%1$L::timestamptz - captured_at)) < 604800::bigint THEN 3600::bigint
                               ELSE 86400::bigint END AS bucket_secs
                   FROM (
                     SELECT id, output_id, captured_at,
                            row_number() OVER (PARTITION BY output_id ORDER BY captured_at DESC, id DESC) AS recency
                     FROM output_snapshot_history
                   ) recent
                   WHERE recency > 101
                 ) classed
               ) ranked WHERE rn > 1)$q$, :'tick'));
INSERT INTO perf_stmts VALUES
(2, 10, 'payload disallowed-tier',
 $q$DELETE FROM node_payload_history h WHERE NOT EXISTS (
               SELECT 1 FROM pipelines p JOIN users u ON u.id = p.owner_id
               WHERE p.id = h.pipeline_id AND u.tier = ANY (string_to_array('beta,owner', ',')))$q$);
INSERT INTO perf_stmts
SELECT 2, s, label || ' ' || tier,
       CASE kind WHEN 'age' THEN
         format($q$DELETE FROM node_payload_history h USING pipelines p, users u
               WHERE h.pipeline_id = p.id AND p.owner_id = u.id AND u.tier = %L AND h.captured_at < %L::timestamptz$q$,
                tier, (:'tick'::timestamptz - age_days * interval '1 day'))
       ELSE
         format($q$DELETE FROM node_payload_history WHERE id IN (
                 SELECT id FROM (
                   SELECT h.id, row_number() OVER (
                     PARTITION BY h.pipeline_id, h.node_step_id, h.root_id ORDER BY h.captured_at DESC, h.id DESC) AS rn
                   FROM node_payload_history h
                   JOIN pipelines p ON p.id = h.pipeline_id JOIN users u ON u.id = p.owner_id
                   WHERE u.tier = %L) ranked
                 WHERE rn > %s)$q$, tier, keep)
       END
FROM (VALUES (20, 'payload age purge', 'age', 'beta', 7, 10), (30, 'payload newest-N', 'n', 'beta', 7, 10),
             (40, 'payload age purge', 'age', 'owner', 30, 30), (50, 'payload newest-N', 'n', 'owner', 30, 30)) v(s, label, kind, tier, age_days, keep);
INSERT INTO perf_stmts VALUES
(2, 60, 'payload unreferenced',
 $q$DELETE FROM node_payload_history h WHERE NOT EXISTS (
               SELECT 1 FROM output_snapshot_history o WHERE o.payload_id = h.id)$q$);

\echo '@@ settings'
SELECT '@@ version=' || version() AS v;
SELECT '@@ ' || name || '=' || setting AS s FROM pg_settings
WHERE name IN ('work_mem', 'max_parallel_workers_per_gather', 'shared_buffers', 'effective_cache_size', 'random_page_cost') ORDER BY name;
SELECT '@@ rows output_snapshot_history=' || (SELECT count(*) FROM output_snapshot_history) || ' node_payload_history=' || (SELECT count(*) FROM node_payload_history) AS r;
SELECT '@@ pg16_view=' || :'pg16_view' AS pv;
SELECT '@@ indexes ' || string_agg(indexrelid::regclass::text, ', ' ORDER BY indexrelid::regclass::text) AS ix FROM pg_index
WHERE indrelid IN ('output_snapshot_history'::regclass, 'node_payload_history'::regclass);

-- (a) EXPLAIN (ANALYZE, BUFFERS) passes; (b) plain timed passes. repo transactions are separate.
CREATE FUNCTION pg_temp.perf_explain(run int, rp int) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE s record; r text; ok boolean;
BEGIN
  SELECT pg_try_advisory_xact_lock(x'48454C31323732'::bigint) INTO ok;
  RAISE NOTICE '@@LOCK run=% repo=% acquired=%', run, rp, ok;
  FOR s IN SELECT * FROM perf_stmts WHERE repo = rp ORDER BY seq LOOP
    RAISE NOTICE '@@STMT run=% repo=% seq=% label=%', run, rp, s.seq, s.label;
    FOR r IN EXECUTE 'EXPLAIN (ANALYZE, BUFFERS) ' || s.sql LOOP
      RAISE NOTICE '@@P %', r;
    END LOOP;
  END LOOP;
END
$f$;
CREATE FUNCTION pg_temp.perf_time(run int, rp int) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE s record; ok boolean; n bigint; t0 timestamptz; t1 timestamptz; tx0 timestamptz := clock_timestamp();
BEGIN
  SELECT pg_try_advisory_xact_lock(x'48454C31323732'::bigint) INTO ok;
  FOR s IN SELECT * FROM perf_stmts WHERE repo = rp ORDER BY seq LOOP
    t0 := clock_timestamp();
    EXECUTE s.sql;
    GET DIAGNOSTICS n = ROW_COUNT;
    t1 := clock_timestamp();
    RAISE NOTICE '@@T run=% repo=% seq=% deleted=% ms=% label=%', run, rp, s.seq, n,
      round((extract(epoch FROM t1 - t0) * 1000)::numeric, 2), s.label;
  END LOOP;
  RAISE NOTICE '@@TX run=% repo=% lock_hold_ms=%', run, rp,
    round((extract(epoch FROM clock_timestamp() - tx0) * 1000)::numeric, 2);
END
$f$;
-- pg16_view=on: PG 18's btree skip scan lets the existing (output_id, captured_at) / (pipeline_id, node_step_id,
-- root_id, captured_at) indexes serve a captured_at-only predicate; PG 16 (prod, see measurements.md) cannot skip.
-- With pg16_view on, each measured transaction first DROPs those two leading-column indexes (transactional DDL,
-- undone by the ROLLBACK), a conservative proxy for a planner without skip scan. Both views are reported.
\if :pg16_view
\set pre 'DROP INDEX idx_output_snapshot_history_output_captured; DROP INDEX idx_node_payload_history_node_captured'
\else
\set pre 'SELECT 1'
\endif
-- Each (run, repo) is its own transaction, rolled back (the dataset is identical for every run).
SELECT x FROM generate_series(1, 3) run, generate_series(1, 2) rp,
  LATERAL unnest(ARRAY['BEGIN', :'pre', format('SELECT pg_temp.perf_explain(%s, %s)', run, rp), 'ROLLBACK']) WITH ORDINALITY u(x, o)
ORDER BY run, rp, o \gexec
SELECT x FROM generate_series(1, 3) run, generate_series(1, 2) rp,
  LATERAL unnest(ARRAY['BEGIN', :'pre', format('SELECT pg_temp.perf_time(%s, %s)', run, rp), 'ROLLBACK']) WITH ORDINALITY u(x, o)
ORDER BY run, rp, o \gexec
\endif

-- ======================================================================================================
-- INSERT PATH (index-maintenance cost of a candidate index): n new points, rolled back, 3 runs
-- ======================================================================================================
\if :do_insert_path
SELECT t AS tick FROM perf_anchor \gset
CREATE FUNCTION pg_temp.perf_insert(run int, per_output int) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE t0 timestamptz := clock_timestamp(); n bigint;
BEGIN
  INSERT INTO output_snapshot_history (output_id, pipeline_id, root_id, run_id, trigger_source, captured_at, row_count, summary)
  SELECT out.id, out.pipeline_id, out.root_id, 'perf-insert', 'schedule',
         (SELECT t FROM perf_anchor) + k * interval '1 second', 1,
         '{"v":1,"metric":null,"series":{"x":"day","y":"revenue","agg":null,"mode":"rows","points":[["d01",100.0],["d02",101.0],["d03",102.0],["d04",103.0],["d05",104.0],["d06",105.0],["d07",106.0]]}}'::jsonb
  FROM outputs out, generate_series(1, per_output) k;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '@@INS run=% rows=% ms=%', run, n, round((extract(epoch FROM clock_timestamp() - t0) * 1000)::numeric, 2);
END
$f$;
SELECT '@@ indexes ' || string_agg(indexrelid::regclass::text, ', ' ORDER BY indexrelid::regclass::text) AS ix FROM pg_index
WHERE indrelid = 'output_snapshot_history'::regclass;
SELECT x FROM generate_series(1, 3) run, generate_series(1, 12, 11) per_output,
  LATERAL unnest(ARRAY['BEGIN', format('SELECT pg_temp.perf_insert(%s, %s)', run, per_output), 'ROLLBACK']) WITH ORDINALITY u(x, o)
ORDER BY run, per_output, o \gexec
\endif
