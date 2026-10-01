## Why

On sbt 2 a repeat bare `sbt test` can be cache-served: zero tests run, exit 0. Local and agent gates that say `sbt test` can therefore pass vacuously (HEL-1018 fixed CI only).

## What Changes

- `concertino.config.json` `backend-test` gate command becomes `cd backend && sbt testFull`; re-render with `concertino sync` (affects `.claude/agents/concertino-{executor,evaluator}.md`, `.cursor/skills/linear-ticket-delivery/SKILL.md`, and any other rendered consumer).
- CLAUDE.md and CONTRIBUTING.md prose that means "run the full suite" uses `sbt testFull`; a short note explains why. Occurrences that are not a full-suite instruction are left alone, each decided explicitly.
- docs/cloud-dev-setup.md is audited; it has no full-suite test instruction, so only a pointer is added if appropriate.
- No change to `scripts/concertino/` (render target), `backend/build.sbt`, or archived openspec changes. Living specs that say `sbt test` in a WHEN clause are behavioral history and are out of scope.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none; tooling/docs only, `skip_specs: true`)

## Impact

Docs and rendered agent instructions only. No runtime code.
