## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/e2e-browser-deps-install/spec.md,
specs/ci-actions-cache-budget/spec.md (all uncommitted in the worktree; HEAD afca73bc8ac9bf039937b2d21fcef459573a3650).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/e2e-apt-deps-cache/HEL-1700`.
- **403 premise (verified):** job 120089196328 log, lines 726-749: `Err:6 https://packages.microsoft.com/ubuntu/24.04/prod
  noble InRelease 403 Forbidden`, then `is no longer signed`, `Installation process exited with code: 100`, step
  `duration_ms=13227`. The Azure Ubuntu indexes in the same update succeeded, so the failure is only the
  third-party source.
- **Stall premise (verified):** job 120006478323 lines 893-914: index fetch `Fetched 12.5 MB in 13s`, then .deb fetch
  from `azure.archive.ubuntu.com` (fonts-ipafont-gothic, fonts-freefont-ttf, fonts-unifont, fonts-wqy-zenhei,
  libglib2.0*, libnss3*, xfonts-*, xvfb), `Fetched 22.4 MB in 12min 54s (28.9 kB/s)`; `8 upgraded, 9 newly
  installed`, `Need to get 25.9 MB`. Image `ubuntu-24.04` 20261012.334.1, sources via `file:/etc/apt/apt-mirrors.txt`
  Mirrorlist (mirror+file method). No individual file stopped long enough to trip a no-data timeout: a trickle,
  so the design's point that apt options alone cannot bound it (D4) is right.
- **Dry-run format (verified locally, Playwright 1.55.1):** `npx playwright install-deps --dry-run chromium` prints
  `sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends <pkgs>"`. That matches D1's parse
  target. (The local host is Arch, so it printed the ubuntu20.04 fallback list. Task 1.2 rightly requires the
  runner's own output. The parser must accept both the `sudo -- sh -c` form and the form with no sudo.)
- **Timeout budget:** ci.yml:677-678 `e2e-prod-build` `timeout-minutes: 8`, healthy 196 s measured (HEL-1691 note).
  With both attempts at the bound: 196 + 180 = 376 s < 480 s. The 90 s bound is sound and no timeout changes.
- **Spec deltas vs existing `openspec/specs/ci-actions-cache-budget/spec.md`:** the MODIFIED requirements copy the
  existing text, add the apt cache, and keep every existing scenario. The janitor family shape matches
  `scripts/cache-janitor.mjs` FAMILIES (lines 14-27).
- **Selftest wiring:** `e2e-backend-lane.selftest.sh` runs via package.json `selftest:e2e-backend-lane`, and
  ci.yml:161 invokes that. So D5's "wire it the same way" has a real precedent.
- **e2e-slow paths filter:** e2e-slow.yml:13-15 lists `.github/actions/e2e-setup/**`. Task 3.3 is needed and correct.

### Verdict: REFUTE

The approach is right: an archive cache as the primary mitigation, a hard `timeout` bound plus a second mirror,
an Ubuntu-only source config, a Playwright-derived package list, and no timeout or image change. Four
specific gaps, though, would let a competent implementer build something broken or "prove" it with
non-evidence. All four are cheap artifact edits.

### Change Requests

1. **Phase (b) must use the same source config as the attempt that succeeded (design D2/D3, task 2.1).** D3 says
   "(b) `apt-get install --no-download` — offline" but never says which `Dir::Etc::SourceList`/`SourceParts` it
   runs with. Each `apt-get update` drops list files for sources that are not in its config. So:
   - if attempt 2 (archive.ubuntu.com) succeeded and phase (b) runs with the attempt-1 or system config, the
     lists it needs are absent or stale;
   - candidate resolution then differs from what was downloaded;
   - `--no-download` fails with "Unable to locate package" or a missing-archive error.

   State explicitly that update, download-only and install --no-download all run with one identical option set
   (source config, `Dir::Cache::Archives`, `--no-install-recommends`, the same package list), taken from the
   attempt that succeeded. Add a selftest case asserting phase (b) receives the attempt-2 config after an
   attempt-1 timeout.

2. **The cache key's OS component must not come from `${{ env.ImageOS }}` (design D3).** `ImageOS` is an
   environment variable of the runner machine, not a workflow-defined `env` value. The expression `env`
   context contains only workflow/job/step `env:` values, so `${{ env.ImageOS }}` evaluates empty. That gives
   the key `e2e-apt-debs-v1--X64-...`, which silently drops the OS-release separation the new spec requires
   ("cache key SHALL include the runner OS image family"). Specify that the key's OS part is computed in a
   shell step (for example `$ImageOS` read in bash, or `/etc/os-release` `VERSION_CODENAME`) and passed to
   `actions/cache/restore`/`save` as a step output. Add a check that the logged key has a non-empty OS segment.

3. **The stall verification must exercise a trickle, not an unreachable mirror (design Verification plan 3,
   task 4.2).** An unreachable mirror fails at connect time in milliseconds, and a black hole trips apt's own
   `Acquire::http::Timeout`. Neither proves that the `timeout 90s` bound cuts the observed failure, a live
   20-30 kB/s transfer that never stops sending. That is evidence-shaped non-evidence. Require the attempt-1
   leg of the temporary verification commit to:
   - run cold (no cache restore);
   - use a real rate limit, e.g. `-o Acquire::http::Dl-Limit=25` (apt's built-in KB/s throttle) or a local
     throttling proxy;
   - show the log line where `timeout` kills attempt 1 at about 90 s, and then attempt 2 succeeding.

   The both-fail case must also be a trickle on both attempts, ending in the named `::error::`. Keep the
   unreachable-mirror case only as an additional scenario.

4. **Make the save rule, the spec and the PR-scoped verification entry agree.**
   - (a) The new spec says the apt cache is saved "only when that job had to download at least one archive that
     the restored cache did not hold". D3 saves whenever the pruned file-name hash differs from
     `cache-matched-key`. Pruning alone (for example a newer runner image that already ships a package version,
     so its `.deb` is dropped) changes the hash with nothing downloaded, and the run saves anyway. Either
     condition the save on "downloaded > 0", or reword the spec requirement and the "nothing new downloaded"
     scenario to "the pruned archive set differs from the restored entry".
   - (b) Verification plan 4 / task 4.3 deliberately creates an `e2e-apt-debs-*` entry on `refs/pull/<N>/merge`,
     and the plan says the final head run restores it. That makes the MODIFIED ci-actions-cache-budget scenario
     "no `e2e-apt-debs-*` cache entry scoped to `refs/pull/<N>/merge` exists for that PR" observably false at
     the evaluated head. Add a step that deletes that entry (`gh cache delete <id>`) after the warm-path evidence
     is recorded, and add to task 4.5 the check `gh cache list --ref refs/pull/<N>/merge` shows no
     `e2e-apt-debs-*` entry. Alternatively, get the warm-path evidence some other way that never writes a PR
     ref.

### Non-blocking notes

- D3 overstates apt's reuse check. For a file already in the archives dir, apt matches on the version-bearing
  filename (`name_version_arch.deb`) plus the size from the index, not a full checksum. It is still safe here:
  Ubuntu never republishes a version with different bytes, and the cache is written only by main CI. Fix the
  wording so a later reader does not rely on a checksum guarantee that does not exist.
- Use `timeout -k 10 90` (or an equivalent hard-kill fallback) so an apt process that ignores or slowly handles
  SIGTERM, possibly behind `sudo`, cannot extend the bound. Wipe or ignore `partial/` between attempts if
  resuming a partial file from a different mirror is a concern (apt normally resumes with Range).
- D2 temp source config: copy the image's `ubuntu.sources` stanzas, keeping `Types`, `Suites`, `Components` and
  `Signed-By`, and change only `URIs` for attempt 2, rather than synthesising stanzas. The image currently also
  carries `noble-backports` and `restricted` (log lines 811-823). Dropping either is fine only if Playwright's
  list never resolves from them; the runner probe in task 1.1 should confirm this.
- D2 says the step is side-effect-free on `/etc/apt`. But `apt-get update` with a restricted source list still
  prunes `/var/lib/apt/lists` entries for other sources (for example microsoft-prod) unless `Dir::State::Lists`
  is also redirected. This is harmless on an ephemeral runner; just don't claim otherwise.
- The AC asks for before/after measurement "across main runs". The plan measures PR runs before merge and only
  watches for cancels after merge. Add post-merge main-run step durations to the watch item so the AC's own
  wording is met.
- Check whether `check:precommit-ci-parity` requires the new selftest npm script in `.husky/pre-commit` too.
- The design needs no owner call: no timeout, image or paid-service change. No escalation required.
