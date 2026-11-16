## Context

See proposal.md (Why) and ticket.md (Premise validation) for the evidence. Current state, from
`.github/actions/e2e-setup/action.yml`: one step `npx playwright install --with-deps chromium`. On an ubuntu-24.04 runner
it runs `apt-get update` over every configured source (the image's `ubuntu.sources` pointing at the Azure mirror list
`/etc/apt/apt-mirrors.txt`, plus `packages.microsoft.com`), then `apt-get install -y --no-install-recommends <list>`,
which installs 9 new and upgrades 8 packages (~26 MB; ~20 MB is four font packages), then downloads chromium and the
headless shell from cdn.playwright.dev (~15 s, never implicated). Callers: ci.yml `e2e` (6 legs, 25 min timeout),
`e2e-prod-build` (8 min), e2e-slow.yml (30 min). HEL-1288 measured caching `~/.cache/ms-playwright` as useless; the
dominant cost was always apt. The HEL-1699 node_modules cache (exact key, main-only save by leg 1, janitor family) is
the house pattern this change follows.

## Goals / Non-Goals

**Goals:** a warm-cache job downloads no `.deb`; a cold or partial fetch is bounded and falls back to a second mirror;
no third-party apt source can fail the install; the package set stays exactly Playwright's.

**Non-Goals:** see proposal.md Non-goals (no timeout or runner-image change, no package dropped, no browser cache).

## Decisions

