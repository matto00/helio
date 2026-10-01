## Skeptic Report — design gate (round 1)

### What I verified
- Gate string originates in helio concertino.config.json:69 (`cd backend && sbt test`); rendered consumers: .claude/agents/concertino-{executor,evaluator}.md, .cursor/skills/linear-ticket-delivery/SKILL.md:129 (grep confirmed). Orchestrator claim holds.
- Repo-wide grep of `sbt test` (excl. node_modules/archive/target): CLAUDE.md:32, CONTRIBUTING.md:241,247,250 are the prose full-suite hits; the rest are code comments, migrations, living-spec WHEN clauses, historical docs, correctly scoped out. docs/cloud-dev-setup.md has no test instruction (confirmed).
- backend/project/build.properties = sbt 2.0.9; MISTAKES.md:246-253 and ci.yml:151 already adopt testFull. Concertino checkout is at origin/main (untracked manifest file only).
- Tasks cover both ACs (red/green repeat-run evidence 1.1, 4.1).

### Verdict: CONFIRM

### Non-blocking notes
- docs/cloud-dev-setup.md:21 installs sbt 1.10.7 tarball, but the repo pins sbt 2.0.9 (testFull-with-caching semantics are sbt 2). Task 3.2 audit should record this stale pin (flag as spinoff; do not widen scope unless trivial).
- Task 1.1/4.1: the red test must be a true repeat with no source change, and the green must show a nonzero test count on the SECOND run, not just exit 0; paste the counts. Use `sbt --client shutdown` between if needed only consistently.
- Task 2.2's grep `sbt test$` is weak (misses `sbt test` followed by text); use `grep -rn "sbt test\b" .claude .cursor` expecting only testOnly/none.
- CONTRIBUTING.md:247 env-var example `... sbt test` should also move to testFull (covered by the per-hit rule; make explicit).
