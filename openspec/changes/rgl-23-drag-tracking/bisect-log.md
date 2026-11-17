# HEL-1728 bisect log (tasks 2.1-2.3)

Upstream: https://github.com/STRML/react-grid-layout cloned to `.concertino/scratch/HEL-1728/rgl` (tarball repository.url redirect). Tags: `v2.2.4` (6ec45c62), `2.3.0` (9b01a614); 45 commits between. Built with `npm install --ignore-scripts --legacy-peer-deps` + `npx tsup` (the repo's `make build-ts` step).

Base install for the whole bisect: react-grid-layout 2.3.0 + react-resizable 3.2.0 hoisted, only `node_modules/react-grid-layout/dist` replaced per step (rm -rf then cp, `.vite` cleared, servers restarted). Each step proves the served pre-bundle by sha256 plus markers: `edgeScroll` = `createEdgeScrollController` count, `oldDragRefGuard` = `!oldDragItemRef.current` count, `activeDragGuard` = `if (!activeDrag) return` count. Verdict rule per design D3, `--repeat-each 3 --workers 2`.

## 2.1 Endpoint check
| step | served sha256[:16] | edgeScroll | oldDragRefGuard | activeDragGuard | result |
|---|---|---|---|---|---|
| 2.2.4 build (6ec45c62) | 7354bf7b3f2b393f | 0 | 0 | 2 | 3 passed (green) |
| 2.3.0 build (9b01a614) | a1f3de8e68c56434 | 2 | 1 | 1 | 3 failed, tracking assertion (red) |

## 2.2 Bisect steps (`git bisect run`)
| commit | served sha256[:16] | edgeScroll | oldDragRefGuard | activeDragGuard | result | verdict |
|---|---|---|---|---|---|---|
| 0b71e080 (Merge #2280) | 912e57cb6a20bee3 | 2 | 0 | 2 | 3 passed | good |
| 8258a56a | 1917f3ab2e6db238 | 2 | 0 | 2 | 3 passed | good |
| a44fb5fa | c6cbcc01ac6cd2cd | 2 | 0 | 2 | 3 passed | good |
| eb35b82c | d03901e3cfcfb690 | 2 | 1 | 1 | 3 failed (tracking assertion only) | **bad** |
| b5fbb95e (its parent) | 1bf2ac53b33ec3ad | 2 | 0 | 2 | 3 passed | good |

All steps recorded versions rgl=2.3.0 rr=3.2.0. No skips.

**First bad commit: eb35b82c88df19acf6f14ab5e89216968da887d7** "fix: end drag when mouseup arrives before the drag start renders (#2291) (#2292)". It changes `onDragStop` to key off `oldDragItemRef.current` instead of the `activeDrag` state (and drops `activeDrag` from the callback's deps). Edge scroll and GridItem memoization (f13dbbc, present and green in the good steps) are cleared.

## 2.3 Restore
`git checkout -- frontend/package.json frontend/package-lock.json`, `npm ci`, `.vite` cleared. Versions after restore: rgl=2.2.4 rr=3.1.3, git status clean; `--repeat-each 3 --workers 2`: 3 passed.
