## Skeptic Report - design gate (round 2, skeptic-design-1.md)

(next-report-number.sh returned number=1; no earlier skeptic-design file exists in the change dir, so no overwrite.)

### What I verified (with evidence)
- Read ticket.md, proposal.md, design.md, tasks.md. No placeholders/TBDs; proposal, design and tasks agree (two exact-path rules, #773 rules untouched).
- Ground truth on .gitignore: lines 3-5 `.metals/ .bsp/ .bloop/` (any depth), 13-16 the four narrow #773 backend/project rules. `git check-ignore -v --no-index backend/project/.metals/x` -> line 3; `.../.bsp/x` -> line 16. Confirms the child-path technique and the design's coverage claims.
- `git ls-files backend/project` lists exactly the five files the design names; `check-ignore --no-index backend/project/plugins.sbt` prints nothing (exit 1), so the rejection of a `*.sbt` wildcard is accurately reasoned.
- ci.yml:213 `printf '%s\n' -Xmx3g > .jvmopts` (run from backend) confirmed; nothing ignores it.
- Main checkout backend/project (read-only ls) contains .bloop, project, target, metals.sbt as claimed; `.bsp/.metals` absent as claimed.
- Every AC maps to a task: ignore jvmopts/metals.sbt (2.1, 3.2), tracked files remain (3.3, 3.2), red-to-green (1.1, 3.1), only-.gitignore (2.1), owner's file never touched (planted files only in worktree, exact-path rm in 3.4). No scope drift; ci.yml untouched.
- Worktree has only the untracked change dir; no source edits yet, as expected pre-execution.

### Verdict: CONFIRM

### Non-blocking notes
- Task 1.1/3.1 should note that the worktree's planted backend/project/metals.sbt is distinct from the main checkout's; the plan already says so.
- Evidence saved by tasks should be persisted via persist-evidence.sh by the executor.
