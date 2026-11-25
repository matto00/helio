## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `a9780ec9f2bff6cc1d5769d2a674636f550de68d` against the live-resolved base `cb287223d10c5451d3ebb2045bd872f88dfb376a`.

Cycle 3 changed these files:
- `frontend/src/features/panels/services/panelService.submitKey.test.ts`
- `frontend/src/features/panels/ui/form/FormPanelView.lostAck.test.tsx`
- `evidence/mutation-J3-in-place-key.txt` (new)
- `evaluation-2.md` (now committed)

**No production change since cycle 1.**
- `git diff a1f8680b4 HEAD -- frontend/src/features/panels/services/panelService.ts` is empty.
- Every file changed between `c33f9b16f` and HEAD is one of the two test files or under `openspec/`.

Cycle 1's backend, RLS, seam and live-lane UI results therefore still stand for the code.

### Phase 1: Spec Review — PASS

- Cycle 1's change request (design/tasks text) was closed in cycle 2.
- Nothing in the specs or planning artifacts changed in cycle 3.
- `check:openspec` is clean.

### Phase 2: Code Review — PASS

**Cycle 2's change request is closed.**
- Both jest files now deep-copy each request body when `post` is called (a JSON round-trip) and assert on the copies.
  - `panelService.submitKey.test.ts`: `script()` / `sent[]` replaces the reads of `post.mock.calls[n][1]`.
  - `FormPanelView.lostAck.test.tsx`: `bodies[]` is filled inside `mockImplementation`.
  - Both also add an explicit `submitKey` equality check.
- The test behaviour is otherwise unchanged:
  - The call sequencing is the same: reject first, then resolve, with the last outcome repeating.
  - The per-test reset of `sent` is in `beforeEach`.

**Mutations, reproduced by me.**
- Where: a throwaway detached worktree at a9780ec9f under the lane scratch dir, with hardlinked node_modules, removed
  afterwards.
- What: the two HEL-1175 test files, run against the unmutated code and against each mutation of `panelService.ts`.

| Run | Mutation in `panelService.ts` | Result | Failing tests |
| --- | --- | --- | --- |
| baseline | none | 7 passed | none |
| J3 (in place) | `body.submitKey = crypto.randomUUID();` inside the retry loop | 3 failed, 4 passed | "re-sends the same body and key...", "stops after 3 requests, all with the same key...", "compact counter, lost acknowledgement › retries with the same key..." |
| J2 (fresh object) | `{ ...body, submitKey: crypto.randomUUID() }` | 3 failed, 4 passed | the same 3 |
| J1 (no retry) | the retry condition forced to `|| true` | 3 failed, 4 passed | the same 3 |

- J3 was 7/7 green in cycle 2, so the blind spot is closed.
- The committed `mutation-J3-in-place-key.txt` matches my run.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1175/evidence/.concertino/scratch/HEL-1175/eval-3-mutations.txt`

**Gates affected by a test-only change, run fresh in `WORKTREE_PATH`:**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `frontend npm run typecheck` | exit 0 |
| `check:openspec` | clean |
| frontend jest over `src/features/panels` (3 workers, `nice -n 19`) | 270 suites, 3152 tests passed |

I did not re-run:
- The build: no source file changed.
- The backend: no backend file changed.
- The rest of the frontend jest suite: no file outside the panels feature changed. All of it passed in cycle 1 on
  identical production code.

**Test quality.** The comment added in each file explains why the body is copied at call time. That is a "why"
comment, as CONTRIBUTING requires for tests, not step narration.

### Phase 3: UI Review — PASS

No UI-affecting source changed since cycle 1's live lane run, which passed. That run covered:
- Flyway migrating the empty lane DB to v149
- the HTTP matrix (201, same-key 200 replay, 409, 400, unkeyed 201)
- a live browser lost-ack test (201 lost, automatic same-key retry, 200 replay, one row, one increment, no error)
- the plain form submit

I started no servers this cycle.

### Overall: PASS

### Non-blocking Suggestions
- design.md D4 still double-counts the `appendFormRow` callers that needed no change. They are
  `PanelFormFileSubmission` plus three specs, 4 in total, not "four existing callers and `PanelFormFileSubmission`".
  This was noted in cycle 2.
- The PR description should note the pre-existing size of `DataSourceRepository.scala` (1349 lines) and
  `DataSourceService.scala` (1524 lines), per CONTRIBUTING's "propose a split" rule.
- `dsOpt.map(rowToDomain).get` in the repository's replay lookup is safe under the lock, but could read more plainly.