**D1. Derive the package list from `npx playwright install-deps --dry-run chromium`.** It prints the exact
`apt-get install -y --no-install-recommends <pkgs>` command Playwright would run for this OS (verified locally on 1.55.1).
Parse the package tokens after `--no-install-recommends` up to the closing quote; validate each token against an apt
package-name pattern; fail the step with a named error on an empty or invalid list (spec: "package list cannot be
derived"). Alternative rejected: a hardcoded list (drifts silently on Playwright bumps). Then run
`npx playwright install chromium` (no `--with-deps`) for the browser, unchanged otherwise.

**D2. Run apt with an explicit, Ubuntu-only, per-attempt option set.** Each attempt builds its own option set:
`Dir::Etc::SourceList=<attempt>/sources.list` (empty) + `Dir::Etc::SourceParts=<attempt>/sources.list.d/` holding
one file, a copy of the runner image's Ubuntu deb822 sources file (`ubuntu.sources`) with only the `URIs:` values
replaced — keeping its `Suites`, `Components`, `Signed-By` exactly — and `Dir::State::Lists=<attempt>/lists/`. This
excludes `packages.microsoft.com` and every other third-party source, and redirecting the lists directory means no
`apt-get update` here prunes or rewrites `/var/lib/apt/lists` (system apt state is untouched). Attempt 1 keeps the
image's own `URIs:` (the Azure mirror list); attempt 2 replaces them with `http://archive.ubuntu.com/ubuntu/` (and
`http://security.ubuntu.com/ubuntu/` for a `-security` stanza if the image splits it). **Every apt call after an
attempt succeeds — the offline install and the `dpkg-query`-based prune — uses that winning attempt's full option set**
(same sources dir, same lists dir, same archive dir); a selftest pins this (attempt 2 wins -> install is invoked with
attempt 2's options). Alternative rejected: deleting `microsoft-prod.list` — fixes the 403 but not the stall, and
depends on the file's name. The script fails with a named error if it finds no Ubuntu deb822 sources file with a
`URIs:` line; it never falls back to the system's full source set. Executor MUST confirm the runner's actual source
file names and contents from a CI log before relying on them (print them once in the step).

**D3. Cache `.deb` archives in a dedicated directory.** `Dir::Cache::Archives=$HOME/.cache/e2e-apt-debs/` with
`APT::Keep-Downloaded-Packages=true`. `ImageOS` is a runner-machine environment variable, not a workflow `env:` value,
so `${{ env.ImageOS }}` would be empty: a shell step computes the OS segment from `$ImageOS`, falling back to
`/etc/os-release` `ID`+`VERSION_ID` (e.g. `ubuntu24.04`), fails if it is still empty, and exposes it as a step output.
Restore with `actions/cache/restore` key `e2e-apt-debs-v1-<os>-${runner.arch}-none`, restore-keys
`e2e-apt-debs-v1-<os>-${runner.arch}-`; the logged key MUST show a non-empty OS segment. Prefix restore is safe: apt
reuses a cached `.deb` only when its filename (which encodes package, version and arch) and size match the candidate
from the fresh index, and Ubuntu never republishes a version, so a stale file is ignored, never installed. Install is two-phase: (a) `apt-get update` + `apt-get install --download-only`
under the D4 bound — fetches only what is missing; (b) `apt-get install --no-download` — offline, from the archive dir.
After install, prune the dir to the `.deb` files whose name+version equal the installed version (`dpkg-query`), drop
`partial/`, `chown` to the runner user. The script records the archive file set before the download phase and after
it; `downloaded` = the count of files present after that were absent before. Save key = prefix + sha256 of the sorted
remaining (pruned) file names. Save **only when `downloaded > 0`** (the spec rule; pruning alone never triggers a save),
only on a main push, only in the job with the new input `save-apt-cache: "true"` (ci.yml `e2e` leg 1, the job already
saving node_modules). A selftest pins: prune-only change -> no save; one new download -> save. The index
refresh (12.5 MB, never observed slow) is not cached: freshness of the index is what keeps security updates current.

**D4. Bound each attempt with `timeout -k 10 90`** (SIGTERM at 90 s, SIGKILL 10 s later, so a process ignoring
TERM cannot stretch the bound). Each attempt (update + download-only) runs under it with
`Acquire::Retries=2` and `Acquire::http::Timeout=20`. Healthy runs fetch 26 MB in 1-2 s and the index in <=13 s, so
90 s is >3x the worst healthy observation. Worst case total = 2 x (90 s + 10 s kill grace) = 200 s, vs today's unbounded 7-14 min; the
8-minute e2e-prod-build budget keeps >4 min for the rest (its healthy total setup is ~4 min including the build).
Both attempts failing => `::error::` naming the stalled fetch and mirror, exit 1. No `timeout-minutes` changes.
Alternative rejected: apt has no minimum-speed abort, so apt options alone cannot cut a 20 kB/s trickle.

**D5. Logic lives in a script, not inline YAML.** `scripts/e2e-apt-deps.sh` (bash, `set -euo pipefail`) owns D1-D4's
shell logic; the action calls it between the restore and save steps. It is unit-tested by a
`scripts/e2e-apt-deps.selftest.sh` following the existing `*.selftest.*` convention (list parsing, mirror-URI
extraction, prune selection, save-key computation, timeout fallback with stub `apt-get`/`timeout`). Executor wires it
wherever the other selftests run (check how `e2e-backend-lane.selftest.sh` is invoked).

**D6. Janitor.** Add `{ name: "e2e-apt-debs", re: /^e2e-apt-debs-v\d+-/, keep: 1 }` to `scripts/cache-janitor.mjs`
FAMILIES and a case to `cache-janitor.selftest.mjs`.

## Verification plan (CI evidence is the proof; local tests are necessary, not sufficient)

1. Before: per-job duration of the `Install Playwright browsers` sub-step, from job logs (`##[end-action ... run_4`
   `duration_ms`), for the main/PR runs listed in ticket.md. Orchestrator data: healthy ~45-50 s; stalls 450-890 s.
2. 403 red/green: reproduce a failing third-party source (a temp `/etc/apt/sources.list.d/` entry whose `InRelease`
   403s or is unsigned) in a local `ubuntu:24.04` container (nice -n 19, one container) or a temporary CI commit:
   `npx playwright install --with-deps chromium` fails; the new script succeeds.
3. Stall bound, reproducing the observed failure (a slow trickle, not a dead mirror): a temporary commit (cold
   cache) adding `Acquire::http::Dl-Limit=25` (kB/s) to attempt 1 only shows attempt 1 killed at ~90 s and attempt 2
   succeeding; a second temporary run throttling both attempts ends in the named error at ~180 s. A dead or silent
   mirror is not acceptable evidence for this item (it fails at connect time or trips apt's own timeout).
4. Warm path: a temporary commit allowing save on this PR's ref, then a run showing zero `.deb` downloads. After the
   evidence is recorded, delete that PR-ref entry (`gh cache delete <key>`), revert the temporary commit, and confirm
   `gh cache list --ref refs/pull/<N>/merge` shows no `e2e-apt-debs-*` entry, so the cache-budget scenario holds at
   review time. (The final head run is therefore a cold-path run; the warm path is evidenced by the recorded run.)
5. After: sub-step durations across >=3 full PR runs (8 e2e jobs each + e2e-slow), cold and warm, in a table.
6. Post-merge (not a pre-merge gate): AC "5 consecutive main runs with no apt-caused cancel" and the after-merge
   deps-step durations across those main runs are a watch item, reported in the hand-off.

## Risks / Trade-offs

- [Image source layout differs from assumption] -> D2 requires reading it from a real CI log first; script fails
  loudly if it cannot find an Ubuntu mirror URI, never silently falls back to all sources.
- [Alternate mirror also slow] -> bounded; named failure; one runner-infra rerun allowed by policy.
- [Cache entry ~26 MB] -> single generation via janitor; far under the 10 GB budget.
- [apt sandbox warning writing to a custom archive dir as root] -> cosmetic; documented if seen.
- [Playwright changes dry-run output format] -> parse failure is loud (D1); selftest pins the current format.

## Migration Plan

Merge; first main push saves the cache from leg 1; subsequent runs restore it. Rollback = revert the commit (the old
one-line step); stale `e2e-apt-debs-*` entries are pruned by the janitor or expire after 7 days unused.

## Planner Notes

- Self-approved: new script + selftest, new action input, janitor family. No new external dependency, no API change.
- Check whether `check:precommit-ci-parity` (precommit-ci-parity-guard spec) requires the new selftest in
  `.husky/pre-commit` too. If wiring it there is required, that touches the commit-gate chain: add a
  `## Gate-Chain Implications Checklist` to this design.md answering the five questions before Delivery.
- `ci.yml`'s `paths` filters for e2e-slow already include `.github/actions/e2e-setup/**`; the new script under
  `scripts/` must be added to any such filter that should retrigger e2e-slow (executor to check).
