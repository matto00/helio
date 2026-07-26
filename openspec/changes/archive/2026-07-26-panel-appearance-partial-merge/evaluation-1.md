## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Verified against `ticket.md`'s 7 acceptance criteria directly:
- AC1 (background-only PATCH preserves stored chartType/sub-fields) — `ApiRoutesSpec.scala` "PATCH background only, without a chart key, preserves a chart panel's already-set chartType and every other chart sub-field (HEL-362 AC1)".
- AC2 (partial `{"chart": {"chartType": "bar"}}` → 200, only chartType changes) — `ApiRoutesSpec.scala` "PATCH a partial chart object ({chartType}) returns 200 (not 400) and changes only chartType (HEL-362 AC2)".
- AC3 (sequential PATCHes both survive) — `ApiRoutesSpec.scala` "two sequential PATCHes (chart.chartType, then background) each preserve the other's change (HEL-362 AC3)".
- AC4 (invalid chartType still 400 on single + batch) — existing single-item donut test updated to `.toJson`; existing batch donut test (`~ApiRoutesSpec.scala:2536`) updated to `.toJson`; both still pass.
- AC5 (create-time unchanged) — `PanelServiceHelpers.resolveCreateAppearance`/`normalizeAppearancePayload` have zero diff (confirmed via `git diff`); `PanelPatchApplier.scala` has zero diff. Pre-existing create-time tests still pass in the full 2050/2050 run.
- AC6 (ScalaTest coverage for all 5 listed cases) — present in both `PanelAppearanceMergeSpec.scala` (domain-level) and `ApiRoutesSpec.scala` (HTTP/DB-level), plus batch-specific tests.
- AC7 (backward-compat full payload) — `PanelAppearanceMergeSpec.scala` "produce an identical result to a full replace when every field is present" + all pre-existing full-payload `ApiRoutesSpec` tests updated to `.toJson` and still passing.

Task list (`tasks.md`) — all items marked `[x]` and each verified against the diff (domain Patch types, single-item path, batch path, contract updates, tests) — no discrepancy between checked-off items and actual implementation.

Scope: `DashboardProposalService.scala` and `scripts/check-schema-drift.mjs` changes are outside the ticket's literal file list but are correctly-scoped, necessary consumer fixes for the `UpdatePanelRequest.appearance` wire-shape change (`Option[PanelAppearancePayload]` → `Option[JsValue]`) — documented in `files-modified.md` and confirmed not to be scope creep (no new behavior, just adapting an existing caller + a schema-drift-checker allowlist entry for the new non-1:1 schema).

Dashboard appearance PATCH has the identical bug but was deliberately scoped out per design.md Decision 5, with a spinoff ticket (HEL-625, parented under HEL-344) filed rather than silently dropped — confirmed present in `workflow-state.md`.

Regression check: full existing panel + batch-update ScalaTest suites (task 5.10) pass (see Phase 2 gate results) — no HEL-296-style batch drop reintroduced. `DashboardApplyProposalSpec`'s pre-existing "apply chart appearance ... from a proposal (HEL-293)" test (which exercises `DashboardProposalService.applyAppearance`) still passes, confirming the wire-shape adaptation there doesn't regress proposal-driven panel creation appearance.

Planning artifacts (proposal/design/spec deltas) accurately reflect the final implemented behavior — spot-checked `PanelAppearance.applyPatch`/`Patch.decode` in `model.scala` against design.md Decisions 2/3/6/7 and the `chartType`-null carve-out; all match exactly.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Canonical code-quality compliance**: `node scripts/check-scala-quality.mjs` → clean (64 pre-existing soft file-size warnings, none newly introduced as violations — `model.scala` grew to 780 lines but the script treats file-size as informational-only per `CONTRIBUTING.md:123`, and the check still reports "clean"/exit 0). No inline FQN violations introduced (new imports for `com.helio.api.RequestValidation`, `org.slf4j.LoggerFactory`, `spray.json._` are all top-of-file).
- **Design-standard [mechanical] rules**: N/A — no frontend files touched.
- **DRY**: merge logic lives in one place (`PanelAppearance.applyPatchJson`) and both the single-item path (`PanelServiceHelpers.resolvePatch`) and the batch path (`PanelMutationRepository.batchUpdate`) call the identical function — verified by reading both call sites directly. `PanelMutationRepository`'s old hand-rolled `getOrElse`/`.orElse` merge block is fully replaced, not left dangling alongside the new one.
- **Readable**: naming and structure closely mirror the existing `MetricPanelConfig.Patch` precedent, as designed. One nit (below, non-blocking): a stale doc comment.
- **Modular**: `Patch`/`applyPatch`/`applyPatchJson` cleanly separated (decode / merge / decode+merge+catch); `PanelPatchApplier` correctly left untouched as a "dumb persist" layer per design.md Decision 4.
- **Type safety**: `Option[Option[T]]` idiom is fully typed; no `any`/untyped escape hatches. `DeserializationException` messages are all curated static text (never a wrapped raw exception), so `Left(d.getMessage)` is safe to return to the client — verified by reading every `deserializationError(...)` call site in `model.scala`.
- **Security**: input validation happens at decode time (`RequestValidation.validateChartType`, `normalizePanelBackground/Color/Transparency`) before any field reaches storage; malformed shapes are rejected with curated 400 messages, not raw exception text; a generic `Throwable` catch-all in `applyPatchJson` logs server-side and returns a generic client message (no leak).
- **Error handling**: batch decode failures throw synchronously inside the lazily-evaluated DBIO closure (mirrors the existing `item.config` pattern) so Slick rolls back the whole transaction — no partial write; `PanelService.batchUpdate`'s existing `.recover` catches it and returns 400. Single-item path returns `Either` all the way through to the route's existing 400 mapping.
- **Tests meaningful**: see hazard spot-check below — new tests genuinely exercise the "field absent from JSON" case, not null-substitution, and would catch a real regression to the merge logic (verified by reading actual assertions against un-set stored fields).
- **No dead code**: no leftover TODO/FIXME; no unused imports.
- **No over-engineering**: chart-level-only merge granularity (not deep into `legend`/`tooltip`/`axisLabels`) matches the literal ACs, as scoped in design.md Non-Goals.
- **Behavior-preserving where expected**: `PanelPatchApplier.scala` (zero diff), `resolveCreateAppearance`/`normalizeAppearancePayload` (zero diff) — confirmed via `git diff`.

