## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD bc2831cf2417af70eb0b48a315def723dcfb5485. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn cwd:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/docker-copy-chown-needs-guard/HEL-1428`.
- **Round-2 CR1 (pin down the `needs` key): resolved.** The fix appears in all three places it needs to:
  - **D3:** the needs key is "the one non-comment line in that block indented exactly 4 spaces matching `^    needs:`".
    Comment lines are never read. Zero such lines, or more than one, is an error.
  - **Spec, fail-closed requirement:** "comment lines SHALL never be read as the `needs` list; `ci-complete` having
    more than one `needs` key line SHALL be an error". There is a new scenario, "Comment mentioning needs above the
    real list".
  - **D5 and task 3.1:** both fixtures are added. One is a comment listing all five jobs above a real line with
    `docker-image` dropped, which must go red naming `docker-image`. The other has two job-level `needs:` lines, which
    must go red.
- **The revised rules close the fail-open, checked by simulation.** I implemented the D3 rules exactly as written
  (scratchpad `sim3.py`, run with `python3 -I`) and ran them against the live `.github/workflows/ci.yml`:
  - real file -> `[]` (green on main)
  - round-2 comment attack -> `missing docker-image`
  - duplicate `needs:` -> `needs lines=2`
  - block-list `needs` -> `needs not flow`
  - column-0 comment between jobs plus `docker-image` dropped -> `missing docker-image`
- **Exact-4-space anchoring holds for this file.** A `run: |` block scalar can never put a line at exactly 4 spaces
  inside `ci-complete`. Its content must be indented deeper than its key, and the steps sit at 6 or more spaces. The
  `${{ needs.* }}` expressions in `ci-complete`'s step are at 10 spaces or deeper and are not keys. The 2-space comment
  lines above `ci-complete:` (ci.yml:676-681) are excluded from the job-key check.
- **Round-2 non-blocking notes: both addressed.**
  - D4 now reads "a choice, not a uniform convention". This is consistent with `.husky/pre-commit`:13-27, which runs
    many `:selftest`s.
  - D2 uses `docker run --rm --entrypoint sh <img> -c "find /app -exec stat ..."`, with the same command for both
    images.
- **Dockerfile / D1 runtime contract, re-checked live.**
  - `Dockerfile:3` has `ARG BASE_REGISTRY`, `:32` has WORKDIR, `:33` has COPY, and `:34` has `chown -R helio:helio /app`.
  - D1 replaces this with `COPY --chown=helio:helio --from=builder` plus a non-recursive `chown helio:helio /app /app/data`.
  - Today `/app` holds only the jar and `data`, so the same three inodes end up helio-owned. Modes are unchanged
    (`COPY --chown` does not alter mode).
  - USER, EXPOSE, HEALTHCHECK and ENTRYPOINT are untouched. `ARG BASE_REGISTRY` is explicitly preserved (task 1.2).
  - D2's equivalence evidence: `docker inspect` field diff, in-image stat listing, jar sha256, and `/health` against a
    throwaway postgres on a dedicated network, all cleaned up by exact name. That is enough to prove AC2.
- **Spec hygiene:** `npm run -s check:openspec` printed "openspec/ is clean". `check:spec-structure` passed (462, 0
  issues).
- **AC coverage:** each AC maps to tasks.
  - AC1: 1.1-1.3.
  - AC2: 1.3-1.4.
  - AC3: 3.5 `pr-notes.md`.
  - AC4: 2.1-2.3, 3.1-3.3. The red is demonstrated against the real ci.yml both in memory and through the CLI, and
    there is a mutation check.
  - AC5: D6 and 3.4.
  - I found no scope drift.

### Verdict: CONFIRM

The one remaining round-2 change request is resolved in the design, the spec and the tasks. I found no remaining
fail-open path in the guard's specified algorithm that bears on this file. I found no runtime change in the image plan.

### Non-blocking notes

- **Self-reference gap, inherent to the placement AC4 prescribes.** The guard runs in the `frontend` job. If a commit
  removes `frontend` itself from `ci-complete.needs`, the guard's red in `frontend` no longer gates `ci-complete`.
  - The pre-commit hook still catches this locally, and the PR would still show a red (non-required) `frontend` check.
  - Running the check additionally inside `ci-complete` itself would close the gap fully. That would need a checkout
    and `node` in a 2-minute job, so it is optional.
  - Worth one sentence in the PR body.
- **`needs:` line with a trailing comment.** D3 does not say whether `needs: [a, b]  # note` is accepted. Either
  reading fails closed (rejection) or behaves correctly (acceptance), so this is not a fail-open. The implementer should
  pick one and cover it in the selftest.
- **Trailing comma or empty entry.** An entry like `needs: [a, ]` should be treated as a non-bare entry, which is an
  error. Again, not fail-open either way.
