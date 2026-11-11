# HEL-1700 measurements

All durations are `duration_ms` from the `##[end-action ...]` lines of per-attempt job logs, fetched with
`gh api repos/{owner}/{repo}/actions/jobs/<job_id>/logs --allow-escape-sequences` (not `gh run view --job`).
"deps" = the step that installs chromium's system packages: BEFORE it is the one step `Install Playwright browsers`
(`npx playwright install --with-deps chromium`, apt plus the ~15 s browser download); AFTER it is the new
`e2e-apt-deps` step (`scripts/e2e-apt-deps.sh run`), with the `Restore apt archive cache` step and the (now
`--with-deps`-less) `Install Playwright browsers` step (browser download only) listed separately.

## 1. Runner probe (tasks 1.1, 1.2)

From job 120139494241 (CI 39869337704, e2e (3)) and every later log; the step prints this once:

```
e2e-apt-deps: ImageOS=ubuntu24; sources in /etc/apt/sources.list.d:
e2e-apt-deps:   microsoft-prod.list
e2e-apt-deps:   ubuntu.sources
e2e-apt-deps: --- /etc/apt/sources.list.d/ubuntu.sources
e2e-apt-deps:   Types: deb
e2e-apt-deps:   URIs: mirror+file:/etc/apt/apt-mirrors.txt
e2e-apt-deps:   Suites: noble noble-updates noble-backports
e2e-apt-deps:   Components: main universe restricted multiverse
e2e-apt-deps:   Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
e2e-apt-deps:   Types: deb
e2e-apt-deps:   URIs: mirror+file:/etc/apt/apt-mirrors.txt
e2e-apt-deps:   Suites: noble-security
...
```

Two files: `microsoft-prod.list` (the third-party source behind the 403) and `ubuntu.sources`. Note `ImageOS` is
`ubuntu24` (not `ubuntu24.04`), so the logged cache key prefix is `e2e-apt-debs-v1-ubuntu24-X64-` (non-empty OS segment).

`npx playwright install-deps --dry-run chromium` on the runner (same job) printed:

```
sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends libasound2t64 libatk-bridge2.0-0t64 ... xvfb fonts-noto-color-emoji fonts-unifont libfontconfig1 libfreetype6 xfonts-cyrillic xfonts-scalable fonts-liberation fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-freefont-ttf"
```

The pre-change job logs (e.g. 120006478226, main 39830913828) do not print the requested list, only apt's resolution.
Comparing the resolutions: pre-change `The following NEW packages will be installed: fonts-freefont-ttf fonts-ipafont-gothic
fonts-tlwg-loma-otf fonts-unifont fonts-wqy-zenhei xfonts-cyrillic xfonts-encodings xfonts-scalable xfonts-utils` +
`upgraded: gir1.2-glib-2.0 libglib2.0-0t64 libglib2.0-bin libglib2.0-data libnss3 libnss3-tools xserver-common xvfb`
(`8 upgraded, 9 newly installed`, 25.9 MB); the new script's install (job 120139494241) shows the identical 9 NEW + 8
upgraded (`8 upgraded, 9 newly installed`). Package set unchanged.

## 2. Before: the single `--with-deps` step, runs since HEL-1698

`Install Playwright browsers` (`__run_4`) duration, first attempts unless noted. "stall" = the apt `.deb` fetch crawled
at 20-30 kB/s (the 4 font packages); cancelled = killed by the job timeout while still in that step.

