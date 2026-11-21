## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 62b6615a02349a61cec628ed027237fa736c1b36 (base afc2a687286a73b22660e613adef2dbb85d0d517, resolved live).
Judged against the owner ruling margin-note (C10), which supersedes design Decision 2's reshape.

### Phase 1: Spec Review — FAIL
Code side matches C10:
- Frame and windows unchanged; the diff to `e2e/hel1683-regex-main-thread.spec.ts` only adds diagnostics.
- `LONG_TASK_BOUND_MS = 100` is unchanged (line 26).
- Attribution logging is kept on all three windows (control, probe, overrun), and the existing log prefixes are kept.
- `HEL1808_CPU_THROTTLE`: unset, empty or `1` makes no CDP call. Nothing under `.github/` references it, so CI cannot turn it on. An invalid value throws. I checked this myself: `HEL1808_CPU_THROTTLE=0` threw `must be an integer >= 1`.
- The branch changes no app, backend or schema code (C9). After my mutation was restored, `git status` was clean.
- `attribution.md` holds PR-ready text with the remaining margin and its cause. The CI cause is labelled INFERENCE.
- AC2: the probe still goes red on pre-HEL-1683 behavior (verified below).

The planning artifacts do not match the delivered state:
1. `tasks.md`: done items are still unchecked. These are 1.1, 1.2, 1.3, 2.2, 3.1, 3.2, 3.3 and 3.4 (lines 16-18, 23, 27-30). The evidence for each is committed: attribution-old-shape.txt, the diagnostics in the spec, the mutation .diff/.txt files, final-1x-x5.txt, and lint/format/tsc pass.
2. `design.md`: Decisions 2 and 6 still describe the reshape and the pass criterion as the plan of record. Nothing in design.md records that the owner's margin-note ruling (C10) superseded the reshape. Only tasks.md (2.1, C10) and attribution.md say so.

### Phase 2: Code Review — PASS
I ran these gates myself in WORKTREE_PATH:
- `npm run lint`: exit 0. ESLint on the spec file with `--max-warnings=0`: exit 0.
- `npm run format:check`: exit 0.
- `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- jest and the frontend build did not apply, because no `frontend/**` or `backend/**` file changed.

Live runs (lane DB helio_hel1808, servers on 7240/10147, ANTHROPIC_API_KEY empty, 2 workers, nice 19):
- Full spec file x3 at 1x, unmutated: 2 passed each time. Control, probe and overrun were 0.0 ms in every run, and so was the HEL-1697 long-cell probe. This matches the executor's final-1x-x5.txt.
- Mutation `mutation-decline-disabled.diff` applied: the probe went red at 483.0 ms (executor recorded 491) and the long-cell probe went red at 1137.0 ms (executor recorded 1132). Control stayed 0.0 ms. Restored with `git checkout -- frontend/`, and the working tree is clean.
- Evidence files (scratch): /home/matt/Development/helio/.concertino/scratch/HEL-1808/eval-1x-x3.txt and eval-mutation-decline.txt.

Code quality:
- The diagnostics are typed through local interfaces (`Loaf`, `WindowReading`, `ApiTimeline`).
- The `unknown` casts inside `page.evaluate` follow the pattern the file already used.
- The Chromium-only `long-animation-frame` observer is wrapped in try/catch, with a comment explaining it. The bound does not depend on it.
- Nothing is dead and there are no TODOs.
- The throttle knob is small and documented, and it validates its input.

### Phase 3: UI Review — N/A
No trigger paths changed (`frontend/**`, ApiRoutes, `schemas/**`, `openspec/specs/**`). The change is limited to one e2e spec and openspec change artifacts.

### Overall: FAIL

### Change Requests
1. `openspec/changes/regex-probe-control-headroom/tasks.md` lines 16-18, 23 and 27-30: change `- [ ]` to `- [x]` for 1.1, 1.2, 1.3, 2.2, 3.1, 3.2, 3.3 and 3.4. Leave 4.1 unchecked, since it belongs to Delivery. On 3.1, add a note that the "new" shape was attempted and reverted under C10, and point to attribution-new-shape.txt.
2. `openspec/changes/regex-probe-control-headroom/design.md`, Decision 2 (and the pass and escalation wording in Decision 6): add a short "Superseded by owner ruling margin-note (C10)" note. It should say that there is no frame or window reshape, `LONG_TASK_BOUND_MS` stays 100, attribution logging is kept, `HEL1808_CPU_THROTTLE` is diagnostic-only and off by default, and the PR states the remaining margin and cause (attribution.md). Without this note the archived design reads as though a reshape shipped.

### Non-blocking Suggestions
- In `final-1x-x5.txt`, the probe lines have no `requests: ...;` segment and show a double space (`(tasks: );  frames:`). The spec actually prints `requests: POST .../draft-preview;`, as my reruns show. The evidence looks post-processed. Consider re-capturing it verbatim, or noting the edit.
