## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/agent-surface-credential-gate/spec.md`,
  and `skeptic-design-1.md` in full.
- Re-derived every round-1 CR premise from the SHIPPED script, not from the round-1 report:
  - CR1: `scripts/check-no-credential-in-agent-surface.mjs` header "Other known residual limits" lists exactly
    three unrelated items (exact-word `credential`, relative-only import extraction, entropy-gated secret check);
    the entry-guard comment ends "so it's fixed rather than left as a documented residual limit". Confirmed the
    round-1 premise. Task 1.6 now says ADD header notes and CORRECT that comment, leaving the three intact;
    proposal.md — Why now states the residuals were recorded on the ticket, not the header. Genuinely fixed.
  - CR2: `collectFiles` still has `try { readdirSync } catch { return out; }` — real fourth silent-drop path.
    Design Decision 0 closes it in-change, task 1.4 implements it, spec adds the "A directory cannot be listed"
    scenario, 3.1 mutation-verifies it. Addressed, not deferred.
  - CR3: verified in `main()` that the vacuity check `process.exit(1)`s before `allErrors` is printed, so
    subtracting unreadable files from `surfaceRecords[].files` would indeed have masked read errors. Decision 1a
    now names the exact array filtered and fixes the report order (access → drift → vacuity) in the same early-exit
    batch; task 1.5 implements it; spec adds "Every file of a surface is unreadable" plus an ordering sentence in
    the requirement body. Addressed.
  - CR4: task 2.5 adds a dedicated BFS-read-failure self-test case, spec adds a matching scenario, Decision 2 gives
    the reason a shared case is insufficient (two independent catch sites), and 3.1 mutation-verifies the two
    separately. Addressed.
  - CR5: `.gitignore` L57–62 does list HEL-956 artifacts as four explicit paths, not a glob. Task 2.7 adds the
    explicit-path registration and binds it to a clean `git status`; Decision 4a states the dotfile-collection
    premise. Verified that premise directly in the script: `collectFiles` does not skip dot-prefixed entries and
    `isSourceFile`/`isTestFile` accept a `.hel993-*.ts`, so a planted probe under the assistant root is collected.
  - Non-blocking note (copy-vs-shipped) is now Decision 4a and states the split explicitly.
- Clean-tree baseline re-measured fresh (Decision 5 / AC5):
  `node scripts/check-no-credential-in-agent-surface.mjs` →
  `OK (82 files scanned: 13 assistant-surface, 3 fixture, 66 mcp, 0 violations)`, `exit=0`. Matches.
- Preserved judgement calls checked: `credentialProp` stays assistant-only (proposal Non-goals, design Non-Goals)
  and coverage stays an explicit surface table. Neither is touched.
- Constraint compliance: no Playwright/e2e, no migration, no prod access, no product code (proposal Impact);
  tasks 3.2 stays within lint/format/typecheck/self-test.
- AC traceability: AC1→1.1/2.1, AC2→1.3/2.2, AC3→2.3/2.4, AC4→3.1, AC5→1.7/Decision 5. No AC uncovered, and no
  task outside the ticket's scope.
- Planner Notes are four reversible, stated, low-stakes calls; per the standing instruction I do not treat
  self-approval as an objection, and none of them alters the specs or task breakdown.

### Verdict: CONFIRM

All five round-1 change requests are substantively addressed against ground truth, not merely reworded. The plan
now closes four silent-drop paths (surface read, BFS read, directory listing, entry guard), each has an
implementing task, a spec scenario, a self-test case, and an entry in the 3.1 mutation matrix bound to the shipped
script via `runMutatedScript`'s exactly-once check. I found no placeholder, contradiction, uncovered AC, or scope
drift that blocks implementation.

### Non-blocking notes

- Decision 0 / task 1.4 distinguish "missing root" (routed to vacuity, tolerated) from "exists but unlistable"
  (error). `collectFiles` currently makes both the same `catch`, and the walk is recursive, so the executor must
  also decide the sub-directory case (a directory that vanishes mid-walk, `ENOENT` below the root). Treating any
  non-`ENOENT` failure as an error and `ENOENT` only at depth 0 as tolerated is the obvious reading; worth pinning
  in code comment at implementation time rather than re-planning.
- Decision 1 reads every surface file up front and `findBannedImport` will re-read the root file. Irrelevant at 82
  files, noted only so it is not mistaken later for an accidental double count — the count comes from
  `surfaceRecords[].files`, not from read calls.
- Task 2.1/2.6's euid-0 SKIP lines are the right call, but the SKIP must be loud on stdout AND must not let the
  self-test exit zero claiming full coverage without saying which cases were skipped.
