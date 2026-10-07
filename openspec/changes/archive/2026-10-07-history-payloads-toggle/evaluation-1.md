## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d44dbac1e49e2b63590e0c57aa305156fc7becd2`. The diff base was resolved live with `resolve-review-base.sh`, giving `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. The spawn-cwd guard returned READY.

### Phase 1: Spec Review — PASS
Issues: none

- **AC1 (editor toggle with caps and free tier):** done. `HistoryPayloadsField.tsx` sits in a History section in edit mode. The ticket AC also requires showing that free tier stores nothing; the disabled state's note covers that.
- **AC2 (MCP):** done. `HISTORY_PAYLOADS_CONFIG_DOC` is appended to the `update_output` description. The generic `config` passes through, and a handler test pins `config.historyPayloads: true`.
- **AC3 (tests on both paths, both themes):** done. There are Jest, helio-mcp, backend route/repository and e2e tests, plus light and dark evidence (see Phase 3).
- **Owner Rulings, checked verbatim against ticket.md and the spec delta:**
  - **Q1:** the switch is disabled, not hidden. It shows the note "Free stores run summaries only" and a "Request Beta access" link to `/settings#beta-access`.
  - **Q2:** the label "Keep each run's rows" and the help text match character for character. Both `HELP_TEXT` and the unit test assert the full string.
  - **Q3:** `historyPayloadsAvailable` is computed server-side from `pipelines.owner_id → users.tier` through `PayloadTierLimit.allowsPayloads`, which is `maxRuns > 0 && maxAge > 0`. The frontend gates on `=== true` only and never reads `User.tier`.
  - **Q4:** the opt-out sentence matches the spec's final wording, and there is no purge.
- **Additional acceptance:**
  - The field is present on all 5 REST sites (list-by-pipeline, create, get, patch, list-all).
  - It is documented in `schemas/outputs/output.schema.json` as `readOnly`.
  - Backend tests cover free, beta and owner owners, plus a free editor grantee on a beta-owned pipeline (`OutputHistoryPayloadsAvailableSpec`).
  - The MCP description points at `historyPayloadsAvailable`.
- **Tasks:** all are ticked and match the diff. D1–D7 are implemented as designed. The patch-set sites are deliberately unchanged (D2).
- **Constraints:**
  - C1 is honoured: `withHistoryPayloads` and `available` read `output.historyPayloadsAvailable` only. Unit tests pin a beta viewer on a free-owned pipeline (disabled) and a free viewer on a beta-owned pipeline (enabled).
  - C2 is honoured: the e2e spec writes only through `evidencePath`, with no `openspec/` path, and `check:e2e-evidence-paths` passes.
  - C3 is honoured: no hel1277, hel1350 or hel1275 spec appears in the diff.
- **Scope:** no scope creep. The `MemoryRouter` wraps in the two existing test files are required, because the new `Link` needs a router.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (fresh, run by me in WORKTREE_PATH at d44dbac1e):**

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | all files clean |
| `npm run typecheck` | clean |
| `npm test` | 462 suites / 4884 tests pass. The helio-mcp project also passes: 39 suites / 378 tests. Targeted frontend run of `OutputEditorSheet*` and `useScrollToHashSection`: 4 suites / 48 tests pass. |
| `npm --prefix frontend run build` | success |
| `npm --prefix helio-mcp run build` (tsc) | success |
| `cd backend && sbt testFull` (nice -n 19) | "Tests: succeeded 6092, failed 0, canceled 4". The 4 cancels are the pre-existing `HELIO_MEASURE=1` report-only latency tests in `DatasetWriteSubmitLatencySpec`, which are unrelated. All 7 `OutputHistoryPayloadsAvailableSpec` tests ran and passed. |
| Other hook checks | `check:schemas`, `check:tokens`, `check:e2e-types`, `check:helio-mcp-types`, `check:openspec`, `check:spec-structure` and `check:test-temp-dir-hygiene` all exit 0 |

**Production ApiRoutes wiring (verified):**
- `ApiRoutes.scala:940` passes `Some((resolvedNodePayloadHistoryRepo, payloadHistoryConfig))`. That is the non-null `resolved*` value (`ApiRoutes.scala:256-257`), not the nullable constructor parameter, as D2 requires.
- `OutputHistoryPayloadsAvailableSpec` builds a real `ApiRoutes(... dbContext = ctx)` and asserts the key at all 5 sites. If the wiring were dropped (`None`), every `assertAllSites` call would see `None` and fail.
- The cross-tier test expects `true` for a free editor on a beta pipeline. If the flag came from the caller's tier instead of the owner's, that test would fail.

