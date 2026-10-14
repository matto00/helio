## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `e056f4708a5a52bb82c6d2ad5cd0a70c4d73cd90`. The change dir is untracked (planning artifacts only). No sbt or test suite was run.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/sbt-cache-cross-worktree-replay/HEL-1595`.
- **Round-1 change requests are addressed in the artifacts:**
  - CR1 (concurrent run): design D2 step 4 and task 1.6 now cover it. A's cold `testOnly` starts while B's run is in progress against the shared scratch cache, N=5, two JVMs, `nice -n 19`. Per repeat, the step records paths, the failing-test outcome and `target/out` symlink provenance. Task 3.1 requires the MISTAKES entry to list this step and its N. The spec has a matching scenario ("A concurrent run in tree B does not leak into tree A").
  - CR2 (ambiguous invocation): the spec scenario now names bare `sbt` and `sbt -batch -Dsbt.server.autostart=false`. `--client` is carved out into its own scenario ("proven isolated, or MISTAKES says never cite"). D2 step 3 (a/b/c) matches.
  - CR3 (forensics first): D2 step 0 and task 1.0 are unconditional and run first, and step 0's result orders steps 1–4.
  - Round-1 non-blocking notes are adopted. C1 makes "escalate if the cache cannot be relocated" a standing constraint, and the Risks line no longer reads as permission. C2 requires deletion only by exact recorded paths. D2 adds "freshly logged vs replayed" for each foreign path.
- **Forensic inputs for step 0 exist:** `/home/matt/Development/helio/.concertino/runs/HEL-1446/events.jsonl` and `.../HEL-1451/events.jsonl` are both present. HEL-1451's events include `gate.result server:backend pass`, so that lane ran `start-servers.sh`.
- **How another lane's sbt actually runs:** `scripts/concertino/.concertino.env:15` sets `CONCERTINO_BACKEND_START='PORT=$BACKEND_PORT CORS_ALLOWED_ORIGINS=http://localhost:$DEV_PORT sbt run'`. `start-servers.sh:198` launches it as a `nohup ... & disown` from `backend/`. A concurrent lane's long-lived sbt is therefore an interactive-mode `sbt run`, which autostarts a server. It is not an `sbt --server`.
- **Tree B's feasibility as designed (DEFECT):** D1 makes tree B "a copy of the same `backend/`" placed under the scratchpad. Ground truth: backend tests read sibling top-level directories through relative `../` paths. `grep -rhoE '"\.\./[a-zA-Z_.-]+' backend/src` finds 15× `"../shared-test-fixtures`, 4× `"../schemas`, 1× `"../docs` and 1× `"../..` across 18 files. Examples:
  - `backend/src/test/scala/com/helio/api/routes/pipelines/DurationFormatSeamSpec.scala:55-57` (`../schemas/...`)
  - `backend/src/test/scala/com/helio/infrastructure/persistence/V119OwnerFkMigrationSpec.scala:160` (`../docs/user-reference-inventory.md`)
  - `backend/src/test/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemasSpec.scala:402`
  - the `*SeamSpec.scala` files reading `../shared-test-fixtures`

  The forked tests run with `workingDirectory = Test / baseDirectory` (build.sbt:226), so in a backend-only copy these specs cannot find their inputs. Tree B's `testFull` then cannot be green. That breaks D2 step 1's precondition ("B (all green) runs ... `testFull`") and spec scenario 1 ("tree B ... runs `sbt testFull` green").

### Verdict: REFUTE

The round-1 revisions are correct and complete. One new, concrete feasibility defect remains in D1, and the red-first proof depends on it: a backend-only scratch copy cannot run the full suite green. A second, smaller gap sits in the same "match the observed condition" family as round-1 CR1. The fix for both is a few lines of artifact text.

### Change Requests

1. **Tree B must be a full-repo copy (or include every sibling the backend tests read). Files: design.md D1, tasks.md 1.2.**
   - Change D1's "a copy of the same `backend/`" so tree B mirrors the repo layout: the repo root, with at least `backend/`, `shared-test-fixtures/`, `schemas/` and `docs/` at the same relative positions. Keep the existing exclusions (`target/`, `project/target/`, `.ivy2/`, `.bsp/`, `node_modules`), and also exclude `.git` or treat it as irrelevant.
   - Add an acceptance signal to task 1.2: B's own `testFull` (or, at minimum, the parent-path-reading specs) passes green in B before step 1 runs. A red B makes "A fails after B ran green" meaningless.
   - Also note that tree B's `backend/.env` comes along with the copy and must never be printed (D5 already says this; restate it for the copy).
2. **Model the foreign server the way a lane actually runs it. Files: design.md D2 step 3, tasks.md 1.5.**
   - The real concurrent process in another lane is a detached `sbt run` (`.concertino.env:15`, `start-servers.sh:198`), and HEL-1451 had started its backend in this window (its `server:backend` gate event).
   - Step 3 currently starts B only with `sbt --server`. Add, or substitute, a B-side `sbt run` launched the same way (in the background, from B's `backend/`, with a recorded PID and a free port, not 8080 or another lane's port), and run A's invocations (a)/(b)/(c) against it.
   - Stop it via `sbt --client shutdown` from B's dir plus the recorded PID only. Never pkill, and never signal HEL-1451's processes.
   - If step 0's forensics shows HEL-1451 was running something else in the window, model that instead, and record which one was chosen and why.

### Non-blocking notes

- sbt's server socket for B will land under `~/.sbt/1.0/server/<hash>/` (two stale dirs already exist there). That is ordinary sbt use, the same as every lane, and not a config change. Still, the executor should state it in investigation/README.md, and must not clean that directory up afterwards (owner rule).
- Step 1 says B runs `testOnly` then `testFull`, while the D2 closing paragraph says full `testFull` runs are only for the final proof. That is a mild tension. Allowing one `testFull` in B (the green precondition) and one in A (the red proof) is consistent with the spec's scenario 1. Just keep it serial.
- Step 3 records "which server A's client connects to" via `project/target/active.json`. In a full-repo copy each tree has its own `project/target`. That is fine, but it also means a foreign attach would have to come through a path other than active.json (for example, a shared socket hash). Record the socket URI from both trees' active.json.
