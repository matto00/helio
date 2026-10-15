## Standing Constraints

- [C1] Pass 1 (`scanBase` and everything in `scripts/check-scala-quality.mjs`) is not edited; `git diff` of that file
  is empty. The guard as a whole stays a superset of the base guard 609e62b6d.
- [C2] Red first: new selftest cases are added and run against the unmodified `scala-code-only.mjs` before it is
  touched; the red transcript is saved as evidence.

## 1. Red first

- [x] 1.1 Add selftest cases to `scripts/check-scala-quality.selftest.mjs` (via `scanScalaText`, plus `spliceCodeOnly`
  where a pass-2-level pin is clearer): green - `/* a /* b */ s"${java.util.UUID.randomUUID()}" */`; green - the
  multi-line form (`/* a` / ` /* b */ s"${...}"` / `*/` / `val x = 1`); green - a depth-3 nested comment holding a
  splice; red - `/* a /* b */ */ val s = s"${java.util.UUID.randomUUID()}"` flagged once; red - `/**/ val s =
  s"${java.util.UUID.randomUUID()}"` flagged once; robustness - an unterminated nested comment does not throw.
  Run `node scripts/check-scala-quality.selftest.mjs` on the unmodified scanner and save the transcript showing the
  nested-comment green cases FAIL (persist as evidence)

## 2. Scanner

- [x] 2.1 Implement design Decisions 1-3 in `scripts/scala-code-only.mjs` (comment frame `depth`, earliest of `/*` and
  `*/`, consume two); verify the selftest passes
- [x] 2.2 Update the header comment's frame list for the nesting depth; verify by reading the diff
- [x] 2.3 Mutations (two): (a) restore first-`*/`-closes behaviour, show the new "not flagged" cases go red; (b) make
  `*/` never pop the comment frame, show the new "flagged" cases go red; restore after each; save both transcripts as
  evidence

## 3. Differential and gates

- [x] 3.1 Whole-repo scan: `node scripts/check-scala-quality.mjs` exits 0 from this worktree
- [x] 3.2 Differential (HEL-1386's, re-run), over every backend `.scala` file under `backend/src`, comparing base
  (609e62b6d) `scanScalaText`, main (67c434c6b) `scanScalaText` and HEAD `scanScalaText`: (a) files as-is; (b) ` ;
  java.time.Instant.now()` appended to each non-blank line; (c) ` ; val p = s"${java.util.UUID.randomUUID()}"`
  appended to each non-blank line; plus (d) the nested-comment probes from 1.1. Verify base ⊆ HEAD for (a)-(c), main
  vs HEAD differs only on lines inside nested comments (expected: zero on the tree), and (d) shows the intended change.
  Print the worktree path and file/line counts; save the transcript as evidence
- [x] 3.3 `git diff 67c434c6b -- scripts/check-scala-quality.mjs` is empty (C1)
- [x] 3.4 `npm run check:scala-quality` exits 0 with the selftest pass count, from this worktree's path