| Run | Job | Step ms | Outcome |
| --- | --- | ---: | --- |
| main 39727278329 (da39f0f14) | e2e (1)-(6) | 33152-40026 (6 legs) | success |
| main 39727278329 | e2e-prod-build | 33899 | success |
| main 39830913828 (14c08def8) | e2e (2) / (3) / (4) | 46829 / 42666 / 39298 | success |
| main 39830913828 | e2e (5) / (6) | 79309 / 78848 | success (slow) |
| main 39830913828 | **e2e (1)** (job 120006478323) | **834881** | success but 13.9 min (`Fetched 22.4 MB in 12min 54s`) |
| main 39830913828 | **e2e-prod-build** (job 120006478226) | **458497** | **cancelled** at the 8 min timeout |
| main 39849054515 (b0f1c89ab) | all 7 jobs | 34499-47938 | success |
| main 39853673220 (8fff8eed1) | e2e (1)-(6) | 31917-38011 | success |
| main 39853673220 | **e2e-prod-build** (120086168922) | **474729** | **cancelled** |
| PR 39854543187 attempt 1 | e2e-prod-build (120089196328) | 13227 | **failed**: 403 from packages.microsoft.com, "no longer signed" |
| PR 39854543187 attempt 1 | e2e (5) / (6) (120089196666 / 120089196962) | 611785 / 724324 | success (slow) |
| PR 39854543187 attempt 2 | **e2e-prod-build** (120102175439) | **452360** | **cancelled** |
| main 39860672752 (afca73bc8) | e2e (1)-(6) | 29075-42274, except e2e (2) = 530037 | success; e2e (2) 8.8 min stall |
| main 39860672752 | **e2e-prod-build** (120110248917) | **476859** | **cancelled** |
| PR 39844229106 | **e2e-prod-build** (120053121138) | **462530** | **cancelled** |
| PR 39820208967 (HEL-1699) | e2e-slow (119969188076) | 585993 | success (9.8 min stall) |
| PR 39816350241 / 39725217813 | e2e-slow | 25638 / 32539 | success |
| PR (HEL-1699) 119969189775 | e2e (6) | 503855 | success (8.4 min stall) |

Before, the step was unbounded: healthy ~30-47 s, stalls 450-835 s, plus one 403 failure at 13 s.

## 3. Reproducing the trickle (task 4.2, standing constraint C1)

Temporary commits (reverted, final head clean) added `Acquire::http::Dl-Limit=25` (kB/s, a live slow trickle on a
reachable mirror, not a dead one) to the apt options.

**Attempt 1 only throttled** (commit 8871e1307, CI 39869337704, e2e-slow 39869337688; the setup step completed in every
job quoted, the run was cancelled later by the pushed revert):

```
e2e (1) job 120139494924:
23:05:17.9314691Z e2e-apt-deps: attempt 1: bounded 90s (+10s kill grace), mirrors: mirror+file:/etc/apt/apt-mirrors.txt
23:06:48.0644687Z e2e-apt-deps: attempt 1 failed or exceeded 90s; last fetch line: Get:9 http://azure.archive.ubuntu.com/ubuntu noble-updates/universe amd64 Packages [1706 kB]
23:06:48.0900546Z e2e-apt-deps: attempt 2: bounded 90s (+10s kill grace), mirrors: http://archive.ubuntu.com/ubuntu/ http://security.ubuntu.com/ubuntu/
23:07:02.8838438Z e2e-apt-deps: attempt 2 fetched the packages
23:07:08.9368434Z e2e-apt-deps: downloaded=17 ...
##[end-action id=__self.apt-deps;outcome=success;conclusion=success;duration_ms=112209]
```

Attempt 1 was cut at 90.1 s; attempt 2 succeeded 14.8 s later. Same in e2e (3) (job 120139494241: 114950 ms) and e2e-slow
(job 120139493671: 126978 ms). Every other job in that run ran the same step; the quoted three are the ones whose logs were read.

**Both attempts throttled** (commit 906625150, CI 39870518404, e2e-slow 39870518478; every e2e job's setup step ended in
the named error; the jobs failed on it, the run was `cancelled` only at workflow level after the revert push):

