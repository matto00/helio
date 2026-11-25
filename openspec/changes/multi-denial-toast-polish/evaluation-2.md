## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: 41da8a28a6bd745421bdc7fce2da6b06441f0a63 (base b2da43a3d02ba1b84eb8296b9bd9ed742623a353, resolved live). The cycle-2 delta is 8ded3978f..41da8a28a: `toast.css` (+2 lines), `multiDenialSeed.ts`, one new e2e test, and evidence files.

### Phase 1: Spec Review — PASS
- Cycle 1's Phase 1 findings still hold. No cycle-2 change touches ordering, alignment or the cue condition.
- A focused control staying clear of the fade is a fix to the overflow-cue requirement's own behaviour, so it is not scope creep. `files-modified.md` is updated.

### Phase 2: Code Review — PASS
Gates (my own fresh runs, WORKTREE_PATH):
- `npm run lint`, `npm run typecheck`, `npm run format:check` and `check:e2e-types`: all exit 0.
- jest, 3 workers, filtered to deniedPipelinesToast, ToastRowList, Toast, useScrollEdges, toastsSlice and FormPanelView: 13 suites and 171 tests passed.
- Full `e2e/hel1172-multi-denial-toast.spec.ts`, `--workers=2`: 12/12 passed in 4.8 min. This includes the new focus-fade test. I restarted the servers fresh with the lane DB `helio_hel1840` and `ANTHROPIC_API_KEY` set empty.

CR1 (seed 429 flake) is resolved. Every seed request in `e2e/support/multiDenialSeed.ts` (source, pipeline, step, output, rename PATCH, dashboard, panel) now goes through `send()`, which retries on 429 and respects Retry-After. Each status assertion checks the response after any retry.

CR2 (fade covering the focused control) is resolved. `toast.css` sets `.toast__list { scroll-padding-block-end: calc(var(--space-6) + var(--space-1)); }`, which uses tokens only. The new e2e test tabs through every stop at 390px and polls until each one is clear of the fade while the fade is showing. The red evidence `evidence/red-focus-under-fade.txt` fails at Tab stop 4 on the pre-fix CSS. `mutations.txt` E4b records that `--space-6` alone is still 0.36px short, which justifies the `+ var(--space-1)`. I checked independently that the test discriminates (see Phase 3: overriding the padding to 0 at runtime brings the defect back).

Issues: none blocking.

### Phase 3: UI Review — PASS
Live check on port 7272 with a throwaway user on the lane DB (deleted afterwards by exact id). Five pipelines; I focused every link and button in the list (10 stops) in order from the top.

| Viewport / theme | Shipped CSS | Runtime mutation: `scroll-padding-block-end: 0` |
| --- | --- | --- |
| 390 light | 0 of 10 under the fade | P3 and its "Run to update" under the fade |
| 390 dark | 0 of 10 | P3 and its "Run to update" under the fade |
| 1440 dark | 0 of 10 | P3's "Run to update" and P4 under the fade |
| 1440 light | 0 of 10 | (not run) |

- The first-row alignment is unaffected (1440: icon top 612, link top 611).
- No console errors or warnings in the flow.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1840/evidence/eval2-390-light-focus-clear-of-fade.png`. The focused P3 link with its ring sits clear of the fade, and the next row still dissolves into the fade below it.

### Overall: PASS

### Non-blocking Suggestions
- `evidence/red-focus-under-fade.txt` shows `Expected: true / Received: false`, but the committed test polls for the string `"ok"`. So the red run came from an earlier form of the same predicate. The logic is unchanged, and my runtime mutation confirms the committed test's condition goes red without the fix.
- In the new test (`e2e/hel1172-multi-denial-toast.spec.ts`, around :326-339), the first `probe` evaluate is used only for its non-null check and the label in the failure message. It could be folded into the poll's evaluate.
- At focus, Chromium centres an out-of-view control rather than aligning it to the padded bottom edge, so the list can jump about 130px on a Tab. This is browser behaviour and acceptable.
- Carried over from cycle 1, for the skeptic's judgment: the icon now sits lower than the close glyph at 390px, and the cue is faint at desktop width.
