## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD bc2831cf2417af70eb0b48a315def723dcfb5485 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn cwd:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/docker-copy-chown-needs-guard/HEL-1428`.
- **Dockerfile premise:** `Dockerfile:3` `ARG BASE_REGISTRY=docker.io/library` (HEL-1452). `:28` runtime FROM, `:30` addgroup/adduser,
  `:32` `WORKDIR /app`, `:33` `COPY --from=builder ... helio-backend.jar`, `:34` `RUN mkdir -p data && chown -R helio:helio /app`,
  `:36` `USER helio`, `:38` EXPOSE, `:40-41` HEALTHCHECK, `:44-62` ENTRYPOINT. Matches design's Context. The two 316 MB layers
  come from premise-validation.md (CI run 37997304485); task 1.1/1.3 re-measure locally, so it does not rest on that claim alone.
- **D1 runtime contract (sound):** `/app` is created root:root by WORKDIR, so today's only helio-owned things are `/app`,
  `/app/data` and the jar. `COPY --chown=helio:helio` (names resolve because adduser runs at `:30`, before the COPY) plus
  `chown helio:helio /app /app/data` gives the same owner on exactly those three inodes. Mode bits: `chown -R` never changed
  modes, `COPY --chown` keeps the source mode, `mkdir` under the same umask gives the same `data` mode. No other files under
  `/app`. USER/ENTRYPOINT/HEALTHCHECK/EXPOSE/WORKDIR lines are not touched. Chowning `/app` too (beyond the ticket's
  "data only" wording) is right: a data-only chown would flip `/app` to root:root, which is a runtime change AC2 forbids.
  The RUN layer then stores two directory inodes, not the jar.
- **D2 verification plan (sound, safe):** exact tags `helio-backend:hel1428-before/after`, dedicated network and
  `postgres:16` container with exact names, never the shared dev DB, exact-name removal, `nice -n 19`. Inspect diff covers
  User/Entrypoint/Cmd/Healthcheck/ExposedPorts/WorkingDir/Env; `stat` listing covers file set + owner + mode + size; jar
  sha256 proves identical bytes. That covers every AC2 item. Falling back to metadata equivalence if `/health` cannot come up
  is what AC2 allows.
- **ci.yml topology:** `ci.yml` has 6 top-level jobs at 2-space indent: `frontend:21`, `backend:146`, `security:311`,
  `e2e:499`, `docker-image:663`, `ci-complete:682`. `:684` `needs: [frontend, backend, security, e2e, docker-image]` is the
  only `needs:` line in the file. Column-0 comments appear only at `:12-15`, before `jobs:`, and the file ends inside
  `jobs:`. So the guard would be green on main as claimed. The `${{ needs.*.result }}` text in ci-complete's step does not
  match the single-line `needs:\s*\[` form.
- **Parity check:** `scripts/check-precommit-ci-parity.mjs` header confirms it is CI-only on purpose and parses `needs` by
  regex. Adding `npm run check:ci-complete-needs` to `.husky/pre-commit` needs that script, or its `node <path>`, to appear
  in a ci-complete-needed job's `run:`. D4 puts it in `frontend` (`ci.yml:136-137` neighbourhood), so parity stays green.
- **Hook wiring justified:** AC4 says the guard "runs in `.husky/pre-commit` and in a `ci-complete`-required CI job".
  So the hook change is required by the ticket, not scope drift. Keeping the selftest CI-only matches the stated
  convention at `ci.yml:128-130` and `:139-140`. The gate-chain checklist is answered and plausible: node built-ins only,
  no env, no writes, repo root from `import.meta.url`.
- **Red is real (D5):** an in-memory removal from the real `ci.yml`, a CLI red on a scratch copy, and a mutation of the
  missing-job comparison. All three would fail if the guard were vacuous. The selftest is a standalone node script (not
  jest), which avoids the HEL-880 vacuous-jest trap.
- **AC5 / D6:** `ci.yml:666` `timeout-minutes: 8`. The design does not change it.

### Verdict: REFUTE

The Dockerfile half is sound. The guard half claims to fail closed, but it has one ambiguity that can be read as
fail-open, and one input shape that silently passes. One AC has no task. All three are cheap to fix now and expensive
to find later.

### Change Requests

1. **D3: define the end of the `jobs:` block precisely. One reading is fail-open.** D3 says the block runs "to the next
   column-0 key". An implementer could reasonably write that as `^\S`, meaning any non-indented line. Under that
   reading, a column-0 `# ---- section ----` comment between two jobs would end the block early. Every job after it
   would then be invisible, and a missing job could pass green. Revise D3 to say the block ends only at the next
   column-0 line matching a YAML key (`^[^\s#][^:]*:`), and that blank lines and column-0 comment lines inside the
   block are skipped. Add a selftest fixture: a column-0 comment between two jobs, the later job missing from `needs`,
   and an assertion that the check reports that job.
2. **D3: fail closed on any 2-space-indented line inside `jobs:` that is not a recognized job id.** Job ids come only
   from lines matching `^  ([A-Za-z0-9_-]+):`. A quoted key such as `  "lint":` or `  'lint':` is valid YAML and a
   valid GitHub job. It would not match, so the job would be silently skipped and the check would pass. That
   contradicts AC4's "fails closed when it cannot parse the jobs". Make any non-blank, non-comment line with exactly
   2-space indentation that does not match the id regex an error naming the line. Also state how quoted `needs`
   entries are handled: either strip quotes, or reject them as a "not a defined job" error. Either is fine, but the
   design must say which. Add a selftest fixture for each, and add the 2-space condition to the "guard fails closed"
   requirement in `specs/ci-required-jobs-guard/spec.md`.
3. **AC3 is not covered by any task.** The proposal's Risks and D2 mention a post-release `/health` check "in the PR
   body", but `tasks.md` has no item that produces that PR-body text. Add a task, for example 3.5: "Draft the PR-body
   post-release check: CD deploys the tagged revision and `/health` returns 200 (owner/driver, no release cut here)".
   Record it somewhere the PR step reads, such as the change's evidence or `files-modified.md` notes.

### Non-blocking notes

- D6 says "73 successful runs, 143-213 s". premise-validation.md says "59 runs, 143-203 s". Probably a later re-query,
  but the evidence recorded by task 3.4 should give the query window and the final numbers so the two can be reconciled.
- D2 publishes on `127.0.0.1:<BACKEND_PORT>`. If this lane's own dev backend is already on that port, `docker run`
  will fail to bind. Pick a free port and record it.
- D2 does not say which `BASE_REGISTRY` the local before/after builds use. Use the same value for both builds, and
  record it. `mirror.gcr.io/library` avoids Docker Hub 429s and gives the same digests per HEL-1452.
- The spec scenario "exactly one layer has a size on the order of the application jar" is loose: the JRE base layer
  is also large. Prefer "no layer other than the jar COPY is >= the jar's size, and the RUN chown layer is under 1 MB".
