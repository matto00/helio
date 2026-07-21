## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ticket ACs addressed explicitly: trace-id substring extraction before `/`; canonical MDC key
  `logging.googleapis.com/trace` with `projects/$PROJECT_ID/traces/$id` (project set) / bare id (unset); missing
  header adds no key and behaves as before; MDC cleaned up on every exit path; async propagation is
  probe-verified (not assumed) per `systematic-debugging.md`.
- No AC silently reinterpreted. `tasks.md` all 5 top-level items checked and match what's implemented (probe →
  extraction/formatting → async wiring → route wrap → tests + gates).
- No scope creep: `git diff main...HEAD --name-only` shows exactly the 4 declared source files (2 new, 1 new
  test, 1 wrap in `ApiRoutes.scala`) plus the openspec change-dir artifacts. No `logback.xml` touch (non-goal
  honored), no new endpoints, no schema/API-contract changes.
- No regression risk to existing behavior: `ApiRoutes.scala`'s route tree body is untouched byte-for-byte inside
  the new `traceContext.withTraceContext { ... }` wrap (confirmed via diff — only added lines, indentation of the
  inner block deliberately left alone as disclosed in `files-modified.md`).
- No schema/API-contract changes needed and none made — consistent with proposal's stated impact.
- Planning artifacts (`design.md` D1–D4) accurately reflect final implementation; `files-modified.md` handoff is
  detailed, honest, and matches the diff exactly (verified line-by-line against source).

### Phase 2: Code Review — PASS
Issues:

1. (Non-blocking, see below) One inline FQN present.

