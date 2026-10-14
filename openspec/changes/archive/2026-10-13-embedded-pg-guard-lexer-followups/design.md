## Context

See proposal.md (Why). Current state, verified on c830aa875:
- `backend/src/test/scala/com/helio/testkit/EmbeddedPostgresStartGuardSpec.scala` (401 lines) holds the lexer
  (`stripComments`, `usesRawFallback`, `hasSpliceLiteral`), the scan rules (`violations`, `offendersIn`, regexes)
  and the spec class. `string()` pairs `\x` only when `!raw`, and handles `$$` and `${` but not `$"`.
- `VerifiedEmbeddedPostgres.scala` (97 lines): `startWith` deletes the dir on any `Throwable` from `b.start()`, but
  the ownership check catches only `NonFatal`, so a fatal throwable skips `pg.close()` and `deleteQuietly(dir)`.
- Scala is 2.13.15 (`backend/build.sbt:4`); zonky embedded-postgres 2.0.7 (`build.sbt:294`).
- `scripts/check-scala-quality.mjs` SOFT_BUDGET = 250 lines.
- Archived skeptic-final-4.md (Q1, Q3, required revisions 1-2) states the two gaps and the fix lines.

## Goals / Non-Goals

Goals: AC1-AC7 in ticket.md. Non-goals: proposal.md Non-goals.

## Decisions

### D1. Lexer escape rules match scalac 2.13
In `string()`: (a) add `interpolated && c == '$' && next == '"'` -> emit both (the `$"` escape, valid in single- and
triple-quoted interpolations); (b) pair `\x` in every single-line string, `raw` included (drop the `!raw`
condition; the `raw` parameter then goes away). Triple-quoted strings keep no backslash pairing (scalac does not
escape `\"` there). Alternative (keep raw unescaped, document as gap): rejected, scalac lexes `raw"a\"b"` as one
literal, so the lexer would be wrong on well-formed input. BEFORE fixing, the executor confirms both facts with
scalac 2.13.15 itself (a scratch compile, e.g. `sbt console`/a throwaway test in the worktree or `scala-cli` if
present): `s"a $" b"` compiles to `a " b` and `raw"a\"b // c"` compiles to one literal `a\"b // c`. Transcript to
`proof/scalac-escapes.txt`. If scalac disagrees, STOP and escalate (the fix would be wrong).

### D2. Red-first reject cases + mutation evidence
New reject cases, each a single line `<literal with //> ; <direct start>`:
- `dollar-quote escape`: `val u = s"a $" // b"; val pg = <Epg>.builder().start()`
- `raw backslash-quote`: `val r = raw"a\"b // c"; val pg = <Epg>.builder().start()`
Plus accept cases proving no over-rejection: the same literals followed by a wrapped (verified) start.
Order: add cases, run, capture RED (only these two missed) -> fix -> GREEN. Then mutation: revert D1(a) alone ->
`dollar-quote` red; restore; revert D1(b) alone -> `raw` red; restore. Transcripts in `proof/`.

### D3. Never-red GUARD labels (fail-closed vs failable)
The triple-quoted, nested-splice and char-literal splice cases move to their own test, labelled GUARDs that never
failed on the pre-fix tree (HEL-1445 c5 transcript). The design-gate skeptic showed (skeptic-design-1.md, item 1)
that in their current shape no lexer mutation can make them red: the direct start sits on its own line and there
is no `/*`, so a mis-lex either leaves it visible or drives the file to the RAW fallback, which still flags it.
They are therefore kept unchanged and labelled "fail-closed GUARD: a mis-lex falls back to the raw scan".
For each of the three constructs the executor ADDS a balanced, same-line variant that stays balanced after the
mis-lex, so a targeted temporary lexer mutation makes it red (e.g. triple-quoted: `val t = """a"b//x"""; <direct>`
under "treat `"""` as `"`"). Each variant: GREEN on the fixed lexer, RED under its mutation, restored
(`proof/guard-mutations.txt`). If a construct provably has no balanced failable variant, record the attempts and
why in that file and label it fail-closed only; do not invent an unrelated mutation (self-approved: the ticket asks
only to relabel these cases, so this does not change scope). Mutations are temporary edits, never committed.

### D4. Split (lexer from assertions)
- `testkit/EmbeddedPostgresGuardLexer.scala` (object): `stripComments`, `usesRawFallback`, `hasSpliceLiteral`.
- `testkit/EmbeddedPostgresStartGuard.scala` (object): tokens/regexes, `violations`, `offendersIn`, `HelperPath`,
  `RegressionPath`, `ExemptionMarker`, `withoutExemptLines`. Keeps the concatenation spelling so no file flags
  itself.
