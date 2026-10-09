# HEL-1284 measurements: history-retention DELETE cost at production scale

Everything below was measured in a scratch database, `helio_hel1284_scratch`, on a local PostgreSQL 18.4. The
reproducible seed/measure script is `backend/scripts/perf/history-retention-measure.sql`; raw run-1 plans and every
timed pass are in `evidence/` (listed at the end). Every number in the planning artifacts was re-measured, not
trusted (the dev-DB `avg(pg_column_size(summary))` is 340.2 bytes over 1,083 rows; the seeded summary is 332 bytes).

> **V120 MERGE ORDER (read before merging).** This change ships
> `backend/src/main/resources/db/migration/V120__history_retention_captured_at_indexes.sql`. **It must NOT merge
> before HEL-1347's V119 is on `origin/main`.** Flyway rejects a resolved-but-not-applied version lower than the
> applied head, so if V120 reaches production first, V119 can no longer be applied there. (V119 was already applied
> to the shared dev DB `helio` by HEL-1347's lane; the scratch DB was migrated 118 -> 120 with no V119, which is fine
> for an empty scratch DB and proves nothing about production ordering.)

## 1. Verdict

| Question | Answer |
|---|---|
| Which statements full-scan where an index bounds them? | The three named-tier **history age purges** (`captured_at < cutoff` joined to `pipelines`/`users`; no index leads with `captured_at`) and, technically, the **payload age purges**. On a planner without btree skip scan (production is PostgreSQL 16, see 3.2) the three history purges read the whole table each: 14,959,246 rows read to delete 418 (S2). |
| Index added | `V120`: `output_snapshot_history (captured_at)` and `node_payload_history (captured_at)`. Chosen on mixed-tier S2 over the join-driven `(pipeline_id, captured_at)` candidate (section 4). |
| Effect of V120 (S2, 3 named-tier history age purges, PG16 proxy) | 14,959,246 -> 453,736 rows read; 808 -> 152 ms EXPLAIN time; 831,925 -> 26,247 buffers. Whole history transaction 9,773 -> 9,069 ms. |
| What dominates the tick | The **thin DELETE**: it ranks every row twice (two seq scans plus an external-merge sort that spills ~600 MB to temp at the default `work_mem` of 4 MB) and cannot be index-bounded. It is 95% (S2), 98% (S1) and 99.9% (S2-owner) of the history transaction's lock hold. V120 does not touch it, and it did not regress (section 4). |
| Cost per tick (this machine, PG 18.4, defaults) | S1 (1k Outputs, ~0.5M rows): **0.79 s**. S2 (10k Outputs, ~5.0M rows): **9.9 s before / 9.4 s after V120** (9.1 s after, PG16 proxy). S2-owner (8.0M rows, all owner): 14.7 s. S3 backlog (1k Outputs, 7 d un-thinned, 2.1M rows, 1.6M deleted): 17.8 s. |
| Hourly cadence | **Appropriate up to at least 10k Outputs** on this hardware: the S2 tick is ~10 s against a 3,600 s interval (0.3%) and 8% of the 120 s lock-retry window. Linear-ish extrapolation (about 1 ms per Output, exponent ~1.1) reaches the 120 s window at roughly 100k Outputs here. **That is this desktop, not production**: prod is a shared-core `db-g1-small` (section 3.2); if it is 3-10x slower the window is crossed at roughly 10k-30k Outputs. That slowdown is an assumption; nothing here measures it. |
| Advisory lock | Appropriate in kind (`pg_try_advisory_xact_lock`, never waits). The exclusive hold is the whole history transaction: ~0.8 s at S1, ~9-10 s at S2, ~18 s for a one-week backlog at 1k Outputs. A run-side payload trim that meets it is **skipped, not delayed** (HEL-1333) and the next purge removes the excess, so it does not starve runs. The payload transaction is short (12-94 ms). What is not appropriate at larger scale is that the lock hold is one unbounded statement; a long outage's backlog is a single transaction (see 6). |
| Premise check | The ticket's example "1k outputs x 1 year of 5-minute points before thinning" (105M rows) is not a state the system reaches: thinning runs hourly. It was modelled as the thinned steady state (~0.5M rows) plus a 7-day backlog scenario. |

(Section 5 has the per-statement tables for every scenario, section 6 the extrapolation assumptions, section 7 the spinoff candidates and what was not done, section 8 the evidence files.)

## 2. Method and provenance

- **Scratch DB, never `helio`.** Created `helio_hel1284_scratch`; migrated with the repo's pinned Flyway (10.20.1) from `sbt assembly`'s
  `helio-backend.jar` via one `jshell` snippet as role `matt` with the literal scratch URL (never `sbt run`, never anything that
  reads `backend/.env`; `sbt shutdown` run afterwards). Recorded result of the migrate:
  `RESULT database=helio_hel1284_scratch target=118 migrations=118 success=true`
  (Flyway also warned `PostgreSQL 18.4 is newer than this version of Flyway ... latest supported version is 17`, as design D1 predicted).
  Window checks: scratch `flyway_schema_history` has 118 rows with `installed_on` 00:05:07.475 .. 00:05:07.934 PDT, inside the
  recorded migrate window 00:05:06-00:05:08 PDT; `helio`'s `flyway_schema_history` has **0** rows with `installed_on` at or after
  00:05:06 PDT that day (and 0 rows with version 120 after the later V120 apply).
  Later, V120 was applied with the same call: `RESULT database=helio_hel1284_scratch target=120 migrations=1 success=true`,
  Flyway execution time 0.772 s (the two index builds on the 5M-row S2 table).
- **Refusal test (D5), against `helio` only under `PGOPTIONS='-c default_transaction_read_only=on'`:** exit status **3**;
  stderr `ERROR: refusing: this script only runs in helio_hel1284_scratch, not helio`; the post-guard marker line
  (`MARKER_AFTER_GUARD`) printed **0** times; `helio` counts before and after identical (users 12686, pipelines 2897,
  output_snapshot_history 1091).
