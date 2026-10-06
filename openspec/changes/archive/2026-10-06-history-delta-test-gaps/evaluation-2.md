## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: `27dd24b812954561b61d3001956f5c46c5be176c`.
- Base (resolved live): `f4601ba2ee9300f7ecb2775a56559f234c966431`.
- Changes since cycle 1 (`f6ffc9a9b`):
  - one added line in `e2e/hel1275-metric-delta-sparkline.spec.ts`: `expect(before, ...).not.toBeNull()` in `resizeAndSettle`;
  - edits to `mutation-evidence.md`;
  - `evaluation-1.md` committed into the change dir.

Logs: session scratchpad, `hel1327-eval2-*.log`.

### Phase 1: Spec Review — PASS

Issues: none.

- **Cycle-1 CR1 (AC2 note) resolved.** The note now gives the probe's observed facts: the public mock is never called, the authenticated mock is called with `[["out-1"]]`, and the DOM shows the authenticated payload. It also states the correct cause, which is the `useOutputHistory` fallback when `source` is undefined. This matches my cycle-1 probe.
- **Cycle-1 CR2 (sentinel red) resolved.** I cross-checked the recorded red against the executor's raw log, `hel1327-red3-sentinel.log`:
  - user `989d77be-d695-4f72-8a9d-4f9ef93bf086`;
  - `Error: window sentinel lost: a full document load replaced the page`, `Received: null`;
  - the copy's line 328 corresponds to line 329 of the real spec (the copy has the count assertion removed, so it is one line shorter).
  - My own independent cycle-1 run reproduced the same red.
- New green users `dc5175a4-5836-4aed-afb9-da7d2ce599f4` and `d31004aa-01d4-4f3c-917d-3f2b697bd59a` match `hel1327-green-final2.log` (`2 passed (26.6s)`).
- C1–C5 are still honored. The cycle-2 delta touches no product code and no C1-listed file.

### Phase 2: Code Review — PASS

Issues: none.

The commit again used HUSKY=0, so I re-ran every pre-commit hook gate myself on HEAD `27dd24b81`:

- eslint `--max-warnings=0`: 0.
- prettier `--check .`: 0.
- frontend `tsc`: 0.
- `tsc -p e2e/tsconfig.json`: 0.
- All 16 node check scripts passed (repo-integrity, schemas, spec-structure, openspec + selftest, dependabot + selftest, cloud-run-cpu + selftest, scala-quality, test-temp-dir-hygiene + selftest, no-credential-leak + selftest, tokens + selftest).
- root jest: 375/375 passed.
- frontend jest (`--maxWorkers=2`, `nice -n 19`): 4618/4618 passed.
- frontend build: 0.
- `check:helio-mcp-types` fails with the same `TS2554` at `src/index.ts:58`. This is the stale `helio-mcp/node_modules` (SDK 1.29.0 installed, lock says 1.31.0), and it fails the same way on main. Nothing under `helio-mcp/` is touched. It is pre-existing and environmental, not caused by this diff.

The added precondition is a test-only guard against a vacuous `.not.toBe(null)` poll. Its message names the failure. It is correct as written. It guards a test precondition rather than product behaviour, so C2's product-mutation red does not apply to it.

### Phase 3: UI Review — PASS

Issues: none.

- Servers were started fresh with `start-servers.sh <wt> 6759 9666 HEL-1327`, and `assert-phase servers` returned PASS.
- Listener cwds: `backend/` is java pid 1896274 and `frontend/` is vite pid 1896687, both in this worktree.
- Changed spec on real code, both themes: `2 passed (1.1m)`.
- Servers were stopped by exact PIDs (1896687 1896672 1896274 1896071 1896028). Both ports are free.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- In `mutation-evidence.md`, the parenthetical "(copy line numbers; spec line 327 area)" should say spec line 329, now that the precondition line has been added. This is cosmetic.

### Dev-DB users created by this evaluation (not deleted; no delete route, HEL-1301)

- 225c1bd4-c234-43fe-833b-ba5448524342 (cycle-2 green, light)
- d536f123-f39d-4047-a18b-3a7d146680cb (cycle-2 green, dark)
