# HEL-1435 measurements: bounded history thinning on a PostgreSQL 16 prod-class proxy

Everything here was measured on real **PostgreSQL 16.14** (the production minor, `POSTGRES_16_14`, per HEL-1284 section 3.2) in
local, resource-limited Docker containers named `hel1435-*`, on a scratch database `helio_hel1435_scratch` (and clones of it).
Nothing touched the shared `helio` dev DB, production, Cloud SQL or any cloud resource. Raw logs for every run are under
`evidence/` (index in section 14). The numbers are a **proxy**, not a production measurement; section 3 says exactly how far
that proxy can be trusted.

## 1. Verdict

| Question | Answer |
|---|---|
| Is the thin now bounded? | Yes. Every transaction ranks at most `OUTPUT_HISTORY_THIN_BATCH_ROWS` rows (default **25,000**), or the rows of the single Output when that Output alone is larger (section 9). Spill to temp is gone at the default (0 bytes in every R=25,000 transaction; the old statement wrote 359-723 MB). |
| Same survivors? | Yes. Row-by-row diff, old verbatim statement vs batched thin, both ways = **0 rows**, on S2 (4.87M survivors), S3 (0.49M) and S4 (0.14M), for batch size 25,000 and 100,000, one batch per pass and a multi-batch budget, drained on both the desktop and the `db-g1-small`-class profile (12 diffs, section 6). Plus a randomized 216-combination Scala guard. |
| Does it cost less? | **No: it costs more in total, and that is the price of bounding.** One full cycle of committed batches (R=25,000) took 1.7-3.0x the old single statement on S2, **0.7-0.9x (cheaper) on S3**, and **1.6x (desktop) to 5.4x (prod-class, CPU-bound) on the deep backlog S4** (section 6.3). In exchange the longest transaction fell from 10.9 s to 0.35 s (S2 desktop), 29.1 s to 0.72 s (S2 prod-class) and, on S4, 81.5 s to 3.1 s (desktop) / 109.6 s to 8.0 s (prod-class). WAL fell about 4x on the deep backlog (23.6 GB to 5.9 GB) and 8x on S3. |
| The "3-10x slowdown" assumption (HEL-1284) | Replaced by measurements (section 5). Warm cache: **2.1x** (S2: 14.0 s desktop to 29.2 s at 0.5 CPU, 21.8 s with the assumed PD-SSD baseline). Pessimistic per-GB PD-SSD limits with reads still served from the host page cache: **6.6x** (92.5 s). Pessimistic limits with every shared_buffers miss a real throttled read (no OS cache): **120x** (1,684 s = 28 min). So 3-10x holds for a warm instance; a cold, slow-disk instance can be an order of magnitude worse, and on that model the old tick already exceeded the 120 s lock-retry window **at 10k Outputs**, not at 10k-30k. |
| Which batch size? | 25,000 rows (see section 10; this **deviates from design D5's "one pass covers 10k Outputs"**, with the reason). 100,000 rows has the same total cost but a deep-backlog transaction 3x longer (9.6 s vs 3.1 s on the desktop); 250,000 rows spills and flips plans to Seq Scans. |

## 2. Method

- **Scratch only.** Container `hel1435-pg` (image `postgres:16`, 127.0.0.1:55435 only, volume `hel1435-pgdata`), database
  `helio_hel1435_scratch`; clones `hel1435_old`, `hel1435_new1`, `hel1435_newb` (created `TEMPLATE helio_hel1435_scratch`, dropped
  after each diff). The seed script refuses any other database name; the recorded refusal test (run against `postgres`) exits 3
  and never prints its post-guard marker (`evidence/refusal-test.log`). No Flyway/URL ever came from `backend/.env`: the Scala driver
  `HistoryThinMeasure` takes a literal URL (and refuses anything but the local `hel1435` container); the sbt test environment is the
  committed `DevEnv.testEnv`. Schema: the repo's pinned Flyway through that driver, `RESULT migrations=121 success=true target=121`
  (`evidence/migrate.log`).
- **Host safety.** Every client `nice -n 19`; available memory checked before each phase (abort below 12 GB; it stayed 33-36 GB);
  one container at a time; one sbt JVM at `-J-Xmx3g`. A measurement container with a 1.7 GB cgroup was OOM-killed twice while cloning
  or diffing multi-GB databases (kernel kill of a backend, `evidence/clonediff-S2-prod-io-base.first-attempt-oom.out`); clone
  creation and the survivor diff were moved to the unthrottled desktop profile, drains stayed on the profile under test.
- **What was measured with what.**
  - *Old tick*: the pre-HEL-1435 statements, text-identical to `OutputHistoryRepository.thinAndPurge` at 22f4c1fd3 (the Scala
    oracle `OldSingleStatementThin` is a verbatim copy), each repository transaction as `BEGIN ... ROLLBACK`, `EXPLAIN (ANALYZE,
    BUFFERS)` runs and plain timed runs (`backend/scripts/perf/history-retention-batched-measure.sql`).
  - *New, dry batches*: the **real repository SQL** (`HistoryThinBatching`, called from the Scala driver, not re-typed in SQL)
    per sampled batch, inside `BEGIN ... ROLLBACK`: `EXPLAIN` runs through `auto_explain` (plans in the server logs, one per
    statement, bind parameters included) and plain timed runs. The batch chain is computed on the pristine data, so batch k is
    exactly the real cycle's batch k (`admitted_same=true` in every row).
  - *New, committed drains*: the real `OutputHistoryRepository.thinPass` loop to completion on a clone, at the seed's pinned `now`.
- **Reps.** Desktop, `prod-noio` and `prod-io-base`: 3 + 3 for the old statements, 3 + 3 per sampled batch (4 batches). The IO-throttled
  profiles ran 1 + 1 (a single old transaction takes 1.5-43 minutes there). This is a deviation from "x3 everywhere" and is labelled
  per table.
- **Settings.** `work_mem` 4 MB (default), `shared_buffers` 128 MB except where stated, `max_parallel_workers_per_gather` 2,
  `auto_explain` (analyze, buffers, nested statements) off for timed runs, on for EXPLAIN runs. Data inserted in `captured_at`
  order (heap order roughly time order, as live ingest produces).

## 3. The prod-class proxy: what it is, sources, assumptions, sensitivity

Production (read-only `gcloud sql instances describe helio-db`, recorded in HEL-1284 section 3.2): PostgreSQL 16, `db-g1-small`
(shared-core), `ENTERPRISE`, 10 GB `PD_SSD`.

**Source note.** No network tool was available in this session, so the public figures below were *recalled* from Google Cloud
documentation, not re-fetched; every one is therefore labelled an **ASSUMPTION with a sensitivity bracket**, with the URL where it
is documented:

| Figure used | Value | Status | Where documented |
|---|---|---|---|
| PostgreSQL version, tier, disk | 16.14, `db-g1-small`, 10 GB PD-SSD | measured from the real instance (HEL-1284) | `gcloud sql instances describe` |
| Memory | 1.7 GB (`--memory=1.7g`, swap = memory) | ASSUMPTION (recalled) | https://cloud.google.com/sql/docs/postgres/instance-settings |
| CPU | 0.5 CPU (`--cpus=0.5`), bracket 1.0 | ASSUMPTION: the sustained share of a shared core; burst credits are **not** modelled (sustained-rate approximation) | https://cloud.google.com/compute/docs/general-purpose-machines#sharedcore |
| Disk, strict model | 300 IOPS, 4.8 MB/s read and write (30 IOPS/GB, 0.48 MB/s per GB x 10 GB) | ASSUMPTION (recalled per-GB limits) | https://cloud.google.com/compute/docs/disks/performance |
| Disk, base model | 6,000 IOPS, 240 MB/s | ASSUMPTION (a baseline that does not scale down with size), a bracket, not a citation | same page |
| `shared_buffers` | 128 MB (default) vs 570-600 MB (about a third of 1.7 GB) | ASSUMPTION, both run | PostgreSQL defaults |

Not modelled and not measurable here: the per-core speed of the host (a Ryzen 7600X desktop; GCP shared-core vCPUs are almost
certainly slower per thread, which would push every prod-class number *up*), network latency from Cloud Run, other tenants and
concurrent application load, burst credits.

**Profiles** (`backend/scripts/perf/hel1435-container.sh`; the script holds the exact flags):

| Label | CPU / memory | IO limit | Cache | Used for |
|---|---|---|---|---|
| `desktop` | 4 / 4 GB | none | host page cache | continuity with HEL-1284 |
| `prod-noio` | 0.5 / 1.7 GB | none | host page cache | isolates CPU + memory |
| `prod-io-base` | 0.5 / 1.7 GB | 6,000 IOPS, 240 MB/s | host page cache | headline prod-class |
| `prod-io-strict` | 0.5 / 1.7 GB | 300 IOPS, 4.8 MB/s | host page cache (reads still cached) | pessimistic write path |
| `prod-io-base-direct` / `prod-io-strict-direct` | as above | as above | `debug_io_direct=data`, `shared_buffers` 600 MB: no OS page cache | cold-cache extreme |

**The IO throttle bites (recorded probe, `evidence/io-probe.log`)**, `dd` inside a `postgres:16` container on the Docker volume
(ext4 on `/dev/nvme0n1p6`; the limit is applied to the whole disk `/dev/nvme0n1`, 259:0, because block-IO throttling is a
per-queue property):

| Probe | unthrottled | 4.8 MB/s + 300 IOPS |
|---|---|---|
| O_DIRECT write, 64 MB, 1 MB blocks | 4.9 GB/s | **4.9 MB/s** |
| O_DIRECT write, 4 kB x 2000 | 218 MB/s | **1.3 MB/s** (6.4 s = 310 IOPS) |
| buffered write + fdatasync, 64 MB | 1.9 GB/s | **4.9 MB/s** |
| O_DIRECT read, 64 MB | 4.6 GB/s | **4.9 MB/s** |

A finding that shaped the profiles: reads served from the *host's* page cache are never throttled (the first strict run of the
old S2 tick took 92 s, not the 30+ minutes its IO volume implies, because the heap was cached). `debug_io_direct=data` makes every
`shared_buffers` miss a real, throttled device read; those `*-direct` profiles are the cold-cache extreme and are labelled so.

