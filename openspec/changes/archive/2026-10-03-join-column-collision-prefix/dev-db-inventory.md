# Dev DB inventory: existing joins with column collisions (HEL-1236, task 3.3)

Read-only. Connection: `psql -h localhost -U matt helio` with `PGOPTIONS='-c default_transaction_read_only=on'`
(confirmed `show transaction_read_only` = `on`). Role `matt` is a superuser, so forced RLS does not hide rows.
Only exact SELECTs were run; nothing was written.

| Query | Result |
| --- | --- |
| `select count(*) from pipeline_steps where op='join'` | **0** |
| `select count(*) from pipeline_steps where config ilike '%secondaryInput%' or config ilike '%joinKey%'` | **0** (catches any mis-typed op) |
| `select op, count(*) from pipeline_steps group by op` | assert 189, sort 9, select 7, limit 7, aggregate 6, rename 3, cast 1, datebucket 1, analyzewithai 1 |
| `select count(*) from pipelines` / `from outputs` | 252 / 370 |

Inventory table (pipeline id, join step id, secondary kind, colliding columns, renamed-to, key collision):

| pipeline id | join step id | secondary kind | colliding columns | renamed to | key collides |
| --- | --- | --- | --- | --- | --- |
| (none) | (none) | -- | -- | -- | -- |

The dev database holds no `join` step at all (it is mostly test residue, see MISTAKES.md), so no existing dev
pipeline changes behaviour. Verified current behaviour of the join KEY column (from code, not from data): on
main the key collides by definition (both sides carry it) and `leftRow ++ rightRow` overwrites the left key with
the right key value, which is equal on every matched row (the match IS key equality), so it was never lossy.
After this change the key is kept once from the left (right copy dropped), identical values, no rename.
Production was not inspected (out of scope, constraint C2).
