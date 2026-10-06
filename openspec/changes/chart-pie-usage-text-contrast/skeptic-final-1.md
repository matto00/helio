## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `4a68aa746e9607dc23a6b167f9482856f4a89d22` (unchanged from spawn through to the end of the review).
Diff base, resolved live with `resolve-review-base.sh <wt> main origin` (exit 0): `2c1884ac5b2cc2578320ace4a21e37b32df5c603`. The branch has 4 commits on top of it. The HEL-1334 merge on origin/main is not an ancestor, and it does not touch these files.

### What I verified (with evidence)

**AC1: both surfaces go through `resolveChartTextColor` and the theme tokens**
- `buildChartOption.ts:184-193`: a post-`applyChartTypeOptions` pass sets every pie series' `label.color = textColor`. Here `textColor = resolveChartTextColor(theme, appearance, themeTokens.text)` (line 104), the same value the legend and axes use.
  - The pass runs after the percent formatter is merged, and it spreads the existing label, so the formatter is kept.
  - An explicit fill also removes zrender's automatic white outline, so nothing paints a ring around the text.
- `UsageChart.tsx:53`: `resolveChartTextColor(theme, undefined, tokens.text)` is wired into `textStyle`, `legend.textStyle`, `x/yAxis.axisLabel` and `nameTextStyle`. The font family is kept. `theme` was added to the memo dependencies.
- The one recorded exception is that labels stay outside the slices. I grepped `features/panels` and `utils` for `position: inside`: there are zero non-test hits, so the exception holds.
- Exporting `toSeriesArray` is a minimal, justified reuse.

**AC2: contrast before and after, WCAG 2.x 1.4.3 AA, and §10.1 accuracy**
- I recomputed every ratio in the §10.1 table independently with the WCAG relative-luminance formula:

  | Text | Background | Ratio |
  |---|---|---|
  | `#333` | `#1a1816` | 1.40 |
  | `#333` | `#fdfcfa` | 12.32 |
  | `#54555a` | `#1a1816` | 2.38 |
  | `#54555a` | `#fdfcfa` | 7.25 |
  | `#f2efe9` | `#1a1816` | 15.43 |
  | `#211d19` | `#fdfcfa` | 16.33 |

  All six match §10.1.
- The token values match `frontend/src` CSS:
  - dark: `--app-surface #1a1816`, `--app-text #f2efe9`;
  - light: `--app-surface #fdfcfa`, `--app-text #211d19`.
- The before state is corroborated by the persisted `before-dark-pie-percent.png`, which shows `#333` text with a heavy white ring.
- The §10.1 method and scope notes (light already passing, dark the failure) are accurate.

**AC3: comparison against the running app in both themes**
- I ran my own servers on 6774/9681 with `start-servers.sh`, and `assert-phase.sh servers` printed PASS.
  - Listener PIDs: vite 3342777 (parent npm 3342750) and java 3342274 (parent sbt launcher 3339914).
  - cwd of both: this worktree's `frontend/` and `backend/`.
- I seeded a throwaway owner with three pies: default, percent labels, and a tinted-background panel (`#f5e6c8`, to exercise the contrast-flip path). I also opened `/admin/usage`.
- Headless chromium at DPR 2. The live `--app-text` read `#f2efe9` (dark) and `#211d19` (light).
- No console errors in either theme. The first dark pass hit 429s from my own pacing, so I waited out the window and re-ran; the re-run was clean.

Screenshots (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1342/evidence/openspec/changes/chart-pie-usage-text-contrast/skeptic-light-dash.png`
- `.../skeptic-dark-dash.png`
- `.../skeptic-light-usage.png`
- `.../skeptic-dark-usage.png`
- `.../skeptic-light-pie-1.png`
- `.../skeptic-dark-pie-1.png`

**AC4: a test that fails on main**
- I copied the HEAD `frontend/` tree into my scratchpad (`git archive`), put back the main versions of the three source files, and ran the two new or extended test files: **7 failed / 36 passed**.
  - Failures: 6 pie-label cases (`Received: undefined` for colour) and the UsageChart theme-switch case.
  - Same files at HEAD: all pass.
- So the tests are red on main for the right reason.

**Gates (re-run by me at HEAD, project-local npm cache)**

| Gate | Result |
|---|---|
| `npm --prefix frontend test -- --maxWorkers=2` under `nice -n 19` | 439/439 suites, 4581/4581 tests, EXIT 0 |
| typecheck | clean |
| lint | clean |
| prettier on the changed files | clean |

- The red run recorded in `gates.txt` did not reproduce for me. That record is honest: it keeps the red run and does not attribute it.

**Design judgment (DESIGN.md, sibling consistency)**
- The themed slice labels read well next to the legend in both themes. They are now the same colour, size and face as the legend entries, with no halo.
- The before state was visibly worse: off-family heavy text with a white ring, which read as a different UI layer. The after state reads as one typographic system.
- Leader lines keep the sector colour, which correctly ties each label to its slice.
- No label collides with a slice or the legend at this size.
- On the tinted panel (Charlie), labels and legend still agree in both themes, because both go through the same resolver.
- The usage page's axis ticks and legends now match the panel charts' axis treatment (HEL-1263): the same token, and the existing mono tick face is unchanged. Light-theme legibility is unchanged; dark-theme legibility is fixed.
- No hardcoded colours were introduced.

### Verdict: CONFIRM

### Non-blocking notes
- The `toSeriesArray` doc comment (`chartAppearance.ts` ~198-203) still explains why it is private, but it is now exported. Reword it in a later touch.
- Usage axis ticks now use full-strength `--app-text`. A muted text token might sit quieter under the chart titles, but full strength matches the panel charts, so I am leaving it as is.
- I did not re-run hover or emphasis states or the narrow breakpoints. The evaluator's cycle-2 live pass covered them, and no rendering code has changed since.

### Dev DB (created by me, deleted by exact id)
- user `279e8533-92cb-4e2d-8f38-952da7816874` (hel1342-skeptic-1791292975904@example.test), promoted to owner by id (UPDATE 1).
- API deletes:
  - panels `8bf09f2f-e837-46e7-8c39-1dd0feb6df42`, `d0263283-72c5-446b-968e-94a64009e89e`, `32eb9633-52a6-4138-8ad2-e7569edbb70b`: 204 ×3
  - dashboard `af813827-bcb1-4707-acf5-29ab40d5c218`: 204
  - outputs `8fffe70b-b54b-4616-aa65-ca97c40bf4f4`, `8289cfe0-7b89-4ffc-98e8-6fd4260f190e`, `09d80d73-38e9-46df-9f91-51670d2aaf8b`: 200 ×3
  - pipeline `b8d050ce-ec90-4968-9e1a-b9136e39242f`: 204
  - data source `417d7a1f-ca2d-4a5d-857b-babdbfb6efb5`: 204
- A re-query by id found 0 rows for each of them.
- `DELETE FROM pipeline_run_rate_window WHERE user_id=<user>`: DELETE 1.
- `DELETE FROM users WHERE id=<user>`: DELETE 1. Re-query: 0.
- Servers were stopped by recorded PID (3342777, 3342750, 3342274, 3339914). All are gone, and both ports are free.
- I did not use sbt's client, so no `sbt --client shutdown` was needed.