**CPU / shared_buffers sensitivity (S2)**: section 5.3.

## 4. Seeds

Same generator as HEL-1284 (`history-retention-batched-measure.sql`; S1-S3 reproduce its row counts exactly), one new scenario.

| | Outputs | history rows | rows / Output (free / beta / owner) | heap + indexes | notes |
|---|---|---|---|---|---|
| S1 | 1,000 | 497,516 | 467 / 527 / 802 | 216 + 47 MB | thinned steady state |
| S2 | 10,000 | 4,986,648 | 467 / 527 / 802 | 2,164 + 464 MB | thinned steady state, 70/25/5 free/beta/owner |
| S3 | 1,000 | 2,081,516 | 2,051 / 2,111 / 2,386 | 903 + 203 MB | 7-day backlog of 5-minute points |
| **S4** | 300 | 5,533,209 | 15,852 / 28,812 / 15,852 | 2,402 + 551 MB | **deep backlog**: dense 5-minute points for 55 days (free, owner) and 100 days (beta), i.e. 25 days past the free cap and 10 past the beta cap; per-Output depth 30-57x steady state; 5,392,209 of 5,533,209 rows (97%) are deleted by the tick |

The seed's own trailing `VACUUM` left the visibility map empty (`relallvisible = 0`), which silently turns the batch admission count
from an index-only scan into heap fetches; a separate `VACUUM (ANALYZE)` after the seed is part of the recipe and sets it. The
cost of an empty map (S1, first 25,000-row batch, desktop): admission 13.8 ms vs 7.9 ms (`dry-S1-desktop-novm` vs `-vm`,
`vm-state-*.txt`). Bounded either way.

