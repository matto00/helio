## Evaluation Report — Cycle 6 (evaluation-6.md)

**Reviewed:** `cf96dd8788e3e9c6d5802183f8aed6ca425c7622`. This is a delta review since `0d225e632` (the cycle-5 PASS). It covers:
- the origin/main merge `9563a9f0a`;
- the tag commit `ea6b7f99a`;
- the docs commit `cf96dd878`.

**Authority:** the owner's answer `apply-prod-build-and-resume`, applying HEL-1691's `prod-build-measurement` ruling with the budget unchanged.

### Phase 1: Spec Review — PASS

**Merge `9563a9f0a` is clean.**
- `git show --remerge-diff 9563a9f0a` is empty, so no hand-resolved conflicts rode in.

**Docs commit `cf96dd878`** touches exactly two files, `evaluation-5.md` and `skeptic-final-4.md`.

**The cycle-5 fixes are intact.** `git diff 0d225e632 HEAD` is empty for all of these:
- `ui/liveOutput/`
- `useIdleCoalesced.ts`
- `ChartPanel.tsx`
- `ChartRenderer.tsx`
- `PipelineSpineLayout.tsx`

The memo, `noAnimation` and `QUIET_MS = 250` are unchanged.

**The tag `ea6b7f99a` follows e2e/README.md's convention** (`test(title, { tag: "@prod-build" }, ...)` "and nothing else"):
- With whitespace ignored (`git diff -w`), the only changes are:
  - the tag object;
  - a one-line comment;
  - re-wrapping one `toHaveText("14")` line.
- The test body, the budget (edit 1 < 100 ms, edits 2-10 < 50 ms) and every assertion are unchanged.
- The enclosing block is `test.describe(...)` (`hel1632-live-output.spec.ts:199`). It is not `describe.serial`, so the tagged test does not drag untagged tests into the prod-build project.

**The partition is correct.** Verified with `playwright --list`:
- **Env unset:** the `dev` project holds 25 of the 27 tests in the two files. Both bursts are excluded.
- **`HELIO_E2E_PROD_BUILD=1`:** the projects are exactly `prod-build-guard`, `hel1631-draft-mode.spec.ts:183` and `hel1632-live-output.spec.ts:260`.

### Phase 2: Code Review — PASS

Gates run fresh by me:

| Gate | Result |
|---|---|
| lint, format:check, typecheck | all exit 0 |
| `npm run check:e2e-prod-build-projects` | clean ("env unset -> dev only; env set -> guard + tagged prod-build only") |
| `npm run check:e2e-prod-build-projects:selftest` | 11 cases passed |
| Targeted jest (`HELIO_JEST_MAX_WORKERS=2`): liveOutput, useIdleCoalesced, ChartPanel*, PipelineDetailPage, PipelineSpine | 36 suites, 487 tests, all passed |
| Dev-project e2e: hel1631 + hel1632, on the merged tree, under the flock, `--trace retain-on-failure` | 25/25 passed. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/c6-e2e.log` |

The executor's "dev project (76 tests) passes" covers a wider file set than I ran. I did not reproduce the 76.

**The executor's prod-build numbers are not reproduced by me.**
- The claim: hel1632 step count 1.7-5.6 ms, hel1631 1.3-6.7 ms, input to live-output about 256 ms, over 3 runs of `npm run e2e:prod-build`.
- No log of those runs is persisted under `.concertino/scratch/HEL-1632/`.
- I did not run `npm run e2e:prod-build` myself, because doing so locally needs a step outside this run's rules (next section).
- The CI `e2e-prod-build` job on the PR is the binding measurement. The orchestrator should require it green before merge. It is the only independent evidence for the budget under the ruling.

**`npm run e2e:prod-build` as documented, versus the executor's workaround.**
- `scripts/e2e-prod-build.mjs` serves `vite preview` on `DEV_PORT`, which must be free. It requires the backend "already running".
- e2e/README.md and the script header say to stop the lane's dev server with `stop-servers.sh` ("that also stops the backend; start it again, or use a free DEV_PORT instead").
- **Neither option works with this repo's canonical tooling:**
  - **"Use a free DEV_PORT":** this fails. `ApiRoutes.scala:805` builds `cors()` from `corsAllowedOrigins`, and Pekko's CORS directive rejects a request whose `Origin` is not on the list. `start-servers.sh` starts the backend with `CORS_ALLOWED_ORIGINS=http://localhost:$DEV_PORT`. So a preview on another port sends a browser `Origin` the backend refuses, even through the proxy.
  - **"Start it again":** there is no canonical backend-only start. `start-servers.sh` always starts both servers. Starting `sbt run` alone with matching CORS is a bare invocation, which CON-165 forbids.
- **So the executor's manual backend start (CORS for 7064, preview on 7064) was a local workaround, not the documented flow.** I did not repeat it.
- This is a HEL-1691 harness and documentation gap on main, not a defect in this branch. Suggested follow-up for HEL-1691's area, either of:
  - a `start-servers.sh --backend-only` mode (or the equivalent canonical script);
  - documenting the CORS constraint and the exact sequence.

### Phase 3: UI Review — PASS

No UI code changed since cycle 5. The cycle-5 UX judgment stands as a listed trade-off for the PR's "Reversible UI calls":
- a settle of about 250-400 ms;
- no chart morph in the live column, which is the DESIGN.md §10 carve-out to disclose in the PR body;
- "live" shown on the previous frame while settling, per §11.

I stopped the servers with `stop-servers.sh`. I created no test data outside the e2e teardown, and I read no `.env` file (CON-261).

### Overall: PASS

The verdict is conditional on CI's `e2e-prod-build` job being green on the PR. I could not reproduce the prod-build latency locally within the rules.

### Non-blocking Suggestions
- Persist the executor's prod-build run logs under `.concertino/scratch/HEL-1632/`, so the 1.7-5.6 ms claim has evidence beyond prose.
- Raise the HEL-1691 local-run gap above (backend-only start, or CORS documentation) as a follow-up ticket.
