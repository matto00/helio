## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed `72ab6847` on top of `9380517b`. Every cycle-1 change request was verified by my own
probe or by reading the named site — no prose claim was accepted as evidence.

### Phase 1: Spec Review — PASS

**CR1 (blocking) — fixed, and the fix is independently proven red.** I did not trust the commit
body. I created a throwaway detached worktree at pre-fix `main` (`9c1f29bf`), dropped in a probe
spec that runs the **pre-fix composition expression verbatim**
(`cfg.foldLeft(Uri(endpoint)) { case (uri, (k, v)) => uri.withQuery(Uri.Query(uri.query().toMap + (k -> v))) }`)
against both fixtures, and ran it under `sbt testOnly`. Result:

```
CYCLE1_FIXTURE_PREFIX_RESULT=[existing=1&added=2]   expected_by_shipped_test=[existing=1&added=2]
CYCLE2_FIXTURE_PREFIX_RESULT=[c3=30&e1=1&c2=20&c1=10&e3=3&e2=2]
                                                    expected_by_shipped_test=[e1=1&e2=2&e3=3&c1=10&c2=20&c3=30]
```

So the cycle-1 fixture provably passed pre-fix (confirming the original finding), and the
cycle-2 replacement at
`backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverQueryParamsSpec.scala:178-185`
(`endpoint = "/echo-query?e1=1&e2=2&e3=3"` + config `c1..c3`, expecting
`"e1=1&e2=2&e3=3&c1=10&c2=20&c3=30"`) is genuinely **red** pre-fix — and my observed red string
is byte-identical to the one recorded in the cycle-1 commit body, which independently
corroborates that the originally recorded red evidence was real. The throwaway worktree was
removed (`git worktree remove --force`; `git worktree list` shows no straggler). The test passes
post-fix in the full suite. AC 7 now has a failable guard.

**CR2 — corrected at every site I named, plus one I did not.** The overstatement is gone from
`RestApiConnectorDriver.scala:136-142` (now: "did NOT drop the endpoint's query string outright
… silently REORDERED … and COLLAPSED any duplicate key within them"), the test comment at
`RestApiConnectorDriverQueryParamsSpec.scala:158-170`, `design.md` D4, `proposal.md` "What
Changes", and `ticket.md` widened-repro item 3. All five statements now match the behaviour my
probe measured (distinct endpoint pairs survive; order is hash-scrambled).

**CR3 — stated correctly and pinned by a non-coincidental fixture.** `design.md` D2, `tasks.md`
3.1 and the `QueryParams` scaladoc (`model.scala:554-563`) now say key-sorted order and cite
`spray/json/JsonParser.scala:100` (`TreeMap`), with the not-a-regression rationale. New test
`DataSourceProtocolSpec.scala:178-195` uses `{"z":"1","a":"2"}` — document order differs from
alphabetical — and asserts `QueryParams(Vector("a" -> "2", "z" -> "1"))`. It appears green in my
own full `sbt test` run, so the key-sorted behaviour is genuinely pinned, not coincidental.

**CR4 — both stale fence references fixed.** `files-modified.md` line 8 now describes the real
diff (normal top-of-file import, fence withdrawn after HEL-914/HEL-868 merged) instead of the
false "inline-qualified to avoid adding an import". The `QueryParams` scaladoc
(`model.scala:541-548`) no longer claims the companion format keeps the edit to "two fenced
lines"; it now correctly separates implicit-format resolution from the ordinary Scala
type-annotation import requirement.

**Non-blocking items re-checked.** (1) `design.md` D4a exists at line 78 and all cross-references
(tasks 4.2, the code comment at `RestApiConnectorDriver.scala:227`, the spec delta) resolve to
it — as noted, pre-existing, not a new edit; nothing dangling. (2) The long line in
`SourceService.scala` was extracted to a named `urlAndConfigQueryParams` val (lines 131-132).
(3) The task 4b.3 spinoff for the dropped `request.config.parameters` is explicitly left to the
coordinator in the commit body — reasonable, but still owed before archive.

**Hard constraints re-verified on the full branch diff (`main...HEAD`):** no path matching
`db/migration` (no Flyway migration); nothing matching `LocalFileSystem`, URL-source fetching,
CSV, or schema-inference (HEL-881 / HEL-893 untouched); `PipelineProposalProtocol.scala` still
confined to the one import + the `queryParams` field type; working tree clean; all pre-commit
gates pass here, so no `git commit -n` bypass is in evidence. No browser/Playwright work was
performed.

### Phase 2: Code Review — PASS

Gates re-run fresh by me in `WORKTREE_PATH` at `72ab6847` (`CLEAN_WORKTREE` not set):

- `npm run lint` → 0; `npm run format:check` → 0; `npm run typecheck` → 0
- `npm test` → 254 suites / 2618 tests passed
- `npm --prefix frontend run build` → 0
- `cd backend && sbt -batch test` → **250 suites, 3791 tests succeeded, 0 failed** (no flake in
  my run; the two specs the commit body reports as flaky both passed here)
- `node scripts/check-schema-drift.mjs` → 0; `node scripts/check-scala-quality.mjs` → clean

Cycle-2 code changes are comment/test/readability only, plus the one extracted val; no behaviour
change to production logic beyond what cycle 1 shipped and I already reviewed. The corrected
comments are now accurate to measured behaviour rather than to the ticket's original narrative.
The new decode test is meaningful (it fails if the branch ever became document-order or
insertion-order preserving).

### Phase 3: UI Review — N/A

No frontend file changed in `72ab6847`; the cycle-1 frontend change remains a wire-serialization
edit with no rendered-UI surface, covered by Jest. Per instruction, no browser work performed;
I do not believe browser review is required for this ticket.

### Overall: PASS

### Non-blocking Suggestions

- `design.md:51` has a transposed-values typo in the new CR3 example: it says `{"z":"1","a":"2"}`
  decodes to `Vector("a" -> "1", "z" -> "2")`. The values belong to the other keys — the correct
  (and test-asserted) result is `Vector("a" -> "2", "z" -> "1")`. The ordering point it makes is
  right; only the example's values are wrong. Worth fixing before archive so the record is exact.
- The cycle-2 commit body contains a typo ("legacop row"); cosmetic only.
- Still owed before archive: file the task 4b.3 spinoff ticket for `request.config.parameters`
  being dropped in `SourceService.createRest`.