```
e2e-slow job 120143494321:
23:16:11.6102349Z e2e-apt-deps: attempt 1: bounded 90s (+10s kill grace), ...
23:17:41.7860169Z e2e-apt-deps: attempt 1 failed or exceeded 90s; last fetch line: Get:9 http://azure.archive.ubuntu.com/...
23:17:41.8166863Z e2e-apt-deps: attempt 2: bounded 90s (+10s kill grace), mirrors: http://archive.ubuntu.com/ubuntu/ http://security.ubuntu.com/ubuntu/
23:19:11.9775587Z e2e-apt-deps: attempt 2 failed or exceeded 90s; last fetch line: Get:12 http://archive.ubuntu.com/ubuntu noble/universe amd64 Packages [15.0 MB]
##[error]e2e-apt-deps: chromium system package fetch did not finish within 90s on either mirror (attempt 1: mirror+file:/etc/apt/apt-mirrors.txt | attempt 2: http://archive.ubuntu.com/ubuntu/ http://security.ubuntu.com/ubuntu/ | last fetch: Get:12 ... [15.0 MB])
##[end-action id=__self.apt-deps;outcome=failure;conclusion=failure;duration_ms=182506]
```

Two 90 s bounds, 182.5 s total (design worst case 200 s). Same shape in e2e-prod-build (120143496242, 182307 ms) and
e2e (1) (120143494269, 182215 ms). In both runs the throttle bit during the apt index fetch (the `Packages` files), not the
`.deb` fetch; both are inside the bounded attempt. The real organic stalls are covered by section 4's cold run, where
3 of 8 jobs hit the Azure mirror stall and were rescued by attempt 2 in 114-120 s.

## 4. After (final code, three full PR runs, 8 e2e-type jobs each: 6 legs + e2e-prod-build + e2e-slow)

