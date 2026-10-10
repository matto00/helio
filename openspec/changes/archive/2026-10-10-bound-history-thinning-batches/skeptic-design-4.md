## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 22f4c1fd326b491337a91e46131fb573cc99774d. The planning artifacts are untracked in the change dir.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/bounded-history-thinning-batches/HEL-1435`.
This was a read-only review: no database, no sbt, no `.env`.

### What I verified (with evidence)

**Prior change requests, checked against the current artifact text:**

- **R1 CR1 (row-bounded batches, deep backlog, single-Output residual, Goals wording): resolved.**
  - D1 adds row-budget admission using a bounded index-only count.
  - S4 is the deep-backlog scenario (≥30× steady state).
  - D9 quantifies the single-Output residual.
  - The Goals line now states the bound actually achieved.
- **R1 CR2 (next-due precedence): resolved.** D4 gives the precedence (1)–(4). The spec delta's ADDED requirement
  states the same order. Scenarios cover two cases: budget exhausted plus a payload failure, and budget exhausted
  plus a payload busy.
- **R1 CR3 (HEL-1343 requirement MODIFIED): resolved.** The delta redefines the two parts (history batches,
  payload purge). It also scopes "untouched" with "thin batches already committed earlier in the pass stay
  committed".
- **R1 CR4 (REVERSE re-point): addressed in D10, but the round-3 fold-in made D10 stale.** See CR 1 below.
- **R1 CR5 (survivor capture across a rollback): resolved.** D6(b) now uses committed `hel1435_*` tables or
  TEMPLATE clones.
- **R2 CR1 (DELETE target bounded): resolved.** D1 puts `output_id = ANY($batch)` on both the target and the
  ranking scan. The plan acceptance is in D1/D7/3.1a.
- **R2 CR2 and R3 CR1 (age purge unbounded, then unbounded in reads): resolved by option (a).**
  - D4 now says "Age purge folded into each batch (no separate age phase)".
  - Its DELETE carries `h.output_id = ANY($batch)`, so the `(output_id, captured_at DESC)` index
    (`V115__output_snapshot_history.sql:35`) bounds the reads to the batch's rows.
  - D1 admission counts over-age rows.
  - D8a extends the plan acceptance to the age DELETE: no `Seq Scan on output_snapshot_history`, and rows read are
    at most the batch's rows.
  - D8a also records the age-deleted set diffed at a pinned `now`.
  - Proposal, tasks 1.2 and Planner Notes are consistent with this.
  - A grep for `age phase|chunk|cycle start|repeat-until|age-purge transaction` finds only the "(no separate age
    phase)" disclaimer. No chunked-phase remnants are left in the proposal, tasks or spec.
- **Round-3 notes:**
  - N1 and N4 are moot under option (a).
  - N2 is resolved: the invariant is stated in D4, but see the note below.
  - N3: the scenario body now reads "age or thin deletes". Under the fold-in that is accurate again, so the title
    is fine.

**CASE-cutoff age DELETE vs today's statements (`OutputHistoryRepository.scala:125-143`).** I checked
equivalence in each case:

- **Named tier T.** Today the statement is `u.tier = T AND captured_at < now − cap(T)`. In the CASE, arm T
  returns the same cutoff, so the two are equivalent.
- **Tier absent from the map, including one unknown to the code.** Today the statement is
  `u.tier <> ALL(named) AND captured_at < now − min(caps)`. The CASE ELSE arm returns the strictest cutoff, so the
  two are equivalent.
  - When the map names all three tiers, today's unnamed statement matches no row, and the ELSE arm is reachable
    only for an unknown tier. Same result.
- **NULL tier.** This is the one place the two forms could diverge. Today's `= T` and `<> ALL` are both NULL, so
  nothing is deleted, while `CASE NULL ... ELSE` would apply the strictest cutoff.
  - It is unreachable: `V88__user_tier.sql:13` declares `tier TEXT NOT NULL DEFAULT 'free' CHECK (...)`, and no
    later migration alters it.
  - The existing "unknown tier" spec drops only the CHECK constraint, not NOT NULL.
- **Empty map.** "Empty map ⇒ no age DELETE" matches today, where `named` is empty and `strictest` is None.
- **Joins.** These are the same inner joins on `h.pipeline_id → pipelines → users`. A row with no joinable owner is
  never age-deleted in either form.
- **Existing guards.** `OutputHistoryRepositorySpec.scala:198-270` already covers four cases: named caps, an absent
  tier at the strictest cap, the shortest of several caps, and an unknown tier (`pro`, CHECK dropped). It also
  covers the pipeline-owner tier and the empty map (`noAgeLimit`). Task 1.2 requires these to pass, which makes
  them a real red guard for the CASE rewrite.

**Per-batch age-then-thin is exact.**
- The age predicate depends only on the row itself (its own `pipeline_id` and `captured_at`).
- Every thin window is `PARTITION BY output_id`.
- So running age-then-thin restricted to a set of whole Outputs at the same `now` is the global age-then-thin
  restricted to those Outputs.

**Read bound on PG16.**
- `output_id = ANY($array)` is an index condition on `idx_output_snapshot_history_output_captured`. The CASE
  cutoff depends on `u.tier`, so it can only be a filter or join qual. Neither the `captured_at` index (V120) nor
  any `pipeline_id` index (V115 has none) gives the planner a cheaper unbounded path.
- The expected plan therefore reads the batch's rows through the output index. D8a/3.1a will confirm or refute this
  by measurement.

