-- HEL-1345 AC3: candidate trunk steps misplaced at a root head by the rootId head-splice.
-- Read-only: one SELECT, no writes, no side-effecting functions. Run as e.g.
--   BEGIN TRANSACTION READ ONLY; <this query>; ROLLBACK;
-- Fingerprint: the buggy create inserts NEW as the root's parentless head and re-parents the old
-- head OLD under it in the same transaction, so OLD.updated_at = NEW.created_at exactly and
-- OLD.created_at < NEW.created_at. Repeated buggy appends leave a run of such inverted edges
-- starting at the head. Window: HEL-968 (v0.7.15, 2026-09-05) onward.
-- head_run_len = consecutive fingerprinted edges counted down from the head (>= 2 is almost
-- certainly the bug; 1 may be a deliberate "insert before the first step"). Undercounts when OLD
-- was edited after the splice (updated_at moved); weak_inverted_edges ignores updated_at.
WITH RECURSIVE trunk AS (
  SELECT s.pipeline_id, s.root_id AS root_id, s.id, s.created_at, s.updated_at,
         1 AS depth, TRUE AS head_run, FALSE AS strong_inv, FALSE AS weak_inv
  FROM pipeline_steps s
  WHERE s.parent_step_id IS NULL AND s.position = 0
  UNION ALL
  SELECT c.pipeline_id, t.root_id, c.id, c.created_at, c.updated_at,
         t.depth + 1,
         t.head_run AND (c.created_at < t.created_at AND c.updated_at = t.created_at
                         AND t.created_at >= '2026-09-05'),
         (c.created_at < t.created_at AND c.updated_at = t.created_at
          AND t.created_at >= '2026-09-05'),
         (c.created_at < t.created_at AND t.created_at >= '2026-09-05')
  FROM pipeline_steps c
  JOIN trunk t ON c.parent_step_id = t.id AND c.pipeline_id = t.pipeline_id
  WHERE c.position = 0 AND t.depth < 500
)
SELECT pipeline_id,
       root_id,
       COUNT(*)                                        AS trunk_len,
       COUNT(*) FILTER (WHERE depth > 1 AND head_run)  AS head_run_len,
       COUNT(*) FILTER (WHERE strong_inv)              AS strong_inverted_edges,
       COUNT(*) FILTER (WHERE weak_inv)                AS weak_inverted_edges,
       (SELECT COUNT(*) FROM pipeline_roots r WHERE r.pipeline_id = trunk.pipeline_id) AS root_count,
       MIN(created_at) FILTER (WHERE depth = 1)        AS head_created_at
FROM trunk
GROUP BY pipeline_id, root_id
HAVING COUNT(*) FILTER (WHERE strong_inv OR weak_inv) > 0
ORDER BY head_run_len DESC, strong_inverted_edges DESC, pipeline_id;
