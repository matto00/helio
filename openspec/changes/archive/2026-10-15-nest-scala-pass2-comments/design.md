## Context

`scripts/check-scala-quality.mjs` flags a line if pass 1 (the base string-blanking detection, 609e62b6d behaviour) or
pass 2 (the splice scan, `spliceCodeOnly` in `scripts/scala-code-only.mjs`) flags it (HEL-1386 Decision 1,
"old OR new"). Pass 2 keeps a stack of frames that survives line breaks; a block comment is a `{ kind: "comment" }`
frame. In the main loop, a comment frame searches `line.indexOf("*/", i)` and pops on the first hit, so a `/*` inside
the comment is never counted and an inner `*/` returns the scanner to code early. Probe on main (67c434c6b):
`/* a /* b */ s"${java.util.UUID.randomUUID()}" */` is reported at col 18; the multi-line form is reported too; a
splice after a fully closed nested comment is (correctly) reported.

## Goals / Non-Goals

**Goals:** pass 2 follows Scala's nested block-comment rule on one line and across lines; red-first selftest; the
guard stays a superset of base.

**Non-Goals:** any change to pass 1 (`scanBase` and its regexes), to the other documented pass-2 limits, to the
prefix list, the exemptions or the report format.

## Decisions

1. **Depth counter on the comment frame.** The comment frame becomes `{ kind: "comment", depth: 1 }` when `stepCode`
   sees `/*`. While the top frame is a comment, the scanner finds the earliest of `/*` and `*/` at or after `i`:
   `/*` increments `depth`, `*/` decrements it and pops the frame at 0; each consumes two characters; no hit ends the
   line (frame survives to the next line). Alternative considered: push one comment frame per level. Equivalent, but
   a counter keeps "one comment = one frame" and leaves the stack shape the rest of the scanner relies on unchanged.
2. **Earliest-token, consume-two semantics match the Scala lexer**, which reads a comment left to right and treats
   `/` followed by `*` as an opener and `*` followed by `/` as a closer, consuming both characters. So `*/*` closes one
   level (the `*/` comes first) and `/*/` opens one (the `/*` comes first). Selftest pins `/**/` (scaladoc-style empty
   comment closes) and a depth-3 case.
3. **Inside a comment nothing else is special**: quotes, `//`, `${` are comment text, as today.
4. **Superset is untouched by construction.** Pass 1 is not edited; pass 2 still only contributes findings. The change
   can only remove pass-2 findings that lie inside a nested comment, which were false positives. Proof is the
   differential (task 3).
5. **Header comment** in `scala-code-only.mjs` updates the comment-frame description (`{ kind: "comment", depth }`,
   nesting).

## Risks / Trade-offs

- [A pass-2 desync now hides a real splice FQN] → only text Scala itself treats as comment is skipped; the differential
  with an appended splice probe compares main vs HEAD over every real line and must show zero differences outside
  nested comments (the tree has none, so zero differences).
- [Unterminated nested comment] → the frame survives to end of file, like today's unterminated `/*`; pass 1 is
  unaffected, never throws. Selftest robustness case.

## Planner Notes

- Self-approved: the depth counter (Decision 1) over a frame-per-level stack; no product, API or dependency change.
- Base for "superset" is 609e62b6d (HEL-1386's base guard); main (67c434c6b) is the comparison for "only nested-comment
  findings change".

## Gate-Chain Implications Checklist

`scripts/scala-code-only.mjs` and `scripts/check-scala-quality.selftest.mjs` run from `.husky/pre-commit` via
`npm run check:scala-quality` (`node scripts/check-scala-quality.selftest.mjs && node scripts/check-scala-quality.mjs`),
so this change touches the commit gate chain.

- **What does it execute?** `npm run check:scala-quality` runs the selftest then the guard under `node`. The selftest
  imports the guard and `scala-code-only.mjs`, runs in-process fixtures, and spawns the real guard CLI once
  (`spawnSync(process.execPath, [check-scala-quality.mjs, <fixtureRoot>])`). The guard reads every `.scala` file under
  `backend/src/main/scala` and `backend/src/test/scala`. No `git` call, no network. This change adds no new process,
  import or file access; it only changes in-memory comment scanning in `spliceCodeOnly`.
- **What environment does it inherit, and from where?** The hook's `npm run` environment, including git's hook
  variables (`GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE` when set). None is read: the scripts use only
  `process.execPath`, `process.argv` and `import.meta.url`; the scan root comes from the script's own location unless
  the selftest passes an explicit root. Unchanged by this change.
- **Does it write anything outside its own sandbox?** No. The guard only reads and prints. The selftest writes one
  fixture under an `mkdtemp(join(tmpdir(), "scala-quality-selftest-"))` directory and removes it in `finally`. New
  selftest cases are in-process only and write nothing.
- **Does it behave differently from a linked worktree than from a main checkout?** No. The scan root is derived from the
  script's path, so a linked worktree scans its own `backend/src`; no `git rev-parse`, inherited `GIT_DIR` ignored.
- **What happens on its first run?** Nothing special: no cache, state file or lock. The selftest runs first and fails
  the chain on any red case. The tree has no nested block comments, so the repo scan stays clean and no site needs a
  fix (verified by task 3.1).
