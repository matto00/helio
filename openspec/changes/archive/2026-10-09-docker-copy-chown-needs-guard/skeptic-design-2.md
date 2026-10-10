## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD bc2831cf2417af70eb0b48a315def723dcfb5485. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn cwd:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/docker-copy-chown-needs-guard/HEL-1428`.
- **Round-1 CR1 (end of the jobs block): resolved.** D3 now says the block ends only at the next column-0 YAML key
  `^[A-Za-z0-9_"'-][^:]*:`, and comment lines at any indent never end it. Spec: "Comment lines, including column-0
  comments between jobs, SHALL NOT end the jobs mapping", with a matching scenario. D5 and task 3.1 add the fixture.
  I simulated the D3 rules with awk on the real `ci.yml`. The block never ends early, and it yields exactly
  `frontend:21, backend:146, security:311, e2e:499, docker-image:663, ci-complete:682`.
- **Round-1 CR2 (non-bare 2-space keys, quoted needs entries): resolved.** Every non-comment line at exactly 2-space
  indent must match `^  ([A-Za-z0-9_-]+):\s*(#.*)?$`, or it is an error. Quoted needs entries are rejected, not
  stripped. The spec's fail-closed requirement covers both, and fixtures are planned. The same awk simulation found
  zero BAD lines in the real `ci.yml`, so the strict rule is green on main. Indentation edge cases also fail closed:
  4-space or flow-mapping `jobs` produce zero jobs, which is an error, and an inline `  lint: {…}` does not match the
  regex, which is also an error.
- **Round-1 CR3 (AC3): resolved.** Task 3.5 writes `pr-notes.md`, which includes the AC3 post-release check. The
  design's Risks section quotes the wording.
- **Round-1 non-blocking notes:** all four were addressed. D6 now gives the final numbers (73 successes, 143-213 s)
  and the query window. D2 uses a free port instead of `BACKEND_PORT` and the same recorded `BASE_REGISTRY` for both
  builds. The image spec scenario now reads "only layer containing it, no RUN layer re-stores it".
- **Dockerfile / D1 (re-checked live):** `Dockerfile:3` `ARG BASE_REGISTRY`, `:30` adduser before `:32` WORKDIR,
  `:33` COPY, `:34` `chown -R`. D1 makes the jar owned at COPY time and does a non-recursive
  `chown helio:helio /app /app/data`. That gives the same three helio-owned inodes as today, with no other files under
  `/app` and modes unchanged. USER, EXPOSE, HEALTHCHECK and ENTRYPOINT are not touched. The runtime contract holds.
- **Spec deltas:** `npm run -s check:openspec` printed "openspec/ is clean". `check:spec-structure` passed (462, 0
  issues). `openspec/specs/ci-production-image-build` exists, so ADDED-to-existing is correct.
- **Remaining fail-open path, reproduced:** D3 says only that `needs` "must match the single-line `needs: [a, b]` form".
  It does not say which line inside `ci-complete`'s block is the `needs` key. The neighbouring helper an implementer
  will naturally mirror, `scripts/check-precommit-ci-parity.mjs:98`, uses an unanchored first match
  `/needs:\s*\[([^\]]*)\]/`. I ran that helper on the real `ci.yml` with one edit: `docker-image` removed from the real
  `needs` line, and a comment `    # previously: needs: [frontend, backend, security, e2e, docker-image]` placed above
  it. It returned `["frontend","backend","security","e2e","docker-image"]`. So `docker-image` reads as required while
  it is actually missing, and the guard passes green.

  This is not contrived for this file. `ci.yml` already documents `needs` in comments: `:134`, `:149` (`` `needs:
  backend` ``) and `:508` (`ci-complete (needs: e2e)`). This is the same class of defect as round-1 CR1 (comment
  handling), applied to the needs lookup instead of the jobs block. The probe script is in this session's scratchpad.
  No repo writes were made.

### Verdict: REFUTE

Round-1 CRs 1-3 are resolved for real, not just reworded. The Dockerfile half is sound. One fail-open remains in the
guard's `needs` lookup, and it is cheap to close in the design now.

### Change Requests

1. **D3 + `specs/ci-required-jobs-guard/spec.md`: pin down the `needs` key exactly.**
   - Inside `ci-complete`'s block, the needs key is a non-comment line at exactly 4-space indent, matching
     `^    needs:` (the job-level key). Comment lines at any indent, and deeper-indented lines, are never treated as the
     needs key.
   - More than one such line is an error.
   - Add to the spec's "guard fails closed" requirement: comment lines SHALL NOT be read as the `needs` list.
   - Add a selftest fixture to D5 and task 3.1. Start from the real `ci.yml`, put a comment containing the full
     `needs: [frontend, backend, security, e2e, docker-image]` above the real needs line, and drop `docker-image` from
     the real line. The guard must go red naming `docker-image`.
   - Add a second fixture with a duplicate job-level `needs:`, which must go red.

### Non-blocking notes

- D4 says the selftest stays CI-only "matching the convention". `.husky/pre-commit` actually runs many `:selftest`s,
  for example `check:openspec:selftest` and `check:dependabot:selftest`. Only some families are CI-only. Either choice
  satisfies AC4. Just don't cite the CI-only choice as a uniform convention in the PR body.
- D2 listing: `find /app -exec stat -c ...` needs `docker run --entrypoint` (the ENTRYPOINT is java). Busybox `stat -c`
  on alpine supports `%n %U:%G %a %s`. That is fine, but use the same invocation for both images.
- A column-0 line with no colon (for example a `---` document marker) neither ends the block nor counts as a job. That
  is harmless, since it cannot hide a 2-space job key.
