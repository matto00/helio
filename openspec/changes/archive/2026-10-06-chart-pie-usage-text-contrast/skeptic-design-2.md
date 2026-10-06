## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `2c1884ac5b2cc2578320ace4a21e37b32df5c603` (branch `bug/chart-pie-usage-label-contrast/hel-1342`). The only change is the untracked change dir; there is no code diff. Spawn-cwd guard result: `READY ambient=/home/matt/Development/helio branch=bug/chart-pie-usage-label-contrast/hel-1342`.

### What I verified (with evidence)

**CR1 (owner-tier mechanism): closed.** design.md D3 and task 1.1 now use the round-1 fallback (b). The throwaway user's own row is promoted with `UPDATE users SET tier='owner' WHERE id='<recorded id>'`. The statement and its row count go into `evidence-ids.md`. A `GET /api/admin/usage?days=7` = 200 check is required before any measurement, and `backend/.env` must not be edited. I checked that this works against the live tree:
- **The premise for rejecting process-env still holds.** `backend/.env` has exactly 1 `HELIO_OWNER_EMAILS=` line. `build.sbt` sets `Compile / run / fork := true` and `Compile / run / envVars ++= loadDotEnv(...)`.
- **The server gate reads the stored tier on every request.** `AdminAccessService.guardOwner` calls `userRepo.findById(user.id)` and allows only `tier == Owner`. `AdminUsageRoutes` calls it before it parses anything. A DB row edit is therefore honoured immediately, with no session cache to defeat it.
- **A fresh login does not undo the promotion.** `AuthService.promoteIfAllowlisted` (l.223-226) and `UserRepository.upsertGoogleUser` (l.85) only ever promote, never demote: "a strict promotion, never a demotion". An email outside the allowlist keeps its stored `owner`.
- **The client gate follows the same stored tier.** `OwnerOnly.tsx:14` reads `state.auth.currentUser?.tier`, which the fresh login populates from the stored tier. That is why the design says "log in fresh".
- **The value is valid.** V88 defines `tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','beta','owner'))`, so `'owner'` is accepted and `id` is a UUID (quoted literal OK).
- **The justification holds.** The CLAUDE.md text ("assigned owner tier at signup and promoted to owner at login ... never a one-off DB edit") describes how real accounts gain owner tier. A throwaway dev fixture, promoted by exact id and deleted by that id, is outside what that rule governs. The argument against editing `.env` is also sound: a missed byte-identical restore would leave a lasting, silent grant of owner tier on every later backend restart, which is a bigger failure blast radius. Round 1 explicitly allowed (b) with a written justification, and the justification is written.

**CR2 (vacuous both-themes UsageChart test): closed.** D4 and task 2.2 now set distinct `--app-text` values per theme on `document.documentElement`, switch theme, flush the rAF `themeSyncTick`, and assert that the colours follow the change. Mutation (3), which hardcodes the fallback/dark token in place of `tokens.text`, is added to D4 and task 3.3. The axis-colour-removal mutation is kept. I checked that this is feasible rather than assuming it:
- `resolveChartTheme()` (`chartAppearance.ts:59-66`) reads `getComputedStyle(document.documentElement).getPropertyValue("--app-text")`.
- There is no precedent test in the repo that sets `--app-text` (grep found 0 hits), so I probed the repo's own jsdom 26.1.0 directly. An inline `setProperty("--app-text","#111111")` read back as `"#111111"`. A stylesheet keyed on `html[data-theme=dark|light]` read back as `"#eeeeee"` / `"#222222"` respectively. jsdom honours custom properties both ways, so the test can observe a real token switch.
- `ThemeProvider` writes only `dataset.theme`, `colorScheme` and accent tokens (`applyAccentTokens`). It never writes `--app-text`, so it will not clobber the test-set values.
- **Red on main is real.** `UsageChart.tsx:47-80` sets no colour on axisLabel, nameTextStyle, legend or global textStyle. `appearanceToEChartsOption` sets colour only on tooltip text, so `#111111`/`#eeeeee` assertions fail on main. Mutation (3) turns red because neither test value equals the `#f2efe9` fallback.

**Nothing else is unsound. I re-checked the remaining claims:**
- **AC coverage is complete:**
  - route both through `resolveChartTextColor`: D1/D2, tasks 3.1/3.2;
  - measure before and after in both themes, §10 method, extend §10: D3, tasks 1.3/4.1/4.2;
  - running-app comparison under DESIGN.md: task 4.1;
  - a test that fails on main: D4, tasks 2.1/2.2.
- **No scope drift.** Label position, label-line colour and tooltip are explicit non-goals, and other call sites are only recorded (task 4.3).
- **No placeholders block implementation.** The one "executor confirms" item (the outline property) is now pinned by D3's note, which follows from zrender `Text.js:226-234`: an explicit `color` suppresses autoStroke. The pie "no outline" guard asserts the absence of `textBorderColor` or a positive `textBorderWidth`, not a no-op `=== 0`.
- **No contract delta is needed.** The change is frontend-only, with no API or schema change. Spec deltas exist for both affected capabilities (`echarts-chart-panel`, `owner-usage-admin`).

### Verdict: CONFIRM

### Non-blocking notes
- **Cleanup order and implicit rows (task 5.2).** Several FKs to `users(id)` have no `ON DELETE CASCADE`: dashboards, panels and pipelines `owner_id` (V10/V32), outputs (V94), `pipeline_run_rate_window.user_id` (V109), `assistant_daily_usage`-style (V88) and others. Pipeline runs and the pie seeding will create rows that task 1.1's id list does not name. Examples are `pipeline_run_rate_window` entries keyed by the throwaway user id, and register-time telemetry/audit rows. Delete children first. Where a row was created implicitly, delete it by the recorded **user id** (still an exact id, not a pattern) and record those counts too. Otherwise the final `DELETE FROM users WHERE id=...` will fail on an FK.
- **D1 and the D3 note disagree slightly.** D1 still names `textBorderWidth: 0` as the default way to neutralise the outline, but the D3 note says to add it only if measurement shows it is needed. The D3 note is the correct one (an explicit `color` already suppresses autoStroke), and task 3.1 should be read in that light.
- D1 calls the default label position `"outside"`. ECharts' pie default is `'outer'`, an alias with the same meaning, so this is not substantive.
- `tasks.md` has an empty "Standing Constraints" heading. That is harmless, but the driver constraints from `ticket.md` (ports, nice/2 workers, no `~` writes, recorded PIDs) are the binding ones.