## 5. Before (today's single statement) on the proxy

History transaction = advisory lock + the age purges + the thin, one transaction, rolled back, median of the runs (3 where
`reps`=3, else the single run).

### 5.1 Lock hold of the old history transaction

| | rows | desktop | prod-noio | prod-io-base | prod-io-strict (cached reads) | prod-io-base-direct | prod-io-strict-direct |
|---|---|---|---|---|---|---|---|
| S1 | 0.50M | 0.9 s | | | | | |
| S2 | 4.99M | **14.0 s** | 29.2 s (2.1x) | 21.8 s (1.6x) | 92.5 s (6.6x) | 95.9 s (6.9x) | **1,684 s** (120x) |
| S3 | 2.08M | 15.0 s | 29.0 s | 32.2 s | 275.5 s | 136.4 s | not finished in 35 min, aborted (`old-S3-prod-io-strict-direct.ABORTED.txt`); the WAL alone is 23 min at 4.8 MB/s |
| S4 | 5.53M | 50.9 s | 82.6 s | 121.7 s | **2,606 s** (43 min) | not run | not run |

Run-to-run spread (desktop S2: 14.0 / 15.2 / 13.7 s) is about 8%. The payload transaction is 2-90 ms in every scenario
(section 8).

**Where the 120 s lock-retry window is crossed** (linear in Outputs, the same extrapolation HEL-1284 used): S2 `prod-noio` 29 s at
10k Outputs reaches 120 s at about 41k; `prod-io-base` (22 s) at about 55k; strict with cached reads (92 s) at about 13k; the
cold strict model is already at 14x the window at 10k. HEL-1284's "10k-30k" is the right order for a warm instance and optimistic for
a cold slow one.

### 5.2 What the old plan does

Unchanged from HEL-1284 (re-run on PG16, `old-*.log`): two Seq Scans of the whole table plus an external-merge sort, spilling
**402 MB (S2), 359 MB (S3), 723 MB (S4)** to temp per tick (sum of the `temporary file` log lines in the run window); WAL 60 MB
(S2), 6.7 GB (S3), 23.7 GB (S4) when the tick commits (`drain-old-*`). The age purges are index-bounded since V120 but on S4 the
free-tier purge alone deletes 1.64M rows (2.8 s desktop, 4.6 s `prod-io-base`).

### 5.3 CPU and shared_buffers sensitivity (S2, old tick and batches)

S2, 3 runs of the old tick and the dry batches (4 or 3 sampled batches), no IO limit, so only CPU and memory vary:

