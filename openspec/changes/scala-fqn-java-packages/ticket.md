# HEL-1332: check:scala-quality inline-FQN check misses java.sql. / java.time.

## Description

origin_kind: followup
origin_ticket: HEL-1276

HEL-1276's evaluator had to catch four inline fully-qualified names in tests by hand. The `check:scala-quality`
inline-FQN pattern list doesn't cover `java.sql.` or `java.time.`, and CONTRIBUTING says inline FQNs are never allowed.

## Acceptance Criteria (original)

- Extend the pattern list to cover `java.` packages, or at least `java.sql.`, `java.time.` and `java.util.`. Keep the
  existing exemptions, such as import lines.
- Show it going red on a fixture that contains one of these FQNs, and green on main. If main has existing hits, fix them
  in the same change.

## Owner ruling (ticket-drift escalation HEL-1332-1791282661946-bda46c, answered `fix-sql-time-util-now`)

The scope, as restated by the driver on resume (2026-10-06), is binding:

- AC1: extend `scripts/check-scala-quality.mjs` to cover `java.sql.`, `java.time.`, `java.util.` and `scala.annotation.`
  (HEL-1345 let an inline `@scala.annotation.tailrec` slip through).
- AC2: fix the dead-prefix bug. `java.util.UUID` and `java.util.Base64` never fire, because the regex is `(<prefix>)\w`.
- AC3: add a selftest covering red, green, string literals, comments (including a trailing `//` after code), scaladoc,
  and the exempt import/package lines.
- AC4: fix every existing hit in those packages on main. At re-derivation (main 659eec305) that is 131 lines across 60
  files: java.sql 72, java.time 37, java.util 21, scala.annotation 1. Rename imports are required wherever a plain import
  would shadow a Scala or already-imported type (e.g. `java.util.Set`, `java.time.Duration`).
- AC5: refactor discipline. The fix is behaviour-preserving, `sbt testFull` stays green, and the test count is the same
  before and after.
- Out of scope: the other `java.*` sub-packages (net, nio.file, lang, io, awt, math). They are a follow-up.
- Escalate rather than widen scope.
