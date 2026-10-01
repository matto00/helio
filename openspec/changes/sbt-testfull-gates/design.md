## Context

See proposal.md. The gate string originates in helio's `concertino.config.json` (concertino core only carries it in `config/examples/helio.json` and `lib/cli/init.js` examples), so the fix is owned by helio; no upstream change is needed for the live gate.

## Goals / Non-Goals

**Goals:** every instruction meaning "run the full backend suite" says `testFull`; proof that a repeat run executes tests.
**Non-Goals:** editing rendered files by hand; touching concertino core; rewording archived/living spec history.

## Decisions

- Use `sbt testFull` (the project's own task, per MISTAKES.md/HEL-1018) rather than `sbt "test; ..."` or cache flags: it is already the CI-adopted form.
- Render via `concertino sync`, after confirming `concertino diff` is 0 changed beforehand and the concertino checkout is at origin/main, so the committed render diff contains only this change.
- Per-hit decision: CONTRIBUTING.md lines about env-var tuning before "invoking `sbt test`" and the flakiness re-run advice mean the full suite, so they move to `testFull`. CLAUDE.md `sbt test   # Run ScalaTest suite` becomes `sbt testFull`. `testOnly` usages stay. Code comments in backend sources/migrations are historical descriptions, left alone.

## Risks / Trade-offs

- [Unrelated rendered churn from sync] -> pre-check `concertino diff` = 0 changed; stop and escalate on any other churn.
- [testFull semantics differ from test] -> verify empirically that a repeat run executes the full count.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit-invoked script is touched.
