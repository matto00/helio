# HEL-1428 PR notes

## Item 1: image size (AC1, AC2)
Both images built with `--build-arg BASE_REGISTRY=mirror.gcr.io/library` (the CI value), `nice -n 19`, tags
`helio-backend:hel1428-before` (origin/main Dockerfile) and `:hel1428-after`. Builder stage was a cache hit for
the second build.

| | before | after |
|---|---|---|
| `docker image ls` size | 1.5GB | 894MB |
| jar layer(s) | 316MB COPY + 316MB `chown -R` layer | 316MB COPY --chown + 12.3kB `chown` layer |

`docker history` (non-zero layers only), before then after:
```
before: 316MB  /bin/sh -c mkdir -p data && chown -R helio:h...
        316MB  /bin/sh -c #(nop) COPY file:650a5571b35af371...
after:  12.3kB /bin/sh -c mkdir -p data && chown helio:heli...
        316MB  /bin/sh -c #(nop) COPY --chown=helio:helio f...
```

(`docker image ls` figures are from this host's containerd store accounting; the layer lines from
`docker history` are the load-bearing evidence: the second 316MB layer is gone.)

Equivalence: `docker inspect` of Config.User/Entrypoint/Cmd/Healthcheck/ExposedPorts/WorkingDir is byte-identical
before vs after; the in-image `find /app -exec stat -c '%n %U:%G %a %s'` listing is identical (`/app` helio:helio 755,
`/app/data` helio:helio 755, `/app/helio-backend.jar` helio:helio 644 316149100) and the jar sha256 is identical
(`d01e1662...2f40e`). Env was not diffed or printed.
Container start: each image was run against a throwaway `postgres:16` on network `hel1428-net`
(127.0.0.1:18481 / :18482 published); both reached `/health` 200 and `healthy`. The backend requires
GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI at boot (first attempt without them exited 1: unrelated to the Dockerfile);
dummy values were supplied. All containers, the network and both images were removed by exact name.

## AC3 post-release check (for driver/owner)
No release is cut by this ticket. After the next tagged revision: **CD deploys and `/health` is 200 on the next
tagged revision.**

## Item 2: guard (AC4)
`scripts/check-ci-complete-needs.mjs` + selftest; hook runs the check, CI `frontend` job runs both. Red on the CLI,
scratch copy of the real ci.yml with `docker-image` dropped from `needs` (exit 1):
```
  - job "docker-image" is missing from `ci-complete.needs` (it would silently stop being required)
```
Mutation (missing-job comparison replaced with `if (false)`): selftest exit 1 with 5 FAIL lines; reverted, exit 0.
Cycles 2-3 hardened the line scanner (column-0 line after `jobs:`; duplicate job keys). Cycle 3's review then found a
third way (a fake `zz:` key inside the gate's own multi-line quoted scalar hides the real `needs`), and the line-scanner
approach was judged unsound. Cycle 4, per the owner ruling (`js-yaml-rewrite`, constraint C4): the guard now parses
`ci.yml` with js-yaml 4.x and checks the parsed tree. `js-yaml` is a root devDependency pinned EXACTLY to `4.3.2` (the
version already locked transitively, so the lockfile diff is two added lines: the root `devDependencies` entry in
`package.json` and in `package-lock.json`'s root package; no version churn). A scalar `needs: a` is rejected on purpose
(documented in the script and spec). The three evaluator attacks (cycle 1 column-0 continuation, cycle 2 fake duplicate
`ci-complete`, cycle 3 fake `zz:` key) are named `REGRESSION` cases in the selftest. The cycle-3 fixture against the
line-scanner HEAD `2ba8bbbfb`, before the rewrite: `PASS (false pass: job b missing)
{"errors":[],"jobs":["a","b","ci-complete","zz"],"needs":["a","b","zz"]}`; after the rewrite the selftest names job "b"
missing. CLI red re-run on the scratch copy (`docker-image` dropped from `needs`): exit 1,
`job "docker-image" is missing from ci-complete.needs`. Mutation of the rewrite (missing-job comparison replaced by
`if (false)`): selftest exit 1 with 9 FAIL lines; reverted, exit 0.
Out of scope, follow-up: `check-precommit-ci-parity.mjs`'s `parseCiCompleteNeeds` still has the line-based
comment-first-match weakness.
Known gap: if `frontend` itself is removed from `needs`, the CI run of the guard (inside `frontend`) no longer blocks
`ci-complete`; only the pre-commit hook still catches it. Follow-up candidate: `check-precommit-ci-parity.mjs`
`parseCiCompleteNeeds` has the same comment-first-match fail-open.

## Item 3: docker-image timeout (AC5, report-only)
`gh run list --workflow ci.yml --limit 100`, runs created after 2026-10-09T05:00Z: 82 runs, docker-image job
rows 82 = 78 success (143-213 s, mean ~180 s) + 4 failures that ended in 8-37 s (pre-HEL-1452 pulls, not timeouts)
+ 0 in progress. Verdict: max 213 s vs `timeout-minutes: 8` (480 s) = ~2.25x headroom; no timeouts; unchanged.
