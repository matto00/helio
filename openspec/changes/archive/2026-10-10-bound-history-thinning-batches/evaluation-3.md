## Evaluation Report — Cycle 3 (evaluation-3.md)

**Commit reviewed:** `22fe13bb78e7838cfe7e8a3ebe217b710025e871`, on top of `fec25bed5` and `4881d8e40`.

**Review base:** resolved live to `df5c941e658d5dcb63656a671437bc037f29b3ed`. That is the current `origin/main`, and HEAD contains it.

### Gates

The cycle-3 diff touches no backend files: `git diff --name-only fec25bed5 HEAD` lists 0 files under `backend/`. It changes only:

- CLAUDE.md
- measurements.md
- files-modified.md
- `evaluation-2.md`, now tracked
- `evidence/pass-window-analysis.{py,txt}`

The code is therefore byte-identical to `fec25bed5`, which I gated fresh in cycle 2. That run was `nice -n 19 sbt -J-Xmx3g testFull`: 6655 succeeded, 0 failed, no `TESTS FAILED` or `*** FAILED`. On this commit I re-ran the gates the changed files can affect:

- Prettier on CLAUDE.md and the change's markdown: clean
- `check:openspec`: clean

### Cycle-2 change request: status

**Request:** replace the derived pass-stall figures with the measured worst cases. **Done, and verified independently.**

- **The script reproduces.** I ran `python3 -I evidence/pass-window-analysis.py` and diffed its output against the committed `pass-window-analysis.txt`. They are identical.
- **The script is correct.**
  - It parses every `@@PASS ... ms=` line of the `drain-new-M1-*-R25000.log` files.
  - "Worst aligned" sums batches `[0..20), [20..40), ...`, which are the passes the default actually forms.
  - "Worst any" is a sliding window of 20 consecutive batches.
- **The numbers match my cycle-2 computation:**
  - S4 prod-io-base: worst aligned 91.6 s, worst any 96.7 s.
  - S4 desktop: 18.4 s.
  - S2 prod-io-base: 5.6 s.
- **The "old single tick" constants match the committed `drain-old-*-R25000.log` values:**

  | Scenario / profile | Committed value | Constant used |
  |---|---|---|
  | S2 desktop | 10948.9 ms | 10.9 s |
  | S2 prod-io-base | 29079.3 ms | 29.1 s |
  | S3 desktop | 16364.3 ms | 16.4 s |
  | S3 prod-io-base | 32729.2 ms | 32.7 s |
  | S4 desktop | 81457.5 ms | 81.5 s |
  | S4 prod-io-base | 109627.0 ms | 109.6 s |

- **The prose now matches the evidence.**
  - measurements.md section 10 states the ratio honestly: 0.88 of the old tick on S4 prod-io-base, with a thin margin.
  - It labels averages as averages, and says that M=60 would have exceeded the old tick.
  - It says these figures do not hold under the cold strict-IO model.
  - The CLAUDE.md row now says "worst measured 20-batch pass is 5.6 s at steady state ... and 96.7 s on the deep-backlog scenario, i.e. 88% of the old 109.6 s single tick". That is accurate.

### Phase 1: Spec Review — PASS

- **Acceptance criteria 1–4:** met, as covered in cycles 1–2.
  - The bounded thin uses rank-once SQL.
  - Plans, timings, and temp usage are recorded before and after.
  - Bounded catch-up is proven in the scratch DB.
  - The prod-class proxy is justified, with sensitivity brackets.
  - Raw logs and EXPLAIN runs are committed.
  - The payload "unreferenced" DELETE is noted.
- **Spec scenarios:** every one is covered, including the scenario where the lock is held part-way through a pass.
- **Tasks:** they match the implementation.
- **Planning artifacts:** they match the final behaviour.
- **Constraints C1–C5:** honored.
- **D5 deviation:** disclosed, with a correct rationale. The batch-row default trades off transaction length; the batches-per-pass default trades off scheduler-tick stall, which is now quantified from the measurements.

### Phase 2: Code Review — PASS

There is no code change since cycle 2, and cycle 2 found no remaining code issues. The added analysis script is evidence tooling: read-only, and it touches only files under `evidence/`.

### Phase 3: UI Review — N/A

This is a backend-only change.

### Overall: PASS

### Non-blocking Suggestions

- **Pass-wall-clock follow-up.** measurements.md section 10 notes that a per-pass wall-clock budget, or running the thin off the scheduler tick, would bound the stall independently of the shape of the data. The deep-backlog margin is only 0.88 of the old tick, and the cold strict-IO model stalls for minutes even at M=1. That makes it worth a follow-up ticket.
- **Unverifiable aside.** In section 10, "the first clone of each pair was the colder run" is not supported by any cited log. Cite a log for it or drop it. No figure depends on it.
