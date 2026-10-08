# HEL-1299: Get GitHub Actions cache under the 10 GB repo limit with real headroom

## Description

The repo's Actions cache is **over** GitHub's 10 GB per-repo limit, so GitHub is evicting entries before they can be
reused. That undercuts the caching that HEL-1287 and HEL-1288 depend on to cut CI time. **Target: <= 6 GB steady
state**, measured after a normal day of PR and `main` traffic.

**Measured on 2026-10-05** (`gh api repos/matto00/helio/actions/cache/usage` and `.../actions/caches`): **10.79 GB
across 76 entries.**

| Source | Size | Entries | Problem |
| -- | -- | -- | -- |
| `codeql-overlay-base-database-*` (CodeQL default setup) | 3.7 GB | 52 | A new ~140 MB JavaScript base database (plus ~3 MB Python) is written on nearly every `main` push. Old ones are never pruned; they only fall out through eviction. |
| `sbt-<hash>` | 4.5 GB | 5 x 911 MB | Four of these were created by PR #773 while it changed the key. PR-scoped caches can only be used by that PR. 911 MB also looks oversized for `~/.sbt` + `~/.ivy2/cache` + `~/.cache/coursier`. |
| `node-cache-Linux-x64-npm-*` | 1.6 GB | 13 | Includes 198 MB entries scoped to `refs/tags/v0.8.8` and `refs/tags/v0.8.9` (written by the CD workflows on tag push). Tag-scoped caches can never be restored by any other run. |
| `sbt-compile-v2-*` (new in #773) | 70 MB | 1 | The key hashes `backend/src/**`, so every backend change mints a new entry, both per PR and per `main` push. |

**Sequencing:** do this after #773 (HEL-1287) and #774 (HEL-1288) merge (both merged).

**Candidates to verify, not assume:**

* **CodeQL.** Can the overlay-base caching of default setup be bounded? If not, should we switch to an advanced-setup
  `codeql.yml` that controls caching? Consider whether `actions` / `python` analysis earns its place. Do not reduce
  scanning coverage without an owner ruling.
* **sbt.** Find what makes up the 911 MB and trim the cached paths. Consider writing the dependency cache only from
  `main` (`actions/cache/restore` on PRs plus `save` on `main`). Apply the same idea to `sbt-compile-v2`.
* **npm.** Skip cache saves on tag-triggered CD runs.
* **Cleanup.** Consider a small workflow that deletes a PR's caches when the PR closes
  (`gh cache delete --ref refs/pull/N/merge`).

## Acceptance criteria

- [ ] AC1: Cache usage is <= 6 GB, measured via `gh api repos/matto00/helio/actions/cache/usage` at least 24 h after
  merge, with the per-prefix breakdown recorded in the change.
- [ ] AC2: No cache entries are created under `refs/tags/*` by the CD workflows, shown by `gh api .../actions/caches`
  after the next `v*` tag deploy.
- [ ] AC3: A PR that changes `build.sbt` or `backend/src/**` does not create a new 900 MB-class sbt dependency entry
  scoped to that PR (or one is created and cleaned up on close), demonstrated on a real PR.
- [ ] AC4: CodeQL still analyses every language it analyses today, or any reduction carries an explicit owner ruling.
- [ ] AC5: CI wall-clock does not regress. The `backend` and `e2e` job medians over 5 green `main` runs after merge are
  no worse than the HEL-1287/HEL-1288 post-merge numbers, so cache hits are preserved.

## Re-measured baseline (2026-10-08T18:56Z, orchestrator, read-only)

`active_caches_size_in_bytes` = 11,664,011,910 (11.66 GB), 25 entries, all `refs/heads/main` (PR entries evicted).

| Family | Size | Entries |
| -- | -- | -- |
| `backend-compile-v3-Linux-*` (HEL-1287's renamed `sbt-compile-v2`; now also caches `~/.cache/sbt`) | 7,138 MB | 4 (1,720 -> 1,778 -> 1,806 -> 1,834 MB, one per main push, growing) |
| `codeql-overlay-base-database-*-javascript-*` | 1,224 MB | 8 (~153 MB each, one per main push) |
| `codeql-overlay-base-database-*-python-*` | 35 MB | 8 (~4.4 MB each) |
| `sbt-<hash>` | 912 MB | 1 |
| `node-cache-Linux-x64-npm-*` | 220 MB | 2 |
| `Linux-X64-sbt-runner-2.0.9-1.5.3` (sbt/setup-sbt) | 54 MB | 1 |
| `Linux-X64-java21...-sbt-diskcache-...` (sbt/setup-sbt) | 0 MB | 1 |

CodeQL default setup languages today: `actions`, `javascript-typescript`, `python` (weekly schedule, default suite).
Full listing persisted at `.concertino/runs/HEL-1299/evidence/cache-baseline-2026-10-08.tsv`.
