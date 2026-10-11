## Evaluation Report — Cycle 5 (evaluation-5.md)

Owner-granted cycle. The owner chose fix-space-4, accepted on the dense tap sweep.

- **Reviewed HEAD:** `0da1b93735978ecd2e2b2f8df344eb491b86adbd`. This is `3207b4d0a` plus a merge of origin/main.
- **Diff base:** re-resolved live as `f4540f25d38d854746e93cce9c0efe90c5b01a3b`. origin/main advanced since cycle 4.
- **Evidence:** `/home/matt/Development/helio/.concertino/runs/HEL-1314/evidence/eval5-*`.

### Phase 1: Spec Review — PASS

**The `53cd2a83e..3207b4d0a` change** touches only two things:
- `PipelineDetailPage.css`: the gated margin goes from `var(--space-3)` to `var(--space-4)`, and the comment is rewritten. The comment's arithmetic is now correct: 4 + 16 = 20px between the boxes, so 12px stays clear after the 8px overhang.
- The committed `evaluation-4.md`, which is byte-identical to the persisted copy.

**The origin/main merge did not disturb the change** (`eval5-merge-delta.diff`, 0 lines):
- `git diff bc8ccac45 3207b4d0a` (the branch against its old base) is byte-identical to `git diff f4540f25d HEAD` (the merged head against its new base).
- None of the files touched by main's new commits overlaps the branch's files.

### Phase 2: Code Review — PASS

All gates were rerun fresh on the merged head in WORKTREE_PATH. Every one is green.

| Gate | Result | Transcript |
| --- | --- | --- |
| lint | exit 0 | `eval5-static.txt` |
| format:check | exit 0 | `eval5-static.txt` |
| typecheck | exit 0 | `eval5-static.txt` |
| check:scala-quality | clean | `eval5-static.txt` |
| root jest, including helio-mcp | 47 suites, 450 passed | `eval5-jest-full.txt` |
| frontend jest | 527 suites, 5674 passed | `eval5-jest-full.txt` |
| frontend build | exit 0 | `eval5-frontend-build.txt` |
| backend `sbt testFull` | 7063 passed, 0 failed, 4 canceled, exit 0 | `eval5-backend-testFull.txt` |

- The root jest run includes `PASS helio-mcp/src/tools/computeExpressionDescription.test.ts`.
- **I ran testFull myself rather than relying on the executor's transcript,** because the merge brought in new backend code. My run shows `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
- The executor's `cycle5-testFull.txt` shows the same guard line and the same 7063 count.

### Phase 3: UI Review — PASS

**Setup.**
- Servers came from `start-servers.sh` on 6746/9653. `assert-phase servers` PASSED, and both listeners' cwd is this worktree.
- I tested in isolated Chromium contexts with `hasTouch` and `isMobile`, logged in as `matt@helio.dev`. The shared MCP browser was not used.
- Every tap is a real `page.touchscreen.tap`.

**Dev-DB rows.** Created under the dev account and deleted by exact id. Each delete returned 204; afterwards the pipeline returns 404 and the source is no longer listed.

| Pipeline | Source |
| --- | --- |
| `ce9a1d61-7a72-41ea-8b42-013b7d11ac1e` | `f70172a5-9f2a-413d-a553-9621a3074980` |
| `f4f41a1f-03b8-432c-a762-2fd181c9aef9` | `ff1a4727-8571-4dda-a6b4-ad50bdeecd36` |
| `1e0f3031-1e55-49a7-8e45-a673eca35019` | `9b27a981-5558-44b6-b3d1-eb7033feac12` |

**Cleanup.** Servers stopped by exact PID; ports free.

**Dense sweep design** (`sweep-output.txt`, `sweep-fast-output.txt`, raw outcomes in `sweep-raw.json` and `sweep-fast-raw.json`):
- x every 1px from the input's left edge, out to 8px past the summary's 73px width;
- y at bottom − 0.25, 0.5, 1, 1.5, 2 and 3px;
- 492 taps per sweep, at 375 and at 1100;
- three runs, with the variant order rotated each run to rule out order effects;
- two harness cadences: two round-trips per tap, and a faster single round-trip per tap.

**Variants, all in the same harness on the same input:**
- (a) shipped `--space-4`;
- (b) the expander removed at runtime;
- (c) the true pre-change state, with the Functions disclosure absent (`display: none`);
- (d) a `--space-5` counterfactual, in the first harness only.

**Results:**

| Variant | Sweeps | Taps | List opens | Input not focused |
| --- | --- | --- | --- | --- |
| Shipped `--space-4` | 12 | 5904 | **0** | the same 5 cells every sweep |
| Expander removed | 12 | 5904 | 0 | the same 5 cells |
| Pre-change, disclosure absent | 12 | 5904 | 0 | the same 5 cells |
| `--space-5` | 6 | 2952 | 0 | the same 5 cells |

- The outcome matrix of the shipped CSS is **cell-for-cell identical to the pre-change state** in every run, at both widths and both cadences.
- **The x+0/x+1 cells predate this change.** The 5 non-focus cells are x+0 at bottom − 1, 1.5 and 2, and x+1 at bottom − 1 and 1.5.
  - They appear identically in every variant, including the pre-change state where the disclosure is absent.
  - They lie outside the input's 6px bottom-left `border-radius` curve, so the hit test resolves to the field container (`elementFromPoint` = `DIV.pipeline-detail-page__compute-field`, measured in cycle 4).
  - None of them opens the list.
- **I could not reproduce the executor's sporadic opens.** It saw 0–1 per width per run, each at bottom − 0.25 and at a different x each time. My harness saw 0 in 12 shipped sweeps (5904 taps) at two cadences.
  - Its own run 2 also logged a sporadic non-focus with no open (1100, x+2/−0.5), which cannot be attributed to the summary.
  - A random-position, single, non-repeating event that my identical-geometry baseline never produces fits harness timing or sub-pixel noise in that harness. It does not fit a geometric snap.
  - In cycle 4, the `--space-3` defect was deterministic: the same 18 cells in every run. That is a different signature.
  - Because I cannot reproduce it, I cannot measure its rate against a baseline in the executor's harness. The verdict therefore rests on my own deterministic baseline equivalence.
- **Sanity checks** (`sanity-output.txt`, screenshots in `eval5-ui/`):

  | Context | Margin | Input → summary | Hit height | Tap/click opens summary | Page errors |
  | --- | --- | --- | --- | --- | --- |
  | 375 touch | 16px | 20px | 44.5px | yes | 0 |
  | 1100 touch | 16px | 20px | 44.5px | yes | 0 |
  | 1440 mouse | 0px (gate does not apply) | 4px | 28.5px | yes | 0 |

  The chevron is present in all three. Keyboard access, accessible names and token or theme parity were verified in cycles 1–2, and nothing affecting them has changed since.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- Carried from cycle 1: the summary recipe duplicates `.usage-card__summary`, and `UsageCard`'s summary has the same marker and touch-floor gaps. A shared disclosure-summary recipe could be a spinoff.
- The x+0/x+1 corner cells are a property of every rounded input in the app, unrelated to this ticket. Nothing to do here.