**Central hazard spot-check (3+ tests, read directly, not by name)**:
1. `PanelAppearanceMergeSpec.scala` — `"preserve the stored background when the field is genuinely absent from the JSON"`: `val json = JsObject("background" -> JsString("#0a0"))` — no `color`/`transparency`/`chart` keys present at all (not `null`). Assertions check `merged.color shouldBe stored.color` etc.
2. `ApiRoutesSpec.scala` AC1 test — second PATCH body is `JsObject("background" -> JsString("#0a0"))`, no `chart` key whatsoever (established in a prior PATCH, not resent). Confirms `chartType`/`seriesColors`/`legend`/`tooltip`/`axisLabels` survive.
3. `ApiRoutesSpec.scala` "batch appearance update preserves an omitted field" — first batch call sets `color` only (`JsObject("color" -> ...)`), second sets `background` only (`JsObject("background" -> ...)`) — `color` is never resent in the second call, yet the assertion checks it's still `"#ffffff"`.
4. Backward-compat tests (`PanelAppearancePayload(...).toJson`) rely on spray-json's macro-format behavior of omitting `None` fields from the wire object entirely (not writing `JsNull`) — confirmed this is the actual `.toJson` behavior for `jsonFormat4`/`jsonFormat5` in this codebase (per project convention: "spray-json omits Option=None on the wire"), so these tests are genuinely exercising omission too, not null.

All spot-checked tests genuinely construct absent fields, not null-substituted ones — this is the actual hazard class the ticket exists to catch.

**Non-blocking nit**: `PanelServiceHelpers.scala:52-53` — the doc comment on `normalizeAppearancePayload` still reads "Shared by the create path (`resolveCreateAppearance`) and the single-item PATCH path (`resolvePatch`)", which was true pre-change but is now stale: `resolvePatch` no longer calls this function (it calls `PanelAppearance.applyPatchJson` instead, per line 38). Purely a documentation accuracy issue — no functional impact — but worth a one-line fix in a follow-up commit so a future reader isn't misled.

### Phase 3: UI Review — PASS
Triggers matched: `schemas/**` changed (`panel-appearance-patch.schema.json` new, `update-panels-batch-request.schema.json` $ref swap), so Phase 3 was run rather than skipped, despite zero `frontend/**` diff.

Confirmed via `git diff main...HEAD --stat -- frontend` (zero output) that no frontend files changed, consistent with the proposal's "No frontend change" impact statement — the frontend's `PanelDetailModal` already sends complete appearance objects and needs no code change for the new merge semantics to apply transparently.

Started dev servers via `scripts/concertino/start-servers.sh` (DEV_PORT 5535, BACKEND_PORT 8442); `assert-phase.sh servers` → PASS.

- Happy path: opened an existing panel's settings, edited the background color, saved. Network trace showed `POST /api/panels/updateBatch` → 200 (the live-edit UI's batch path). "Last saved just now" confirmed the write round-tripped and re-rendered correctly.
- Console: 0 errors during the flow (`browser_console_messages(level: error)` → 0 messages).
- No loading/empty/error states exercised beyond the happy path since no new frontend surface exists to test — the backend contract change is additive/backward-compatible and the only frontend caller (already existing) is unaffected.
- Breakpoint/accessibility/multi-entry-point checks not separately run — no new or changed frontend component exists for these to apply to; the existing panel-settings UI (unchanged) already has its own established coverage.

### Overall: PASS

### Change Requests
(none — PASS)

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:52-53` — update `normalizeAppearancePayload`'s doc comment; it still claims to be "shared by ... the single-item PATCH path (`resolvePatch`)", which is no longer true post-HEL-362 (`resolvePatch` now calls `PanelAppearance.applyPatchJson`). Trivial one-line fix, not blocking.

## Verification gates re-run (fresh evidence, this cycle)
- `node scripts/check-schema-drift.mjs` → PASS ("schemas in sync ... 19 checked across 23 protocol files").
- `node scripts/check-scala-quality.mjs` → PASS ("Scala code-quality check: clean", 64 pre-existing soft file-size warnings, no new violations).
- `sbt test` (full backend ScalaTest suite) → **2050/2050 passed**, 0 failed, 0 canceled (115 suites).
- `npm test` (full frontend Jest suite) → **1423/1423 passed** (137 suites) — unaffected, as expected (no frontend diff).
- `npm run lint` (root ESLint, zero-warnings policy) → PASS, exit 0.
- `npm run format:check` (Prettier) → PASS ("All matched files use Prettier code style!").
- `helio-mcp` TS: `npm run typecheck` shows pre-existing errors (missing `node_modules`, no `@types/node` etc.) — confirmed identical on `main` via `git stash`/re-run before restoring; not a regression introduced by this change.
