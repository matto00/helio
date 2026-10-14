## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 609e62b6d917243355a179fa8a26318c04898c27; the change dir is untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/scala-guard-interpolation-splices/HEL-1386`.
- **The design's Context matches the live guard.** In `scripts/check-scala-quality.mjs`, `scanScalaText` blanks every literal with
  `/"(?:[^"\\]|\\.)*"/g`, which can't tell an `s"` literal from a plain `"` one. It deletes (does not space-fill) the `/* */` span and the trailing `//`,
  and computes `col = raw.indexOf(offender) + 1`. That column can land on a string occurrence of the same text, so the claimed mis-pointing is real. The header documents the `${...}`
  limit, as the proposal says. The selftest is wired first in `check:scala-quality` (package.json:35), which runs from husky pre-commit:19 and
  CI ci.yml:126. Both claims hold.
- **No baseline exists** (`grep baseline scripts/check-scala-quality.mjs` → no hits). Decision 9 ("fix with an import, no baseline") is correct under the ticket's
  AC 4.
- **ShareTokenGenerationSpec.scala.** Line 45 (`"never reach for scala.util.Random or Math.random" in {`) and line 56
  (`src should not include "scala.util.Random"`) are plain `"..."` literals, so the driver's claim is verified. The same file has an interpolated line
  `fail(s"... ${new File(".").getCanonicalPath}")` (line 51), which contains a nested literal inside a splice. My prototype keeps it clean.
- **I prototyped the design to test it, rather than trusting it.** I implemented Decisions 1–7 literally in the scratchpad (not the worktree):
  a length-preserving scanner, id-before-quote interpolator detection, `$$` and `$ident` treated as text, depth-counted splices with recursive nested literals,
  single-line `"""`, and space-filled comment stripping.
  - Over `backend/src/{main,test}/scala` it gives `old 0 new 0`: no new violations and none lost. So task 2.4 should come out as no fixes needed, and the
    "fix every newly flagged site" step can't turn into false-positive churn on the current tree.
  - Every spec scenario behaves as specified. `s"id=${java.util.UUID...}"` is a HIT at col 16 (the real code position). The nested-brace `xs.map { ... }` case is a HIT.
    The plain `"${java.util.UUID...}"` is clean. `s"$java.util.UUID and $$java.time.Instant"` is clean. `src should not include "scala.util.Random"` is clean.
    A single-line `s"""x ${java.time.Instant.now()} y"""` is a HIT. A splice holding `"}"` doesn't unbalance depth (HIT, as intended).
    Unterminated `s"${x` and `s"x` don't throw.
  - The existing pinned `'"'` char-literal case stays clean under the design, so its pin survives unchanged, as Decision/Non-goal says.
- **Red-first is achievable.** Each red case in task 3.1 is blanked whole by the current regex. I hand-traced all of them, including the nested-literal-in-splice
  form, where the regex's quote pairing still swallows the FQN. So they'll fail on the unmodified guard, and task 1.1 can produce a genuine red.
- **Spec delta is valid.** The live `openspec/specs/scala-inline-fqn-guard/spec.md` has `### Requirement: Inline-FQN guard exemptions` with exactly the
  two scenarios the MODIFIED block carries forward, and it adds one. `openspec validate scan-scala-interpolation-splices --strict` → `Change ... is valid`.
- **AC coverage:**
  - AC1 (scan splices, nested braces, plain text ignored) → Decisions 2–4, task 2.1, spec ADDED requirement.
  - AC2 (selftest: splice flagged, plain not flagged, `$ident`) → tasks 3.1/3.2.
  - AC3 (red first) → task 1.1, plus the 3.4 mutation.
  - AC4 (fix or baseline) → task 2.4.
  - No scope drift: the prefix list, the exemptions and file-size rules are untouched, and cross-line `"""` is explicitly a non-goal.
- **Placeholders, contradictions, missing contracts:** none that block implementation. This is a dev-tooling change only, so no API or schema delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

1. **`$"` escape (Scala 2.13.15 here) is not in Decision 3.** In an interpolated literal, `$"` is an escaped quote. The design will end the literal at that `"`
   and expose the following text as code. Prototype: `s"a$"b java.time.Instant c"` → HIT (a false positive on string text). The current regex guard has the
   same false positive, so this isn't a regression, and the repo has zero `$"` inside interpolated literals today. All `$"` hits are `$` anchors in plain
   regex literals. Still, it's one extra branch next to `$$`, plus a green selftest case, and it squares the implementation with the spec's "text portions ...
   SHALL NOT be reported". Recommended.
2. **Decision 5 wording can be read two ways.** It says an unclosed `"""` blanks "the rest of the line", but it also applies "the same splice handling". Does a `${...}` on the
   opening line of a multi-line `s"""`/`sql"""` get scanned? Either reading gives the same result on the current repo (prototype found no diffs). Pick one
   and pin it with a selftest case, preferably scanning the splice, which is consistent with AC1.
3. Char literals inside splice code (`'}'`, `'{'`, `'"'`) will unbalance the depth counter or the quote parity. Consider adding this to the header's "Known guard limits"
   alongside the existing `'"'` limit.
4. `tasks.md` has an empty `## Standing Constraints` heading. Fill it in or drop it.
