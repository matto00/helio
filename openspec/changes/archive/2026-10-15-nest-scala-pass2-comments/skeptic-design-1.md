## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 67c434c6b01f9b91681870488975be5ca370c896. The change dir is untracked planning artifacts only. The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/scala-pass2-nested-comments/HEL-1603`.

### What I verified (with evidence)

- **The design describes the real scanner.** I read `scripts/scala-code-only.mjs` (110 lines). When the top frame is a comment, the main loop does `line.indexOf("*/", i)` and pops on the first hit. `stepCode` pushes `{ kind: "comment" }` on `/*` and consumes 2 characters. This matches the design's Context section and Decision 1.
- **The problem exists on main, and the planned green cases are red today.** My own probe (`scratchpad/.../probe.mjs`) runs `scanScalaText` on the unmodified worktree:
  - `/* a /* b */ s"${java.util.UUID.randomUUID()}" */` is flagged at 1:18, as design.md says (col 18).
  - The multi-line form is flagged at 2:14.
  - Depth-3 on one line is flagged at 1:23. The multi-line depth-3 form is flagged on lines 3 and 4.
  - An unterminated nested comment is flagged at 1:18.
  - The red cases `/* a /* b */ */ val s = s"${...}"` and `/**/ val s = s"${...}"` are both flagged today, so they are correct.
  - Task 1.1's red-first transcript can therefore actually go red.
- **Every one of these findings comes from pass 2, not pass 1.** In each case the FQN shows up in the `spliceCodeOnly` view. I also read `scanBase` (lines 86-133). Pass 1 skips any trimmed line that starts with `/*` or `*`, skips lines while `inBlockComment` is set, and blanks `"..."` text before matching. So pass 1 never flags these lines, and C1 (pass 1 not edited) does not block the ACs.
- **Decision 1 is correct and leaves the tree unchanged.** I applied Decision 1 exactly to a scratch copy (`patched.mjs`): `depth: 1` on the frame, take the earliest of `/*` and `*/`, consume 2, pop at depth 0. I then compared its pass-2 view with main's across all 1218 `backend/src` `.scala` files, as-is and with task 3.2(c)'s ` ; val p = s"${java.util.UUID.randomUUID()}"` appended to every non-blank line. That is 467,530 line-scans with **0 view differences**, which supports the design's "expected: zero on the tree".
  - Edge semantics under the patch: `/**/ ...` closes and the splice is flagged. `/* a */*/ ...` closes at the first `*/` and flags. `/* x /*/ ... */ */` treats `/*/` as an opener and does not flag. All match Decision 2 and the Scala 2 lexer's `maybeOpen`/`maybeClose` left-to-right order.
- **The differential base works.** `git show 609e62b6d:scripts/check-scala-quality.mjs` exports `scanScalaText`, and `scala-code-only.mjs` does not exist at that commit. `git log 609e62b6d..67c434c6b -- <both scripts>` lists only c5cc7eeee (HEL-1386).
- **The gate-chain checklist is accurate.** `.husky/pre-commit:19` runs `npm run check:scala-quality`, and `package.json:35` is `selftest && guard`. The scripts make no git calls and read no env vars; they use only `process.execPath`, `process.argv` and `import.meta.url`. The only filesystem write is the selftest's `mkdtemp` fixture. All five checklist questions are answered with concrete facts, not hand-waving.
- **No placeholders.** `grep TODO|TBD` over the change artifacts finds nothing, and `openspec validate nest-scala-pass2-comments --strict` reports the change as valid.
- **Every AC maps to a task:**
  - Nesting depth, on one line and across lines: Decision 1 and task 2.1.
  - The one-line case is not flagged: tasks 1.1 and 3.4.
  - A splice after a closed nested comment is still flagged: task 1.1 (red).
  - Red-first: tasks 1.1 and 2.3, and C2.
  - Pass 1 unchanged and the guard stays a superset, by differential: tasks 3.2 and 3.3, and C1.
  - The repo scan stays clean: tasks 3.1 and 3.4.
  - The checklist: present in design.md.
- **No scope drift.** The non-goals exclude pass 1, the other pass-2 limits, the prefixes, the exemptions and the report format.
- **The spec delta fits.** It ADDs a requirement to the existing `scala-inline-fqn-guard` capability, and its name does not collide with the five existing requirements.

### Verdict: CONFIRM

### Non-blocking notes

1. **Mutation coverage for the red guards.** Task 2.3's mutation (restoring "first `*/` closes") turns only the *green* nested cases red. The red cases (`/* a /* b */ */ val s = ...` and `/**/ ...`) stay green under that mutation, so it does not show they can fail. A second mutation would, for example `*/` never popping the frame, or depth starting at 2. The executor should run one, or label those two cases as regression guards rather than red-first proofs.
2. **The ticket says pass 1 is "unaffected", but pass 1 has its own nested-comment false positive.** The input `/* a\n /* b */\n val t = java.time.Instant.now()\n*/` is flagged by pass 1, because it leaves the comment at the inner `*/`. That is outside scope: pass 1 is a non-goal under C1 and the ticket. Still, the guard as a whole will keep false-positiving on plain FQNs inside multi-line nested comments. A follow-up ticket could be filed if anyone cares; there are no nested comments in the tree today.
3. **The multi-line fixture differs slightly between documents.** Task 1.1 has 4 lines (it adds `val x = 1`), while the spec scenario has 3. Either is fine.
4. **Pass 2 is still not a full lexer.** A spurious `/*` that pass 2 sees but Scala does not (for example inside a backtick identifier or an exotic char literal) now needs a matching number of `*/` to close. This only loses pass-2 findings, never pass-1 findings, and it matches the documented limits. The differential showed no effect on the tree.
