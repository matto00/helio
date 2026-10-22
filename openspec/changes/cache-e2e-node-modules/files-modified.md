- `.github/actions/e2e-setup/action.yml` — setup-node id, exact-key node_modules restore, `if:` skip on both `npm ci` steps, `save-node-modules-cache` input and guarded save step (main push, restore miss, one job)
- `.github/workflows/ci.yml` — `e2e` job passes `save-node-modules-cache: ${{ matrix.shard == 1 }}`; `frontend` job runs `npm run selftest:e2e-backend-lane` (cycle 2)
- `scripts/cache-janitor.mjs` — `e2e-node-modules` family (keep 1)
- `scripts/cache-janitor.selftest.mjs` — superseded/PR/near-miss cases for the new family
- `scripts/e2e-backend.sh` — new `lane-start` subcommand (re-invokes itself via `bash "$0"`) (`start`/`wait` branches unchanged), header docs, usage line
- `scripts/e2e-backend-lane.selftest.sh` — new selftest in a throwaway git repo with self-terminating stubs (C2)
- `package.json` — `selftest:e2e-backend-lane` npm script
- `scripts/e2e-prod-build.mjs` — header documents the in-lane sequence
- `e2e/README.md` — in-lane `@prod-build` sequence (D6)
- `openspec/changes/cache-e2e-node-modules/tasks.md` — task checkboxes
- `openspec/changes/cache-e2e-node-modules/files-modified.md` — this handoff

Evidence (outside the repo, `/home/matt/Development/helio/.concertino/scratch/HEL-1699/`):
- `/home/matt/Development/helio/.concertino/scratch/HEL-1699/baseline-npm-ci.txt` — npm ci step timings, 32 e2e job rows, incl. run 39711300255 (424 s outliers)
- `/home/matt/Development/helio/.concertino/scratch/HEL-1699/du.txt` — node_modules sizes (main checkout; worktree had none): 168M + 454M
- `/home/matt/Development/helio/.concertino/scratch/HEL-1699/selftest-lane.txt` — lane-start selftest output
- `/home/matt/Development/helio/.concertino/scratch/HEL-1699/ci-checks.txt` — CI script checks
- `/home/matt/Development/helio/.concertino/scratch/HEL-1699/lane-initial-start.txt` — start-servers.sh start state
- `/home/matt/Development/helio/.concertino/scratch/HEL-1699/lane-readme-sequence.txt` — README sequence verbatim, PGID-empty, ports free, start-servers + assert-phase servers PASS
- `/home/matt/Development/helio/.concertino/scratch/HEL-1699/e2e-full-dev.txt` — full dev-project e2e suite
