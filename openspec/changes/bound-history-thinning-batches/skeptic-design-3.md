## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 22f4c1fd326b491337a91e46131fb573cc99774d. The planning artifacts are untracked in the change dir.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/bounded-history-thinning-batches/HEL-1435`.
This was a read-only review: no database, no sbt, no `.env`.

### What I verified (with evidence)

**Round-2 change requests:**

- **CR1 (bound the batch DELETE's target scan): resolved for thin batches.**
  - D1 now puts `output_id = ANY($batch)` on both the DELETE target and the innermost ranking scan.
  - D7 and task 3.1a add plan acceptance: no `Seq Scan on output_snapshot_history` in any batch plan, on S2 and S4,
    in both profiles.
  - Not included: the "rows read per batch ≤ ~R + batch rows" check from round 2. The Seq Scan check covers most of
    that risk, so I am not requiring it.
  - Ground truth for the risk this fixes: the HEL-1284 plan has a Hash Semi Join over a full Seq Scan of the target
    (`evidence/S2-after-v120-pg16-proxy.txt`, thin statement).
- **CR2 (unbounded age purge under a backlog): partly resolved.**
  - D8a adds free and beta Outputs whose backlog runs past their tier caps, and records per-chunk rows, duration,
    WAL and chunk count.
  - D4 now chunks the age purge.
  - The chunking bounds the rows each age transaction **deletes**, but not what it **reads**. See new CR 1.
- **Round-2 notes:**
  - N1 resolved: D4 says the latency is stated in measurements.md.
  - N2 resolved: D10 has the NOWAIT precondition, the old-fixture-trips-it proof, and the newest-first scan order.
  - N3 resolved: the D6(a) mutation is now killable (protected count 100, or `>=`), and the near-equivalent mutant is
    explicitly excluded.
  - N4 resolved: `now` is pinned in D7/3.3.
  - N5 resolved: the payload purge runs on every pass, and the last batch returns `resumeAfter = None`.

**D2 (rank once) re-derived independently: correct.**
- Within an Output ordered by `captured_at DESC, id DESC`, `age_class` never decreases, and `floor(epoch/bucket)`
  never increases within a class. Rows tied on `captured_at` share both values. So each `(class, bucket)` group is
  a contiguous run.
- The old `rn = 1` over unprotected rows is the first unprotected row of its run. That is exactly "the immediately
  newer row is protected, or in a different group". The `lag` form is equivalent.

**Is the chunked age phase ordering claim correct? Yes, with one unenforced invariant.**
- Every row of an Output carries that Output's `pipeline_id`. Nothing in `backend/src/main` updates
  `outputs.pipeline_id`, and V115 gives the history column no FK. So all of an Output's rows share one tier and one
  cutoff, and its over-age rows form a suffix of its `captured_at DESC, id DESC` order (ties share status).
- Deleting a suffix leaves `recency` unchanged for every remaining row. It also cannot change which row heads a
  `(class, bucket)` run among the rows that are not over-age, because over-age rows are older than every member of
  such a run.
- **Protected newest 101.** If over-age rows sit inside the newest 101 (an Output with fewer than 101 rows that are
  not over-age), they are protected from the thin but deleted by the age purge in either order. The final state is
  the same. Example: 120 points, the oldest 30 over-age:
  - age first: 90 survive, all protected, and the thin deletes nothing;
  - thin first: the 19 oldest are thinned, then the age purge removes all 30, and the same 90 survive.
- **"Exactly the same set" holds only per reference time.** A chunk loop that crosses a pass boundary re-evaluates
  `cutoff = now − cap` with the later pass's `now`. The deleted set is then the unbounded purge's set at the `now`
  of the pass that finishes that tier, a superset of the first pass's set.
  - That is benign: it is the same behaviour as an unbounded purge at the later time.
  - But it is not "repeat-until-empty of the same predicate", and the spec says only "exactly the points the
    unbounded age purge would", without saying at which time. See note N1.

**Is each age chunk bounded in reads on PG16 with V120's captured_at index? No.**
- HEL-1284's PG16-proxy plan for the free age purge (`evidence/S2-after-v120-pg16-proxy.txt`, stmt seq=11):
  - `Index Scan using idx_output_snapshot_history_captured_at ... (captured_at < cutoff) rows=316648`;
  - then a Hash Join to pipelines and users, `rows=297`.
- Every beta and owner row older than 30 days is read to find 297 free rows, because the tier is joined after the
  scan. `measurements.md:123,380` names this as the free-tier residue, and the proposal defers fixing it.
- Adding `LIMIT L` to the subquery does not change what a chunk must scan to find its L matching rows.
- In an ascending `captured_at` scan, the other tiers' older rows come before or among the free rows past the cap.
  So **every** chunk reads at least that residue, plus the dead index entries left by earlier chunks, and the final
  chunk (fewer than L deleted) always reads the full residue.
- Under S4's deep backlog the residue is not the thinned steady-state ~317k rows. The age phase runs before any thin
  in the cycle, so the residue includes every **un-thinned** dense beta and owner row older than 30 days.
  Illustration: 200 non-free Outputs × 25 days × 288 points ≈ 1.4M rows read per free chunk.
- The phase as a whole then reads (number of chunks) × residue. That is more than today's single unbounded statement,
  which reads the residue once.
- The target side is also unchecked. `DELETE ... WHERE id IN (SELECT h.id ... LIMIT L)` has no index-usable
  predicate on the target. With L = R in the tens of thousands, PG16 can choose the same Hash Semi Join over a
  `Seq Scan on output_snapshot_history` target that round-2 CR1 fixed for thin batches.
- Task 3.1a's plan acceptance and D8a's metrics (rows, duration, WAL) cover neither reads nor plan shape for age
  chunks.

**Spec delta vs the living spec:**
- Both MODIFIED requirement headers match `openspec/specs/output-history-retention/spec.md:9,70` exactly.
- The ADDED next-due precedence matches D4.

### Verdict: REFUTE

### Change Requests

1. **The chunked age phase bounds deletes per transaction but not reads, and each chunk re-reads the cross-tier
   residue (design.md D4 "Age phase, chunked", D8a; spec delta ADDED "Thinning runs in bounded batches"; tasks 1.2,
   3.1a).**
   - **The defect.**
     - Each chunk's subquery scans `idx_output_snapshot_history_captured_at` over every row of every tier older than
       that tier's cutoff before it finds L matching rows.
     - Under a backlog, that residue is the un-thinned other-tier history, so it grows with backlog depth. The
       work in one age transaction is therefore not independent of backlog, which is the AC's "without a single
       huge transaction" concern restated as duration and lock hold.
     - The total residue reads are multiplied by the chunk count.
     - Separately, the target `id IN (... LIMIT L)` may Seq Scan the table each chunk.
   - **Required.** Pick one of these and make it the design:
     - **(a) Fold the age purge into each per-Output thin batch.** In the batch transaction, before the thin, run
       `DELETE ... WHERE output_id = ANY($batch) AND captured_at < <that Output's tier cutoff>`. Resolve the tier
       per Output from `outputs` → `pipelines.owner_id` → `users.tier` (strictest cap for an unnamed tier).
       - This is today's per-Output order: age, then thin, in one transaction.
       - It is bounded by the `(output_id, captured_at DESC)` index and by the batch's admitted rows.
       - It removes the separate age phase and its cursor state.
       - It also removes the free-tier residue as a side effect.
       - The admission count (D1) must then count over-age rows too. The per-Output floor (D9) applies the same
         way.
     - **(b) Keep a separate age phase, but drive each chunk by Output** (keyset over `outputs` of the tier, then
       the `(output_id, captured_at)` index), so it does not depend on a captured_at range that spans tiers.
   - **Either way:**
     - Put `output_id = ANY(...)` (or an equivalent index-usable predicate) on the DELETE target.
     - Extend task 3.1a's plan acceptance to every age statement: no `Seq Scan on output_snapshot_history`, and rows
       read per age transaction at most about L plus the batch's rows, recorded on S2 and S4 in both profiles.
     - Extend D6(b)/3.2 so the age-deleted set is diffed against the unbounded age purge at the same pinned `now`
       (`EXCEPT` both ways = 0).
   - **The other option:** if the executor keeps the current tier-scan chunks, D8a/3.1a must record rows read per
     chunk and the target plan per chunk. The design must also state the read bound actually achieved ("reads ≥ the
     other tiers' rows past the cutoff, per chunk") in Goals and measurements.md as a residual. That is a weaker
     outcome than the AC asks for, so per round 2 it should be raised for an owner ruling, not self-approved.

### Non-blocking notes

- **N1. Reference time for the age purge.** State in D4 and in the spec's ADDED requirement that the age phase
  deletes exactly the unbounded age purge's set at the reference `now` of the pass that completes it (or each tier).
  The current wording, "repeat-until-empty of the same predicate", is not literally true across passes, because the
  cutoff moves. Say whether the "age phase" cursor records which tier it is on, or restarts from the first tier.
  Both are correct. Restarting re-pays one final chunk per completed tier. (Moot under CR 1(a).)
- **N2. An invariant the ordering argument relies on.** "Over-age points are each Output's oldest" relies on every
  history row of an Output carrying the same `pipeline_id`. The schema does not enforce this: V115 gives
  `output_snapshot_history.pipeline_id` no FK, and no code moves Outputs between pipelines. State it in D4 as an
  assumed invariant, so a future "move Output" feature knows it breaks this.
- **N3.** Spec scenario "Run trim while the real thin and age deletes hold rows" still names age deletes in its title,
  but its body now describes only a thin batch. Retitle it, or drop "age".
- **N4.** Precedence step (3) says "thin budget exhausted with Outputs remaining". Make it say explicitly that an
  age phase exhausted part-way also counts (both D4 and the spec). Moot under CR 1(a).
