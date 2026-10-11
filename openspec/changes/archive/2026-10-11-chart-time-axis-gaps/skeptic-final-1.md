## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: f8392cf14e284fa82efe79ced5b1084f79c6c5c0. Diff base resolved live via resolve-review-base.sh: 3eb0cc893.
Evidence dir (already in the durable main-checkout run dir, so no copy was needed):
`/home/matt/Development/helio/.concertino/runs/HEL-1305/evidence/skeptic-final-1/`

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/chart-time-axis-gaps/HEL-1305`.

**Code read.** I read the full diff of these files: `buildChartOption.ts`, `chartDataOptions.ts`, `chartTimeDataOptions.ts`, `timeAxisOption.ts`, `chartTimeAxis.ts`, `chartOverlayOption.ts`, `chartTypeOptions.ts`, `chartAppearance.ts`, `chartClickSelection.ts` and `ChartTimestampParsingParitySpec.scala`. Every time-axis behaviour is added as a new branch next to the existing category branches. The category paths are untouched except for ruling 2 (`?? 0` becomes `?? null` at `chartDataOptions.ts:184`) and the `—` tooltip wrapper.

**Gates, re-run fresh by me** (logs in the evidence dir):
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, zero warnings.
- Jest over every chart suite touched (chartTimeAxis, timeAxis*, unchangedPath, fieldTypes, chartDataOptions, chartOverlay, chartTypeOptions, chartClickSelection, chartAppearance, buildChartOption*): 18 suites, 411 tests, exit 0.
- Backend and the shared fixture have not changed since aa8b4f4ea. The evaluator's pasted `eval-1/sbt-testFull.log` is unambiguous on two points:
  - `ChartTimestampParsingParitySpec` passes both cases (log lines 43625-43628);
  - the run totals `succeeded 7133, failed 0`.
  I relied on that log rather than re-running sbt.

**AC1 (irregular dates, proportional, sorted).** Code: `timedRows` sorts by parsed instant (`chartTimeDataOptions.ts:43-50`), and the axis is `{type:"time"}`. In the running app (my own throwaway user):
- the tsLine panel has `xAxis.type` `time` and `useUTC` `true`;
- spacing is visually proportional at 1440 and 375;
- the e2e pixel measurement (17.1 px per day: gaps 17.1 / 119.8 / 222.6 for 1 / 7 / 13 days) agrees with what I saw;
- a tz-less `2026-09-01T08:15:00` plots at epoch 1788250500000. `date -u` gives Sep 1 08:15 UTC, so the instant is correct;
- the tooltip header reads `2026-09-01 13:30` for 1788269400000, which is correct in UTC.

AC1 met.

**AC2 (missing x is a gap, not 0, with a unit test).**
- Unit test `buildChartOption.timeAxis.test.ts:42` ("emits null for the series that misses an x"), plus the time-axis multi-series case at :131. Both pass.
- Live: series B breaks at Sep 3 and Sep 11. Hovering the gap gives tooltip text `2026-09-03 / A: 16 / B: —` in both light and dark (`dash-light-1440.png`).

AC2 met.

**AC3 (non-date category x unchanged).**
- `buildChartOption.unchangedPath.test.ts` deep-equals 32 cases against `chartUnchangedPath.main.snapshot.json`. The evaluator's provenance check (`eval-2/snapshot-provenance-result.txt`) shows main's own source reproduces that snapshot, and HEAD differs only in the two ruling-2 gap cells.
- The guard is mutation-proven (`HEL-1305-mutation-unchangedPath-guard.txt`). The test passes for me.
- The e2e `text-*-375/1440.png` (label column D1..D6) still draws category axes.

AC3 met.

Side finding on AC3: a dataset column I declared `string` holding `2026-09-01` values still drew a time axis, because the pipeline Output's schema infers it as `timestamp` (`/api/outputs/:id` schema: `day: timestamp`). This is consistent with ruling 1, which keys on the Output's declared schema. It is not a defect of this change, but it means almost every date-looking column will get the time axis.

**Running app — my own probe.**
- Servers: started via `start-servers.sh` on 6737/9644; `assert-phase.sh servers` printed PASS.
- Identity: I registered user `cb4fabbf-5aad-4345-ac7e-2b6364ca4315` (`hel1305-skeptic-…@example.test`). Before registering, the MCP browser returned `/api/auth/me` 401, so it was not logged in as any other account. I re-verified the identity before every seed or delete.
- Charts seeded:
  - multi-series line and bar, timestamp-typed and "string"-declared;
  - a duplicate-date single-series bar;
  - an hourly line with `compare: previous_run` plus a reference line and band;
  - a months-span line.
- Captured light and dark at 1440 (`dash-light-1440.png`, `dash-dark-1440.png`) and light and dark at 375 (`m-light-375-a.png`, `m-light-375-b.png`, `m-dark-375-b.png`).
- Overlay on a time axis: aligned by instant. The live `getOption()` shows the overlay points carry the same instants as the primary.
- Reference line and band: both draw on the time axis.
- Console: no app errors. The only errors are 401s from before login and after logout, and connection-refused after I stopped the servers.

**Cleanup.** All deletes were by exact id:
- 18 deletes, each returning 204 or 200: the dashboard (its panels cascade), 7 outputs, 5 pipelines and 5 data sources. Afterwards the user's lists were empty.
- I logged the user out, then deleted it by exact id with the repo's own `userCleanupCore.buildUserDeleteSql` + `db.cjs psql`. A follow-up `SELECT count(*)` returned 0.
- I stopped the servers by exact PID (sbt 205357/205406/205565, npm/vite 205779/205794). I had started them 3m46s earlier, as shown by etime against the wall clock. Both ports are now free.
- I moved my MCP files into `evidence/skeptic-final-1/mcp/`.

**Visual cohesion of the time axis.**
- Labels use the same mono font, size and colour as the y-axis in both themes.
- The UTC tooltip matches the existing tooltip chrome: mono font, same border and shadow.
- Bars on a time axis get edge padding and are not clipped.
- The stacked bar stacks correctly by instant.
- One defect, at narrow widths: see CR1.

### Verdict: REFUTE

### Change Requests

1. **Time-axis x labels overlap into unreadable text at narrow widths** (design judgment, visual; reproduced in both themes after a reload).
   - **What I saw:** an hourly or intra-day timestamp line at 375 (panel canvas 285 px, compact 10 px labels) renders `10:0012:0014:0016:0018:0020:0022:00 2 02:00` as one run-together string. Evidence:
     - `evidence/skeptic-final-1/hourLine-light-375-labels.png` (device scale)
     - `evidence/skeptic-final-1/m-light-375-b.png`
     - `evidence/skeptic-final-1/m-dark-375-b.png`
   - **Month span:** the same layout leaves `Feb Mar Apr … Dec` with zero gap between labels.
   - **Why it is new:** the category axis this replaces auto-hides overlapping labels (interval `auto`), so this is a regression in legibility. It applies to any narrow chart: mobile, and small desktop panels of similar width.
   - **Cause:** the time axis's `axisLabel` carries no `hideOverlap`. The live option read `hideOverlap: null`.
   - **Fix:** set `axisLabel.hideOverlap: true` on the x axis only when it is a time axis. The natural place is the HEL-1305 merge in `buildChartOption.ts:206`, next to `type: "time"`, or `TIME_X_AXIS` in `chartTimeDataOptions.ts:32` if it survives the merge. This keeps ECharts' built-in adaptive labels (ruling 4) and leaves category options byte-identical (C2).
   - **Probe:** I applied exactly this live via `setOption({xAxis:{axisLabel:{hideOverlap:true}}})`. The labels became `12:00 16:00 20:00 2 02:00`, legible and with the day boundary kept (`evidence/skeptic-final-1/hourLine-light-375-probe-hideOverlap.png`).
   - **Tests and evidence required:**
     - a unit test that a time-axis built option carries `xAxis.axisLabel.hideOverlap === true`;
     - the unchanged-path snapshot suite still green (it must not appear on category options);
     - fresh 375 light and dark screenshots of an intra-day timestamp chart.

### Non-blocking notes

- **(a) Duplicate-instant single-series bar over raw rows.** I confirmed it live (`dash-*-1440.png`, panel "SK dupBar"): two rows on 2026-09-01 (10 and 20) draw as one bar. The 10 is fully hidden, and the tooltip shows only `value: 20`.
  - This is a direct consequence of binding ruling 5 (raw rows on a time axis). Fixing it needs a product choice: aggregate duplicates, offset them, or fall back to a category axis. That choice is not the executor's or mine to make.
  - Lines draw a visible vertical segment instead.
  - Not blocking. Record it in the PR body and file a follow-up ("time-axis raw-row bars hide rows that share an instant"), linked to HEL-1305.
- **(b) Parity spec asserts `None` for `MM/dd/yyyy`.** Acceptable, and stronger than D3: it pins the frontend extension as the only divergence. The class scaladoc still says those cases "assert nothing here" (`ChartTimestampParsingParitySpec.scala`, doc comment), which contradicts the second test. Fix the comment while in the area.
- **(c) Unparseable-x rows silently dropped on a time chart (D4).** Accepted per design. Keep the follow-up candidate ("surface dropped-row count") in the PR body.
- **ECharts day-boundary label.** On an intra-day axis the label is a bare `2` (Sep 2), which can read oddly. It is ECharts' built-in level label (ruling 4), so no change is needed.
- **Pre-existing, not this change:** at 375 the y-axis of an overlay plus reference-band chart is crammed (`35 30 25 …` stacked). This comes from compact height plus the kept overlay legend, and is independent of the x-axis type (the evaluator's `overlay-refmarks-*-375.png` shows the same).
- **Gate-chain check:** neither the evaluator's report nor mine relies on mtime ordering, so there is no mtime-soundness gate defect to record.