- **Role.** All measuring ran as `matt`, a superuser: RLS is bypassed exactly as on the BYPASSRLS `helio_privileged` pool the
  tick uses, but `SET LOCAL ROLE helio_privileged` was **not** exercised, so grant and ownership paths are untested here. In
  particular, that production's Flyway role `helio` owns `output_snapshot_history`/`node_payload_history` (needed for
  `CREATE INDEX`) is an **assumption** (Flyway created both tables as `helio` and no migration re-owns them); no local run proves it.
- **Statements.** The exact SQL text of every DELETE in `OutputHistoryRepository.thinAndPurge` (3 named-tier age purges, the
  unnamed-tier catch-all, the thin) and `NodePayloadHistoryRepository.purge` (disallowed-tier, then per allowed tier [beta,
  owner] the age purge and the newest-N, then unreferenced) at origin/main 023aa4bb, bind parameters substituted as literals
  (`::bigint` where Slick binds `Long`). Real tick time is the hour-aligned anchor T; the table is seeded as the previous tick
  left it plus one hour of new points, and a hashed 1/24 of Outputs hold one daily point just past their tier cap, so the age
  purges do their real hourly work.
- **Per run.** Each repository transaction is its own `BEGIN; ...; ROLLBACK`, run 3 times for `EXPLAIN (ANALYZE, BUFFERS)`
  (tables report the median EXPLAIN time and the first run's buffers) and 3 more times plain and timed with `clock_timestamp()`
  (rows deleted come from `GET DIAGNOSTICS ROW_COUNT`; the **lock hold time** is the plain pass's whole-transaction time,
  advisory lock to last statement). EXPLAIN's instrumentation makes its per-statement times a little higher than the plain
  ones. "Rows read" = every scan node on the DELETE's target table, `actual rows x loops` plus `Rows Removed by Filter` and
  by index recheck. The tick wall time is the sum of the two transactions' median lock holds.
- **Settings.** PG 18.4 defaults: `work_mem` 4 MB, `max_parallel_workers_per_gather` 2 (no plan used a parallel scan),
  `shared_buffers` 128 MB, `effective_cache_size` 4 GB, `random_page_cost` 4. The server had other load on it (load average ~5
  during parts of the run; one S2 after-run was visibly perturbed and is replaced by a clean re-run, noted where used). Data
  was inserted in `captured_at` order (heap order roughly time order, as live ingest produces). One session at a time,
  `nice -n 19` clients; the seed phase used `work_mem` 256 MB in its own psql session and the measure phase a fresh one at defaults.
- **PG16 proxy.** PG 18's btree skip scan lets the existing `(output_id, captured_at)` index (and the 4-column payload index)
  answer a `captured_at`-only predicate (`Index Searches: 10001` in the as-is S2 plans: one descent per Output). Production runs
  PG 16, which cannot. No PG 16 binary is available here, so the "PG16 proxy" view drops those two leading-column indexes
  *inside each rolled-back transaction* (transactional DDL) so the planner cannot skip-scan them. It is a conservative stand-in:
  real PG 16 might choose a full-index bitmap scan (reads the whole 24 MB index instead of the 216 MB heap) instead of the
  proxy's seq scan, which would sit between the two views. Both views are reported; the D4 decision is stated on the proxy
  (the after-plan must not depend on skip scan, and it does not: the new index is used with a plain range condition).

## 3. Scenarios, seed, and the prod version

### 3.1 Seed (verified by `-v do_report=on`)

| scenario | Outputs | history rows | payload rows | notes |
|---|---|---|---|---|
| S1 | 1,000 (mix M) | 497,516 | 206 | tiers by user: free 712 / beta 240 / owner 48 Outputs (71.2 / 24.0 / 4.8%); rows per Output 467 / 527 / 802 (the 455 / 515 / 790 steady-state counts of design D2 plus the new hour's 12); heap 216 MB + 43 MB indexes |
| S2 | 10,000 (mix M) | 4,986,648 | 8,457 | free 7,012 / beta 2,490 / owner 498 Outputs (70.1 / 24.9 / 5.0%); 2,164 MB heap, indexes 190+239 MB |
| S2-owner | 10,000 (all owner) | 8,020,418 | 19,501 | 802 rows per Output |
| S3 | 1,000 (mix M), backlog | 2,081,516 | 206 | 2,051 / 2,111 / 2,386 rows per Output: 7 days of 5-minute points |

Mix M = 70% free / 25% beta / 5% owner by user (6 Outputs and 2 pipelines per user, one root per pipeline). Payloads (per node
= per pipeline here): a hashed 20% of beta/owner pipelines opt in and hold their newest N (beta 10, owner 30); 1 in 10 also
hold one beyond N, 1 in 24 one just past the tier age, 1 in 20 one unreferenced, plus a downgrade-residue payload on 1 in 60
free pipelines; row counts 70% x 20, 25% x 200, 5% x 1000 (S2: mean ~110 rows, ~10 KB, max 92 KB). Every Output of an opted-in
pipeline links its point to the node's payload. A first seed keyed payloads per Output (several streams in one partition) and
over-counted the newest-N deletes; it was corrected before any number used here.

### 3.2 Production database (read-only `gcloud sql instances describe helio-db`)

`databaseInstalledVersion: POSTGRES_16_14`, `tier: db-g1-small` (shared-core), `edition: ENTERPRISE`,
`dataDiskSizeGb: 10`, `PD_SSD`. So **prod is PostgreSQL 16**; local is 18.4 and CI is 16. The 10 GB disk matters
for sizing: S2's tables plus indexes are ~2.6 GB, and the S3-style backlog thin spills ~430 MB of temp per 2M rows (section 6).
Table ownership of the history tables in prod was not read (no DB credential; assumption stated above).

## 4. The index decision (design D4, constraint C1): mixed-tier S2

The rule: a statement qualifies when it reads the full table and deletes < 1% of what it reads. On the PG16 proxy, all three
named-tier history age purges qualify (each reads ~4.99M rows to delete 297 / 104 / 17: 16,790x / 47,946x / 293,309x). The
unnamed-tier catch-all matches no row in any environment (V88 limits `users.tier` to free/beta/owner); recorded, excluded. The
thin DELETE and the payload newest-N rank every row by design and are not index-boundable (read/deleted 83x and 228x/566x).

Candidates, built on the same S2 data (S2 first baseline = the unindexed table on the proxy), summed over the three named-tier history age purges:

| candidate | rows read | EXPLAIN ms (sum, median of 3 each) | buffers (hit+read) | plans | build | index size | insert path (10k rows, ms, 3 runs) |
|---|---|---|---|---|---|---|---|
| none (PG16 proxy) | 14,959,246 | 807.1 | 831,925 | 3 x seq scan | n/a | n/a | 220, 168, 183 (baseline; indexes as migrated) |
| **A `(captured_at)`** | **453,736** | **151.1** | **26,247** | index scan, plain `captured_at < cutoff` range, 1 search each | 707 ms | 33 MB | 234, 188, 178 |
| B `(pipeline_id, captured_at)` | 4,986,772 | 309.8 | 332,602 | beta/owner: join-driven index scan (107 / 16 rows, 830 / 166 searches); **free: planner stayed on the seq scan** (4.99M rows) | 2,704 ms | 93 MB | 282, 212, 252 |
| A and B both | 453,736 | 148.7 | 26,247 | planner chose A everywhere; B unused | A 717 ms + B 2,235 ms | both | 310, 220, 220 |

Insert path at 120,000 rows (an hour of 5-minute points for 10k Outputs): none 1,999 / 2,113 / 2,196 ms; A 2,179 / 2,214 /
2,097; B 2,307 / 2,480 / 2,251; both 2,436 / 2,696 / 2,483. A's cost is inside the run-to-run noise; B's is not.
(All insert runs are `INSERT ... SELECT` rolled back, so rolled-back dead index entries accumulate between runs and flatter
nothing; the order was none, A, B, both.)

**Pick: A, `(captured_at)`** on rows read, buffers, time and insert cost. A bounds the beta and owner purges to their own rows
(137,071 and 17); the free purge still reads 316,648 rows to delete 297 because the free cutoff (30 d) also matches every
beta/owner daily point older than 30 d and the tier is only joined afterwards. That residue is the cost of any
`captured_at`-only index and B does not remove it (the planner will not use B for the free tier).

**Payload age purges (analogous pair on `node_payload_history`):** they qualify on the proxy (2,854 and 2,825 rows read to delete 4 and 0) and
the same pair was built; A reads 4 rows, B 4 rows. The absolute saving at S2 is ~0.5 ms (0.94 -> 0.21 ms EXPLAIN, S2b before/after), because the table is
bounded by tier caps (runs per node x opted-in nodes). `V120` still indexes it by the design's rule (A chosen, cheapest to maintain), as inexpensive insurance
against a tier-cap change; this is a judgement call recorded here, not a measured need.

### Before/after on S2 (same data, vacuumed between; exact V120 DDL applied through Flyway)

| view | named-tier history age purges: rows read | EXPLAIN ms | history tx lock hold (median ms) | payload tx lock hold | tick wall |
|---|---|---|---|---|---|
| PG 18 as-is, before | 5,123,736 (free seq scan; beta bitmap over skip-scanned existing index; owner skip scan) | 431.6 | 9,881.4 | 18.0 | 9,899.5 |
| PG 18 as-is, after V120 | 453,736 | 157.4 | 9,420.4 | 19.5 | 9,439.9 |
| PG16 proxy, before | 14,959,246 | 808.3 | 9,772.6 | 11.7 | 9,784.2 |
| PG16 proxy, after V120 | 453,736 | 151.5 | 9,068.9 (second run) | 16.6 | 9,085.4 |

The first PG16-proxy after-run was perturbed by background load (history tx 15,977 / 13,584 / 9,022 ms; its thin statement
11.2 s). It was discarded and re-run on a quiet machine (9,075 / 9,069 / 9,036); only the re-run is reported and committed under `evidence/`.
The thin DELETE did not regress: EXPLAIN 9,922 ms before vs 10,064 after (as-is) and 9,998 vs 9,877 (proxy);
plain-pass 9,433 vs 9,292 (as-is) and 8,932 vs 8,943 (proxy). It uses neither index (two seq scans), so any difference is noise, not V120.

After-plans are index-bounded: the three named history purges and the unnamed catch-all each show
`Index Scan using idx_output_snapshot_history_captured_at ... Index Searches: 1` with an ordinary `captured_at < cutoff`
condition (not a skip scan); the payload beta/owner age purges likewise use `idx_node_payload_history_captured_at`.

V120 build time: **~0.7 s at 5.0M rows** (707 ms in the standalone build; Flyway's whole migration took 0.772 s with both
indexes; 897 ms on the 2.08M-row S3 table where other load was present). S1's table (0.5M rows) is strictly smaller. Production
history is days old, so plain `CREATE INDEX` (not `CONCURRENTLY`; D6 threshold ~5 s) is justified: the SHARE lock delays history inserts for about a second at worst.

## 5. Per-statement results, every scenario

Columns: "scan nodes" are the scans on the DELETE's own target table (`rows` = rows read incl. filtered, `searches` = btree
descents, i.e. `Index Searches`, which is also how a PG 18 skip scan shows itself); "rows deleted" is `ROW_COUNT` of the plain pass;
"EXPLAIN exec ms" is the median of 3 instrumented runs; "plain ms" the median of 3 uninstrumented runs; buffers are the top
node's `Buffers:` of the first run (which includes cold reads); the FK column is the `ON DELETE SET NULL` trigger time the
payload deletes pay on `output_snapshot_history.payload_id` (counted in the execution time). Full plan text for run 1 is in `evidence/`.

### S1 (1k Outputs, mix M, ~0.5M rows) -- PG 18 as-is

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Bitmap Heap Scan on output_snapshot_history (30,516 rows) | 30,516 | 25 | 1,221x | 11.23 | 9.12 | `shared hit=2188 read=3384 dirtied=3 written=3237` |  |
| 1 | history age purge beta | Bitmap Heap Scan on output_snapshot_history (13,211 rows) | 13,211 | 10 | 1,321x | 5.59 | 3.83 | `shared hit=4324 dirtied=1` |  |
| 1 | history age purge owner | Index Scan [idx_output_snapshot_history_output_captured] on output_snapshot_history (1 rows, 1001 searches) | 1 | 1 | 1x | 1.82 | 1.25 | `shared hit=3457 dirtied=1` |  |
| 1 | history age purge unnamed-tier catch-all |  | 0 | 0 | n/a (0 deleted) | 0.02 | 0.12 | `shared hit=3` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (497,480 rows); Seq Scan on output_snapshot_history (497,480 rows) | 994,960 | 12,000 | 83x | 887.49 | 772.76 | `shared hit=35106 read=32852 dirtied=669 written=802, temp read=2563 written=2571` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (206 rows) | 206 | 2 | 103x | 0.23 | 0.39 | `shared hit=18 read=46 written=15` | output_snapshot_history_payload_id_fkey: time=0.217 calls=2 |
| 2 | payload age purge beta | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (1 rows, 1 searches) | 1 | 1 | 1x | 0.08 | 0.20 | `shared hit=38 read=6 dirtied=3 written=2` | output_snapshot_history_payload_id_fkey: time=0.065 calls=1 |
| 2 | payload newest-N beta | Seq Scan on node_payload_history (203 rows); Seq Scan on node_payload_history (203 rows) | 406 | 2 | 203x | 0.23 | 0.37 | `shared hit=130 dirtied=1` | output_snapshot_history_payload_id_fkey: time=0.049 calls=2 |
| 2 | payload age purge owner | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (0 rows, 16 searches) | 0 | 0 | n/a (0 deleted) | 0.07 | 0.16 | `shared hit=39` |  |
| 2 | payload newest-N owner | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (91 rows, 16 searches); Index Scan [node_payload_history_pkey] on node_payload_history (1 rows, 1 searches) | 92 | 1 | 92x | 0.20 | 0.33 | `shared hit=100` | output_snapshot_history_payload_id_fkey: time=0.058 calls=1 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (200 rows) | 200 | 0 | n/a (0 deleted) | 0.23 | 0.22 | `shared hit=268 read=9` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 788.6, 787.2, 786.1 | 787.2 |
| NodePayloadHistoryRepository.purge (payload) | 1.8, 1.7, 1.9 | 1.8 |

**Tick wall time (sum of medians): 789.0 ms**

### S1 -- PG16 proxy (leading-column indexes hidden)

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Seq Scan on output_snapshot_history (497,516 rows) | 497,516 | 25 | 19,901x | 30.00 | 28.22 | `shared hit=11639 read=16037 written=94` |  |
| 1 | history age purge beta | Seq Scan on output_snapshot_history (497,491 rows) | 497,491 | 10 | 49,749x | 27.79 | 27.17 | `shared hit=11718 read=15943 written=8` |  |
| 1 | history age purge owner | Seq Scan on output_snapshot_history (497,481 rows) | 497,481 | 1 | 497,481x | 27.21 | 26.87 | `shared hit=11803 read=15849` |  |
| 1 | history age purge unnamed-tier catch-all | Seq Scan on output_snapshot_history (1 rows) | 1 | 0 | n/a (0 deleted) | 0.03 | 0.24 | `shared hit=5` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (497,480 rows); Seq Scan on output_snapshot_history (497,480 rows) | 994,960 | 12,000 | 83x | 879.23 | 773.08 | `shared hit=35881 read=31416, temp read=2563 written=2571` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (206 rows) | 206 | 2 | 103x | 0.28 | 0.45 | `shared hit=61 read=1` | output_snapshot_history_payload_id_fkey: time=0.180 calls=2 |
| 2 | payload age purge beta | Seq Scan on node_payload_history (204 rows) | 204 | 1 | 204x | 0.08 | 0.17 | `shared hit=84 read=1` | output_snapshot_history_payload_id_fkey: time=0.049 calls=1 |
| 2 | payload newest-N beta | Seq Scan on node_payload_history (203 rows); Seq Scan on node_payload_history (203 rows) | 406 | 2 | 203x | 0.23 | 0.35 | `shared hit=129` | output_snapshot_history_payload_id_fkey: time=0.044 calls=2 |
| 2 | payload age purge owner | Seq Scan on node_payload_history (201 rows) | 201 | 0 | n/a (0 deleted) | 0.02 | 0.11 | `shared hit=47` |  |
| 2 | payload newest-N owner | Seq Scan on node_payload_history (201 rows); Index Scan [node_payload_history_pkey] on node_payload_history (1 rows, 1 searches) | 202 | 1 | 202x | 0.20 | 0.29 | `shared hit=59` | output_snapshot_history_payload_id_fkey: time=0.052 calls=1 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (200 rows) | 200 | 0 | n/a (0 deleted) | 0.21 | 0.21 | `shared hit=277` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 855.9, 853.3, 863.0 | 855.9 |
| NodePayloadHistoryRepository.purge (payload) | 1.7, 1.7, 1.7 | 1.7 |

**Tick wall time (sum of medians): 857.6 ms**

### S2 BEFORE V120 (vacuumed), PG 18 as-is

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Seq Scan on output_snapshot_history (4,986,648 rows) | 4,986,648 | 297 | 16,790x | 278.21 | 280.79 | `shared hit=314 read=277093 dirtied=18` |  |
| 1 | history age purge beta | Bitmap Heap Scan on output_snapshot_history (137,071 rows) | 137,071 | 104 | 1,318x | 91.33 | 87.71 | `shared hit=20011 read=23761 dirtied=7 written=43` |  |
| 1 | history age purge owner | Index Scan [idx_output_snapshot_history_output_captured] on output_snapshot_history (17 rows, 10001 searches) | 17 | 17 | 1x | 62.06 | 59.89 | `shared hit=20052 read=15131 dirtied=1 written=2` |  |
| 1 | history age purge unnamed-tier catch-all | Seq Scan on output_snapshot_history (1 rows) | 1 | 0 | n/a (0 deleted) | 5.12 | 5.33 | `shared hit=22 read=1` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (4,986,230 rows); Seq Scan on output_snapshot_history (4,986,230 rows) | 9,972,460 | 120,000 | 83x | 9922.24 | 9432.90 | `shared hit=128418 read=552334 dirtied=6670, temp read=74650 written=74739` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (2,901 rows) | 2,901 | 47 | 62x | 3.96 | 4.13 | `shared hit=320 read=753 dirtied=67` | output_snapshot_history_payload_id_fkey: time=2.266 calls=47 |
| 2 | payload age purge beta | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (4 rows, 1 searches) | 4 | 4 | 1x | 0.37 | 0.59 | `shared hit=53 read=37 dirtied=5` | output_snapshot_history_payload_id_fkey: time=0.195 calls=4 |
| 2 | payload newest-N beta | Seq Scan on node_payload_history (2,850 rows); Seq Scan on node_payload_history (2,850 rows) | 5,700 | 25 | 228x | 3.39 | 2.99 | `shared hit=1522 read=11 dirtied=21` | output_snapshot_history_payload_id_fkey: time=0.676 calls=25 |
| 2 | payload age purge owner | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (0 rows, 1 searches) | 0 | 0 | n/a (0 deleted) | 0.08 | 0.24 | `shared hit=31` |  |
| 2 | payload newest-N owner | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (1,175 rows, 166 searches); Index Scan [node_payload_history_pkey] on node_payload_history (5 rows, 5 searches) | 1,180 | 5 | 236x | 1.70 | 1.70 | `shared hit=1594 read=6 dirtied=3` | output_snapshot_history_payload_id_fkey: time=0.192 calls=5 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (2,820 rows) | 2,820 | 0 | n/a (0 deleted) | 8.07 | 8.21 | `shared hit=1655 read=2223` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 9881.4, 9958.0, 9398.0 | 9881.4 |
| NodePayloadHistoryRepository.purge (payload) | 17.1, 29.1, 18.0 | 18.0 |

**Tick wall time (sum of medians): 9899.5 ms**

### S2 BEFORE V120 (vacuumed), PG16 proxy

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Seq Scan on output_snapshot_history (4,986,648 rows) | 4,986,648 | 297 | 16,790x | 286.51 | 279.15 | `shared hit=6094 read=271367 dirtied=3 written=7` |  |
| 1 | history age purge beta | Seq Scan on output_snapshot_history (4,986,351 rows) | 4,986,351 | 104 | 47,946x | 266.73 | 264.72 | `shared hit=6064 read=271204 dirtied=2` |  |
| 1 | history age purge owner | Seq Scan on output_snapshot_history (4,986,247 rows) | 4,986,247 | 17 | 293,309x | 255.10 | 262.43 | `shared hit=6079 read=271117` |  |
| 1 | history age purge unnamed-tier catch-all | Seq Scan on output_snapshot_history (1 rows) | 1 | 0 | n/a (0 deleted) | 5.13 | 5.59 | `shared hit=22 read=1` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (4,986,230 rows); Seq Scan on output_snapshot_history (4,986,230 rows) | 9,972,460 | 120,000 | 83x | 9998.00 | 8932.07 | `shared hit=132199 read=542026 dirtied=1486, temp read=74650 written=74739` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (2,901 rows) | 2,901 | 47 | 62x | 3.95 | 2.53 | `shared hit=340 read=668 dirtied=32` | output_snapshot_history_payload_id_fkey: time=1.688 calls=47 |
| 2 | payload age purge beta | Seq Scan on node_payload_history (2,854 rows) | 2,854 | 4 | 714x | 0.65 | 0.69 | `shared hit=718 read=8 dirtied=3` | output_snapshot_history_payload_id_fkey: time=0.122 calls=4 |
| 2 | payload newest-N beta | Seq Scan on node_payload_history (2,850 rows); Seq Scan on node_payload_history (2,850 rows) | 5,700 | 25 | 228x | 3.05 | 2.46 | `shared hit=1501 read=11 dirtied=10` | output_snapshot_history_payload_id_fkey: time=0.468 calls=25 |
| 2 | payload age purge owner | Seq Scan on node_payload_history (2,825 rows) | 2,825 | 0 | n/a (0 deleted) | 0.28 | 0.34 | `shared hit=676` |  |
| 2 | payload newest-N owner | Seq Scan on node_payload_history (2,825 rows); Index Scan [node_payload_history_pkey] on node_payload_history (5 rows, 5 searches) | 2,830 | 5 | 566x | 1.67 | 1.44 | `shared hit=764 read=2 dirtied=2` | output_snapshot_history_payload_id_fkey: time=0.149 calls=5 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (2,820 rows) | 2,820 | 0 | n/a (0 deleted) | 4.17 | 3.68 | `shared hit=1736 read=2142` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 9772.6, 9856.1, 9663.2 | 9772.6 |
| NodePayloadHistoryRepository.purge (payload) | 11.7, 16.7, 10.8 | 11.7 |

**Tick wall time (sum of medians): 9784.2 ms**

### S2 AFTER V120, PG 18 as-is

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (316,648 rows, 1 searches) | 316,648 | 297 | 1,066x | 114.89 | 92.64 | `shared hit=379 read=17844 dirtied=17 written=10585` |  |
| 1 | history age purge beta | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (137,071 rows, 1 searches) | 137,071 | 104 | 1,318x | 42.38 | 35.50 | `shared hit=104 read=7797 dirtied=7 written=78` |  |
| 1 | history age purge owner | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (17 rows, 1 searches) | 17 | 17 | 1x | 0.13 | 0.39 | `shared hit=111 read=12 dirtied=1` |  |
| 1 | history age purge unnamed-tier catch-all | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (1 rows, 1 searches) | 1 | 0 | n/a (0 deleted) | 0.11 | 0.25 | `shared hit=25` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (4,986,230 rows); Seq Scan on output_snapshot_history (4,986,230 rows) | 9,972,460 | 120,000 | 83x | 10063.60 | 9291.52 | `shared hit=151169 read=566526 dirtied=6806 written=2, temp read=74650 written=74739` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (2,901 rows) | 2,901 | 47 | 62x | 14.70 | 4.47 | `shared hit=244 read=764 dirtied=65` | output_snapshot_history_payload_id_fkey: time=2.563 calls=47 |
| 2 | payload age purge beta | Index Scan [idx_node_payload_history_captured_at] on node_payload_history (4 rows, 1 searches) | 4 | 4 | 1x | 0.29 | 0.48 | `shared hit=44 read=10 dirtied=5` | output_snapshot_history_payload_id_fkey: time=0.209 calls=4 |
| 2 | payload newest-N beta | Seq Scan on node_payload_history (2,850 rows); Seq Scan on node_payload_history (2,850 rows) | 5,700 | 25 | 228x | 3.43 | 3.60 | `shared hit=1501 read=11 dirtied=21` | output_snapshot_history_payload_id_fkey: time=0.769 calls=25 |
| 2 | payload age purge owner | Index Scan [idx_node_payload_history_captured_at] on node_payload_history (0 rows, 1 searches) | 0 | 0 | n/a (0 deleted) | 0.01 | 0.20 | `shared hit=2` |  |
| 2 | payload newest-N owner | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (1,175 rows, 166 searches); Index Scan [node_payload_history_pkey] on node_payload_history (5 rows, 5 searches) | 1,180 | 5 | 236x | 1.95 | 1.95 | `shared hit=1563 read=34 dirtied=3` | output_snapshot_history_payload_id_fkey: time=0.245 calls=5 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (2,820 rows) | 2,820 | 0 | n/a (0 deleted) | 8.95 | 8.57 | `shared hit=1603 read=2275` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 9142.0, 9420.4, 9794.6 | 9420.4 |
| NodePayloadHistoryRepository.purge (payload) | 18.1, 19.7, 19.5 | 19.5 |

**Tick wall time (sum of medians): 9439.9 ms**

### S2 AFTER V120, PG16 proxy

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (316,648 rows, 1 searches) | 316,648 | 297 | 1,066x | 112.37 | 88.42 | `shared hit=298 read=17925 dirtied=17 written=15964` |  |
| 1 | history age purge beta | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (137,071 rows, 1 searches) | 137,071 | 104 | 1,318x | 39.01 | 33.24 | `shared hit=104 read=7797 dirtied=7 written=13` |  |
| 1 | history age purge owner | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (17 rows, 1 searches) | 17 | 17 | 1x | 0.12 | 0.34 | `shared hit=111 read=12 dirtied=1` |  |
| 1 | history age purge unnamed-tier catch-all | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (1 rows, 1 searches) | 1 | 0 | n/a (0 deleted) | 0.10 | 0.23 | `shared hit=25` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (4,986,230 rows); Seq Scan on output_snapshot_history (4,986,230 rows) | 9,972,460 | 120,000 | 83x | 9876.97 | 8943.33 | `shared hit=149860 read=611449 dirtied=6768, temp read=74650 written=74739` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (2,901 rows) | 2,901 | 47 | 62x | 12.83 | 3.94 | `shared hit=251 read=757 dirtied=65` | output_snapshot_history_payload_id_fkey: time=1.718 calls=47 |
| 2 | payload age purge beta | Index Scan [idx_node_payload_history_captured_at] on node_payload_history (4 rows, 1 searches) | 4 | 4 | 1x | 0.20 | 0.37 | `shared hit=44 read=10 dirtied=5` | output_snapshot_history_payload_id_fkey: time=0.162 calls=4 |
| 2 | payload newest-N beta | Seq Scan on node_payload_history (2,850 rows); Seq Scan on node_payload_history (2,850 rows) | 5,700 | 25 | 228x | 3.06 | 2.65 | `shared hit=1501 read=11 dirtied=21` | output_snapshot_history_payload_id_fkey: time=0.507 calls=25 |
| 2 | payload age purge owner | Index Scan [idx_node_payload_history_captured_at] on node_payload_history (0 rows, 1 searches) | 0 | 0 | n/a (0 deleted) | 0.01 | 0.13 | `shared hit=2` |  |
| 2 | payload newest-N owner | Seq Scan on node_payload_history (2,825 rows); Index Scan [node_payload_history_pkey] on node_payload_history (5 rows, 5 searches) | 2,830 | 5 | 566x | 1.69 | 1.52 | `shared hit=760 read=6 dirtied=3` | output_snapshot_history_payload_id_fkey: time=0.172 calls=5 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (2,820 rows) | 2,820 | 0 | n/a (0 deleted) | 8.16 | 7.63 | `shared hit=1603 read=2275` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 9074.5, 9068.9, 9036.0 | 9068.9 |
| NodePayloadHistoryRepository.purge (payload) | 16.4, 16.6, 24.9 | 16.6 |

**Tick wall time (sum of medians): 9085.4 ms**

### S2-owner (10k all-owner, ~8M rows), V120 applied, PG 18 as-is

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (1 rows, 1 searches) | 1 | 0 | n/a (0 deleted) | 5.29 | 5.40 | `shared read=25` |  |
| 1 | history age purge beta | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (1 rows, 1 searches) | 1 | 0 | n/a (0 deleted) | 4.39 | 4.39 | `shared hit=25` |  |
| 1 | history age purge owner | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (418 rows, 1 searches) | 418 | 418 | 1x | 1.00 | 1.11 | `shared hit=1669 read=65 dirtied=24` |  |
| 1 | history age purge unnamed-tier catch-all | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (1 rows, 1 searches) | 1 | 0 | n/a (0 deleted) | 4.23 | 4.57 | `shared hit=48 read=1` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (8,020,000 rows); Seq Scan on output_snapshot_history (8,020,000 rows) | 16,040,000 | 120,000 | 134x | 16370.12 | 14607.44 | `shared hit=148389 read=869455 dirtied=6752, temp read=122079 written=122222` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (19,501 rows) | 19,501 | 0 | n/a (0 deleted) | 5.15 | 4.91 | `shared hit=21 read=4588` |  |
| 2 | payload age purge beta |  | 0 | 0 | n/a (0 deleted) | 0.07 | 0.28 | `shared hit=21` |  |
| 2 | payload newest-N beta |  | 0 | 0 | n/a (0 deleted) | 0.09 | 0.30 | `shared hit=21` |  |
| 2 | payload age purge owner | Index Scan [idx_node_payload_history_captured_at] on node_payload_history (22 rows, 1 searches) | 22 | 22 | 1x | 1.84 | 1.80 | `shared hit=311 read=43 dirtied=33` | output_snapshot_history_payload_id_fkey: time=1.280 calls=22 |
| 2 | payload newest-N owner | Seq Scan on node_payload_history (19,479 rows); Seq Scan on node_payload_history (19,479 rows) | 38,958 | 99 | 394x | 31.92 | 27.04 | `shared hit=949 read=8823 dirtied=74` | output_snapshot_history_payload_id_fkey: time=3.827 calls=99 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (19,380 rows) | 19,380 | 0 | n/a (0 deleted) | 62.53 | 54.19 | `shared hit=8028 read=18262 written=758` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 14668.0, 14589.8, 14624.0 | 14624.0 |
| NodePayloadHistoryRepository.purge (payload) | 98.3, 94.0, 86.5 | 94.0 |

**Tick wall time (sum of medians): 14718.1 ms**

### S3 backlog (1k Outputs, mix M, 7 d of 5-min points, ~2.1M rows), V120 applied, PG 18 as-is

| repo | statement | scan nodes on target table | rows read | rows deleted | read/deleted | EXPLAIN exec ms (median of 3) | plain ms (median of 3) | first-run buffers (top node) | FK trigger |
|---|---|---|---|---|---|---|---|---|---|
| 1 | history age purge free | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (30,516 rows, 1 searches) | 30,516 | 25 | 1,221x | 14.93 | 13.50 | `shared hit=227 read=1533 dirtied=4 written=1443` |  |
| 1 | history age purge beta | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (13,211 rows, 1 searches) | 13,211 | 10 | 1,321x | 2.02 | 1.88 | `shared hit=766 dirtied=1` |  |
| 1 | history age purge owner | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (1 rows, 1 searches) | 1 | 1 | 1x | 0.01 | 0.14 | `shared hit=9 dirtied=1` |  |
| 1 | history age purge unnamed-tier catch-all | Index Scan [idx_output_snapshot_history_captured_at] on output_snapshot_history (1 rows, 1 searches) | 1 | 0 | n/a (0 deleted) | 0.03 | 0.13 | `shared hit=7` |  |
| 1 | history thin (protected newest 101) | Seq Scan on output_snapshot_history (2,081,480 rows); Seq Scan on output_snapshot_history (2,081,480 rows) | 4,162,960 | 1,595,000 | 3x | 16310.08 | 17823.00 | `shared hit=503216 read=1411814 dirtied=1234393 written=1211510, temp read=54562 written=54599` |  |
| 2 | payload disallowed-tier | Seq Scan on node_payload_history (206 rows) | 206 | 2 | 103x | 0.76 | 2.67 | `shared hit=7 read=57 dirtied=3 written=55` | output_snapshot_history_payload_id_fkey: time=0.408 calls=2 |
| 2 | payload age purge beta | Index Scan [idx_node_payload_history_captured_at] on node_payload_history (1 rows, 1 searches) | 1 | 1 | 1x | 0.16 | 0.44 | `shared hit=27 read=14 dirtied=3 written=12` | output_snapshot_history_payload_id_fkey: time=0.138 calls=1 |
| 2 | payload newest-N beta | Seq Scan on node_payload_history (203 rows); Seq Scan on node_payload_history (203 rows) | 406 | 2 | 203x | 0.23 | 0.51 | `shared hit=130 dirtied=1` | output_snapshot_history_payload_id_fkey: time=0.035 calls=2 |
| 2 | payload age purge owner | Index Scan [idx_node_payload_history_captured_at] on node_payload_history (0 rows, 1 searches) | 0 | 0 | n/a (0 deleted) | 0.01 | 0.17 | `shared hit=1` |  |
| 2 | payload newest-N owner | Index Scan [idx_node_payload_history_node_captured] on node_payload_history (91 rows, 16 searches); Index Scan [node_payload_history_pkey] on node_payload_history (1 rows, 1 searches) | 92 | 1 | 92x | 0.28 | 0.51 | `shared hit=99 read=1 written=1` | output_snapshot_history_payload_id_fkey: time=0.117 calls=1 |
| 2 | payload unreferenced | Seq Scan on node_payload_history (200 rows) | 200 | 0 | n/a (0 deleted) | 1.00 | 1.08 | `shared hit=110 read=166 written=157` |  |

| transaction | lock hold ms (3 runs) | median |
|---|---|---|
| OutputHistoryRepository.thinAndPurge (history) | 17490.3, 17935.4, 17839.3 | 17839.3 |
| NodePayloadHistoryRepository.purge (payload) | 4.1, 5.8, 13.9 | 5.8 |

**Tick wall time (sum of medians): 17845.0 ms**


Other S2 views (pre-vacuum first baseline and the two candidates) are in section 4's table; their statement-level tables
are reproduced from the same logs by the committed script plus the plan text in `evidence/`.
(`S2-owner` and `S3` were measured with V120 applied; their thin DELETE is index-independent, and S2-owner's empty tiers make
its age purges degenerate by design - they were not used for the index decision.)

## 6. Extrapolation, with the assumptions stated

1. **Model.** Steady state is what an hourly thin leaves: ~467 / 527 / 802 rows per free / beta / owner Output, plus 12 new
   points per hour. The ticket's literal 1k Outputs x 1 year x 5-minute points (105M rows) is not reachable under hourly
   thinning; S3 is the nearest honest analogue (a thinning outage).
2. **Thin cost is about linear in Outputs, slightly worse.** Plain-pass thin: 773 ms (1k Outputs) -> 9,433 ms (10k): exponent
   ln(9433/773)/ln(10) = 1.09, i.e. ~0.77 ms -> ~0.94 ms per Output. Assuming `n log n` for the sort: 100k Outputs ~ 115 s, 1M ~ 1,400 s
   (this machine, `work_mem` 4 MB, temp spill ~600 MB per 5M rows = 120 MB per 1M rows).
3. **Age purges are small once V120 exists** (~150 ms at S2 on the proxy) and grow with the number of past-cap rows per tick
   (hourly: ~418 rows at 10k Outputs), not with table size; payload purge is tens of ms (12-94 ms) and bounded by tier caps.
4. **Backlog (S3):** 2.08M rows, 1.6M deleted, 17.8 s = ~8.6 us per row, 54.6k temp pages (~430 MB) and 1.2M dirtied pages.
   Linear in backlog rows: a year of un-thinned 5-minute points for 1k Outputs (105M rows) would be ~15-20 min in one transaction and
   ~20 GB of temp - more than the 10 GB data disk of the production instance. That scenario cannot arise while the hourly tick
   works, but a long outage followed by a restart is a single statement with no upper bound.
5. **Production is slower, by an unmeasured factor.** `db-g1-small` is shared-core with a small shared_buffers. No measurement here
   speaks to its speed; the 3-10x used in the verdict is an assumption chosen to show the sensitivity, not a finding.
   If the prod data volume is wanted, a read-only `SELECT count(*) FROM output_snapshot_history` against prod would
   calibrate which row of this table applies; it was not run (no prod credentials in scope).
6. **Cadence/lock criteria (design D7).** Hourly is appropriate if the S2 tick is well under the 120 s lock-retry window and a
   small fraction of the interval: 10 s is 8% of the window and 0.3% of the hour. The lock is appropriate if its hold does not
   routinely starve run-side payload trims, which skip rather than wait: true at the measured holds; the S3-style catch-up hold (18 s per 2M rows)
   would make every payload trim in that window skip until the next purge.

## 7. Not done here (spinoff candidates), per the proposal's non-goals

- **Thin DELETE rewrite or `SET LOCAL work_mem`**: it ranks every row twice and sorts ~600 MB on disk at 5M rows (95-99.9% of the tick).
  Candidate: rank once per Output, or process Outputs in bounded batches. This is where the time is; V120 is a
  secondary fix by comparison (it removes ~0.7 s of ~9.8 s on the proxy, plus a table-size-proportional cost).
- **Bounded catch-up for a thinning backlog** (temp space and lock hold grow with the backlog, section 6.4).
- **Free-tier age purge residue**: with `(captured_at)` the free purge still reads every beta/owner daily point older than 30 d
  (316,648 rows at S2) because the tier is joined after the cutoff; per-tier ordering or a partial index would remove it. Small.
- No cadence or lock change is recommended; none was implemented.

## 8. Reproduce, and evidence index

```
# scratch DB created and migrated as in section 2 (jshell + Flyway on the assembly jar, role matt, literal scratch URL)
psql -X -w -d helio_hel1284_scratch -v n_outputs=10000 -v mix=M -v backlog=0 -v do_seed=on -f backend/scripts/perf/history-retention-measure.sql
psql -X -w -d helio_hel1284_scratch -v do_report=on   -f backend/scripts/perf/history-retention-measure.sql
psql -X -w -d helio_hel1284_scratch -v do_measure=on  -f backend/scripts/perf/history-retention-measure.sql 2>&1 | tee run.log
psql -X -w -d helio_hel1284_scratch -v do_measure=on -v pg16_view=on -f ...
psql -X -w -d helio_hel1284_scratch -v do_index=on -v idx=captured_at|pipeline_captured|both|none -f ...
psql -X -w -d helio_hel1284_scratch -v do_insert_path=on -f ...
```

The scratch DB is dropped by hand, by exact name, from another database (never in the script); see the cleanup record below.

`evidence/` (run-1 EXPLAIN (ANALYZE, BUFFERS) text for every statement, plus all timed passes):
`S1-pg18-asis.txt`, `S1-pg16-proxy.txt`, `S2-before-pg18-asis.txt`, `S2-before-pg16-proxy.txt`,
`S2-candidateA-captured_at-pg16-proxy.txt`, `S2-candidateB-pipeline_captured-pg16-proxy.txt`, `S2-after-v120-pg18-asis.txt`,
`S2-after-v120-pg16-proxy.txt`, `S2owner-after-v120-pg18-asis.txt`, `S3-backlog-v120-pg18-asis.txt`.
(The S2 candidate runs are pre-vacuum; the before/after pair is on vacuumed data, which is why section 4's candidate table and
its before/after table differ slightly in the same quantities.)

## 9. Cleanup record

- `DROP DATABASE helio_hel1284_scratch` was run by hand from the `postgres` database; afterwards
  `SELECT datname FROM pg_database WHERE datname LIKE 'helio%'` returns `helio`, `helio_hel818` (not mine) only.
  `helio_privileged` is a cluster-global role and was not touched; no role was created.
- `sbt shutdown` was run in `backend/` after both `sbt assembly` and `sbt testFull`.
- Backend gate: `cd backend && sbt testFull` -> `Total number of tests run: 6396`, `Suites: completed 457, aborted 0`,
  `Tests: succeeded 6396, failed 0, canceled 4, ignored 0, pending 0`, `All tests passed.` (the embedded-Postgres suites apply the new V120
  on every start; OutputHistoryRetentionServiceSpec, OutputHistoryRetentionPrivilegedSpec, NodePayloadHistoryRlsSpec and the history route specs ran in it).
