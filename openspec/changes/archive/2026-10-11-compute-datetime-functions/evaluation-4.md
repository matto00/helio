## Evaluation Report — Cycle 4 (evaluation-4.md)

This is the driver-granted extra cycle, scoped to evaluation-3's CR1.

- Reviewed HEAD: `53cd2a83e59ea295652fa9a93787e79bfc499b58`.
- Diff base, re-resolved live: `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39`.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1314/evidence/eval4-*`.

### Phase 1: Spec Review — PASS

The delta `b3fa7ec5f..53cd2a83e` changes two files:
- `PipelineDetailPage.css`: the gated `margin-top` goes from `var(--space-2)` to `var(--space-3)`, and the comment is rewritten;
- the committed `evaluation-3.md`, which is byte-identical to the persisted copy.

It is CSS-only. Tree hashes are identical at both commits:

| Tree | Hash |
| --- | --- |
| `backend/` | `fad7e3dec26f` |
| `shared-test-fixtures/` | `dc1d362219e3` |
| `helio-mcp/` | `5311f4d7c49a` |

### Phase 2: Code Review — PASS

All gates were rerun fresh in WORKTREE_PATH and are green.

| Gate | Result | Transcript |
| --- | --- | --- |
| lint, format:check, typecheck | exit 0 | `eval4-static.txt` |
| jest: root and helio-mcp | 46 suites, 444 passed | `eval4-jest-full.txt` |
| jest: frontend | 518 suites, 5551 passed | `eval4-jest-full.txt` |
| frontend build | exit 0 | `eval4-frontend-build.txt` |

The backend was not re-run because its tree is unchanged. My cycle-2 `sbt testFull` passed on that same tree.

### Phase 3: UI Review — FAIL

**Method.**
- Servers came from `start-servers.sh` on 6746/9653. `assert-phase servers` PASS, and both listeners' cwd is this worktree.
- I used isolated Chromium contexts from the repo's playwright library with `hasTouch` and `isMobile`, logged in as `matt@helio.dev`. The shared MCP browser was not used.
- Every tap is a real `page.touchscreen.tap`.

**Dev-DB rows.** All four probe pipelines and their sources were created under the dev account and deleted by exact id. Every delete returned 204, every pipeline GET afterwards returned 404, and no source is still listed.

| Pipeline | Source |
| --- | --- |
| `4f0ab3c6-710f-4665-b647-8521cef4c231` | `8c49d7c5-b534-4e05-9c37-f1cd25afe71b` |
| `df16272e-30a5-4f82-a1c5-0263ba92c48f` | `88054337-767a-4d99-9e0e-5f2ae0a7a2de` |
| `7dc5ca82-0467-4279-a8cf-c2589f58ccc3` | `5970abac-1315-4e75-9b8f-145ee4d36239` |

**Servers.** Stopped by exact PID; ports free.

**What now works** (`probe-output.txt`):
- The served CSS applies. With a coarse pointer, `margin-top` computes to 12px: 16px from the input to the summary, with 8px clear of the expander.
- At 1440 with a mouse it computes to 0px, so desktop is unaffected.
- Hit height is 44.5px.
- The executor's probe points all focus the input, at 375 and 1100: x+20, at bottom minus 0.5, 1, 1.5 and 2px.
- Tapping or clicking the summary itself opens it. No page errors.

**What still fails:** taps close to the input's left edge still snap to the summary.
- `probe-output.txt`: x+8 / bottom-0.5 opened the list at both widths.
- `sweep-output.txt` is a dense sweep: every 1px across the summary's x-span plus 8px, at bottom minus 0.25, 0.5, 1, 1.5, 2 and 3px, giving 486 taps per width.
  - **As shipped: 18 of 486 taps open the list instead of focusing the input, at both 375 and 1100.**
  - All 18 are at x+4 to x+9 from the input's left edge, at bottom minus 0.25 to 1.5px. That is the input's 6px-radius bottom-left corner, directly above the summary's start.
- `elementFromPoint` at x+4 and x+8, bottom-0.5, is `#compute-expression`. These points geometrically belong to the input, and touch adjustment moves the tap to the summary.

**Counterfactuals** (runtime CSS overrides in the isolated page only; `corner-probe-output.txt`, `sweep-output.txt`):

| Variant | Snaps |
| --- | --- |
| Expander removed (the pre-change state) | 0 |
| `margin-top: var(--space-4)`, 12px clear of the expander | **0 of 486 at both 375 and 1100** |
| `var(--space-5)` | 0 at the corner points |

**Correction of my own evaluation-3.** I recommended `var(--space-3)` on the strength of counterfactual taps at a single x offset (input.x+20). That sample missed the corner band. The executor implemented exactly what I recommended. This defect is my under-sampled recommendation, not an executor error. The dense sweep above is the evidence that settles it.

**Baseline note.** My attempted pre-existing-input corner baseline (`corner-probe-output.txt`, last line) hit a hidden or offscreen sidebar input at 375, so it is inconclusive and I do not rely on it. The decisive comparison is the same input with no expander: 0 snaps.

### Overall: FAIL

### Change Requests

1. **Use `var(--space-4)` and fix the comment.** In `frontend/src/features/pipelines/ui/PipelineDetailPage.css`, final `@media (max-width: 768px), (pointer: coarse)` block:
   - Change `.pipeline-detail-page__compute-functions { margin-top: var(--space-3); }` to `margin-top: var(--space-4);`. That gives 20px from the input to the summary's painted box, which is 12px clear of the 8px expander overhang.
   - Correct the comment. Its arithmetic is wrong even for the current value: it says "4px field gap plus this 8px margin gives 12px", but `--space-3` is 12px, so the real total is 16px. Its "at least 8px clear … to the summary's painted box" threshold is also not what was measured. State the measured reason: with less than 12px clear between the input and the expander, the browser's touch adjustment snaps taps on the input's bottom-left rounded corner to the summary.
   - Verify with a dense real-touch sweep, not single points, at 375 and 1100 with `hasTouch`/`isMobile`:
     - x positions: every 1px from the input's left edge across the summary's width + 8;
     - y positions: bottom minus 0.25, 0.5, 1, 1.5, 2 and 3;
     - pass condition: 0 taps leave `details.open` true, and each focuses `#compute-expression`.
   - `eval4-ui/sweep-output.txt` is a ready template: the `--space-4` counterfactual already gives 0 of 486 at both widths.

### Critical Path

The cycle budget is already exceeded: this was the driver-granted extra cycle.

**What remains:** one CSS token (`--space-3` to `--space-4`) plus a comment correction. My runtime counterfactual shows it removes every snap across 486 taps per width.

**Everything else is verified and green:**
- backend semantics, the shared parser, and the datebucket characterisation;
- seam tests in all three consumers, each proven failable;
- all gates;
- docs, the chevron, keyboard access and accessible names.

**Recommendation for the human:**
- Have the token and comment change made, then accept it on a re-run of `sweep-output.txt`'s dense tap sweep. A full evaluation cycle is not needed.
- Alternatively, waive it. The residual is 18 of 486 sampled taps, confined to a 6x1.5px sliver at the input's bottom-left corner on touch devices. It is a judgment call. The fix is cheap and fully characterised, so I recommend fixing over waiving.

### Non-blocking Suggestions

- Carried from cycle 1: the summary recipe duplicates `.usage-card__summary`. `UsageCard` has the same marker and touch-floor gaps, so a shared recipe could be a spinoff.