| configuration | old history transaction (3 runs) | batch R=25,000 | batch R=100,000 |
|---|---|---|---|
| desktop (4 CPU, 4 GB, shared_buffers 128 MB) | 14.0 s | 55 ms | 238 ms |
| `prod-noio` (0.5 CPU, 1.7 GB, 128 MB) | 29.2 / 29.2 / 27.8 s | 104 ms | 416 ms |
| 1.0 CPU, 1.7 GB, 128 MB | 10.3 / 10.3 / 10.3 s | 49 ms | 213 ms |
| 0.5 CPU, 1.7 GB, shared_buffers 570 MB | 20.6 / 20.7 / 20.4 s | 99 ms | 420 ms |

The CPU effect is roughly proportional (0.5 to 1.0 CPU: 2.8x for the old statement, 2.1x for batches), shared_buffers matters to the
old statement (28% less at 570 MB: it scans the heap twice) and not to batches. The 1.0-CPU run being *faster* than the 4-CPU
desktop run (10.3 s vs 14.0 s) is unexplained (the desktop plans may use parallel workers; not investigated), so do not read these
as monotone in the CPU count. The bracket for "prod-class" S2 is therefore 10-29 s for the old tick before any IO model, which
matches the 2-3x of section 5.1 and nothing close to 30x.

## 6. After: bounded batches

### 6.1 Per-batch cost, dry (rolled back), real SQL

Median lock-hold of a sampled batch (admission + age purge + thin, one transaction), warm (timed reps), with the number of
batches in a cycle and the largest sort spill of any batch transaction in that configuration. R = `OUTPUT_HISTORY_THIN_BATCH_ROWS`,
N = 500 (the cap on Outputs per batch; never the binding limit here).

| Scenario, profile | R=25,000 | R=100,000 | R=250,000 |
|---|---|---|---|
| S2 desktop | **55 ms**, 202 batches, spill 0 | 238 ms, 51 batches, spill 4.0 MB | 1,193 ms, 21 batches, spill 10 MB, **9 of 21 delete plans Seq Scan** |
| S2 prod-noio | 104 ms | 416 ms | 2,268 ms, 9 of 21 Seq Scan |
| S2 prod-io-base | **107 ms** | 429 ms | 2,255 ms, 9 of 22 Seq Scan |
| S2 prod-io-strict (cached) | 106 ms | 431 ms | not run |
| S3 desktop | 101 ms, 86 batches | 464 ms, 22 batches, spill 7.6 MB | 1,120 ms, 9 batches, spill 29 MB, 9 of 24 Seq Scan |
| S3 prod-io-base | 220 ms | 1,251 ms | 2,600 ms, 9 of 24 Seq Scan |
| S4 desktop | **131 ms**, 300 batches, spill 0 | 810 ms, 61 batches, spill 6.7 MB | 2,110 ms (max 6.3 s), 23 batches, spill 28 MB |
| S4 prod-noio | 291 ms | 1,746 ms | 4,414 ms |
| S4 prod-io-base | 302 ms | 1,691 ms | 4,111 ms (max 12.6 s) |

Per-batch plan acceptance (no `Seq Scan on output_snapshot_history` in any batch DELETE plan, both profiles, S2 and S4): **met at
R <= 100,000 in every plan dumped** (S2: 0 of 12-21 delete plans per profile; S4: 0 of 24). It is **not** met at R=250,000 on
S2/S3: the planner flips to a Seq Scan of the table in 9 plans per run once a batch holds about 500 Outputs, which is also where
time stops being linear (1,193 ms for 250k rows vs 238 ms for 100k). That is the reason R is not larger. The age DELETE reads
only over-cap rows through the `(output_id, captured_at)` index (`captured_at < strictest cutoff` is implied by every tier's own
cutoff, so it changes no result): S4 R=25,000, the first batch reads 7,211 rows for the batch's free Output instead of its 15,852 rows
(extracted from `dry-S4-desktop-R25000.server.log`).

D1's claim that admission is "index-only" holds only on a vacuumed table (6 buffers per Output vs 468, section 4); on an unvacuumed
table the same bounded count does heap fetches.

### 6.2 Cold-cache batches (first touch)

The timed reps above are warm. The first (EXPLAIN) rep of each sampled batch is the first touch and shows what a cold batch costs:

| | R=25,000 | R=100,000 |
|---|---|---|
| S2 prod-io-base-direct (cold, 240 MB/s) | 120-498 ms | 1.2-1.3 s |
| S2 prod-io-strict-direct (cold, 4.8 MB/s) | 2.7-11.5 s | 17.8-21.8 s |
| S3 prod-io-base-direct | 0.2-7.0 s | 0.2-4.4 s |
| S3 prod-io-strict-direct | 3.5-60.4 s | 0.3-46.8 s |
| S4 prod-io-base-direct | 8.3-42.8 s | 35-54 s |
| S4 prod-io-strict-direct | 77-172 s | 81-167 s |

For comparison the old S2 transaction is 96 s (base, cold) and 1,684 s (strict, cold). Under the strict cold model *no* batch size
meets the "about 1-2 s" criterion of D5; the deep-backlog cold batches are dominated by deleting an Output's rows (about one full-page
WAL image per deleted row because an Output's rows sit one per heap page), which a smaller R cannot reduce below one Output (D9).

