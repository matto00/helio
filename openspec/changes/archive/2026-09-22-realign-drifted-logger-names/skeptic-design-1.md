## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Production literal locations and line numbers.** Read both files directly:
   - `backend/src/main/scala/com/helio/services/proposals/AuthoringTelemetry.scala:33` —
     `private val log: Logger = LoggerFactory.getLogger("com.helio.services.AuthoringTelemetry")` (confirmed exact line).
   - `backend/src/main/scala/com/helio/services/assistant/AssistantTelemetry.scala:29` —
     `private val log: Logger = LoggerFactory.getLogger("com.helio.services.AssistantTelemetry")` (confirmed exact line).
   - Both are single top-level `object`s (not nested, not `class`) — confirmed via `grep -c "^object"` on each file, so `getClass.getName` will resolve exactly to `com.helio.services.proposals.AuthoringTelemetry$` / `com.helio.services.assistant.AssistantTelemetry$` as the docs claim, with no additional nesting `$` segments.

2. **Test-literal count: re-derived 15 myself, independent of the ticket/design claim.**
   `grep -rn 'withCapture("com.helio' backend/src/test | wc -l` → **15**, and the full listing's line numbers match the ticket/design/tasks exactly: `AuthoringTelemetrySpec.scala` lines 230, 258, 280, 304, 346, 392, 418, 446, 477, 497 (10); `AssistantTelemetrySpec.scala` lines 182, 223, 252, 281, 312 (5). This is not "trust the artifact's count" — I ran the grep myself against the live worktree and it matches independently.

3. **Main-tree grep for other drifted literals.** `grep -rn 'getLogger("' backend/src/main` returns exactly the two lines above — no other hardcoded, drifted category literal exists anywhere in `backend/src/main`. Confirms the "these are the only two" claim and that no broader audit is silently needed.

4. **`getClass`-precedent citations spot-checked for real, not just counted.** Verified a sample of the 13 named precedents by reading each file directly (not just grepping for the name):
   - `PipelineAnalyzeService.scala:40-42` — `object PipelineAnalyzeService { ... private val log = LoggerFactory.getLogger(getClass)`.
   - `SqlConnectorDriver.scala:26-28` — same pattern.
   - `LocalFileSystem.scala:97-99`, `GcsFileSystem.scala:66-68` — companion `object`s, same pattern.
   - `PanelRowMapper.scala:20-22`, `TopLevelErrorHandlers.scala:21-23`, `RewrapConnectorCredentialsJob.scala:25-27`, `PdfTextSupport.scala:24-26`, `ClaudeSseAssembler.scala:24-26`, `ContentSourceSupport.scala:35-37` — all confirmed `object`s using `LoggerFactory.getLogger(getClass)`.
   - `PatchSetUndoConflictCheck.scala` and `PatchSetApplyRollback.scala` — my first grep pass (`^object`) missed these because of the `private[services] object` modifier prefix; re-read the file headers directly and confirmed both are `private[services] object`s using the identical pattern (lines 32/29 respectively). This was the one place I had to re-verify past an initial false negative — resolved by reading full file content, not re-grepping with the same pattern.
   - `PanelAppearance` — confirmed `object PanelAppearance { ... private val log = LoggerFactory.getLogger(getClass)` at `model.scala:396/402` (my first grep, using `head -3` per file, truncated past this occurrence since `model.scala` declares many `object`s — re-checked with a targeted `sed` read).
   - Total occurrence count of `LoggerFactory.getLogger(getClass)` in `backend/src/main`: **35** (via `grep -ro ... | wc -l`), matching the run's own `premise-validation.md` evidence file exactly (see point 6). The design's "13+" claim is conservative and accurate.

5. **`logback.xml` claim.** Read the full file: only `<root level="${LOG_LEVEL}">` with an `<appender-ref>`; no `<logger name="com.helio...">` entries anywhere. The sole `com.helio` references in `backend/src/main/resources/` are two lines in `logback.xml` naming `com.helio.logging.LogFormatPropertyDefiner` (a `PropertyDefiner` class attribute + its own doc-comment mention) — unrelated to either Telemetry category string. This exactly matches the ticket's and design's "zero `com.helio` references other than one unrelated `PropertyDefiner`" claim.

