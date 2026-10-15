## Standing Constraints

- [C1] No behaviour, API, schema, or rendered-output change. Docs, specs, a parameter rename, and proven-dead code removal only.
- [C2] Do not touch HEL-1572's requirement ("Hover emphasis is subtle and respects reduced motion") or any file owned by concurrent lanes HEL-1601 (CI workflow, jest reporter) / HEL-1613 (e2e) or parked HEL-1610/1575/1576/1578/1579/1572/1583.
- [C3] Every spec/doc claim gets a verification command plus its output in `evidence.md` in this change directory.
- [C4] If the probe shows the authenticated app should NOT be calling `GET /api/dashboards/:id/panels` (code wrong), change nothing for that item and return ESCALATION.
- [C5] Local caps: jest `--maxWorkers=3` or fewer under `nice -n 19`; Bash `timeout: 600000`; never more than 3-4 parallel workers. Cited test runs must show this worktree's paths and non-zero counts.
- [C6] Never pkill/pgrep/killall or signal processes you did not start; stop servers only via `scripts/concertino/stop-servers.sh`. Never edit rendered Concertino files.
- [C7] No writes to the main checkout. Scratch only under `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/hel1614/<role>-<n>/`.

## 1. echarts-chart-panel spec

- [x] 1.1 Re-verify each scenario body in `specs/echarts-chart-panel/spec.md` (delta) against the cited source/test lines in design.md; record command + output per scenario in `evidence.md`.
- [x] 1.2 Retitle the four scenarios named in design.md Decision 1 in BOTH `openspec/specs/echarts-chart-panel/spec.md` and the delta, in lockstep; direct-edit the Purpose line to the Output-bound model. Verify: `openspec validate last-stale-panel-references --type change --strict` exits 0; `grep -n typeId` on the delta is empty and the Purpose line (spec.md L4) has no `typeId`/`type: "chart"`.
- [x] 1.3 Simulated archive on a scratch copy of the worktree (`openspec archive last-stale-panel-references --yes` in the copy): succeeds; `grep -n typeId` on the resulting echarts spec is empty; it still contains HEL-1572's target requirement unchanged; the write-path-audit `## Write Path Reference` section survives. Record in `evidence.md`.

## 2. write-path-audit spec

- [x] 2.1 Direct-edit the reference section to the batched model per design.md Decision 2 (rows 7/8, payload details 7/8, row 9 trigger source, call-volume rows and totals, Source Locations, Key observation L176-180). Each claim verified against `panelService.ts`, `panelPayloads.ts`, `usePanelUpdatesFlush.ts`, `usePanelTitleEditing.ts`, `PanelDetailModal.tsx`, `OutputPicker.tsx` with a grep in `evidence.md`.

## 3. usePanelPolling rename

- [x] 3.1 Rename `typeId` -> `outputId` in `frontend/src/features/panels/hooks/usePanelPolling.ts` (param, doc comment, guard, deps). Also rename the `typeId` variable/test titles in `usePanelPolling.test.ts` (assertions unchanged). Verify: `grep -rn typeId frontend/src/features/panels/hooks/` empty; the polling tests (find with `grep -rln usePanelPolling frontend/src`) pass unchanged in assertions.

## 4. CLAUDE.md panels-endpoint line

- [x] 4.1 Start this worktree's servers (`scripts/concertino/start-servers.sh`, ports 7046/9953), sign in as the dev account (`matt@helio.dev` / `heliodev123`), and probe `GET /api/dashboards/<owned non-public id>/panels` signed-in and unauthenticated; grep the `authenticate` branch for a same-path route. Record in `evidence.md`. Stop servers via `scripts/concertino/stop-servers.sh`.
- [x] 4.2 If the doc is wrong, rewrite only CLAUDE.md line 155 accordingly (per design.md Decision 4); if the code is wrong, see C4.

## 5. Dead code

- [x] 5.1 Prove `metricOptions` and `.panel-detail-modal__segmented*` dead (greps listed in design.md Decision 5, before the edit, in `evidence.md`).
- [x] 5.2 Remove them and update `CollectionRenderer.test.tsx`, `MetricRenderer.duration.test.tsx`, `PanelDetailModal.css.test.ts` per Decision 5.
- [x] 5.3 Verify: `npm --prefix frontend run typecheck`, `npm --prefix frontend run lint`, `npm --prefix frontend run build` pass; no built JS asset references `panel-detail-modal__segmented` before or after, and the built CSS no longer contains it; the touched test files pass (jest, capped per C5).

## 6. Gates

- [x] 6.1 Commit through the normal pre-commit hook (no `-n`); write `files-modified.md` listing every touched file.