"restore" = `Restore apt archive cache` step; "deps" = `e2e-apt-deps` step; "browser" = `npx playwright install chromium`;
"a2" = attempt 1 was cut at 90 s and mirror 2 was used. dl = `.deb` files downloaded (the script's `downloaded=`).

### 4a. Cold, organic (CI 39872286932 / e2e-slow 39872286752, head 2f30ffdb9, no cache entry)

| Job | restore | deps | browser | dl | note |
| --- | ---: | ---: | ---: | ---: | --- |
| e2e (1) 120149357442 | 278 | 24129 | 10722 | 17 | |
| e2e (2) 120149357421 | 364 | 35780 | 16062 | 17 | |
| e2e (3) 120149357551 | 391 | 120206 | 6520 | 17 | **a2** (Azure mirror stalled, cut at 90 s) |
| e2e (4) 120149357516 | 324 | 26224 | 15371 | 17 | |
| e2e (5) 120149357379 | 303 | 26610 | 17139 | 17 | |
| e2e (6) 120149357385 | 526 | 115826 | 8993 | 17 | **a2** |
| e2e-prod-build 120149357572 | 883 | 113908 | 7534 | 17 | **a2** |
| e2e-slow 120149355885 | 271 | 27587 | 15341 | 17 | |

Both runs green. Three of eight jobs hit the stall organically and were bounded to ~2 min instead of 7-14 min or a
timeout cancel (the e2e-prod-build 8 min budget survived).

### 4b. Warm (CI 39874827436 attempt 1 / e2e-slow 39874827405 attempt 1, head 5fc708eea, PR-ref entry restored)

| Job | restore | deps | browser | dl |
| --- | ---: | ---: | ---: | ---: |
| e2e (1) 120157764018 | 1476 | 42522 | 17228 | 0 |
| e2e (2) 120157764051 | 1933 | 21888 | 14283 | 0 |
| e2e (3) 120157764006 | 2165 | 37545 | 13037 | 0 |
| e2e (4) 120157764005 | 772 | 23900 | 15476 | 0 |
| e2e (5) 120157763989 | 2263 | 28649 | 12034 | 0 |
| e2e (6) 120157763991 | 1176 | 25250 | 22845 | 0 |
| e2e-prod-build 120157763699 | 882 | 29096 | 14822 | 0 |
| e2e-slow 120157763216 | 1477 | 24856 | 19226 | 0 |

All 8 jobs: `Cache restored from the e2e-apt-debs-v1-ubuntu24-X64-<digest> entry`, `Need to get 0 B/25.9 MB of archives`,
`downloaded=0`. Both runs green. The warm deps step is still ~22-43 s because it keeps the index refresh (35.6 MB,
~4 s) and does the dpkg install of 17 packages; the saving is the 25.9 MB `.deb` fetch (the stall surface), not the
healthy-case wall clock.

### 4c. Cold, final head (CI 39874827436 attempt 3 / e2e-slow 39874827405 attempt 3, head 5fc708eea, PR-ref entry deleted)

Also the earlier cold reruns of e2e-prod-build (CI attempt 2, job 120164174135) and e2e-slow (attempt 2, job 120164200298).

| Job | restore | deps | browser | dl | note |
| --- | ---: | ---: | ---: | ---: | --- |
| e2e (1) 120167701523 | 370 | 23225 | 18835 | 17 | |
| e2e (2) 120167701520 | 354 | 29004 | 15976 | 17 | |
| e2e (3) 120167701433 | 370 | 24044 | 15552 | 17 | |
| e2e (4) 120167701378 | 393 | 24882 | 16426 | 17 | |
| e2e (5) 120167701576 | 346 | 30054 | 9649 | 17 | |
| e2e (6) 120167701370 | 252 | 36687 | 12830 | 17 | |
| e2e-prod-build 120167701245 | 383 | 27630 | 17160 | 17 | |
| e2e-slow 120168540719 | 461 | 24712 | 12886 | 17 | |
| e2e-prod-build a2 120164174135 | 388 | 113118 | 6516 | 17 | **a2** (mirror stall, bounded) |
| e2e-slow a2 120164200298 | 380 | 119613 | 9429 | 17 | **a2** |

Both attempt-3 runs green. Across runs 4a and 4c plus the 4c a2 reruns, 5 of 20 cold job executions hit the Azure
stall; every one finished in 113-120 s through the second mirror, none was cancelled. Before the change, a stall cost
452-835 s and 5 of the 8 observed cancels were e2e-prod-build.

## 5. 403 red/green (task 4.1)

Local `ubuntu:24.04` container (one at a time, `nice -n 19`), Playwright 1.55.1 (the repo pin's resolved version
range floor), node 18, a third-party source `deb [trusted=no] http://127.0.0.1:8403/ubuntu noble main` whose server
answers every request with 403 (reproduces `packages.microsoft.com ... 403 Forbidden ... is no longer signed`):

```
=== RED: old command: npx playwright install --with-deps chromium
Err:1 http://127.0.0.1:8403/ubuntu noble InRelease
  403  Forbidden [IP: 127.0.0.1 8403]
E: Failed to fetch http://127.0.0.1:8403/ubuntu/dists/noble/InRelease  403  Forbidden [IP: 127.0.0.1 8403]
E: The repository 'http://127.0.0.1:8403/ubuntu noble InRelease' is not signed.
Failed to install browsers
Error: Installation process exited with code: 100
old exit=1
=== GREEN: new script (same container, same source still configured)
e2e-apt-deps: downloaded=105 save-key=e2e-apt-debs-v1-ubuntu24.04-X64-9b03... kept=105
new exit=0
```

(105 packages because the bare container has none of the runner image's preinstalled libraries.) The new script never
reads `/etc/apt/sources.list.d/thirdparty403.list`: the per-attempt option set points apt at its own Ubuntu-only
sources dir.

## 6. Final-state checks (task 4.5)

- `git diff origin/main...HEAD` contains no `TEMP`, no `Dl-Limit`, and the save condition is back to
  `github.event_name == 'push' && github.ref == 'refs/heads/main'`.
- `gh cache list --ref refs/pull/1094/merge` prints nothing; `gh cache list --limit 100 | grep -c e2e-apt-debs` = 0 (the
  one PR-ref entry, id 9371901660, was deleted with `gh cache delete` after run 39874827436 attempt 1 restored it).
- Logged key prefix: `e2e-apt-debs-v1-ubuntu24-X64-` (OS segment `ubuntu24`, non-empty), restore key
  `e2e-apt-debs-v1-ubuntu24-X64-none`.

## 7. Post-merge watch (not a pre-merge gate)

AC "no leg cancelled by an apt stall across 5 consecutive main runs" is observable only after merge. The first main
push saves the entry from e2e (1) (`downloaded > 0`, main ref); later runs restore it.