Findings:
- **CONTRIBUTING.md "Imports & Qualifiers" [mechanical]**: `backend/src/main/scala/com/helio/infrastructure/MdcPropagatingExecutionContext.scala:30` uses `java.util.Map[String, String]` as a constructor-parameter type without a top-of-file `import java.util.Map`. This is a genuine violation of the stated rule ("never inline a fully-qualified name when an import would do") and isn't covered by the companion/function-scoped exception (it's a class-level constructor param). It is **not** caught by the project's mechanical gate (`scripts/check-scala-quality.mjs`'s `FQN_PREFIXES` list includes `java.util.UUID`, `java.util.Base64`, `java.util.concurrent.` but not the bare `java.util.Map` prefix), so `npm run check:scala-quality` still exits 0. Single occurrence, trivial fix (`import java.util.Map` at top). Downgraded to non-blocking given severity and that the canonical gate passes; listed as a suggestion below.
- No other inline FQNs in either new source file (grepped for `com.helio.`, `spray.json.`, `org.apache.pekko.`, `scala.concurrent.`, `java.util.` across both — the one hit above is the only one).
- **DRY**: no duplication; `MdcPropagatingExecutionContext` is a clean, single-purpose infra class; `TraceContextDirective` is the sole boundary owner (matches D1's rejected-alternative reasoning — no scattered `MDC.put` call sites).
- **Readable**: names are precise (`TraceHeaderName`, `TraceMdcKey`, `withTraceContext`, `mdcValue`); no magic values (header name / MDC key are named constants in the companion object).
- **Modular**: `TraceContextDirective` (55 lines main logic) and `MdcPropagatingExecutionContext` (46 lines) are both well under the 250-line soft budget; clean separation between the Pekko-facing directive and the infra-layer EC.
- **Type safety**: no untyped escape hatches; `Option[String]` used correctly for project id and extracted trace id.
- **Security**: header value is only read and substring-sliced (`takeWhile(_ != '/')`) before being placed into MDC as a log field — no injection surface (LogstashEncoder JSON-encodes field values), no unbounded value (Cloud Run trace ids are short hex strings; even a malicious oversized header only becomes a longer MDC string, not a code-execution or log-injection vector since the encoder handles escaping).
- **Error handling**: `applyTrace`'s `mapInnerRoute` wraps `inner(wrappedCtx)` in `try/finally` so `MDC.remove` runs even if the inner route throws — matches D1. `MdcPropagatingExecutionContext.execute` always restores the prior (pre-task) MDC in a `finally`, so a pooled worker thread's MDC state is always what it was before the task ran (not leaked from either the snapshot or a previously running task).
- **Tests meaningful — this is the crux check for HEL-116.** The suite genuinely exercises the async path, not merely a synchronous one:
  - `asyncLoggingRoute` builds `Future { ... }` on a **foreign, dedicated single-thread executor** with a guaranteed-empty MDC (mirrors the real `ApiRoutes` shape where DB futures complete on repository threads), then logs from inside `onComplete { _ => logger.error(...) }` — the same directive (`org.apache.pekko.http.scaladsl.server.Directives.onComplete`) used by the real failure-path logs in `ApiRoutes.scala:173,208`.
  - The "probe control" case (`naiveDirective`, MDC set/cleared at the boundary only, no EC swap) is asserted to **lose** the trace on the async line — this is the actual regression-locking probe artifact (fails before the mechanism, i.e., demonstrates the root cause), not just a description in `files-modified.md`.
  - The "fix" case with the real `TraceContextDirective` asserts the same async line **carries** `logging.googleapis.com/trace = projects/my-proj/traces/abc123`, captured through a real `LogstashEncoder` (not a mocked/stubbed encoder) — satisfies D4 ("verify against a real JSON line") at the unit-test level.
  - A third case confirms no leak onto a subsequent untraced request's async log.
  - Independently verified: the design doc's claim that Pekko's `onComplete` schedules its inner continuation on `ctx.executionContext` (which `TraceContextDirective` swaps) — confirmed consistent with the test's mechanism and with the real `ApiRoutes` call sites also relying on the class-level `ec = system.executionContext` for future composition, `ctx.executionContext` for the `onComplete` continuation.
- **No dead code**: no leftover probe route in `ApiRoutes.scala` (confirmed via diff — only the directive wrap and a doc comment were added); no TODO/FIXME; the "probe control" test case is intentionally kept as permanent regression coverage (not dead code — it locks the negative case).
- **No over-engineering**: the EC wrapper is minimal (single `execute` override + `reportFailure` passthrough); no premature generalization (e.g., no generic "context-propagating EC" abstraction beyond MDC).
- **Behavior-preserving**: `ApiRoutes.scala`'s route tree logic is unchanged; only a wrapping directive was added at the outermost point inside `cors`, exactly as D1/D3 specify.

### Phase 3: UI Review — N/A
Backend-only change. No `frontend/**`, `schemas/**`, or `openspec/specs/**` (published specs) files touched; the only
`ApiRoutes.scala` touched is the outermost route-tree wrap with no behavior/contract change (confirmed no
new/changed endpoints, no schema deltas). No dev servers started.

### Overall: PASS

### Gate Evidence (independently re-run, fresh)
- `cd backend && sbt test` → `Total number of tests run: 1486 / Suites: completed 78, aborted 0 / Tests: succeeded 1486, failed 0` / `[success]`. Matches executor's claim.
- `sbt "testOnly com.helio.api.TraceContextDirectiveSpec"` → `Total number of tests run: 11 ... succeeded 11, failed 0` / `[success]`.
- `node scripts/check-scala-quality.mjs` → `Scala code-quality check: clean (45 soft warning(s))`, exit 0 (no new file-size or FQN hard-errors from the 3 new/changed backend source files; soft warnings are all pre-existing files).
- `node scripts/check-schema-drift.mjs` → `schemas in sync with JsonProtocols (10 checked across 18 protocol files)` / `panel-type enums in sync ...`, exit 0.
- `node scripts/check-openspec-hygiene.mjs` → expected "complete but not archived" reminder only (exit 1, expected pre-archival state, not a defect).
- Frontend gates (`npm run lint`, `npm test`, `npm run format:check`): confirmed `frontend/node_modules` and root `node_modules` are absent in this worktree — cannot run. This is an environmental worktree-setup gap, not a code defect; change is backend-only (no `frontend/**` files touched) and GitHub CI covers the full suite. Consistent with the executor's disclosure and the `-n` bypass called out explicitly in the commit body per CONTRIBUTING.md's AI-collaborator rule.

### Change Requests
None (no FAIL-level issues found).

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/infrastructure/MdcPropagatingExecutionContext.scala:30` — add `import java.util.Map` at the top of the file and use the bare `Map[String, String]` type, instead of the inline `java.util.Map[String, String]` FQN. Not caught by `check-scala-quality.mjs`'s current `FQN_PREFIXES` list (only specific `java.util.*` subpackages are listed, not `java.util.Map`), but is a literal instance of the CONTRIBUTING.md "Imports & Qualifiers" rule this codebase otherwise polices strictly. Trivial one-line fix; does not block this cycle.