### 6.3 Committed drains: catch-up proof, equivalence, total cost

The real `thinPass` loop on clones of the seeded scratch DB at the seed's pinned `now`; old = the verbatim statements in one
committed transaction. "new, one per pass" = `maxBatches` 1 (every pass is one transaction, so the per-transaction figures are
exact); "new, budget" = the shipped multi-batch pass (`M` = batches per pass). Survivor diffs below.

R = 25,000 (the shipped default):

| | old: 1 txn | new, one per pass: txns, wall, longest txn, spill, longest txn WAL | new, budget M: passes, longest pass |
|---|---|---|---|
| S2 desktop | 10.9 s, spill 402 MB, WAL 60 MB | 202 txns, 32.4 s, **0.35 s**, 0 B, 0.6 MB | M=60: 4 passes, 9.7 s |
| S2 prod-io-base | 29.1 s | 202 txns, 49.2 s, **0.72 s**, 0 B, 0.6 MB | M=60: 4 passes, 7.7 s |
| S3 desktop | 16.4 s, spill 359 MB, WAL 6.9 GB | 86 txns, 14.3 s, **0.30 s**, 0 B, 38 MB | M=30: 3 passes, 4.3 s |
| S3 prod-io-base | 32.7 s | 86 txns, 22.6 s, **0.37 s**, 0 B, 38 MB | M=30: 3 passes, 7.8 s |
| S4 desktop | 81.5 s, spill 723 MB, WAL 23.6 GB | 300 txns, 129 s, **3.07 s**, 0 B, 225 MB | M=60: 5 passes, 35 s |
| S4 prod-io-base | 109.6 s | 300 txns, 588 s, **8.0 s**, 0 B, 225 MB | M=60: 5 passes, 147 s |

R = 100,000 (earlier configuration, kept as the comparison that chose the default):

| | old | new, one per pass | new, budget |
|---|---|---|---|
| S2 desktop | 10.9 s | 51 txns, 28.0 s, 0.93 s, spill 8 MB | M=60: 1 pass, 27.3 s |
| S2 prod-io-base | 28.7 s | 51 txns, 58.4 s, 1.89 s | M=60: 1 pass, 59.1 s |
| S3 desktop | 17.8 s | 22 txns, 23.3 s, 1.70 s, spill 15 MB | M=8: 3 passes, 9.4 s |
| S3 prod-io-base | 29.6 s | 22 txns, 23.7 s, 1.97 s | M=8: 3 passes, 8.7 s |
| S4 desktop | 83.0 s | 61 txns, 120 s, **9.6 s**, spill 17 MB, 419 MB WAL | M=20: 4 passes, 47 s |
| S4 prod-io-base | 107.6 s | 61 txns, 551 s, **26.0 s**, 450 MB WAL | M=20: 4 passes, 208 s |

Reading it honestly:

- **Total work goes up on S2 and S4, not on S3**: at R=25,000, 1.7-3.0x (S2), 0.7-0.9x (S3), 1.6x desktop and **5.4x prod-class on S4**; at R=100,000, 2.0-2.6x (S2), 0.8-1.3x (S3), 1.4-5.1x (S4). An
  Output's rows are spread one per page across the table (history is inserted in time order across all Outputs), so a batch of R rows
  touches about R pages and a deleted row costs a full-page WAL image after a checkpoint. The old statement walks the heap once. The
  S4 prod-io-base gap is CPU-bound on 0.5 CPU (6.1 GB of WAL in 588 s is 10 MB/s, far below the 240 MB/s limit). I tried
  deleting by `ctid` (a Tid Scan) in place of `id IN (subquery)`: 20-33% faster on S4 prod-io-base (469 s / 369 s), not the 5x, so it
  was not worth the extra fragility and was reverted (`evidence/experiment-ctid-delete/`).
- **WAL falls** on the deep backlog: 23.7 GB to 5.9 GB (S4 desktop) and 6.7 GB to 0.85 GB (S3), (the mechanism, fewer repeated full-page images of re-visited pages across the old statement's checkpoints, was not probed
  separately).
- Spill is 0 at R=25,000 everywhere; the old statement spilled 359-723 MB.
- **Equivalence at scale** (`survivor-diff-*.log`, `drain-*.log`): for each of S2, S3, S4, on `desktop` and `prod-io-base`, for
  R=25,000 and R=100,000: survivors old = one-per-pass = budget, `old EXCEPT new`, `new EXCEPT old` both **0**, and equal
  deletion counts (120,418 / 1,595,036 / 5,392,209). The `prod-io-base` diffs were *computed* on the desktop profile after the
  drains ran on `prod-io-base` (the 1.7 GB cgroup was OOM-killed running the EXCEPT); the data are the same clones.
