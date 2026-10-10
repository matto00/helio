## Standing Constraints

- [C1] Never print environment contents; never touch the shared dev DB for image verification (throwaway postgres only).
- [C2] Remove every docker image/container/network created for measurement by exact name; never prune or pattern-match.
- [C4] The ci-complete.needs guard parses ci.yml with js-yaml 4.x (root devDependency pinned 4.3.2), never a line scanner; fail-closed checks on the parsed result; the three evaluator attack cases stay as named selftest regressions.
- [C3] Heavy work (docker build, sbt) under `nice -n 19`; never pkill/pgrep/killall; no --no-verify/HUSKY=0.

### Backend

## 1. Dockerfile

- [x] 1.1 Build `helio-backend:hel1428-before` from the unchanged Dockerfile; save `docker history`, size, inspect, in-image stat listing
- [x] 1.2 Change runtime stage to `COPY --chown=helio:helio --from=builder` + `chown helio:helio /app /app/data`; keep `ARG BASE_REGISTRY` intact
- [x] 1.3 Build `helio-backend:hel1428-after`; confirm one ~316 MB layer only and diff inspect/listing/jar sha256 vs before
- [x] 1.4 Start both images against a throwaway postgres on a dedicated network and curl `/health` (or record why not)
- [x] 1.5 Remove the measurement containers, network and both images by exact name; verify with `docker image ls`

### Frontend

## 2. CI guard

- [x] 2.1 Add `scripts/check-ci-complete-needs.mjs` (pure exported check + CLI with optional repoRoot), fail-closed per design D3; real repo passes
- [x] 2.2 Add `check:ci-complete-needs` and `:selftest` to `package.json`; wire the check into `.husky/pre-commit` after isolation-testing it
- [x] 2.3 Add both to the `frontend` job in `ci.yml` next to `check:precommit-ci-parity`; `npm run check:precommit-ci-parity` passes

### Tests

## 3. Verification

- [x] 3.1 Add `scripts/check-ci-complete-needs.selftest.mjs` covering every D3 error path by reason text (column-0 comment, quoted key, quoted needs entry, comment-listed needs above the real line, two needs lines) plus real-ci.yml pass and in-memory red
- [x] 3.2 Demonstrate the CLI red on a scratch copy of ci.yml with `docker-image` removed from needs (exit 1, job named)
- [x] 3.3 Mutation: weaken the missing-job comparison, show the selftest fails, revert
- [x] 3.4 Re-run the D6 duration query; record window + numbers (no timeout change unless timeouts) for the PR body
- [x] 3.5 Write `pr-notes.md` in the change dir: before/after sizes, equivalence summary, item 3 data, and the AC3 post-release check
