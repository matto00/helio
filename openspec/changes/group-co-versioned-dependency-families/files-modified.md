# Files modified — HEL-898

- `.github/dependabot.yml` — added `fortawesome`, `echarts`, `redux`, `markdown` groups to the npm `/frontend` config; moved every pattern group ahead of the `dev-dependencies` catch-all (first-match-wins); raised that config's `open-pull-requests-limit` to 15; added the ordering/pattern-precision rationale comment.
- `scripts/check-dependabot-groups.mjs` — new validator: dependency-free YAML subset parser, Dependabot first-match-wins assignment, declared-family table + `declaredIndependent` allowlist, split/ungrouped + stale-declaration + manifest-coverage assertions.
- `scripts/check-dependabot-groups.selftest.mjs` — new selftest, six in-memory fixture cases (a)–(f), each asserting on the failure reason and named individually on stdout.
- `package.json` — `scripts` block only: `check:dependabot`, `check:dependabot:selftest`. No dependency changes.
- `.husky/pre-commit` — runs both new checks alongside the existing `check:*` entries.
- `.github/workflows/ci.yml` — runs both new checks in the `frontend` job after `format:check`.
- `openspec/changes/group-co-versioned-dependency-families/tasks.md` — sections 1–6 marked complete; section 7 is the orchestrator's.
- `openspec/changes/group-co-versioned-dependency-families/evidence/validator-red-precommit.txt` — validator run against the unmodified config: exit 1, names `fortawesome` as split/ungrouped.
- `openspec/changes/group-co-versioned-dependency-families/evidence/fontawesome-matching-versions-typecheck.txt` — `--no-save --no-package-lock` probe of the four packages at matching versions plus `npm run typecheck`; resolved versions recorded.
- `openspec/changes/group-co-versioned-dependency-families/evidence/gate-chain-isolation-check-dependabot-groups.md` — CON-132 isolation transcript for the validator (PASS).
- `openspec/changes/group-co-versioned-dependency-families/evidence/gate-chain-isolation-check-dependabot-groups-selftest.md` — CON-132 isolation transcript for the selftest (PASS).
- `openspec/changes/group-co-versioned-dependency-families/` — planning artifacts (ticket/proposal/design/tasks/spec delta) and gate reports (`skeptic-design-1..3.md`, `evaluation-1.md`, `skeptic-final-1.md`).
