## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `79de6b835d44a8f3ebaed5af2a8b44f16d0b6f69`. Diff base, resolved live with `resolve-review-base.sh`: `e4289e6c88e4d8d0c174b94f1359817fe0466514` (origin/main).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (new tab, edits survive, accessible name): `HistoryPayloadsField.tsx` uses `target="_blank"` and `rel="noopener noreferrer"`. The link holds the visually-hidden text " (opens in a new tab)" in the canonical `.sr-only` class (`theme.css:505`). I checked this live in both themes, opening the link from the keyboard (focus, then Enter):
  - A popup opened at `/settings#beta-access`.
  - The "Beta access" heading was in the viewport.
  - `window.opener === null` in the popup.
  - The original tab stayed on `/pipelines/:id` and kept the unsaved name edit.
- AC2 (`historyPayloadLimits` on every response that has `historyPayloadsAvailable`, env overrides included, schema): `withAvailability` is the only place `historyPayloadsAvailable` is stamped, and it now sets the limits from the same config.
  - Live with the default env, the field was present on GET `/api/outputs/:id`, on every item of GET `/api/outputs`, and on the POST create response.
  - Live with `PAYLOAD_HISTORY_MAX_ROWS=500 PAYLOAD_HISTORY_MAX_BYTES=2097152 PAYLOAD_HISTORY_MAX_RUNS_BETA=1 PAYLOAD_HISTORY_MAX_AGE_DAYS_BETA=1` exported into the restarted backend, the API returned `{"maxRows":500,"maxBytes":2097152,"tiers":{"beta":{"maxRuns":1,"maxAgeDays":1},...}}`. This proves the `Main` → `fromEnv` → `ApiRoutes` path end to end, not only the injected config the spec exercises.
  - The schema has the field, with `readOnly` and `additionalProperties: false` at each level. The schema-drift check passes.
- AC3 (figures rendered from the field, no constant): `HELP_TEXT` is deleted and the figures come from `formatHistoryPayloadLimits`. With the overridden config, the live editor reads "A run over 500 rows or 2 MiB keeps only its summary. Beta keeps the last 1 run for 1 day; Owner keeps 30 runs for 30 days." in both themes.
- AC4 (MCP): `HISTORY_PAYLOADS_CONFIG_DOC` points at `historyPayloadLimits` and no longer states the figures. `OutputResponse` has the type. Both `server.test.ts` and the passthrough test cover this.
- AC5 (note styling): the note now uses `output-editor-sheet__field-hint`. Live computed styles of note and help text are identical in each theme:
  - light: 12px, rgb(100, 94, 86)
  - dark: 12px, rgb(170, 164, 156)
  - The link inherits 12px.
- Tasks 1.1–4.1 are all marked done and match the diff. There is no scope creep: item 4 is untouched, and `compareOptions.ts` is not in the diff (0 hits).
- The planning artifacts and spec deltas match what was implemented. `openspec validate history-payloads-toggle-polish --type change` reports the change is valid.
- CONSTRAINTS C1–C6 are honoured:
  - No compareOptions change.
  - e2e screenshots go through `evidencePath`, in both themes.
  - No hook bypass is visible.
  - No prod access, and no matt@helio.dev data was touched.

### Phase 2: Code Review — PASS
Gates, run fresh in WORKTREE_PATH under `nice -n 19` with at most 3 workers:
- `npm run lint`: exit 0
- `npm run format:check`: all files clean
- `npm run typecheck`: exit 0
- `npm run check:schemas`: in sync
- `npm run check:scala-quality`: clean (soft warnings only, none new)
- `npm run check:no-credential-leak`: OK
- root jest (includes helio-mcp): 39 suites / 379 tests passed
- frontend jest: 463 suites / 4893 tests passed
- `npm --prefix frontend run build`: success
- helio-mcp `npm run typecheck`: exit 0
- `cd backend && sbt testFull`: 6113 succeeded, 0 failed (4 canceled), "All tests passed". The 4 new `historyPayloadLimits on Output responses` cases ran and passed.
- e2e `hel1331-history-payloads-toggle.spec.ts` against this worktree's restarted servers (DEV_PORT=6804): 4/4 passed.

Code review:
- The code follows CONTRIBUTING: top-of-file imports, no inline FQNs, and files within budget (OutputProtocol 199 lines, OutputRoutes 228).
- It follows DESIGN.md's mechanical rules: tokens only (`--text-xs`, `--app-text-muted`), and the existing `.sr-only` utility is reused.
- The limits object is built once per stamping call. The formatter is pure, small and unit-tested: defaults, overrides, singular units, zero tier, KiB and raw-byte fallbacks, and the absent case.
- There is no `any`, no dead code and no TODO.
- A client-sent `config.historyPayloadLimits` cannot affect the top-level field; the backend spec covers this.

### Phase 3: UI Review — PASS
Servers: as the caller warned, the backend on 9711 predated the commit.
- I stopped it by exact PID (3485446 and its sbt launcher 3485047) and restarted it with `start-servers.sh`. `assert-phase.sh servers` reported PASS.
- The new backend PID's cwd is this worktree's `backend/`. Vite on 6804 (cwd this worktree's `frontend/`) was reused.
- For the override check I restarted the backend a second time with `PAYLOAD_HISTORY_*` overrides. I then restarted it once more with no overrides, confirmed 0 `PAYLOAD_HISTORY` variables in the process environment, and left it running that way.

I used my own Playwright browser and context, not the shared MCP browser. Results:
- Happy path: the beta-owned editor shows an enabled switch and the served figures. The free-owned editor shows a disabled switch with the note and link. Both themes verified (`data-theme` checked).
- Unhappy path: when limits are absent, the help text renders with no figures (unit test). Breakpoints 1440, 1100, 768 and 375 showed no horizontal overflow, and at 375 the link wraps cleanly.
- Keyboard: the link is reachable by focus and activates with Enter. The accessible name is "Request Beta access (opens in a new tab)".
- Console: no page errors. The only console errors are a 404 on `GET /api/pipelines/:id/schedule` for a pipeline with no schedule. This happens on the pipeline page itself, in code this diff does not touch, so it is not from this change.

Evidence (durable):
- `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1372/eval-default-results.json`
- `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1372/eval-override-results.json`
- `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1372/eval-default-free-light-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1372/eval-default-free-dark-375.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1372/eval-default-beta-dark-1440.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1372/eval-default-beta-light-768.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1372/eval-override-beta-light-1440.png`

All the claims above rest on JSON values and computed-style measurements. None depends on file modification times.

Cleanup: all 10 users that my probes and e2e run created, and the 6 pipelines and 6 sources my probes created, were deleted by exact id. The e2e spec deletes its own pipelines and sources. Afterwards, `SELECT count(*)` returns 0 for both the users and the pipelines.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `schemas/outputs/output.schema.json`: the `{maxRuns, maxAgeDays}` tier object appears three times verbatim (free, beta, owner). A single `$defs/HistoryPayloadTierLimit` with `$ref`, a pattern `schemas/patch-sets/patch-set.schema.json` already uses, would keep the three in step. Only do this if the schema-drift checker resolves `$ref`.
- `e2e/hel1331-history-payloads-toggle.spec.ts` checks only `maxRows` against the served limits. Asserting the whole formatted sentence (bytes and tiers too) would catch a regression in the tier wiring at the browser layer. The unit tests and backend spec already cover it, so this is optional.
