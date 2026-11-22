## Evaluation Report — Cycle 2 (evaluation-2.md)

**What was reviewed**
- HEAD: `4c17779014027704cad20fce0e9c26aa3c0ecf98`.
- Base: `c405b68179c46b59e3f7f06940e3acc5d2031999`, resolved live.
- Cycle-2 delta: the single commit `4c1777901`.
- Changed paths: `e2e/hel1585-document-never-scrolls.spec.ts`, the new `e2e/support/hel1585Seed.ts`, and `openspec/changes/document-never-scrolls-guard/**`.
- Not touched: `frontend/**`, `backend/**`, `playwright.config.ts` and `e2e/shard-weights.tsv`.

### Phase 1: Spec Review — PASS
- CR1 is resolved. `tasks.md` 3.1 now reads "N/A: no offenders on main (evidence/offenders.md), so no shell fix and no green-run.txt".
- `files-modified.md` lists the new seed helper.
- Everything that passed in cycle 1 still passes: all four ACs, the 3b.1 amendment, and the empty CONSTRAINTS list.

### Phase 2: Code Review — PASS
**Gates, run on the committed head `4c1777901`.** All exited 0:
- `npm run lint`
- `npm run format:check`
- `npm run check:e2e-types`, which covers the executor's untested type-only `APIRequestContext` import fix
- `npm run check:e2e-evidence-paths`
- `npm run check:e2e-user-cleanup`

**Full spec run on the committed head.** Setup: lane servers on DB `helio_hel1585`, `ANTHROPIC_API_KEY` empty, worker cap 2.
- Result: 4 passed in 23.1 s.
- 1440x900: 72 /api requests, maxWindow 72, 0 x 429.
- 1280x800: 74 /api requests, maxWindow 74, 0 x 429.
- Teardown deleted the 3 recorded users.
- This is the first spec run on this exact commit.

**Checks on the cycle-2 changes**
- CR2 is resolved. `waitReady(page, route)` no longer takes the unused `Seeded` parameter.
- The seed moved verbatim into `e2e/support/hel1585Seed.ts`. The only behavior change: the outputs response is now typed as the one real shape, `{items}`. The green run proves that shape is what the backend returns.
- The wheel check now reads `.app-command-bar`, which exists at `frontend/src/app/CommandBar.tsx:128`.
- `tallestOverflower` now skips `.sr-only` and absolute/fixed elements. `evidence/mutation-shell-height-cycle2.txt` shows the mutation is still red (2 failed). It now names real culprits, for example `div.spine-body__live-output` for the long `/pipelines/:id` (2041 > 900), and `section.panel-list` and `div.page-shell.*` elsewhere. One review route names `tallest: null`. That is acceptable because the field is a diagnostic, not the assertion.
- The spec dropped from 505 to about 413 lines. That is still over the ~400-line soft budget, so mention it in the PR description.

### Phase 3: UI Review — N/A
No trigger path changed. The guard itself was exercised against the running app in Phase 2. My servers were PIDs 3560745 (backend) and 3561355 (frontend), both stopped with `stop-servers.sh`.

### Overall: PASS

### Non-blocking Suggestions
- Several routes have no seed precondition: `/home`, `/sources`, `/connectors`, `/chat`, `/settings` and the review pages. They still wait only on the shell's sr-only `<h1>`. A content landmark per page would make each measurement independent of fetch timing. This is adequate today, per the cycle-1 timing probe.
