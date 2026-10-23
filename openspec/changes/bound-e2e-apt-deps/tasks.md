## Standing Constraints

- [C1] Stall-bound evidence must reproduce a slow trickle (Acquire::http::Dl-Limit, cold cache); a dead or silent
  mirror is not evidence.
- [C2] After an attempt succeeds, every later apt/dpkg call (offline install, prune) uses that attempt's full option
  set (sources, lists, archives dirs).

## Implementation notes from the design gate (round 2, non-blocking)

- apt names cached files with the epoch colon encoded as `%3a` (e.g. xvfb `2:21.1.12-...` ->
  `xvfb_2%3a21.1.12-..._amd64.deb`); `dpkg-query` prints `2:`. The prune MUST normalise this, or xvfb is pruned and
  re-downloaded every run (and every main push saves). Add an epoch case to the selftest.
- `mkdir -p` the `partial/` dirs under both the custom archive dir and the custom lists dir before every apt call.
- Worst case with `timeout -k 10 90` is 2 x 100 s = 200 s; state that number, not "3 min".
- apt's `_apt` sandbox warning on a custom archive dir is cosmetic; do not treat it as a failure.

## 1. Probe the runner (before writing the script)

- [x] 1.1 From an existing CI job log or a first CI push, record the runner's `/etc/apt/sources.list.d` file names and
  the Ubuntu `URIs:` value, and `ImageOS`; verify by quoting the log lines in the PR body / evidence notes.
- [x] 1.2 Record `npx playwright install-deps --dry-run chromium` output on the runner (ubuntu 24.04), and confirm its
  package list equals the 2026-10-22 job logs' list; verify by quoting both.

## 2. Install script

- [x] 2.1 Write `scripts/e2e-apt-deps.sh` implementing design D1-D4 (list derivation, Ubuntu-only source config,
  archive dir, two bounded attempts on two mirrors, offline install, prune, save-key output); verify with
  `bash -n` and `shellcheck` (if installed).
- [x] 2.2 Write `scripts/e2e-apt-deps.selftest.sh` covering: list parse (valid / empty / malformed), sources-file
  URI rewrite (Suites/Components/Signed-By preserved), missing-sources named error, prune selection, save-key
  stability, `downloaded` count (prune-only change -> no save; one new file -> save), attempt-1-timeout -> attempt-2
  path, **attempt 2 wins -> the offline install and prune use attempt 2's full option set**, both-fail named error
  (stub `apt-get`/`timeout`/`dpkg-query` on PATH); verify it passes, and that breaking the fallback or the
  option-set hand-off makes it fail.
- [x] 2.3 Wire the selftest wherever the existing `*.selftest.sh` scripts run; verify by showing the invocation.

## 3. Action and workflow wiring

- [x] 3.1 In `.github/actions/e2e-setup/action.yml`: compute the OS key segment in a shell step (from `$ImageOS`,
  falling back to `/etc/os-release`; fail if empty) as a step output, restore the apt cache, run the script, install chromium with
  `npx playwright install chromium`, save the apt cache under D3's conditions; add input `save-apt-cache`
  (default "false"); update the header comment; verify with an actionlint run if available and in CI.
- [x] 3.2 Pass `save-apt-cache: "true"` from ci.yml `e2e` leg 1 only; verify by grep that no other caller passes it.
- [x] 3.3 Add `scripts/e2e-apt-deps.sh` to any `paths` filter that lists `.github/actions/e2e-setup/**`; verify by grep.
- [x] 3.4 Add the `e2e-apt-debs` janitor family + selftest case; verify `node scripts/cache-janitor.selftest.mjs`.
- [x] 3.5 Check `check:precommit-ci-parity`: if it requires the new selftest in `.husky/pre-commit`, wire it there and
  add design.md's `## Gate-Chain Implications Checklist`; verify by running the parity check.

## 4. CI evidence (design "Verification plan")

- [x] 4.1 403 red/green (old command fails, new script passes) with a failing third-party source; record output.
- [x] 4.2 Stall bound with a reproduced slow trickle (cold cache, `Acquire::http::Dl-Limit=25` on attempt 1 only):
  attempt 1 killed at ~90 s, attempt 2 succeeds; throttling both -> named error at ~180 s. A dead/silent mirror is not
  acceptable evidence. Revert; record run links and log excerpts.
- [x] 4.3 Warm path: temporary PR-ref save, then a run with zero `.deb` downloads; record it, then
  `gh cache delete` the PR-ref `e2e-apt-debs-*` entry and revert the temporary commit; record run links.
- [x] 4.4 Before/after timing table of the deps sub-step across >=3 full PR runs (cold and warm), all 8 e2e jobs +
  e2e-slow; write it to `openspec/changes/bound-e2e-apt-deps/measurements.md`.
- [x] 4.5 Final head has no temporary verification code (verify by diff against the base), and
  `gh cache list --ref refs/pull/<N>/merge` shows no `e2e-apt-debs-*` entry; the logged cache key has a non-empty OS
  segment.