**D5 (the save path omits the key unless the toggle is enabled and changed):**
- `withHistoryPayloads` (`OutputEditorSheet.tsx`) returns the built config unchanged unless `historyPayloadsAvailable === true` AND the state differs from the seed.
- Unit tests cover:
  - on → `true` and off-from-true → `false`;
  - an untouched toggle with absent, `null` and `true` seeds → key omitted;
  - toggled on then off again → omitted;
  - disabled with a stored `true` → shown as checked, key omitted;
  - a missing flag → fails closed.
- I also checked this live (see Phase 3). After saving `true`, a name-only edit sent `{"name":…,"config":{"fieldMapping":{},"aggregation":{…},"format":"number","compare":null}}`, with no `historyPayloads` key, and the stored value stayed `true`.

**The `check-no-credential-in-agent-surface.mjs` COVERAGE DRIFT claim (verified; pre-existing environmental hazard, not a defect of this change):**
- **Reproduced in WORKTREE_PATH.** With the gitignored top-level `e2e-evidence/` present, the script prints `FAIL - COVERAGE DRIFT: top-level directory "e2e-evidence" is not classified…`. The cause is that it enumerates `readdirSync(repoRoot)` (line 852) and hardcodes its ignored-directory set rather than reading `.gitignore`. `e2e-evidence` is gitignored (`.gitignore:103`).
- **Pre-existing on `origin/main`.** HEL-1363 (#825) added `/e2e-evidence/` and `evidencePath`, but neither main's copy of the script nor this branch's classifies it. `git show origin/main:scripts/check-no-credential-in-agent-surface.mjs | grep e2e-evidence` returns nothing. The script is not in this branch's diff, so the executor did not edit it.
- **The committed tree passes the check.** I ran the script in a throwaway detached worktree at exactly d44dbac1e, which has no `e2e-evidence/`. It printed `OK (9000 files scanned … 0 violations)`. The same throwaway worktree also passed `check-e2e-evidence-paths`, `check-openspec-hygiene`, `check-spec-structure`, `check-scala-quality` and `check-repo-integrity`. I removed it afterwards and confirmed `git worktree list` holds no straggler.
- **Conclusion.** Moving the untracked, gitignored directory aside changed nothing in the commit's contents. It worked around a scanner that reads filesystem state outside the commit, so it is not a hook bypass that hides any defect in this change. It is a real hazard, though: every worktree that runs any `evidencePath` e2e spec will then fail its pre-commit hook. It needs a follow-up ticket (see Suggestions).

**Code quality:**
- **Type safety:** typed throughout, with no `any`, except `postDataJSON` casts in e2e, which are acceptable.
- **Security:** `payloadsAvailableFor` builds its `IN (...)` list from interpolated bind parameters (`sql"$i"`), so there is no string splicing. It runs on the privileged pool only for pipeline ids the service has already authorized and returned to the caller. The client-sent `config.historyPayloadsAvailable` is ignored in the top-level field, and a test covers that.
- **Error handling:** an unknown pipeline or an unparseable tier maps to `false`, never an exception, and a test covers it. A failed PATCH surfaces the sheet's existing error alert (verified live).
- **Modularity:**
  - The new UI lives in its own file because `OutputEditorSheet.tsx` was already over budget, as design D7 says.
  - `useScrollToHashSection` is a small, separate hook with its own tests.
  - Availability is one batched query per response, not N.
- **Mechanical design rules:**
  - The new CSS uses only tokens (`--app-accent-text`, `--weight-semibold`).
  - It reuses the shared `Toggle` and the existing `output-editor-sheet__*` section, hint and heading classes.
  - `check:tokens` passes.
- **Dead code:** none. There are no TODO/FIXME markers and no unused imports (lint is clean).

### Phase 3: UI Review — PASS
Issues: none.

**Servers.** I ran `start-servers.sh`, which reused healthy servers on 6763 and 9670, and `assert-phase.sh servers` printed `PASS servers`.
- Both listening processes have their cwd inside this worktree: `…/HEL-1331/backend` and `…/HEL-1331/frontend`.
- The running backend could in principle be stale. One source file, `OutputProtocol.scala`, has a modification time after backend start (13:57:57). Modification times are not reliable evidence, so I did not rely on them. Instead I checked the response content: the e2e run asserted `historyPayloadsAvailable === true` from `GET /api/outputs/:id` on a beta pipeline, and the editor rendered the enabled state from it. So the running server emits the field with correct values.

**Repo e2e spec.** I ran `e2e/hel1331-history-payloads-toggle.spec.ts` (DEV_PORT=6763) and all 4 tests passed: beta enable → save → reopen in light and dark, and free disabled → link → Beta access heading in the viewport in light and dark.

**My own checks.** These ran as a scratch Playwright spec in the session scratchpad, with its own browser context. I did not use the shared MCP browser or cookie jars. Workers = 1, `nice -n 19`.
- **Happy path:** keyboard Space toggles the switch, Save sends `historyPayloads: true`, and reopening shows it on.
- **Unchanged save:** the key is omitted live and the stored `true` is preserved.
- **Unhappy path:** a PATCH forced to 500 shows a visible error alert, with no blank screen and no page error.
- **Console:** there were no JavaScript errors and no page errors in any flow. The only console entries were resource 401s from `/api/auth/me` before login, and 404s from `GET /api/pipelines/:id/schedule` for pipelines with no schedule. Both are pre-existing and unrelated to this change.
- **Breakpoints (1440 / 1100 / 768 / 375):**
  - The History section and the dialog never overflow horizontally (`scrollWidth <= clientWidth` at every width).
  - The document has no horizontal scroll.
  - At 375 px the copy and the link wrap cleanly.
- **Accessibility:**
  - The switch has role `switch` and the accessible name "Keep each run's rows". It is `aria-describedby` the help text, plus the note when disabled.
  - The link's name is "Request Beta access".
  - Keyboard Tab reaches the link and the enabled switch, and both show a visible focus ring in light and dark themes (`outline: solid` via the global `:focus-visible`; the switch track ring comes from `Toggle.css`).
  - The disabled switch is correctly skipped in tab order.
  - Enter on the link navigates to `/settings#beta-access`, with the "Beta access" heading in the viewport.
- **Both themes:**
  - The label, help text, note and link are legible in both.
  - The disabled state is visibly dimmed and distinguishable from the enabled state.
  - The subjective visual-cohesion judgment is left to the skeptic.

**Persisted evidence** (cited by durable ref):
- **Executor e2e screenshots** (regenerated by my run):
  - `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331/editor-beta-on-{light,dark}.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331/editor-free-disabled-{light,dark}.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331/settings-beta-access-{light,dark}.png`
- **My checks:**
  - Breakpoints: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-eval/free-{1440,1100,768,375}.png`
  - Focus rings: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-eval/kb-link-{light,dark}.png`, `kb-switch-{light,dark}.png`, `kb-switch-on-{light,dark}.png`
  - Save failure: `/home/matt/Development/helio/.concertino/runs/HEL-1331/evidence/e2e-evidence/HEL-1331-eval/beta-save-error-dark.png`
- No claim above rests on file modification-time ordering. Every claim is backed by asserted content, either a request body or a measured value.

**Test data.**
- Every source and pipeline I created was deleted by exact id in `finally`, and the ids are logged in the run output.
- The throwaway `*@example.test` users stay behind, as with every repo e2e spec.
- `matt@helio.dev` was never touched; `setUserTierForTest` excludes it by construction.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- **File a follow-up ticket (origin HEL-1363) to classify `e2e-evidence` in `scripts/check-no-credential-in-agent-surface.mjs`.** Add it to the hardcoded ignored set or to `ACKNOWLEDGED_UNSCANNED`, with the same rationale as the other gitignored roots. Until that lands, any worktree that has run an `evidencePath` e2e spec fails its pre-commit hook on COVERAGE DRIFT, and the only remedy is to move the directory aside by hand. This is out of scope for HEL-1331.
- **Isolate the destructive test DDL.** `OutputHistoryPayloadsAvailableSpec`'s "unknown tier" test runs `ALTER TABLE users DROP CONSTRAINT users_tier_check` against the spec's own embedded Postgres. The database is per-spec, so this is safe, but the dropped constraint persists for the rest of the suite's tests. Consider running that test last or in its own class, so a later test can never rely on the CHECK constraint unknowingly.
- **Strengthen the MCP pass-through test.** `outputsHandlers.test.ts` checks the handler → `HelioApi.updateOutput` argument, not the HTTP body. Existing `helioApi` tests cover the PATCH serialization, but a single seam test asserting the actual PATCH body would close the spec scenario's literal wording.