**Spec delta vs the living spec.**
- Both MODIFIED headers match `openspec/specs/output-history-retention/spec.md:9,70`, with all 5 and all 6
  scenarios carried over.
- The other requirements are unaffected: failures never fail the tick, privileged pool, env config.
- `node-payload-history/spec.md:56-58` ("while the retention pass is running") stays true per batch.

**D10 against the actual test (`RetentionLockGuardSpec.scala:235-280`).**
- In the REVERSE fixture, the two P_old-linked over-age points and X/Y all belong to the **same Output** (`oid`).

### Verdict: REFUTE

### Change Requests

1. **D10's premise is false after the fold-in, and its mandated non-vacuity proof cannot be produced (design.md
   D10; tasks 4.5).**
   - **D10 now contradicts D4.**
     - D10 says: "REVERSE parks retention after its age deletes in the SAME transaction; after D3 they commit first,
       so the test would pass vacuously."
     - Under the current D4, each batch transaction runs the age DELETE and then the thin over the same Outputs.
     - In the existing fixture, the P_old-linked over-age points and X are in one Output, so they are in one batch.
     - The age DELETE therefore row-locks the P_old-linked points in the very transaction that then parks on X.
     - The existing test is **not** vacuous under the new design.
   - **The proof D10 mandates now fails.** D10 requires recording "that the NOWAIT precondition fails when the
     fixture is reverted to the old shape (P_old-linked points only age-eligible) — that is the non-vacuity proof".
     Under the fold-in those points **are** row-locked when the batch parks, so the `FOR UPDATE NOWAIT` precondition
     passes on the old fixture. An executor following D10 hits a mandated proof that cannot be produced, or produces
     a misleading one.
   - **Required.** Rewrite D10 and task 4.5 to match D4, and update the spec scenario text if the fixture changes.
     - Keep the NOWAIT precondition, asserted from a separate session before the write. This time it must hold for
       whichever P_old-linked points the batch has deleted, age or thin.
     - Keep the recorded mutation (trim takes a waiting lock instead of a try-lock).
     - Replace the impossible "old fixture trips the precondition" proof with one that can actually fail. One
       option: move the P_old-linked points to a **different Output** admitted in a later batch (batch size 1). The
       precondition must then fail, which shows it detects a cross-batch fixture.
     - Decide whether to keep the age-linked fixture (now valid again) or the thin-linked one. Either is fine, but
       state which, and drop the stale "commit first" rationale.

2. **The scale equivalence proof still assumes a separate age phase, and the age-set diff is not mechanically
   defined (design.md D6(b), D8a; tasks 3.1a, 3.2).**
   - **D6(b) runs the old shape.** It reads "after the age purges are committed, materialise ... then run the
     batched thin". That is today's shape: an age step, then the thin. The new code has no separate age step. On
     pre-aged data, every per-batch age DELETE is a no-op, so the S1–S4 diff never exercises the folded path.
   - **D8a's diff has no defined capture.** D8a diffs "the age-deleted set" on S4 at a pinned `now`. The age and
     thin DELETEs now share one transaction per batch, and D8a never says how the implementation's age-deleted ids
     are separated from its thin-deleted ids. In the Scala code the two are just a summed count.
   - **S4 needs two seeds.** It must be pre-aged for D6(b) and un-aged for D8a, and neither section says so.
   - **Required.** Make the scale proof end-to-end on **un-aged** seeds, at least S3 and S4, plus S2.
     - Expected survivors = all ids − (today's age statements' victims ∪ today's thin victims evaluated after
       those age deletes), at the pinned `now`. Use committed `hel1435_*` tables or the TEMPLATE-clone alternative:
       run today's full `thinAndPurge` SQL on clone A and the batched implementation on clone B.
     - Diff the actual survivors with `EXCEPT` both ways = 0.
     - Per-batch age reads, rows and WAL stay as D8a's measurements. If an age-only diff is still wanted, specify
       how it is captured, e.g. a DELETE … RETURNING in the scratch script, textually diffed against the Scala SQL.
     - Update tasks 3.1a and 3.2 to match.

### Non-blocking notes

- **N1. The invariant is stronger than the equivalence needs.** D4 says equivalence "rests on the invariant that all
  of an Output's history rows share one `pipeline_id`". Under option (a) it does not. The age predicate is per-row
  (each row's own `pipeline_id`), and the thin is per-Output, so per-batch age-then-thin is exact without that
  invariant. Keeping the scaladoc note is harmless. Do not let the executor spend fixture effort "asserting" it as if
  it were load-bearing.
- **N2. Spec wording.** The ADDED requirement says the per-batch age purge "deletes, at the pass's reference time,
  exactly the points the unbounded purge would". Add "for that batch's Outputs", so it is not read as one batch
  deleting the whole table's over-age set.
- **N3. Existing `thinAndPurge` specs and the shared table.** `OutputHistoryRepositorySpec` clears only
  `output_snapshot_history`. `outputs` keeps accumulating across tests, so a keyset pass with a small default
  budget may not reach a test's Output in one call. Adapted tests should run passes to `resumeAfter = None` (or pass
  a large budget), so a result is never missed because of budget.
- **N4. Per-batch joins.** The batch age DELETE's `USING pipelines p, users u` may hash-join seq-scanned
  `pipelines` and `users` on every batch. That is cheap at current sizes, but it is M scans per pass. Record it in
  the D8a plan dumps rather than assuming it away.