- **Bounded catch-up**: the S4 deep backlog (30-57x steady state, 97% of the rows deleted) drains in 5 passes of at most 60
  transactions each, none longer than 3.1 s (desktop) / 8.0 s (prod-class); S3's 7-day backlog in 3 passes. The cursor is carried by
  the (unit-tested) service; the runs here drive `thinPass` with the cursor the same way.
- What a pass costs on the proxy (R=25,000, M=60 as measured; the shipped default is M=20, section 10): S2 steady-state cycle = 4
  passes of 7.7-9.7 s; S4 deep backlog = 5 passes of 35 s (desktop) to 147 s (prod-class). A pass is not a transaction; the lock is
  released between batches, but the pass does stall the scheduler tick for its duration.

## 7. Age purge (D8a)

Today's per-tier purges (S4, `old-S4-*.log`): free 1,644,116 rows deleted in 2.8 s (desktop) to 4.6 s
(`prod-io-base`); beta 173,460 rows in 0.16-0.35 s; the plan reads 2.94M index entries for 1.64M deletes and is one statement. In
batches it is part of the same transaction as the thin (design D4) and reads only over-cap rows of the batch's Outputs. S4, R=25,000,
sampled batches (extracted from the plans): 7,211 rows read, 8-12 ms warm, 57 MB WAL on the first (cold) execution and 0.4 MB after; at R=100,000,
44,694 rows read, 236-359 ms, WAL 1.3-88 MB. Plan acceptance covers it: no `Seq Scan on output_snapshot_history` in any age plan.
**Lag:** an Output's age cap is enforced at the `now` of the pass whose batch covers it, so a cap can lag by up to the length of one
drain (S4 desktop: about 2 minutes; prod-class about 9 minutes at R=25,000/M=60).

## 8. Payload purge per pass, and why its "unreferenced" DELETE cannot be index-bounded

Per pass, the payload transaction (`NodePayloadHistoryRepository.purge`) is **2-90 ms** in every scenario and profile (S1 2 ms; S2 20-80 ms; S3/S4 10-60 ms; the `@@TX ... repo=2` lines in `old-*.log`). It runs on every pass regardless of the history part (design D4). Its "unreferenced" statement,
`DELETE FROM node_payload_history h WHERE NOT EXISTS (SELECT 1 FROM output_snapshot_history o WHERE o.payload_id = h.id)`, is an
anti-join over **every** payload row (Seq Scan of `node_payload_history`, 2,820 rows on S2, then a Merge Right Anti Join against the
ordered partial index on `payload_id`, 8,460 entries): 8.3 ms on S2 desktop (`old-S2-desktop.log`, seq 60). No index can bound it,
because "no referencing history point exists" has to be checked for each payload row; what bounds it is the tier caps on the
payload table's size (5 MB heap at 10k Outputs), not an index.

## 9. D9: the single-Output residual (one Output's own rows are the floor)

Maximum rate per Output given the default pipeline-run limit (`PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` 10 per 60 s per user, one
history point per Output per run) = 14,400 points/Output/day. **This number rests on the default limit and on one point per Output
per run (constraint C4)**; a user with several Outputs on one pipeline shares the limit across them. Seeded with one un-thinned
backlog Output each (`hel1435-d9-single-output.sql`), N=1, each Output a batch by itself (the first Output is always admitted),
dry, warm:

| Outage at full rate | points in the Output | desktop | prod-io-base | spill |
|---|---|---|---|---|
| 1 day | 14,400 | 52 ms | 103 ms | 0 |
| 7 days | 100,800 | 342 ms | 710 ms | 11 MB |
| 30 days | 432,000 | **1.91 s** | **3.93 s** | 58 MB |

These are rolled-back, warm numbers; committed and cold costs scale like S4 (section 6.2/6.3: about 3-8x for a mostly-deleted
backlog). The plan for the 432k-row Output is a Seq Scan (it is 79% of the 550k-row D9 table, so it is not a plan-acceptance
case; plan acceptance is asserted on S2/S4). Worst case, a month-long outage of an Output at the maximum rate is one statement of
roughly 2-4 s (warm) over 432k rows with a 58 MB spill; this is the one bound that batching cannot lower, and it is far below the
120 s window.

## 10. Choosing the defaults (D5), and the deviation

| Setting | Default | Evidence |
|---|---|---|
| `OUTPUT_HISTORY_THIN_BATCH_ROWS` | **25,000** | steady-state batch 55 ms (desktop) / 107 ms (prod-io-base), no spill, plans off Seq Scan; deep-backlog longest transaction 3.1 s / 8.0 s (vs 9.6 s / 26 s at 100,000); the total cycle cost is about the same as at 100,000 (estimated desktop cycle S2: 11.1 s at 25,000 vs 12.1 s at 100,000) |
| `OUTPUT_HISTORY_THIN_BATCH_OUTPUTS` | 500 | an upper cap; not binding at any measured R (a 25,000-row batch holds about 50 Outputs on S2) |
| `OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS` | **20** | bounds pass wall time, which matters because **a retention pass blocks the scheduler tick**: `PipelineSchedulerService` zips the history work into the tick future and `PipelineSchedulerActor` arms the next `Tick` only on `TickCompleted`, so every scheduled run and auto-run debounce waits for the whole pass. M never lengthens a transaction; it sets how long the tick stalls. |

