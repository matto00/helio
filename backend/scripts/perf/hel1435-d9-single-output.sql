-- HEL-1435 D9: one Output's own rows are the floor of a batch. Run AFTER seeding a 6-Output base
-- (history-retention-batched-measure.sql -v n_outputs=6 -v mix=M -v backlog=0 -v do_seed=on).
-- Gives Outputs o0 / o1 / o2 an un-thinned outage backlog at the highest rate the pipeline-run limits allow
-- (PIPELINE_RUN_RATE_LIMIT_PER_WINDOW default 10 per 60 s per user = 14,400 points per Output per day, one point per
-- Output per run): 1 day (14,400), 7 days (100,800) and 30 days (432,000) of points, evenly spaced 6 s apart,
-- ending at the anchor tick. Scratch database only (same guard as the main script).
\set ON_ERROR_STOP on
DO $guard$
BEGIN
  IF current_database() <> 'helio_hel1435_scratch' THEN
    RAISE EXCEPTION 'refusing: this script only runs in helio_hel1435_scratch, not %', current_database();
  END IF;
END
$guard$;
SET maintenance_work_mem = '256MB';
DELETE FROM output_snapshot_history WHERE output_id IN ('o0', 'o1', 'o2');
INSERT INTO output_snapshot_history (output_id, pipeline_id, root_id, run_id, trigger_source, captured_at, row_count, summary)
SELECT o.id, o.pipeline_id, o.root_id, 'run-' || g, 'schedule', (SELECT t FROM perf_anchor) - g * interval '6 seconds', 1,
       '{"v":1,"metric":null,"series":{"x":"day","y":"revenue","agg":null,"mode":"rows","points":[["d01",100.0],["d02",101.0],["d03",102.0],["d04",103.0],["d05",104.0],["d06",105.0],["d07",106.0]]}}'::jsonb
FROM outputs o, generate_series(0, CASE o.id WHEN 'o0' THEN 14399 WHEN 'o1' THEN 100799 ELSE 431999 END) g
WHERE o.id IN ('o0', 'o1', 'o2')
ORDER BY 6;
VACUUM (ANALYZE) output_snapshot_history;
SELECT output_id, count(*) AS points FROM output_snapshot_history WHERE output_id IN ('o0','o1','o2') GROUP BY 1 ORDER BY 1;
