## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7cec4bfca56ec71ffab6b2f5aa6ac91d2a605f45` (split `0010efb84` + evidence `7cec4bfca`) against base
`24f6de4cf` (resolved live via `resolve-review-base.sh`). Backend-only change. Every check below was re-run by the
evaluator; none relies on the executor's evidence files except where a comparison against them is stated.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (closer to budget, real seams): `OutputService.scala` 503 -> 330, `NodeSnapshotRepository.scala` 458 -> 352.
  The seams are genuine: row reads (`OutputRowReads`), create-time root anchoring (`OutputRootResolution`),
  whole-config write validation joined to its existing home (`OutputConfigValidation`), and pure SQL-fragment
  construction (`NodeSnapshotFilterSql`). Both files are still over 250. That is allowed by the AC's "or flags a
  smaller overage" clause and is disclosed in design Risks and in files-modified follow-up 1.
- AC2 (zero behaviour change, tests unmodified): `git diff 24f6de4cf...HEAD -- backend/src/test` is empty (0 lines).
  Suite results below.
- AC3 (mutation bites): independently confirmed. See Phase 2.
- AC4 (`check:scala-quality`): both files are still flagged, but with smaller overages (353/331 by the script's count).
  No hard violations.
- Tasks 1.1-3.7 are all ticked and match the diff. No scope creep. The two README edits and the one-line
  `TARGET_FILES` addition are D4/C5-sanctioned.
- CONSTRAINTS:
  - C1 holds (see Phase 2).
  - C2 holds (see the javap section).
  - C3 holds (see the move checks).
  - C4 holds: `ServiceError.Forbidden(` appears once in `OutputService.scala`. `KNOWN_EXEMPTIONS` is unchanged and
    the three exempt scopes did not move.
  - C5 holds: `services/pipelines/README.md` line 5 (`Holds:`) is untouched and the addition is after line 11.
    `git merge-tree --write-tree 7cec4bfca ca3f5619` is clean (exit 0). PR #847 only calls
    `listRows`/`overwriteRows`/`overwriteRowsWith`, whose signatures are unchanged.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (run by the evaluator):**
- `nice -n 19 sbt testFull` in WORKTREE_PATH at HEAD: 6180 succeeded, 0 failed, 4 canceled, 443 suites, `[success]`.
- An independent baseline `nice -n 19 sbt testFull` on a `git archive 24f6de4cf` copy of the full tree gave the same
  totals. The per-suite counts from the two runs are byte-identical (443 suites, 6184 leaf lines). They also equal
  the executor's `base-counts.json` and `after-counts.json`.
- `npm run check:scala-quality`: clean, soft warnings only.
- `npm run check:node-root-encoding`: clean, 4 files scanned (was 3).
- Red run on the encoding check: I inserted `private val probe = sql" AND node_step_id IS NULL"` into a scratch copy
  of `NodeSnapshotFilterSql.scala`. The check flagged it at `NodeSnapshotFilterSql.scala:11`, which proves the new
  file is scanned.
- Frontend gates: N/A, no `frontend/**` changes.

**Move checks (C3):**
- The executor's `check_moves.py` re-run on HEAD gives RESULT: PASS.
- My own red runs in a scratch copy, different from the executor's, all made the checker FAIL at the right line:
  - `roots.size > 1` changed to `>= 1` in `OutputRootResolution`.
  - The member-import line duplicated in `NodeSnapshotRepository` (the reverse check).
  - One extra space added inside a moved doc comment in `NodeSnapshotFilterSql`.
  - The checker went back to PASS after reverting.
- I also ran an independent multiset check over the `-U0` diff of `backend/src/main`, not using the executor's
  tooling. Every removed line is re-added verbatim except:
  - the 4 visibility widenings (`private` -> `private[pipelines]`) that D2/D4 sanction;
  - the 2 import trims;
  - the persistence README `Holds:` line;
  - the D5-listed positional comment words ("above", "this service", "this file", "THIS class", "this class").
  Every other added line is scaffolding, imports, wiring, delegation, forwarders, or the D3 header amendment. No
  logic line changed.

**javap / public API (C2), re-derived from scratch:**
- Before: I compiled a fresh `git archive 24f6de4cf` extraction. After: a fresh `git archive HEAD` extraction. In both,
  I ran `javap -public` on every `OutputService*`, `NodeSnapshotRepository*` and `OutputConfigValidation*` class.
- My raw diff body is identical, line for line, to the executor's committed `move-check/javap-raw.diff`.
- My before and after dumps are identical class by class to the executor's `javap-base.txt` and `javap-after.txt`.
  The only extra classes are the 4 `OutputConfigWritePolicy*` classes, which I added to the scope and which are
  unchanged.
- The executor's `classify.py`, run on my dumps, gives RESULT: PASS.
- `OutputService` and `OutputService$` still carry `validateConfig$default$4()`. No `rowReads` or `rootResolution`
  member is exposed. The only `$$` member removals are the two pre-approved
  `NodeSnapshotRepository$$escapeLikeTerm` and `$$likeEscapeChar`. `git grep` on HEAD and on ca3f5619 finds no
  reference to either.
- Caveat: sbt 2's content-addressed disk cache served both compiles (`cache 100%`). The outputs are keyed on source
  content, so this does not weaken the comparison.

**Ruling on the executor's "before" (built from an earlier copy):** Accepted as sound. My independently built
before-dump from a fresh `git archive 24f6de4cf` matches the executor's `javap-base.txt` exactly. Whatever copy the
executor built from produced the true base API.

**Ruling on the `$$anonfun$N` class carve-out:** This is a correct reading of D5b(b), not a weakening.
- D5b(b)'s "an ADDED `$$` name fails" exists to catch leaked private members. These are name-mangled public accessors
  on a checked class, e.g. `$$rowReads`, or the `com$...$$escapeLikeTerm` pair this very change removes.
- `Owner$$anonfun$N` are not members of a checked class. They are separate compiler-generated
  `AbstractPartialFunction` classes, which Scala 2.13 still emits for a `collect { case ... }` literal.
- The `collect` bodies moved verbatim, so the owner prefix and index necessarily change. Evidence that only the name
  changed:
  - `javap -p -c` bytecode of `OutputService$$anonfun$1` is identical to `OutputConfigValidation$$anonfun$3` once
    owner names and constant-pool indices are normalised. The same holds for `$$anonfun$2` and `$$anonfun$4`.
  - `NodeSnapshotRepository$$anonfun$1` reappears as `NodeSnapshotFilterSql$$anonfun$1`. The accessor pair it needed
    moved with it onto `NodeSnapshotFilterSql$`, which is package-private and not a checked class.
- The carve-out is narrow:
  - Added anonfun classes are accepted only under the `OutputConfigValidation` prefix.
  - Removed anonfun classes are accepted only under `OutputService` or `NodeSnapshotRepository`.
  - A newly added `OutputService$$anonfun$N` would still fail.
  - Member-level `$$` additions on checked classes still fail, and none occurred.
- Recommendation for future designs: word the rule as "no added `$$` member name", which says what was meant.

**Mutation (ticket AC), re-run by the evaluator in a scratch copy, each reverted (verified with `cmp`):**
- M1, `NodeSnapshotFilterSql.escapeLikeTerm`, `.replace("%", "\\%")` changed to `.replace("%", "%")`:
  `testOnly *OutputRoutesSpec` stayed **GREEN** (100/100). This is a pre-existing test gap, not a refactor defect:
  - The D6 escaping test at `OutputRoutesSpec.scala:931-942` uses rows "50% off" and "full price".
  - An unescaped `%50%%` pattern still matches only the first row, so the test cannot tell escaped from unescaped.
  - It is a follow-up candidate (see below).
- M2, the collect closure in `filterWhereFragment`, `if term.trim.nonEmpty` changed to `if term.trim.isEmpty`:
  - Green under `*OutputRoutesSpec`, which has no column-term coverage.
  - **RED** under `*OutputFilteredMetricRoutesSpec *PublicDashboardRoutesSpec`: 1 failed, at
    `OutputFilteredMetricRoutesSpec.scala:123`.
  - That test reaches the code via public `NodeSnapshotRepository.listFieldCells`, which proves the member-import
    delegation and the moved `$$anonfun` closure are live.
- I did not re-run the executor's other 4 recorded mutations. Its harness is committed under `move-check/`.

**Code-quality checklist:**
- No inline FQNs. I checked every `s"${...}"` in the new and receiving files: `OutputRootResolution:32,57`,
  `NodeSnapshotFilterSql:35,86` and the pre-existing `OutputConfigValidation` lines are all plain values.
- DRY: no duplication. The forwarders keep the API source- and binary-compatible as D3 requires.
- Type safety: no new escape hatches.
- No dead code. The leftover `NodeRef` import was already unused at base, and the follow-up list discloses it.
- Not over-engineered: there are three new units and each is a real concern.
- Behaviour-preserving: confirmed by the move checks, the javap diff, and equal suite totals.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The API surface is unchanged per
the javap diff.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `OutputRootResolution.scala:11` (new class doc) says `pipelineRootRepo == null` "skips both checks". This is
  inaccurate for `resolveExplicitRootId`: with a null repo and `Some(rid)` it returns
  `400 "rootId is not supported by this deployment"`. Suggested wording: "`pipelineRootRepo == null` skips the
  ambiguity check and rejects an explicit `rootId`".
- `NodeSnapshotRepository.scala:89-90`: the D4 member import's trailing blank line sits next to the existing blank
  line, leaving two consecutive blank lines. Dropping the added blank line would also be a valid move.
- Follow-up candidate (test gap, pre-existing): the D6 LIKE-escaping test (`OutputRoutesSpec.scala:931-942`) does not
  bite on removing the `%` escape (evaluator mutation M1 stayed green). A non-matching row that contains "50"
  (e.g. "500 units") would make it bite. Add this to the existing follow-up list in `files-modified.md`.
- Evidence wording: D5b(b)'s "added `$$` name" should become "added `$$` member name" in any future reuse of this
  evidence pattern (see the ruling above).