**Why M=20 (pass-time bound chosen over a wall-clock budget).** Computed from the committed one-batch-per-pass drains
(`evidence/drain-new-M1-<S>-<profile>-R25000.log`, one `@@PASS ... ms=` per batch transaction; script and output
`evidence/pass-window-analysis.py` / `.txt`, no re-measurement). "Worst aligned" = the slowest of the passes the default forms
(batches 1-20, 21-40, ...); "worst any" = the slowest 20 consecutive batches. The averages are only averages and understate the
worst case about 2x on the deep backlog:

| Scenario, profile | batches | average 20-batch pass | worst aligned | worst any | longest txn | old single tick | worst any / old |
|---|---|---|---|---|---|---|---|
| S2 desktop | 202 | 3.1 s | 3.8 s | 3.8 s | 0.3 s | 10.9 s | 0.35 |
| S2 prod-io-base | 202 | 4.6 s | 5.6 s | 5.6 s | 0.7 s | 29.1 s | 0.19 |
| S3 desktop | 86 | 3.2 s | 3.5 s | 3.5 s | 0.3 s | 16.4 s | 0.21 |
| S3 prod-io-base | 86 | 4.9 s | 5.1 s | 5.2 s | 0.4 s | 32.7 s | 0.16 |
| S4 desktop | 300 | 8.4 s | 18.4 s | 18.4 s | 3.1 s | 81.5 s | 0.23 |
| S4 prod-io-base | 300 | 38.7 s | **91.6 s** | **96.7 s** | 8.0 s | 109.6 s | **0.88** |

So M=20 stays at or below the old tick everywhere, but on the S4 deep backlog on the prod-class proxy only with a thin margin
(worst 20 consecutive batches 96.7 s = 88% of the old 109.6 s, and below the 120 s lock-retry window); elsewhere it is 16-35% of
the old tick. These figures are warm-to-first-touch drains on clones (the first clone of each pair was the colder run); under the
cold strict-IO model they do not hold (section 6.2). For comparison the M=60 passes reached 147 s, longer than the old tick.
A per-pass wall-clock budget (stop starting batches after T) would bound it
independently of data shape and is the better design if the cold strict model matters: there a single batch is 25-172 s (section
6.2), so even M=1 stalls the tick for minutes and only a hard cap on batch size (impossible below one Output) or running the thin
off the tick could help. I kept the count budget because the design specifies it and it needs no new state; the trade-off is that a
pass bound is data-dependent (deep-backlog passes are 10x a steady-state pass).

**Deviation from D5 (flagged):** the design asked that one pass cover 10k Outputs at steady state and that a batch be 1-2 s on the
prod-class proxy including the deep backlog. At R=25,000/M=20 a 10k-Output cycle is about 11 passes (a few minutes of scheduler
ticks, not one pass), and the committed deep-backlog batch is 3.1-8.0 s (not 1-2 s) because deleting an Output's rows is itself
that expensive and a batch cannot be smaller than one Output. A larger R doubles-to-triples the longest transaction on the deep
backlog (R=100,000: 9.6 s / 26 s) and flips plans to Seq Scans at 250,000; a larger M lengthens the tick stall. I chose short
transactions and short stalls over fewer passes. All three are env vars.

Not measured: the retention pass running concurrently with run-side payload trims and live inserts (the lock-guard tests cover
correctness, not throughput); real Cloud Run to Cloud SQL latency; autovacuum interaction.

## 11. HEL-1284 evidence gaps closed (D8), labelled as fresh PG16 re-runs

HEL-1284's raw logs for the insert-path and index-build timings were never committed; **the figures below are fresh PostgreSQL
16.14 re-runs on the HEL-1435 container, not recoveries of HEL-1284's numbers** (constraint C4). S2 (4,986,648 rows).

| | desktop | prod-noio | prod-io-base |
|---|---|---|---|
| V120 `idx_output_snapshot_history_captured_at` build (3 runs) | 764 / 729 / 740 ms | 2,762 / 2,623 / 2,618 ms | 2,930 / 2,794 / 2,794 ms |
| index size | 33 MB | 33 MB | 33 MB |
| insert 10,000 rows, with V120 (ms, 3 runs, rolled back) | 234 / 156 / 161 | 387 / 310 / 307 | 386 / 309 / 308 |
| insert 10,000 rows, without V120 | 159 / 150 / 160 | 310 / 305 / 300 | 309 / 302 / 317 |
| insert 120,000 rows, with V120 | 1,822 / 1,754 / 1,902 | 3,787 / 3,684 / 3,909 | 3,909 / 4,086 / 4,278 |
| insert 120,000 rows, without V120 | 1,762 / 1,714 / 1,760 | 3,569 / 3,584 / 3,710 | 3,605 / 4,364 / 4,484 |

