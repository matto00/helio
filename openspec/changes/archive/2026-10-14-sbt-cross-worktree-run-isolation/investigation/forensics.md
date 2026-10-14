# Step 0 forensics (read-only)

Sources: `/home/matt/Development/helio/.concertino/runs/HEL-1446/events.jsonl`, `.../HEL-1451/events.jsonl`, and
`.../HEL-1446/evidence/openspec/changes/widen-scala-fqn-guard/skeptic-final-1.md` (local time, 2026-10-14).

| time | HEL-1446 | HEL-1451 |
|---|---|---|
| 04:52:12 | final skeptic spawned | run.start 04:52:56, Planning |
| 04:58:38 | final skeptic still running | Execution starts (executor runs gates incl. sbt) |
| 05:05:54 | | `gate.result server:backend pass` (start-servers.sh -> detached `sbt run`, port from its own env) |
| 05:14:21 | | Evaluation phase (evaluator runs sbt) |
| 05:18:27 | final skeptic CONFIRM (window 04:52:12-05:18:27, ~26 min) | server:backend re-started again 05:39:51 |

Verified from the logs: the HEL-1446 final skeptic's window (04:52-05:18) overlaps HEL-1451's Execution phase and
the Evaluation phase start, and HEL-1451 had a detached `sbt run` backend live from 05:05:54 until its Delivery
phase. So at least one other-tree sbt JVM was live (and the executor/evaluator of that lane were running `testFull`
and `sbt run`) during the skeptic's first run. The report gives no timestamp for the bad run, so which of those was
concurrent is not recorded. The skeptic report says both its runs printed `cache 100%, 644 disk cache hits`, so that
line is the ordinary compile-cache line and is not the discriminator; the tell was the `loading project definition`
/ `set current project` / warning-path lines naming HEL-1451. The bad run's cwd was confirmed via /proc as
HEL-1446/backend and it passed 8079/0.

Chosen B-side model for step 3: HEL-1451's `server:backend` gate shows a detached `sbt run`
(`.concertino.env:15` `CONCERTINO_BACKEND_START`, `start-servers.sh` nohup/setsid), so step 3 models exactly that
(plus `sbt --server` separately).