6. **`JsonLogCapture.withCapture` semantics.** Read the full implementation (`backend/src/test/scala/com/helio/testsupport/JsonLogCapture.scala`): it attaches an appender directly to `loggerContext.getLogger(loggerName)` by exact string — Logback caches/returns the same `Logger` instance for a given name, and the production code resolves the identical name via `getLogger(getClass)`. This is an exact-name match, not a hierarchy-prefix match, so the trailing `$` is not a source of any accidental cross-matching or missed capture — the design's assumption here is technically sound.

7. **Scope-boundary claim ("no other files").** Ran a full-repo grep for both old literal strings (`com.helio.services.AuthoringTelemetry` / `com.helio.services.AssistantTelemetry`) across `.scala`/`.xml`/`.conf`/`.md`. Only the 2 production + 15 test occurrences are live-code hits; the only other hits are in `openspec/changes/archive/**` historical report files (records of past changes, not live references that need updating) and this change's own planning docs. Also confirmed via `grep -rln` that only the two spec files plus the generic `JsonLogCapture.scala` helper reference either class name anywhere in `backend/src/test` — no other spec indirectly depends on the old category string.

8. **`premise-validation.md` evidence file.** Design.md cites `.concertino/runs/HEL-803/evidence/premise-validation.md`. This is not inside the ticket worktree (it's under the main repo's `.concertino/runs/HEL-803/evidence/`, which is correct — run evidence lives at the orchestrator level, not per-worktree). Read it directly: its claims (15 not 12, logback.xml clean, 35 existing `getClass` call sites, zero other drifted literals, no sibling-ticket collision via `git log` on the four target files) match my own independently-run greps line-for-line, including the exact same line numbers.

### Assessment against the three focus areas

1. **15 vs 12 test-literal count** — independently re-verified as 15, exact line numbers match across ticket.md, design.md, tasks.md, and my own fresh grep. Correctly re-derived, not just asserted.
2. **`getClass`-vs-literal decision and trailing-`$` consequence** — soundly reasoned. Both target objects are genuinely top-level `object`s (not `class`es), so the trailing `$` is unavoidable and consistent with the 35 existing (13+ named, spot-checked for real) precedents in this exact codebase, several confirmed to be `private[services] object`s using the identical unmodified pattern. Nothing in `logback.xml`/resources keys off the exact string, so `D1`'s claim that the ticket's own escape hatch ("prefer a corrected literal if something depends on the string") does not apply is verified true.
3. **Scope boundary ("pure logger-rename, no other files")** — realistic and independently confirmed: a full-repo grep for both old category strings turns up nothing outside the 2 production lines + 15 test lines (plus inert archived planning docs). No sibling in-flight ticket touches these four files per the `git log` check recorded in `premise-validation.md`, which I did not independently re-run (a `git log` "no other lane collides right now" claim is inherently time-sensitive and re-verifying it now would only restate the same point-in-time fact) — this is a minor, non-blocking observation, not a defect, since the executor/evaluator will operate against the live tree at execution time regardless.

No placeholders, no internal contradictions between proposal/design/tasks, no ambiguity a competent implementer could misread — task 1.1/1.2 name exact file:line, task 2.1/2.2 name exact line numbers and exact target strings, task 2.3/2.4 give concrete verification commands. Acceptance criteria in ticket.md map 1:1 onto tasks.md. No contract/schema impact (`skip_specs: true`, confirmed no route/schema file appears anywhere in the Impact section, and none of my greps turned up any schema/route file referencing either logger category).

### Verdict: CONFIRM

### Non-blocking notes

- The `git log --oneline -20 origin/main -- <four files>` "no sibling collision" check in `premise-validation.md` is a point-in-time fact from earlier in this run; not re-verified here since it will naturally be re-confirmed by the executor operating against the live tree at execution time, and re-running it now would not add information beyond what I already independently confirmed via the full-repo string grep (point 7 above).