V120's insert-path cost is within about 0-7% (run-to-run noise on the prod-class profiles overlaps it), consistent with HEL-1284's
conclusion. Raw: `evidence/v120-insertpath-*.log`. All EXPLAIN runs (not only run 1) are in `evidence/old-*.log` (old statements,
`EXPLAIN (ANALYZE, BUFFERS)` x runs) and `evidence/dry-*.server.log` (every batch statement's plan, `auto_explain`).

## 12. Equivalence guards and red/green records

- Scala (embedded Postgres): `OutputHistoryBatchedThinSpec` compares the batched thin with the verbatim old SQL
  (`OldSingleStatementThin`) over 12 randomized fixtures x protected counts {0, 5, 101} x six batch shapes (1, 2, 3, 1000 Outputs;
  row limits 10 and 120) = 216 comparisons, all equal; the cap set (full map, free-only map, empty map) rotates per fixture. Guard, so failable by mutation: protected count off by one
  (`mutation-1-...`) and dropping the bucket comparison (`mutation-2-...`) both fail it.
- Red-first (behavioural): a stub that ignores the batch budget and the row limit fails three tests (`red-stub-ignores-budgets.log`),
  the real implementation passes them.
- Lock taken part-way through ONE pass (spec scenario): a test `DbContext` takes the shared advisory lock right after the first batch
  transaction completes; asserts `LockHeld(d, Some(cursor))` with the real `d`, batch 1 equal to the oracle, the rest untouched, and
  that a retry from the cursor does not re-thin a fresh pair inserted into a batch-1 Output. Red: mutating the branch to
  `LockHeld(0, startAfter)` fails it (`red-mid-pass-lock-mutation.log`, `green-mid-pass-lock.log`).
- `RetentionLockGuardSpec` REVERSE keeps its fixture and adds the NOWAIT precondition (asserts SQLSTATE 55P03 from a separate
  session); mutation (i) a waiting trim lock fails the test, mutation (ii) the batch's age DELETE committed in its own
  transaction fails the precondition (`mutation-d10-*.log`).
- Later `now`: a pass of a multi-pass cycle uses its own later `now` for the Outputs it covers; per Output the result is identical
  to a one-shot thin at that later time (every window is per Output), so a drain is equivalent to a one-shot at the `now` of each
  Output's pass. The scale diffs above pin `now` across passes so the comparison is exact.

## 13. Script vs code SQL (task 2.1)

There is no SQL copy of the batched thin to drift: the Scala driver executes `HistoryThinBatching` itself, so the "textual diff" is
vacuous by construction. The old statements appear twice: verbatim in `OldSingleStatementThin` (the oracle used for every survivor
diff and for the committed old drains) and as literal-substituted text in `history-retention-batched-measure.sql` (the rolled-back
old-tick timings and plans); the two are equivalent but **not** textually identical (bind parameters vs literals).

## 14. Evidence index (`evidence/`)

`io-probe.log`, `refusal-test.log`, `migrate.log`, `seed-S*.log` / `vacuum-S*.log` / `report-S*.log`,
`old-<S>-<profile>.log` (+ `.tempfiles.log`), `dry-<S>-<profile>-R<rows>.log` (+ `.server.log` with every plan),
`drain-old-*`, `drain-new-M1-*`, `drain-new-M<k>-*`, `drain-<S>-<profile>.serverlog.txt`, `survivor-diff-*.log`, `v120-insertpath-*.log`,
`d9-seed.log`, `dry-D9-*`, `dry-S1-desktop-{novm,vm}.log`, `vm-state-S1-*.txt`, `pass-window-analysis.{py,txt}`, `red-*`, `mutation-*`, `green-*` (incl. `red-mid-pass-lock-mutation.log`),
`experiment-ctid-delete/`, `clonediff-S2-prod-io-base.first-attempt-oom.out`, `old-S3-prod-io-strict-direct.ABORTED.txt`.
Reproduce with `backend/scripts/perf/hel1435-container.sh`, `history-retention-batched-measure.sql`, `hel1435-d9-single-output.sql`
and `HistoryThinMeasure` (modes `migrate`, `dry-new`, `drain-new`, `drain-old`).

## 15. Teardown

Done after the last measurement, by exact name (`evidence/teardown.log`): `docker rm -f hel1435-pg`; `docker volume rm hel1435-pgdata
hel1435-probe` (the volume held the scratch database `helio_hel1435_scratch`; the clones `hel1435_old`, `hel1435_new1`, `hel1435_newb`
had already been dropped by `DROP DATABASE`, listing taken before removal shows only `helio_hel1435_scratch`, `postgres` and the two
templates). Afterwards zero `hel1435` containers and zero `hel1435` volumes remain; the other containers on the machine
(`searxng`) were never touched; the `postgres:16` image was already present and is left. No scratch files were written outside the
worktree and the session scratchpad.
