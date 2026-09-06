## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `4174a87f` (cycle-1 commit `4d4cb817`, base `75f59b04`). Working tree clean.

Scope of this cycle: the cycle-1 change requests only. Cycle 1's Phase-1 findings and the six deep security checks
(evidence authenticity, mutation legitimacy, behaviour-preserving refactor, no-spec-routed-around-the-guard,
host-identity defence, no-migration/no-credentials) were all PASS and the diff since `4d4cb817` touches nothing that
could disturb them — it is two import lines, two type annotations, one comment block, two evidence-file headers, and
the cycle-1 report itself. I re-ran the full gate set regardless rather than carrying the previous run forward.

### Phase 1: Spec Review — PASS

Unchanged from cycle 1. No task, artifact, or acceptance-criteria surface moved; no scope crept in with the fixes.
`design.md` Decision 5.6/5.8 and the corrected in-spec comment now agree with each other and with the transcripts.

### Phase 2: Code Review — PASS

**Gates (my own fresh runs at `4174a87f`, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):**

- `cd backend && sbt test` → **green**: 3873 tests, 255 suites, 0 failed, **0 ignored**, 0 canceled (270 s). Same
  test count as cycle 1 — the fixes neither added nor removed coverage, which is what a comment/import-only cycle
  should look like.
- `npm run check:scala-quality` → clean (156 pre-existing soft size warnings, unchanged count).
- `npm run check:openspec` → clean. `npm run check:spec-structure` → 350 canonical specs, 0 issues.
- `npm run check:no-credential-leak` → 0 violations.
- Frontend gates not run: still zero `frontend/**` files in `git diff --name-only main...HEAD`.

**CR1 — inline fully-qualified names: RESOLVED.**

- `PipelineService.scala:25` now carries `import java.net.InetAddress`; line 1532 reads
  `(h: String, addr: InetAddress) => ...`.
- `PipelineAnalyzeProposalRoutesSpec.scala:29` now carries `import java.net.InetAddress`; line 144 reads
  `(String, InetAddress) => Boolean`.
- I re-grepped the whole backend for inline `java.net.` / `java.util.UUID.` / `spray.json.Js` qualifiers outside
  import lines. The remaining hits are all in files this change never touched (`TemplateInterpolator.scala:71` — a
  doc comment, `SparkJobSubmitterSpec`, `DbContextSpec`, `OutputRoutesSpec`, `AuditTestFixture`, `PanelBatchCreateSpec`,
  and `RestConnectorEgressGuardSpec:168`, which is unmodified by this change). **Zero inline FQNs remain anywhere in
  this diff.** The parenthetical suggestion to also drop the unused `h` was not taken; that was explicitly a
  parenthetical, not part of the request, and it is not blocking.

**CR2 — mutation-check comment: RESOLVED, and the correction is itself true.**

I checked this the way the cycle-2 brief asked — by testing whether the new claim *predicts* the transcript, not by
taking its word for it. The corrected comment
(`SqlConnectorEgressGuardSpec.scala:168-180`) states the mutation replaced `SqlConnectorDriver.connect`'s
`checkConfigEgress(...)` match with a hardcoded `Right(())`. That claim makes three independently checkable
predictions, and `evidence/task-7-mutation-check-RED.txt` satisfies all three:

1. `execute` proceeds past the guard into `DriverManager.getConnection` and genuinely reads rows ⇒ the failure value
   should be a populated `Right`. Transcript: `Right(List(Map("one" -> 1))) was not an instance of scala.util.Left`.
2. Every `checkConfigEgress`-level test is untouched, because none of them route through `connect` ⇒ all 14 stay
   green. Transcript: exactly 14 succeeded, 1 failed.
3. The mutation lives in a main source, not a test source ⇒ sbt recompiles a main file. Transcript:
   `compiling 1 Scala source to .../scala-2.13/classes` (main `classes`, versus the `test-classes` line in the
   task-2.2 transcript).

I also confirmed the correction is *uniquely* consistent, not merely consistent: the two other plausible mutation
sites both predict a different transcript. Neutralising `ContentSourceSupport.isBlockedAddress` (the original false
claim) or neutralising `checkConfigEgress` itself would each have reddened the seven blocked-class tests plus the
DNS-name and multi-A-record tests — nine reds, not one. The connect call site is the only candidate that produces the
transcript on disk. The new comment's supporting reasoning ("`isBlockedAddress` is shared with the REST egress guard
and its own denylist unit tests, so neutralising IT would have reddened many more tests") is likewise accurate, and
it now agrees with `design.md` Decision 5.6/5.8 instead of contradicting it. **No second inaccuracy was introduced.**

**Evidence files were annotated, not edited.** `git diff 4d4cb817..HEAD` on both transcript files shows **additions
only — zero `-` lines**. Each header is a comment block prepended above the original `[info] welcome to sbt …` first
line, and every byte of the originally captured sbt output below it is unchanged, including the failure line and the
per-test roster. This is the correct shape: the captured output stays the primary artifact and the annotation sits
outside it. The RED header's factual claims each check out against the body it heads — "Only SqlConnectorEgressGuardSpec
was run" (the transcript contains that one suite), "exactly ONE test goes red" (1 failed / 14 succeeded), and the
quoted failure value matches the transcript verbatim. `task-2.2-ssrf-reachable.txt` was not touched at all.

### Phase 3: UI Review — N/A

Unchanged from cycle 1, and the cycle-2 diff narrows it further: the only files touched are two Scala sources, one
Scala spec, two evidence transcripts, and the cycle-1 report. No Phase-3 trigger matches — zero `frontend/**`, no
`schemas/**`, no wire-shape change, and the only `openspec/**` files are this change's own artifacts. Per the standing
constraint, Playwright was **not** launched, **no** e2e spec was run, and **no** dev server was started (HEL-972 holds
Playwright and the dev database).

### Overall: PASS

Both cycle-1 change requests are resolved in substance, not just in form: CR1 is verified by a repo-wide re-grep rather
than by reading the two lines that were named, and CR2's replacement text is verified by prediction-matching against
the transcript it describes — the corrected account is the only one of the three candidate mutation sites that could
have produced the evidence on disk. The evidence files were annotated rather than rewritten. The security substance
that passed cycle 1 is untouched, and the full backend suite is green at 3873/3873 with zero ignored.

### Non-blocking Suggestions

Carried forward from cycle 1, none blocking and none of them regressions:

- The blocked-class tests still assert only `result shouldBe a[Left[_, _]]`; asserting the message
  (`err should include("resolves to a disallowed address")`) would pin *why* the host was refused and make them immune
  to a future refactor that starts refusing them for an unrelated reason.
- The charset gate excludes `_`, so a SQL host like `my_db.internal` is now `Invalid` where the SQL path previously did
  no validation at all. Deliberate and documented at `ContentSourceSupport.scala:238-244`, and consistent with the REST
  path — but worth a line in the release note.
- `design.md` Decision 5.8's point (the loopback red/green pair is the only end-to-end proof and must not be weakened
  by a later cycle) would be worth restating as a comment on the flipped test itself, where a future editor will see it.
- The unused `h` parameter at `PipelineService.scala:1532` could be `_: String`.
