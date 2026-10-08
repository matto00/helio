## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `79de6b835d44a8f3ebaed5af2a8b44f16d0b6f69`. Diff base, resolved live with `resolve-review-base.sh` (exit 0): `e4289e6c88e4d8d0c174b94f1359817fe0466514` (origin/main, an ancestor of HEAD). The diff covers 25 files.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/history-payloads-toggle-polish/HEL-1372`.
- **Servers (checked myself, not taken from the evaluator):**
  - `:6804` is node PID 3486463. Its cwd is `<worktree>/frontend`, it runs this worktree's `node_modules/.bin/vite`, and it was started at 19:30:53. Vite serves the source on disk, so the start time does not affect what it serves.
  - `:9711` is java PID 3911817. Its cwd is `<worktree>/backend`. It was started at 20:18:59, after the commit time of 19:43:12. Its `/proc/<pid>/environ` contains no `PAYLOAD_HISTORY_*` variables.
  - `assert-phase.sh servers ... 6804 9711 HEL-1372` returned `PASS servers`.
- **AC1 (new tab, unsaved edits kept, accessible name):**
  - `HistoryPayloadsField.tsx` uses `<Link target="_blank" rel="noopener noreferrer">` with `<span className="sr-only"> (opens in a new tab)</span>`. `.sr-only` is the canonical utility at `frontend/src/theme/theme.css:505`.
  - I ran `e2e/hel1331-history-payloads-toggle.spec.ts` myself (DEV_PORT=6804, 1 worker, nice 19): **4 passed (27.9s)**, both themes.
  - In that spec, the link is found by the role name "Request Beta access (opens in a new tab)".
  - It opens a popup at `/settings#beta-access`, and the "Beta access" heading is in the viewport.
  - The original tab keeps the unsaved `#output-name` value "HEL-1372 unsaved edit".
- **AC2 (`historyPayloadLimits` everywhere `historyPayloadsAvailable` appears, env overrides included, schema):**
  - `historyPayloadsAvailable` is stamped only in `OutputRoutes.withAvailability`. All 5 callers (lines 65, 75, 93, 99, 215) now also get `historyPayloadLimits` from the same `config`.
  - That config comes from `Main.scala:157` (`PayloadHistoryConfig.fromEnv()`). The same instance goes to `ApiRoutes` (`Main.scala:279`) and then to both `OutputRoutes` (`ApiRoutes.scala:940`) and the payload writer (`ApiRoutes.scala:462`). The figures shown therefore come from the same config the server enforces.
  - `maxAge.toDays` is lossless, because `fromEnv` only builds whole days.
  - The schema gained the field with `readOnly` and `additionalProperties: false` at every level.
  - The backend spec adds 4 cases: all 5 sites, an overridden config, an attempted client-side override, and the field being omitted when it is not wired. I did **not** re-run sbt: the running backend was started by `sbt run` in the same `backend/` directory, and I would not risk disturbing it. I rely on the evaluator's pasted `sbt testFull` result (6113 succeeded, 0 failed) and its live env-override probe (`maxRows: 500` and so on).
- **AC3 (figures rendered from the field, no constant):**
  - `HELP_TEXT` is deleted. A grep for `1,000 rows|10 runs|1 MiB` in non-test `frontend/src` and `helio-mcp/src` finds only an unrelated comment in `TruncatedRowCountBadge.tsx`.
  - My fresh jest run (`--testPathPatterns=outputEditor`, 3 workers) gave **8 suites, 116 tests passed**. They include the 500-row / 2 MiB override test and the test for absent limits (no digits in the help text).
  - Frontend `typecheck` and `eslint --max-warnings=0` on the touched directories both exit 0.
- **AC4 (MCP):**
  - `HISTORY_PAYLOADS_CONFIG_DOC` no longer contains figures and points to `historyPayloadLimits`. `types.ts` adds the interface.
  - My fresh run of `server.test.ts` and `outputsHandlers.test.ts` gave **2 suites, 38 tests passed**.
- **AC5 (note styling):**
  - The note `<p>` now uses `output-editor-sheet__field-hint` (`--text-xs`, `--app-text-muted`), the same class as the help text. The e2e asserts the two computed font sizes are equal, and that assertion passed.
- **Visual judgment (I looked at the screenshots myself):**
  - Free-owned editor, light: `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1331/editor-free-disabled-light.png`
  - Free-owned editor, dark: `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1331/editor-free-disabled-dark.png`
    - In both themes the note now sits at the same size and colour as the help paragraph. The accent, semibold, underlined link reads clearly as a link. Contrast is fine in both themes, and nothing is visibly hardcoded.
  - Beta-owned editor: `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1331/editor-beta-on-light.png`
    - The served default figures render ("1,000 rows or 1 MiB ... Beta keeps the last 10 runs for 7 days; Owner keeps 30 runs for 30 days").
  - Settings page in the new tab: `/home/matt/Development/helio/.concertino/runs/HEL-1372/evidence/e2e-evidence/HEL-1331/settings-beta-access-dark.png`
    - The "Beta access" section is in view.
  - The History section is consistent with the sibling Preview section.
  - These claims rest on image content and computed-style assertions, not on file modification times.
- **Main CI is red independently of this change:**
  - On `e4289e6c8` (main HEAD), CI run 37703350572 failed only in job `e2e (3)`, on `e2e/hel1350-chart-compare-picker.spec.ts`.
  - On the previous main commit, run 37703155327 failed on hel1350 and hel1351, among others.
  - This change does not touch either spec.
- **Cleanup:** my e2e run created 4 throwaway `@example.test` users. The spec had already deleted their pipelines and sources (0 pipelines remained for them). I deleted the users by exact id (`DELETE 4`, guarded with `email <> 'matt@helio.dev'`).
- **Gate-defect check:** the evaluator states its claims do not rest on mtimes. I did not accept any mtime-ordering claim. No gate defect.

### Verdict: CONFIRM

### Non-blocking notes
- "Free stores run summaries only" runs straight into the link with no punctuation ("...only Request Beta access"). A full stop or an em dash would read better. This was already the case before this change.
- The tier object is repeated three times in the schema. A `$defs` entry would remove the repetition. (The evaluator raised the same point.)
- The e2e checks only `maxRows` against the served limits. Asserting the whole sentence would also cover the bytes and tier figures at the browser layer.
