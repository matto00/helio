## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio
  branch=task/move-health-routes-to-root/HEL-811`. Proceeded.
- **Full fresh read of all four planning artifacts** (ticket.md, proposal.md, design.md, tasks.md)
  plus round-1's skeptic-design-1.md (as a claim to verify, not fact).
- **Round-1's required revision is now present in the plan text.** Round-1 REFUTEd because
  `api/routes/README.md`'s line-12 summary sentence ("No other file lives directly in
  `api/routes/` — every route class belongs under one of the 13 domain subdirectories") would
  become self-contradictory once `HealthRoutes` (a route class) moves to root, and neither
  design.md nor tasks.md instructed fixing it.
  - **design.md D3** (lines 42–55) now quotes that exact sentence, explains precisely why it goes
    false once the move lands (`HealthRoutes` *is* a route class, mounted as `health.routes ~`),
    cites the round-1 REFUTE by name, and gives a concrete rewrite example that acknowledges
    `HealthRoutes` as the one route class exceptionally placed at root — this is a real, specific
    revision, not a restatement.
  - **tasks.md task 1.4** (line 6) now has two explicit sub-requirements: (a) add `HealthRoutes` as
    a second named-shared-file bullet, AND (b) "rewrite the pre-existing summary sentence ... so it
    no longer contradicts the new bullet ... it must acknowledge `HealthRoutes` as the one route
    class exceptionally placed at root", with a verification step requiring the implementer to
    re-read the file top-to-bottom and confirm no sentence asserts "every route class belongs under
    one of the 13 domain subdirectories" without qualification. This verification step is itself
    testable/falsifiable, not just an instruction.
  - I confirmed the live file still reads exactly as round-1 described (`api/routes/README.md:12`,
    read fresh): "No other file lives directly in `api/routes/` — every route class belongs under
    one of the 13 domain subdirectories." — matching the sentence both D3 and task 1.4 now target
    for rewrite. (This is pre-execution state, as expected — the fix is in the plan text, to be
    executed later; that matches this task's framing.)
  - **Verdict on the required revision**: fully addressed in both artifacts. Not merely re-worded
    to pass a string check — the instruction is specific (names the exact sentence, explains why it
    breaks, requires a real semantic fix, and has a checkable verification criterion).

- **Other premises re-verified fresh, independent of round 1's claims:**
  - `backend/src/main/scala/com/helio/api/routes/workspace/README.md` (read fresh): line 3 still
    contains the "plus `HealthRoutes` — a domain-agnostic `GET /health` check..." explanatory
    clause and line 5 still lists `HealthRoutes` in "Holds:" — task 1.5's instruction ("remove
    `HealthRoutes` from its 'Holds' list and adjust its explanatory sentence accordingly") covers
    both call sites in this file; no orphaned mention would survive if followed.
  - `ApiRoutes.scala` (read fresh): 13 sub-package wildcard imports exist (`agents._` through
    `workspace._`), no bare `com.helio.api.routes._`, and line 235 constructs
    `new HealthRoutes()` — matches design.md D2's premise and tasks.md 1.3's added import.
  - Subdirectory count under `api/routes/` (`find -maxdepth 1 -type d`, fresh count): exactly 13 —
    matches the "13 domain subdirectories" language both READMEs and design.md D3's proposed
    rewrite use. Not stale.
  - `api/routes/README.md`'s `ServiceResponse.scala` rationale (lines 4–10) is untouched by this
    change and doesn't conflict with the D3 rewrite plan.
  - Ticket.md's AC and design.md/tasks.md remain internally consistent: the ticket's AC language
    ("named-shared-files list") is satisfied either way per round-1's own non-blocking note, and
    nothing in the now-revised D3/1.4 contradicts the ticket's ruling or any other AC.
  - Scope, iron constraint (git mv + package + imports + READMEs only, no logic/signature changes),
    and verification plan (`sbt compile` at 1.3, full `sbt test` naming the two `/health` specs at
    2.1) are unchanged from round 1 and remain sound.

### Verdict: CONFIRM

### Non-blocking notes

- (Carried from round 1, still applicable, not blocking): ticket.md's AC phrase "the named-shared-
  files list that `api/routes/README.md` carries" is loose since the README is prose, not a
  formatted list — design.md D3's "second bullet in the same style" resolves the formatting
  question either way.
- (Carried from round 1, still applicable, not blocking): proposal.md's rationale mentioning
  `HealthResponse`'s "existing root placement in `api/protocols/`" is slightly imprecise
  (`HealthResponse` is a case class inside `ResourceProtocol.scala`, not its own file) — background
  rationale only, not re-litigable, no bearing on task correctness.
