## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD: `0ac44e1a36b937faa417f8de239ff7b1e9466702`.
Diff base (resolved live): `64e374bb7519262655370bc8c0e210dba930f251`. It is origin/main and an ancestor of HEAD.

The delta since the head I fully gated in cycle 2 (`f67177ffd..0ac44e1a3`) touches only:
- `design.md`
- `red-evidence.md`
- the evaluation-2 report
- one renamed test name in `PatchSetUndoInlineSourceCleanupSpec.scala`

No product code changed.

Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1493/evidence/` (`EV/` below).

### Phase 1: Spec Review — PASS
Issues: none.

**evaluation-2 CR1, `design.md` brought in line.**
- The D4 table's `KeptReferenced` row now says `InlineSourceCleanup.inUseReason(conflict)`. It describes UI-safe text that names only visible referencers, shows hidden ones as a count, and carries no ids or remediation.
- D5 now covers the `fetchSourceReferences()` dispatch whenever an outcome lists any inline source. It also states the real wording rule: the backend owns the text, and a failure is never worded as "in use".
- The Risks entry now says the 409 reason is deliberately not shown, mirroring `SourceDeleteConflictNotice`.
- All of this matches the code I reviewed at f67177ffd, which this cycle leaves unchanged. C6 and design.md now agree.

**evaluation-2 CR2, C1 record completed.**
- `red-evidence.md` "Cycle 3 additions" records a jest run of the changed slice cases against the cycle-1 `patchSetsSlice.ts`. The three cases fail (`Tests: 3 failed, 19 passed`), and the file was restored afterwards.
- These failures are what the code predicts. The cycle-1 slice made 0 dispatches for `kept` and 1 for `removed`/`alreadyGone`, where the tests now expect 1 and 2.
- The two guards are labelled as guards, each with its reason:
  - the `undoToast.test.ts` id-free case;
  - the wire extra-property case.

**Non-blocking cycle-2 item done.** The test name at `PatchSetUndoInlineSourceCleanupSpec.scala:98` is now "keep a referenced source, with UI-safe in-use text naming the visible pipeline".

**C1 to C6:** all still honoured. No change since cycle 2.

### Phase 2: Code Review — PASS
Issues: none.

I re-ran the gates in proportion to the delta.

**Format and Scala quality:**
- `npm run format:check`: exit 0. This covers the edited markdown.
- `npm run check:scala-quality`: clean.

**Targeted backend run (it covers the one changed Scala file):**
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly …PatchSetUndoInlineSourceSpec …PatchSetUndoInlineSourceCleanupSpec …PatchSetUndoInlineSourceWireSpec …PipelineCreateInlineSourceCleanupSpec"`.
- All four suites ran, and the renamed test appears in the output.
- Result: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` and `Tests: succeeded 30, failed 0`, exit 0. Log: `EV/eval3-targeted-specs.log`.

**Why I skipped `sbt testFull`, lint, jest and the builds:**
- No product code changed since f67177ffd.
- My cycle-2 gating already covered that head in full: testFull exit 0 with 7135 succeeded (`EV/eval2-sbt-testFull.log`), plus lint, 5887 jest tests and both builds, all clean.
- The only code edit this cycle is a ScalaTest name string, which the targeted run compiled and executed.

### Phase 3: UI Review — PASS
Issues: none.

UI-affecting files are unchanged since cycle 2, where C4 and C6 were closed. The kept-toast screenshots are `EV/exec2-undo-kept-toast-{dark,light,light-390}.png`, and my own cycle-1 live verification is `EV/eval1-*`. I started no servers this cycle.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- For the skeptic, a copy-judgment carry-over from cycle 2: "N you cannot access" reads slightly awkwardly as a list item. "N others you cannot access" would read better.
