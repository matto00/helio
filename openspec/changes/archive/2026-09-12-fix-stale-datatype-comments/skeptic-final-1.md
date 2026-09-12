## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed at HEAD `b099e1ca0267e816216fec90cfd180d361ee0c34`, base
`03480817df8a6fa9811c3291f1a1f50900c65464` (live-resolved via `resolve-review-base.sh`,
exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/fix-stale-datatype-comments/hel-1118`.

### What I verified (with evidence)

**Gates re-run fresh by me (not taken from evaluation-1.md):**

- `sbt -batch compile` → `[success] Total time: 1 s` / `SBT_EXIT=0`
- `npm run check:openspec` → `openspec/ is clean`, `EXIT=0`
- `npm run check:helio-mcp-types` (`tsc --noEmit`) → no errors, `EXIT=0`
- `npm run check:scala-quality` → `clean (164 soft warning(s))`, `EXIT=0`

**UI review (Step 4): N/A, verified rather than assumed.** `git diff --name-status`
against the live base shows zero `frontend/**`, `schemas/**`, or `openspec/specs/**`
files — only backend scaladoc, one `helio-mcp/src/helioApi.ts` doc+literal change, and
change-dir artifacts. No servers started, no screenshots, so no evidence artifacts to
persist for this gate.

**AC tracing (each traced to code, not to the executor's narrative):**

- AC4 (`helioApi.ts:456` sends `"dataset"`) — **MET.** Verified in place: the POST body
  now reads `type: "dataset"`, and the docstring above it reads "Create a `dataset` data
  source".
- AC "no unrelated comments edited" — **MET.** `helioApi.ts:93`'s
  `CSV_LIKE_TYPES = new Set(["csv", "static", "dataset"])` is untouched, and I confirmed
  `PanelServiceHelpers.scala:192` ("the DataType-binding resolvers ... were removed here")
  was correctly left alone as accurate-historical. The diff contains no logic changes —
  behavior-preserving as claimed.
- AC1 (`DatasetSource` scaladoc) — **MET.** The class-level scaladoc is genuinely
  untouched by this diff; only the separately-flagged `inferredSchema` field doc changed.
- AC3 (every genuinely-stale comment corrected) — **NOT MET.** See CR1 and CR2.
- AC2 (findings listed with counts so a future reader knows the check was done) — **NOT
  demonstrably met.** See CR4.

**Independent verification of the load-bearing factual claims behind the edits:**

- `DataTypeService`/`MetricService` really are gone (`grep` for `class|object
  DataTypeService|MetricService` in `backend/src/main` → no matches), and no top-level
  `DataType` case class exists. The retirement-framing edits rest on a true premise.
- `CreateSourceResponse`'s field really is `inferredSchema: Option[InferredSchemaResponse]`
  (`DataSourceProtocol.scala:209-213`), so the `ConnectorDriver.scala` correction is
  accurate, not a guess.
- V94 section 8 really is titled "Data migration step 2.9(a): companion types ->
  inferred_schema", so the `DataSource.scala:44` "backfill already ran" correction rests
  on a real migration.
- `WorkspaceContextProtocol`'s new "always `None` / `pipelineOutput` always `true`" claim
  is corroborated by `WorkspaceContextService.scala:447-452`, where `sourceId = None` and
  `pipelineOutput = true` are literally hardcoded. Accurate.
- `validateMetricName` genuinely has zero references in `backend/src/main` **and**
  `backend/src/test`. That edit's "currently unreferenced" is true.

### Verdict: REFUTE

Three of the ~16 comment edits/omissions are wrong on the merits, and they are the exact
failure mode this ticket exists to eliminate: a comment that confidently asserts something
false. CR3 is the most serious — this change *introduces* a new inaccuracy rather than
merely missing an old one, and it feeds a spinoff recommendation to delete code that is
in fact still referenced.

### Change Requests

1. **`backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala:37-42`
   — a genuinely-stale paragraph left inside the very scaladoc block this diff edited.**
   The executor corrected line 25 of the class scaladoc to say `OutputRepository` "replaced
   the retired `DataTypeService`", but twelve lines below, in the *same* comment, the
   original text still stands in the present tense:

   ```
   *  HEL-372: takes `dataTypeService: DataTypeService` rather than a bare
   *  `DataTypeRepository` (design.md D7) — `findAll` is still exactly what
   *  `DataTypeRepository.findAll` did, but `listRows`'s owner-scoping choke
   *  point (`findByIdOwned`) only exists on the service, and sample rows need it.
   ```

   The constructor does not take a `dataTypeService`; `WorkspaceContextService.scala:61`'s
   own comment states HEL-904 task 3.12 replaced that param with `outputRepo` in the same
   positional slot. So this diff leaves one scaladoc simultaneously asserting both that
   `DataTypeService` was retired and that this class takes one. Correct or delete this
   paragraph. It is not listed in any bucket in `triage-findings.md`.

2. **`backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringService.scala:66`
   — the identical stale pattern that was fixed six lines away.** `GroundedContext`'s doc
   still reads "a per-DataType panel-capability menu (keyed by `outputId`, HEL-365)", which
   is the same construction the executor correctly rewrote to "per-Output" at line 261.
   It matches the sweep's own `DataType\b` grep pattern and appears in no bucket in
   `triage-findings.md`, so this is an incomplete pass rather than a deliberate
   classification. (The evaluator flagged this too but waved it through as non-blocking;
   combined with CR1 it is evidence the sweep was not exhaustive, which is the AC.)

3. **`backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala:50-52` and
   `:421-426` — the new comment asserts something false.** Both edited blocks now state
   `validateTolerant` is "currently unreferenced". It is not:
   `backend/src/test/scala/com/helio/domain/engine/ExpressionEvaluatorSpec.scala`
   references it (verified by grep). The accurate claim — the one `triage-findings.md`
   item 6 actually establishes — is that it has no callers in **production code**
   (`backend/src/main`); its spec still exercises it. Qualify both comments accordingly
   ("unreferenced in production code; still covered by `ExpressionEvaluatorSpec`").

   This is not pedantry: `triage-findings.md`'s "Spinoff candidates" section recommends a
   follow-up to "confirm and delete outright" both this method and `validateMetricName`,
   on the strength of the unqualified wording. `validateMetricName` genuinely has zero
   references anywhere; `validateTolerant` does not, and deleting it would break its spec.
   The two are lumped together as if identical. Split them in that section.

4. **`triage-findings.md`'s completeness reconciliation does not hold.** The AC requires
   the findings be recorded "so a future reader knows the check was done", and the
   document presents `91 + 108 + 9 + 2 + 16 = 226 ✓` as proof. That check is not real:
   three of the five terms are explicitly approximate ("~108", "~9", "~2"), so they cannot
   sum to an exact total, and the "Genuinely-stale hits fixed (16)" list enumerates 14
   entries that between them cover well over 16 grep hits (entry 4 alone covers 9-10 sites,
   entry 6 covers two multi-token blocks). CR1 and CR2 are two confirmed genuinely-stale
   hits that appear in no bucket at all, which is what the arithmetic was supposed to make
   impossible. Please either re-do the census so the buckets are exact and every hit is
   accounted for, or drop the false `✓` and state plainly that the accurate-historical
   bucket was sampled rather than enumerated line-by-line. My own census at HEAD is
   **209 hits across 75 files** (`grep -rniE "DataType\b|type registry|snapshot.?row"
   backend/src/main --include=*.scala`), against the 225-226/77 measured at base.

### Non-blocking notes

- `backend/src/main/scala/com/helio/services/workspace/WorkspaceAssistantTools.scala:55` —
  the live `get_resource` LLM tool description still offers "a DataType's columns/sample
  rows/column stats" as a fetchable resource kind. This is prompt copy, so it plausibly
  belongs in the "uncertain" bucket — but the triage names only `DashboardAuthoringPrompt`
  and `RefinementPrompt` as its 2 uncertain items, so this one is simply unlisted. Worth a
  classification line even if the call is "leave it".
- `DataSource.scala:44`'s new text says V94 "backfilled every pre-existing row's schema
  from its companion DataType". V94 section 8 folds in only those sources that *had* a
  companion type (`source_id IS NOT NULL` and not a pipeline output); a pre-existing source
  with no companion type still reaches the empty default. "every pre-existing row" slightly
  overstates it.
- `files-modified.md` says `DataSourceService.scala` had "10" genuinely-stale comments
  fixed; the diff contains 9 hunks in that file. Bookkeeping only.
- AC2 also requires the findings summary in the **PR body**. No PR exists yet, so this is
  unverifiable at this gate — flagging it as an outstanding delivery obligation (tasks.md
  2.4 covers it) rather than a defect.
- No gate defect to report: neither `evaluation-1.md` nor any artifact I relied on
  discloses unsound evidence-directory mtimes, and no conclusion in this report rests on
  mtime ordering or directory placement. Every finding above is content-addressed (cited
  file:line, grep output, or pasted command exit code).
