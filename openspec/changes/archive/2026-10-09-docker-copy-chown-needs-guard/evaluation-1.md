## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `8babb8c06ca5bb6f64c98a4d2406db1dd2f5ef5f` (commits 8781940c4, 8babb8c06) against live-resolved base
`bc2831cf2417af70eb0b48a315def723dcfb5485`.

### Phase 1: Spec Review — FAIL
- AC1/AC2 (Dockerfile): PASS. `Dockerfile:33-34` is `COPY --chown=helio:helio --from=builder ...` plus a
  non-recursive `chown helio:helio /app /app/data`. `ARG BASE_REGISTRY` and the `FROM ${BASE_REGISTRY}/...` lines
  are unchanged. USER, EXPOSE, HEALTHCHECK, ENTRYPOINT and WORKDIR are not in the diff. I did not rebuild the images.
  The equivalence claim in pr-notes.md matches Dockerfile semantics: `COPY --chown` keeps the 644 mode, `/app` (made
  by WORKDIR) and `/app/data` are still chowned to helio, and the users are created before the COPY. No `hel1428`
  images, containers or networks are left on the host (checked by exact substring with `docker image ls`, `ps -a` and
  `network ls`).
- AC3: PASS. The post-release check is stated in pr-notes.md.
- AC4: FAIL on one point. The wiring, selftest and red all pass (see Phase 2). But the guard does not meet the spec
  requirement "SHALL fail whenever any job defined in `.github/workflows/ci.yml` ... is absent from `ci-complete`'s
  `needs`" (specs/ci-required-jobs-guard/spec.md). There is a reproducible fail-open, described under Phase 2,
  Issue 1.
- AC5: PASS. I re-ran the query myself: 83 ci.yml runs created after 2026-10-09T05:00Z, with docker-image results of
  79 success (143-213 s, mean 181 s) and 4 failures (8, 8, 10 and 37 s, none of them timeouts). That matches
  pr-notes.md (82 runs / 78 success); one run finished since. Leaving `timeout-minutes: 8` unchanged is correct.
- Tasks: all checked. I reproduced 3.2 (CLI red) and 3.3 (mutation) independently.
- Scope: no creep. Constraints C1-C3 are honored, with no leftover docker artifacts.

### Phase 2: Code Review — FAIL
Gates I ran fresh in WORKTREE_PATH. No `frontend/**` or `backend/**` files changed, so the configured trigger gates
do not strictly apply. I still ran `npm run lint` (exit 0) and `npm run format:check` (exit 0), plus the touched
checks: `check:ci-complete-needs` (exit 0, 6 jobs / 5 needs), `check:ci-complete-needs:selftest` (24/24 ok),
`check:precommit-ci-parity` (OK, 26/26, includes the new script) and its selftest (5/5), and `check:openspec` (clean).

Independent reproduction:
- CLI red: on a scratch copy of the real ci.yml with `docker-image` removed from `needs` at line 687, the CLI exits 1
  and names `docker-image`.
- Mutation: with the missing-job condition replaced by `if (false)`, the selftest exits 1 with 5 FAIL lines.
- Gate chain: `.husky/pre-commit` runs `set -e`, so a red check aborts the commit. The script derives its root from
  `import.meta.url`, reads no env, and writes nothing.

My own fail-open attacks, each run through the guard and cross-checked with js-yaml (and PyYAML for the finding):
- These fail closed, as they should: CRLF line endings, `jobs :`, a quoted `"jobs":` key, a duplicate
  `ci-complete`, a `---` document separator, a quoted `"needs":` key, a tab after `needs:`, an alias (`needs: *n`), a
  BOM before `jobs:`, a `# , c]` comment after the flow list, an unterminated quoted entry, `? c` explicit keys, and a
  colon inside a quoted value.

Issues:
1. **Fail-open: a column-0 continuation line inside a multi-line quoted scalar ends the jobs block early**
   (`scripts/check-ci-complete-needs.mjs:37-43`, `TOP_LEVEL_KEY_RE` at :20).
   - Fixture: a `ci-complete` that needs `[a, b]`, then job `b` with step `run: "echo` followed by a line `foo: bar"`
     at column 0, then job `c` at 2-space indent.
   - The guard returns **PASS**. js-yaml and PyYAML both parse it as `jobs = [a, ci-complete, b, c]` with `c`
     missing from `needs`.
   - In the real ci.yml, `jobs:` is the last top-level key and `ci-complete` is the last job (line 685). So a new job
     appended after `ci-complete`, after any multi-line quoted string that has a column-0 `x:` continuation, is
     silently dropped.
   - This is low-likelihood. It is still a pass-on-misparse in a guard whose stated contract is fail-closed, and the
     design rounds rejected the same class of issue (comment-first-match).
   - I have not verified whether GitHub's own parser accepts the column-0 continuation. Both reference parsers do.

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: FAIL

### Change Requests
1. `scripts/check-ci-complete-needs.mjs:37-43`: make the end of the jobs block fail closed. Recommended approach:
   - Treat `jobs:` as the final top-level key. After the `^jobs:` line, any non-blank, non-comment column-0 line is
     an error (for example "column-0 line after `jobs:` — jobs must be the last top-level key in ci.yml (cannot
     establish the job set): <line>"), not a terminator.
   - The real ci.yml already satisfies this, because `jobs:` at line 20 is its last top-level key.
   - This also turns the duplicate-top-level-`jobs:` case into an error. It is invalid YAML, but the guard currently
     passes it.
   - Alternative: track quote and block-scalar state across lines. That is more code for the same guarantee.
   - Add a selftest case in `scripts/check-ci-complete-needs.selftest.mjs` with the exact fixture from Phase 2,
     Issue 1. Assert it fails on the reason text, and show it is red against the current implementation before the
     fix.
   - Update the "guard fails closed" requirement in `specs/ci-required-jobs-guard/spec.md` and design D3 to match.

### Non-blocking Suggestions
- pr-notes.md gives the docker before/after evidence only as prose. Consider pasting the two relevant
  `docker history` lines per image into the PR body, so the "second 316 MB layer is gone" claim is self-contained.
  The 1.5GB vs 894MB `image ls` figures come from containerd accounting and are correctly labelled as not
  load-bearing.