- `EmbeddedPostgresStartGuardSpec.scala` (class): allowlist/reject/accept/exemption cases + whole-tree scan.
- `EmbeddedPostgresGuardLexerSpec.scala` (class): splice/escape cases, GUARDs, stats.
Exact cut is the executor's call; constraint: every file <= 250 lines, no case lost. Most cases are entries inside
`Seq`s, not ScalaTest test names, so the inventory lists every CASE (test name + each Seq label or literal, e.g. by
a script over the source) before and after; the set only grows by the new cases. Whole-tree STATS stay `raw-fallback-files=0
offenders=0`. `HelperPath`/`RegressionPath` are unchanged (the new files are scanned like any other).
Alternative: keep one file and accept the soft warning: rejected, the ticket asks for the split.

### D5. Helper cleanup on fatal and on failed start
Ownership check: wrap so that ANY throwable that is not `NonFatal` closes `pg` (best-effort, its own failure added
as suppressed) and deletes `dir`, then rethrows the same throwable (no retry). NonFatal behaviour is unchanged.
A test seam is needed to observe the attempt's data dir: add a defaulted `newDataDirectory: () => Path` parameter
to `startWith` (default = today's `Files.createTempDirectory("epg")` call with its temp-dir-hygiene comment);
`start` behaviour is unchanged. Tests (in `VerifiedEmbeddedPostgresSpec`):
- fatal: `observeDataDirectory` captures the instance it was given and throws `InterruptedException`; assert the
  same throwable propagates, the injected dir no longer exists, AND the captured instance was closed (e.g. a new
  connection to its port is refused / `pg_ctl status` on its dir reports no server). The red run against the old
  helper leaks a postmaster, so that red harness closes the captured instance explicitly in a `finally`.
- failed start: trigger a zonky `start()` failure that happens BEFORE the postmaster is launched (zonky 2.0.7
  launches it and registers a shutdown hook at EmbeddedPostgres.java:275/:283 before the startup wait can throw at
  :335), e.g. an initdb failure from an invalid locale/initdb arg. Never use a short `setPGStartupWait` trigger (it
  leaves a live postmaster on a deleted dir). Assert the error propagates and the injected dir no longer exists, and
  record in the proof that no postmaster was started for that dir.
Zonky 2.0.7 fact-finding (AC7): read the zonky sources jar (coursier cache) for what `start()` does on failure:
does a postmaster survive, is a shutdown hook registered? Record with file/line citations in
`proof/zonky-start-failure.txt`. If a postmaster can survive a throwing start, do NOT expand scope: record it and
file a Follow-up ticket (relatedTo HEL-1474).

### D6. Docs
- Archived `openspec/changes/archive/2026-10-10-embedded-postgres-port-race-guard/design.md` D7: replace "`raw"..."`
  without escapes" with the correct rule; gap 3 names the `$"` escape and raw `\"` (fixed by HEL-1474), backquoted
  identifiers and XML literals as concrete residual members, and "a wrapped builder handed to a user function that
  starts it" as an accepted deliberate-evasion residual; the "Comment handling" paragraph names the `$"` escape and
backslash pairing in single-line strings, `raw` included; "cover each construct" becomes "have accept and reject
  cases for the constructs listed". Append `_Corrected by HEL-1474 (2026-10-13)._` to the paragraph. Only D7 is
  edited; the archived spec has no matching wording (checked by grep).
- CONTRIBUTING.md: one short paragraph after the HEL-924 embedded-postgres paragraph.

## Risks / Trade-offs

- [Pairing `\x` in raw strings makes a raw string ending in a lone `\` before `"` mis-lex] -> scalac rejects such
  input too (unterminated), so it never compiles; the lexer then falls back RAW (fail closed).
- [The split drops a test] -> before/after test-name inventory is compared in the evaluation.
- [Editing an archived design] -> wording-only, dated note; hygiene hooks run on commit.

## Migration Plan

Test-only; rollback = revert the PR.

## Planner Notes

- Self-approved: the `startWith` seam parameter (test-only, defaulted, `private[testkit]`).
- Self-approved: zonky survival found on the start-failure path is filed as a Follow-up, not fixed here.
- Run rules (driver hard rules) bind every role; they are restated in each sub-agent brief.
