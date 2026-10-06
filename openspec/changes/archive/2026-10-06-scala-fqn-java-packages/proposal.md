## Why

CONTRIBUTING.md bans inline fully-qualified names, but `check:scala-quality` has no coverage for `java.sql.`, `java.time.`
and most of `java.util.`, so reviewers keep catching these by hand (HEL-1276, HEL-1345). Two of its existing entries are
also dead. `java.util.UUID` and `java.util.Base64` can never fire, because the regex requires a word character right
after the prefix. The result is that `java.util.UUID.randomUUID()`, CONTRIBUTING's own example, passes the guard today.
The script also has no selftest, so a guard can silently stop being failable.

## What Changes

- `scripts/check-scala-quality.mjs`: the FQN prefix list gains `java.sql.`, `java.time.`, `java.util.` and
  `scala.annotation.`. The dead `java.util.UUID`/`java.util.Base64` entries and the now-subsumed
  `java.util.concurrent.` entry are removed. A load-time assertion requires every prefix to end in `.`. The scan logic is
  exported as a pure function. Trailing `//` and single-line `/* */` comments after code are stripped before matching.
- A new selftest, `scripts/check-scala-quality.selftest.mjs`, runs as part of `npm run check:scala-quality`, so the
  existing hook and CI steps both execute it with no `ci.yml` change.
- Every existing in-scope hit on main is fixed with a top-of-file import. That is 131 lines across 60 Scala files (25
  main, 35 test). Rename imports are used where a plain import would shadow a type.

## Capabilities

### New Capabilities
- `scala-inline-fqn-guard`: what the inline-FQN guard covers, its exemptions, and its selftest.

### Modified Capabilities

## Non-goals

- Other `java.*` sub-packages (`net`, `nio.file`, `lang`, `io`, `awt`, `math`), deferred to a follow-up.
- Multi-line triple-quoted string tracking, and `${...}` interpolation inside ordinary string literals.
- Any behaviour change in Scala code. This is a pure import refactor.

## Impact

`scripts/check-scala-quality.mjs`, a new selftest, `package.json` (scripts), and about 60 backend Scala files (imports
only). No API, schema, migration, or runtime behaviour change.
