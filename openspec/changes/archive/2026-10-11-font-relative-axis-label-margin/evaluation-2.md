## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `a3fe652583618763b1344893d610084037bfdd69`, the squashed single commit. The review base was resolved fresh: `2e02b79511fab222ac2bc73a142fc61e0979f192`, which is also the merge-base. Evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1512/evidence/eval2-*`.

### Squash drift — none

`git diff 75bb2651d a3fe65258` is empty (0 lines), and both commits have the identical tree `a949b389fa2c762e0df89b21846bc68bf9b20538` (`eval2-squash-drift.txt`).

### Phase 1: Spec Review — PASS

Issues: none.

- Cycle 2's only frontend change against the cycle-1 commit 081b415f1 is the CR1 move plus comment and export tidying. Behaviour is unchanged, so Phase 1 holds as it did in evaluation-1.
- The AC are re-measured below:
  - 7 of 7 days on both heatmaps at 375 and 1440.
  - 10 of 10 bins at 1440.
  - Gap floors of at least 14 px for the 12px font and at least 12 px for the 10px font.
  - Checked in light and dark.
- Constraints C1–C5 are still honoured. C1's red-first proof and the mutation evidence from cycle 1 still apply, because the behaviour under test is byte-identical apart from where `fontSizeOf` is defined.

### Phase 2: Code Review — PASS

Gates, run fresh at a3fe65258 (`eval2-gates.txt`):

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm test` | frontend 568 suites / 6209 tests / 19 snapshots; helio-mcp 454 tests; all pass |
| `npm run typecheck` | exit 0 |
| `check:e2e-types` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |

The cycle-1 CR is verified fixed. `fontSizeOf` now lives in `heatmapHistogramOptions.ts`, next to the now file-local `CATEGORY_LABEL_DEFAULT_FONT_SIZE`, and is imported by `buildChartOption.ts`. `defaultOption`'s explanatory comment (`buildChartOption.ts:36-41`) once again sits directly above `defaultOption`. The `categoryXLabelMargin` JSDoc is corrected. `CATEGORY_LABEL_SHOW_ALL`, `CATEGORY_LABEL_DEFAULT_FONT_SIZE` and `CATEGORY_X_LABEL_MARGIN_PER_PX_FONT` are no longer exported. No new issues.

### Phase 3: UI Review — PASS

I started the servers with `start-servers.sh` on 6944/9851 and `assert-phase servers` passed. Afterwards I stopped them by exact PID and confirmed no process was left in the worktree.

| Spec | Result | Transcript |
|---|---|---|
| hel1512 | 4/4 (light/dark × 1440/375) | `eval2-e2e-hel1512-category-axis-labels.txt` |
| hel1311 | 9/9 | `eval2-e2e-hel1311-heatmap-histogram-charts.txt` |
| hel1305 | 6/6 | `eval2-e2e-hel1305-chart-time-axis.txt` |
| hel1306 | 8/8 | `eval2-e2e-hel1306-chart-reference-lines.txt` |

Each hel1512 case registered its own throwaway `@example.test` user, verified through `currentUserId` → `/api/auth/me`. The user ids are logged in the transcript, and the run registry was cleaned up by global teardown.

hel1512 measurements, identical to cycle 1:

| Case | heatX | heat8X | heat8Y | hist10 | hist20 | overlaps |
|---|---|---|---|---|---|---|
| 1440, light and dark | 7/7, gap 91.36 | 7/7, gap 88.36 | 6/6 | 10/10, gap 16.75 | 5/20, gap 15.75 | 0 |
| 375, light and dark | 7/7, gap 14.57 | 7/7, gap 12.00 | 3/6 | 4/10, gap 13.04 | 3/20, gap 17.20 | 0 |

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `buildChartOption.ts` is still 412 lines, past CONTRIBUTING's ~400-line threshold. Propose a split in the PR description.
- In `buildChartOption.ts`, the import list puts `fontSizeOf` between `categoryXLabelShowAll` and `compactHeatmapVisualMap`, out of alphabetical order. Lint does not enforce this; it is cosmetic.
