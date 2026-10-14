## Why

HEL-1445's embedded-Postgres start guard (`EmbeddedPostgresStartGuardSpec`) strips comments with a small Scala
lexer. Its final-gate review found two escape rules that lex well-formed Scala 2.13 wrongly (the `$"` escape and
`\"` inside `raw"..."`), so a `//` inside such a literal can hide a same-line direct start. The review also left
documentation, labelling, file-size and helper-cleanup nits. None has an instance in the tree; this closes them.

## What Changes

- Lexer: treat `$"` as a two-character escape in interpolated strings, and pair `\x` in every single-line string,
  `raw` included, matching scalac 2.13. Each with a red-first reject case and mutation evidence.
- Relabel the three splice cases that never failed on the pre-fix tree as GUARDS, each failable by mutation.
- Correct D7's wording in the archived HEL-1445 design, with a dated correction note.
- CONTRIBUTING.md: a note that specs start embedded Postgres via `VerifiedEmbeddedPostgres.start`.
- Split the 401-line guard spec: lexer and scan rules into a test-support object, assertions in specs, each
  file under 250 lines.
- `VerifiedEmbeddedPostgres`: a fatal throwable in the ownership check still closes and deletes the attempt before
  propagating; a test proves the data directory is deleted when zonky's own start throws.

## Capabilities

### New Capabilities

### Modified Capabilities
- `backend-embedded-postgres-isolation`: the guard must not be bypassed by string-literal escape syntax; the helper
  must clean up an attempt on fatal errors and on a failed zonky start.

## Non-goals

- New guard features (reflection, XML literals, backquoted-identifier tricks stay accepted gaps).
- Updating the archived python enumerator port of the lexer (`enumerate-embedded-postgres-tokens.py`).
- Any change to which specs are allowed to start Postgres, or to zonky itself.
- HEL-1418 (frontend layout/e2e, another lane).

## Impact

Test-only: `backend/src/test/scala/com/helio/testkit/*`, CONTRIBUTING.md, one archived design.md. No runtime code,
no migrations, no API change.
