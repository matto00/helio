# Dev-DB inventory (read-only, 2026-10-03)

Connection: local dev DB `helio` as `matt` (superuser, rolbypassrls=f; superusers bypass RLS, so the counts are not RLS-filtered). Only exact SELECTs; no writes.

| Query | Result |
|---|---|
| `select rolsuper, rolbypassrls from pg_roles where rolname=current_user` | `t|f` |
| `select count(*) from pipeline_steps where op='lookup'` | 0 |
| `select id, pipeline_id, enabled, config from pipeline_steps where op='lookup' order by created_at limit 50` | 0 rows |
| `select count(*) from pipeline_steps where config like '%lookupKey%'` | 0 |
| `select op, count(*) from pipeline_steps group by op order by 2 desc` | assert 189, sort 9, select 7, limit 7, aggregate 6, rename 3, cast 1, datebucket 1, analyzewithai 1 |

Conclusion: the dev DB holds no lookup steps at all, so no existing colliding lookup step (and no bound output/panel) is affected there. This says nothing about production (not inspected, per constraints).
