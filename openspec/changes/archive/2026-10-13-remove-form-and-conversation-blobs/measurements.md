# Measurements (HEL-1530 task 3.4)

Machine: the owner's desktop (6c/12t Ryzen 5 7600X), `nice -n 19`, single test JVM. "Embedded" = the zonky embedded
Postgres the specs use (superuser, default config, tmpfs-free). "Dev DB" = the local `helio` database, read-only
queries only (`BEGIN READ ONLY ... ROLLBACK`; V132 was NOT applied to it, and nothing was written to it). Nothing was
run against prod. A throwaway spec produced the embedded numbers and was deleted; its method is described so it can
be redone.

## 1. Dev-DB row counts (read-only, before V132)

| table | rows | note |
|---|---|---|
| `dataset_rows` | 16,159 | 19 MB; 5 rows (5 distinct keys) hold a `form-uploads/` key |
| `assistant_conversations` | 43 | |
| `stored_object_deletions` | 0 | before and after this work (V132 never applied to dev) |
| `node_snapshots` | 1,643,391 | 1,590 MB total relation size: the guard's dominant scan |
| `node_payload_history` | 0 | |
| `binary_refs` | 0 | |
| `alert_events` | 0 | |
| `image_uploads` / `data_sources` | 6 / 3,741 | |

Dev flyway head was V131 (another lane's migration), so the dev DB has no V132 columns/index; the guard SQL below
does not need them (the only V132 object it uses is the `binary_refs(storage_key)` index, and `binary_refs` is empty).

## 2. Guard cost, EXPLAIN (ANALYZE, BUFFERS) on the dev DB, a batch of 100 keys (5 real form keys + 95 unreferenced)

**Authoritative scan** (image_uploads, data_sources, assistant_conversations, one `dataset_rows` pass):
Execution Time **5.7 ms**. Seq scans over 3,741 / 43 / 16,159 rows; the `dataset_rows` extraction runs only on the 5
rows that mention `form-uploads/` (the `strpos` prefilter removed the other 16,154).

**Derived scan, first draft** (plain `rows x keys` `strpos` join, worst case = every key unreferenced so nothing
short-circuits): Execution Time **39.4 s**. The planner materialised all 1.64 M snapshot texts and ran 100 passes
(164 M substring searches; 13 M temp blocks read). This would have made every deletion pass cost ~40 s of DB CPU on
dev-sized data, so it was NOT shipped.

**Derived scan, shipped** (the row text is tested against the few distinct key prefixes of the batch first,
`"images` / `"form-uploads` / ..., and only a row that mentions a prefix is compared with each key):
Execution Time **2.44 s** (warm cache for `node_snapshots`: 242,697 shared hits, 159,995 reads of the 1.59 GB
relation; the 3.29 M semi-join comparisons are 2 per row; zero rows matched). **16x faster.** The scan is
I/O-and-detoast-bound from here (reading 1.6 M JSONB values), not CPU-bound on keys.

Consequence: a drain pass that has at least one UNREFERENCED key in its batch costs one sweep of the derived tables
(about 2.5 s of one DB core on dev data; it grows linearly with `node_snapshots`). A pass with no work, or whose keys
all resolve in the authoritative scan, does not run the derived scan. One sweep covers the whole 100-key batch. Passes
run on the existing scheduler tick and are single-flight per process. If the owner's prod `node_snapshots` is much
larger than dev's, lower the drain frequency (a later ticket) or index the check; the prod sizing queries are in
`pr-owner-review.md`.

## 3. Write cost of the triggers, embedded Postgres, 10,000 rows per statement, median of 5

Run on two databases: `before` = migrated to V130 (V128's two triggers only), `after` = all migrations (V132 in).
"file field" = every row holds one `{"storageKey":"form-uploads/<uuid>.pdf", ...}` binary-ref.

| statement (10,000 rows) | before V132 | after, no file field | after, with file field |
|---|---|---|---|
| `DELETE FROM dataset_rows WHERE data_source_id = ..` | 2.7 ms | 7.7 ms | 173 ms |
| `DELETE FROM data_sources` (cascade over the rows) | 2.6 ms | 7.6 ms | 172 ms |
| `UPDATE dataset_rows SET updated_at = now()` (JSON unchanged) | 88 ms | 91 ms | 160 ms |
| `UPDATE dataset_rows SET data = data \|\| '[n]'` (JSON changed) | 139-146 ms | 145 ms | 437 ms |
| `TRUNCATE users CASCADE` (about 60 k dataset rows, 30 k with a key) | n/a | n/a | 245 ms, queued 110,000 rows |

Reading: rows with no file field cost +0.5 microseconds per deleted row (the text prefilter); a row carrying a form
file costs about 17 microseconds to delete (JSON walk + regex + `DISTINCT` + one queue insert). An `UPDATE` that does
not change the JSON pays only the equality test (first draft of the update trigger walked every row: 315 ms; the
shipped `MATERIALIZED` "changed rows" CTE brought it to 160 ms). A bulk operation over a very large number of file rows
is therefore proportional, not pathological: 1 M file rows would add about 17 s to the one delete statement.

Queue rows after the run: before 0, after 100,000 (10,000 file rows x 5 deletes + 5 cascades), as expected.
The 110,000 on the TRUNCATE line is the CUMULATIVE queue count of that one embedded `after` database (100,000 left by
the delete runs above + 10,000 queued by the TRUNCATE itself, i.e. the distinct keys of the rows still present then).
It is per-spec embedded Postgres; the shared dev DB was never touched.

## 4. Verification-run queue counts

`stored_object_deletions` on the dev DB: 0 before, 0 after (nothing was written to it). In the embedded databases the
count is whatever each spec seeds; every spec that asserts on the queue keys its assertions to its own keys.
