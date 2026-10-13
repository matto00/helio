## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `86ebb71d8e6b6dd61a820be96811c50fdcb2fa83`. The base was resolved live: `f63ab8365d2b0e6cac36154a83437b6d26b3a209`. The only change since cycle 1 is commit 86ebb71d8. Each cycle-1 change request was checked against the tree and the running app.

### Phase 1: Spec Review — PASS

Nothing in the spec, ACs or scope changed. The fix commit touches only:
- `PipelineDetailPage.tsx`: the frame around the error.
- `PipelineDetailPage.stepsError.test.tsx`: one added assertion and one new test.
- Files in the change dir.

C1 still holds: no file from the parked PRs is touched. C2 still holds: no new `eslint-disable`, and the frame wrap is part of the behaviour change from commit 7.

Still owed by the orchestrator, unchanged from cycle 1:
- File the Follow-up for the rest of the hook split (427 lines).
- Write the OWNER REVIEW entries for A1, A2 and A3 in the PR.

### Phase 2: Code Review — PASS

I ran every gate myself in WORKTREE_PATH, with `nice -n 19` and at most 3 workers:
- `npm run lint`: exit 0.
- `format:check`: passed.
- `typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- Jest, run as foreground shards:

| Shard | Suites | Tests |
| --- | --- | --- |
| root | 49 | 458 |
| frontend pipelines | 135 | 1862 (one more than cycle 1, the new test) |
| frontend panels | 191 | 2578 |
| frontend rest | 261 | 2576 |

  The frontend shards total 587 suites, which matches `--listTests`.

Cycle-1 change requests:
- **CR1 (frame):** done. The `stepsFailed` branch now renders `.pipeline-detail-page__river > .pipeline-detail-page__river-inner > PageStatus`. A new assertion, `getByRole("alert").closest(".pipeline-detail-page__river")`, pins this. My mutation M6 replaced both wrapper classes with bare `<div>`s, and that test went red (1 failed / 7).
- **CR2 (proof logs):** done.
  - `proof/switch-test-{base,after}.txt` and `proof/steps-error-{red,green}.txt` are committed.
  - No `.log` files remain in `proof/`.
  - `tasks.md` 6.3 and 7.1 now cite the `.txt` names.
- **CR3 (files-modified):** done. I compared the file list against `git diff --name-only f63ab8365...HEAD` in both directions. Every file in the branch is listed with its full repo-relative path. One file is listed but not in the branch: `workflow-state.md`, which is untracked through `.git/info/exclude:21`. This is harmless (see suggestions).
- **Retry unmount gate:** the new test is "a Retry that settles after the page unmounted dispatches no analyze". I re-ran mutation M3, which removes `if (!mountedRef.current) return;` from `usePipelinePageLoad.ts`. The new test now goes red (1 failed / 7). In cycle 1 the same mutation survived. The test is green unmutated (7/7).

### Phase 3: UI Review — PASS

Setup:
- Servers came from `start-servers.sh`, and `assert-phase servers` passed.
- I registered a throwaway user, `hel1501-eval2-1791909174@example.test`, with curl and seeded the "ops" template.
- I forced the steps fetch to fail with an in-page XHR `open` rewrite and in-app navigation, so no data was mutated.
- Afterwards I deleted the user by exact (id, email) via `buildUserDeleteSql`. Counts afterwards: 0 user rows and 0 pipeline rows. Servers were stopped with `stop-servers.sh`.

I measured the error's inset from the tabpanel edges with `getBoundingClientRect`:

| Theme | Width | Inset left / top / right (px) | Column width (px) | Horizontal overflow |
|---|---|---|---|---|
| light | 1280 | 120 / 16 / 120 | 800 (centred) | none |
| light | 768 | 20 / 16 / 20 | 728 | none |
| light | 360 | 16 / 12 / 16 | 328 | none |
| dark | 1440 | 200 / 16 / 200 | 800 | none |
| dark | 1280 | 120 / 16 / 120 | 800 | none |
| dark | 1100 | 30 / 16 / 30 | 800 | none |
| dark | 768 | 20 / 16 / 20 | 728 | none |
| dark | 360 | 16 / 12 / 16 | 328 | none |

- The padding comes from the river's own responsive rule: `16px 20px` at 768 and wider, `12px 16px` at 360.
- The error text is `--app-error` in both themes: light `rgb(175, 51, 37)`, dark `rgb(241, 123, 103)`.
- At 360 the text now lines up with the tabs (x=16) instead of sitting at viewport x=0.
- Recovery still works. Retry with the fault removed clears the error and the footer reads "8 steps".
- The console showed only network 404s: the forced-failure URL and the existing "no schedule" 404. The two `/api/auth/me` 401s came from the login page before sign-in. There were no JS exceptions.

Evidence (persisted; the claims rest on the measured numbers above, not on file mtimes):

| Screenshot | sha256 prefix |
|---|---|
| `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval2-steps-error-light-1280.png` | 3f403c32a6d4e1bf |
| `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval2-steps-error-light-768.png` | 715678c54d3f93e2 |
| `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval2-steps-error-light-360.png` | 635c7c2ee67b793b |
| `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval2-steps-error-dark-1280.png` | d5eeea366958370a |
| `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval2-steps-error-dark-768.png` | 9bb399ec4c4416b6 |
| `/home/matt/Development/helio/.concertino/runs/HEL-1501/evidence/.playwright-mcp/hel1501-eval2-steps-error-dark-360.png` | 8b24964b2c429d76 |

### Overall: PASS

### Non-blocking Suggestions
- `files-modified.md` lists `openspec/changes/pipeline-steps-error-and-splits/workflow-state.md`, but that file is untracked (excluded through `.git/info/exclude`). Either drop the line or mark it as not committed.
- Carried over from cycle 1, still open:
  - `proof/hook-split-verify.py` accepts any inserted block that contains a hook name. Matching each call site exactly would make it a real guard.
  - Focus falls to `<body>` after Retry.
  - The footer still shows "OUTPUT: no output yet" while the steps are unknown. That is a skeptic-level call.
  - `stepsError.test.tsx` repeats the store and render boilerplate.
