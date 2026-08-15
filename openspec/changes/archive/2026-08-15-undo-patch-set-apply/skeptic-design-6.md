## Skeptic Report — design gate (round 6, skeptic-design-6.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, the full current `design.md` (150 lines), `tasks.md`, and all four
  spec deltas (`patch-set-undo`, `patch-set-apply`, `patch-set-preview`, `mcp-patch-set-tools`) fresh
  from the worktree, plus `skeptic-design-{1,2,3,4,5}.md` (treated as claims to re-verify, not fact —
  all five prior rounds REFUTEd).
- Confirmed no implementation code for this ticket exists yet (`git log` in the worktree tops out at
  HEL-411 #336; the only diffs are the still-untracked `openspec/changes/undo-patch-set-apply/`
  directory) — this is genuinely still a design-gate review.

**Primary re-verification target — does simplifying D2a (moving the raw-config fetch into
`applyResolved`'s own loop, via a separate index-keyed accumulator never merged into `applied`)
actually close round 5's tuple-arity finding, without silently reopening round 4's wire-leak finding
or introducing a new one?**

1. **`panelRepo` is genuinely reachable from `applyResolved`'s loop body.** `PatchSetApplyService`'s
   constructor (`PatchSetApplyService.scala:39-56`) takes `panelRepo: PanelRepository` as a field
   (line 45); `applyResolved` (line 79) and its inner `loop` (line 83) are both methods/closures of
   that same class, so `panelRepo` is in scope with no `PatchSetApplyContext`/`applyOne` threading
   needed — confirmed by reading the class body directly, not by trusting design.md's citation.
2. **`applyOne`'s signature is genuinely untouched.** `PatchSetApplyForward.applyOne`
   (`PatchSetApplyForward.scala:20-24`) is still exactly `(edit: ResolvedEdit, user: AuthenticatedUser,
   services: PatchSetApplyServices)(implicit ec): Future[Either[ServiceError, EditOutcome]]` — the
   round-6 design never proposes changing it (D2a: "not inside `PatchSetApplyForward.applyOne` at
   all"), which is the correct reading of the current source: `applyOne` has no `panelRepo`/`ctx`
   parameter today and the new design doesn't add one.
3. **The failure-path call genuinely keeps its 2-tuple shape.** `PatchSetApplyService.scala:79-104`
   traced line-by-line: `loop`'s `applied: Vector[(ResolvedEdit, EditOutcome)]` accumulator (line 85)
   is appended to only in the `Right(outcome)` branch (line 92); on `Left(err)` (line 91) it is passed
   through completely unchanged as `(err, applied)`. Round 6's plan adds a *separate*,
   `edit.index`-keyed `Map[Int, JsValue]` accumulator that the design explicitly says is "never merged
   into `applied`" and is read "only by the terminal SUCCESS branch" — meaning the `Left` branch at
   line 91 (and thus the failure-path call `PatchSetApplyRollback.rollback(appliedSoFar, user,
   services)` at line 100) never needs to see it at all. `PatchSetApplyRollback.rollback`
   (`PatchSetApplyRollback.scala:53-57`) is still hard-typed to the 2-tuple `Vector[(ResolvedEdit,
   EditOutcome)]` — since `applied` itself is never widened, this type-checks with zero changes to
   `rollback`'s signature. This is a structurally sound resolution, and it is verbatim the exact
   sub-choice round 5's own CR1 option (a) recommended ("collect the raw-config value in a **separate**
   ... accumulator... consumed only by the success branch... the extra `panelRepo.findByIdInternal`
   fetch... could instead happen in `applyResolved`'s loop itself" — `skeptic-design-5.md` lines
   153-160) — a genuine third-round convergence on a previously-identified correct answer, not a new
   guess.
4. **`EditOutcome`/the `/apply` wire response genuinely stay clean.** `EditOutcome`
   (`PatchSetApplyProtocol.scala:33-39`) is still exactly 5 fields (`jsonFormat5`); nothing in the
   round-6 design adds a field to it. Since the raw-config accumulator lives entirely outside `applied`/
   `EditOutcome`, round 4's original wire-leak risk cannot recur through this path either.
5. **No other consumer of `applyResolved`/`applyOne`/`rollback` exists to disturb.** `grep` for
   `applyResolved`, `PatchSetApplyRollback.rollback`, `PatchSetApplyForward.applyOne` across
   `backend/src/main/scala` and `backend/src/test/scala` turns up exactly the three in-file call sites
   already traced above, plus one unrelated doc-comment mention in `PatchSetPreviewService.scala` — no
   test file constructs `PatchSetApplyResponse`/`EditOutcome` directly (both current call sites for
   `PatchSetApplyResponse(...)` are inside `PatchSetApplyService.scala` itself, so adding the
   `applicationId` field is a same-file, same-commit change with no other call site at risk).

This round's specific brief is satisfied: the fix is real, traces cleanly against source, and does not
reopen either of the two prior findings.

**Fresh, independent pass over claims not specifically flagged this round** (per the brief's request to
check for a new problem two hops away):

- `PanelService.create` (`PanelService.scala:168-235`) confirmed to never call `resolveSingleBinding` —
  builds a `Panel` via `buildForCreate`/`buildNewPanel` and inserts it directly — supporting D2a's "a
  `create` edit needs no fetch" claim. `PanelService.update` (`PanelService.scala:434-473`) confirmed to
  call `patchApplier.apply(panelId, spec, p => resolveSingleBinding(p, user))` (line 462) — the
  materializing path D2a's whole premise depends on. Both re-confirmed directly, not taken on trust.
- `V78__refinement_conversations.sql` confirmed still the latest migration
  (`ls backend/src/main/resources/db/migration | sort -V | tail`) — D1's `V79` is still correct.
- `PipelineSummaryResponse` (`PipelineProtocol.scala:15-27`) confirmed to carry exactly
  `lastRunStatus`/`lastRunAt`/`lastRunRowCount` as Option fields — D4a's justification for excluding
  them from the pipeline conflict check is grounded.
- `MetricPanelConfig` (`MetricPanel.scala:25-33`) confirmed to carry exactly `dataTypeId`/
  `fieldMapping`/`aggregation`/`unit` (plus `label`/`metricId`/`metricDeprecated`) — D4a's "four
  metric-materialized effective fields" list is accurate.
- Frontend: `Toast`/`toastsSlice` (`frontend/src/shared/ui/Toast.tsx`,
  `frontend/src/features/toasts/state/toastsSlice.ts`) confirmed to genuinely support `duration` (0 =
  never auto-dismiss, default 4000ms) and `action: {label, onClick}` exactly as D6 describes.
  `PatchSetReviewPage.handleAccept` (`PatchSetReviewPage.tsx:74-85`) confirmed to be the real
  `await dispatch(applyPatchSet(patchSet)).unwrap(); navigate("/")` call site D6/task 3.2 target.
- `helio-mcp/src/tools/refinement.ts` confirmed to have the real `propose_patch_set`/`apply_patch_set`
  pair `undo_patch_set` is described as joining, with the exact wiring pattern (`guarded(() =>
  ...Handler(api, ...))`) a third tool would mirror.
- All three other spec deltas (`patch-set-undo`, `mcp-patch-set-tools`, `patch-set-preview`) read
  internally consistent with the current design.md and with each other; no contradiction found.

**Narrow items noticed, explicitly assessed against the "genuinely broken" vs. "implementation-detail
gap" bar the brief asked for — all fall on the non-blocking side:**

- D2's older sentence ("the write happens... after `applyResolved` returns `Right`, before the response
  is returned") reads slightly stale next to D2a's newer framing ("the terminal SUCCESS branch reads the
  separate accumulator, to build the journal payload") — the natural reading of D2a is that the journal
  write happens *inside* `applyResolved`'s own terminal branch (which is where the accumulator lives),
  not after `applyResolved` returns to `apply()`. Functionally these describe the same observable
  behavior (synchronous write, response carries the id) either way, and this same D2 sentence has been
  unchanged and unflagged across all six rounds — it is a phrasing nit, not a decision an implementer
  needs a human for; either placement compiles and behaves identically. Non-blocking.
- Wiring a new `PatchSetApplicationRepository` into `PatchSetApplyService`'s constructor (task 1.2/1.3)
  touches exactly one instantiation site (`ApiRoutes.scala:199`, confirmed the sole `new
  PatchSetApplyService(...)` call) — mechanical, not ambiguous.
  Giving `PatchSetApplyResponse.applicationId` a value at the failure-path constructor call
  (`PatchSetApplyService.scala:101`, currently `PatchSetApplyResponse(rolledBack, failure =
  Some(err.message))`) is a one-line addition (`applicationId = None`, consistent with D2's "journal
  only on success") — same file, same commit as the field's own addition, no other caller to disturb
  (confirmed via `grep` above). Non-blocking.
- Mirroring the new `applicationId: Option[String]` field onto the frontend's `PatchSetApplyResponse`
  TypeScript type (`frontend/src/features/patchSets/types/patchSet.ts:66-68`) so
  `PatchSetReviewPage.handleAccept` can read it isn't named as an explicit task line, but it's a single,
  unambiguous, low-risk mechanical mirror of a backend field addition — exactly the kind of follow-through
  a competent frontend engineer does without a design decision. Non-blocking.

None of these three items has the property that made rounds 4 and 5's findings genuinely blocking: in
both of those, two structurally different implementations were both consistent with the design's prose,
and picking the wrong one produced either a silent public-contract change (round 4) or a compile error
at a specific call site (round 5). Here, each item has exactly one reasonable implementation with no
live ambiguity and no risk of silently regressing a documented guarantee.

### Verdict: CONFIRM

Round 6's simplification of D2a is sound and closes round 5's finding for the reason round 5 itself
predicted it would: moving the extra fetch into `applyResolved`'s own loop and threading its result
through a wholly separate accumulator (never merged into `applied`) means `PatchSetApplyRollback.
rollback`'s failure-path call never needs to see it, so no tuple-arity mismatch is possible, and
`applyOne`/`EditOutcome` are never touched, so round 4's wire-leak risk cannot reopen either. I traced
every one of the three re-verification targets the brief named against the actual current source (not
prior skeptic reports), plus did a fresh whole-design pass over every other decision (D1/D3/D4/D4a/D4b/
D5/D6) and all four spec deltas, and found no new blocking gap. The three narrow items noted above are
real but are the "competent executor resolves without a human decision" kind the brief asked me to
distinguish — I considered blocking on the D2/D2a phrasing overlap specifically, since this ticket's
history shows how a vague sentence has cost multiple rounds before, but concluded it doesn't meet that
bar here: both readings compile, both satisfy every spec scenario, and neither requires walking back any
other decision — unlike rounds 4/5's findings, which had a wrong-turn implementation path that would
silently violate a documented contract (round 4) or fail to compile (round 5). This design is ready to
implement.

### Non-blocking notes

1. Consider tightening design.md D2's "after `applyResolved` returns `Right`, before the response is
   returned" sentence to match D2a's newer framing (the write happens inside `applyResolved`'s own
   terminal success branch, which is where the raw-config accumulator lives) — purely cosmetic, but
   given this ticket's history of a vague sentence costing a round, a one-clause tightening here is
   cheap insurance for the executor.
2. tasks.md 1.3 could explicitly note the one-line `applicationId = None` needed at the failure-path
   `PatchSetApplyResponse(rolledBack, failure = Some(err.message))` call site
   (`PatchSetApplyService.scala:101`) alongside the new field's addition, and tasks.md 3.x could name the
   frontend `PatchSetApplyResponse` TS type update explicitly — both are already implied and low-risk,
   just worth a one-line callout given how granular this tasks.md already is everywhere else.

### Environmental note (non-blocking, does not affect the verdict above)

`scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` are absent from
this worktree's `scripts/concertino/` (only `.concertino.env`, `README.md`, `assert-phase.sh`,
`cleanup.sh`, `setup-worktree.sh`, `start-servers.sh` are git-tracked there; the rest are gitignored
generated files that `git worktree add` cannot bring over, and `setup-worktree.sh` only copies
`CONCERTINO_ENV_FILES`, not `scripts/concertino/*`). I verified the main checkout's copies of all three
scripts resolve their state purely via `git` commands and explicit path arguments (never their own
`$0`/`SCRIPT_DIR` location) — `git rev-parse --git-common-dir`/`--show-toplevel` correctly resolve to
this same worktree's shared `.git` regardless of which copy of the script is invoked — and confirmed
byte-for-byte identity between the worktree's and main checkout's copies of every git-tracked script
they share (`assert-phase.sh`, `cleanup.sh`). I therefore invoked the main checkout's copies directly
(by absolute path, pointed at this worktree's files) rather than modifying the worktree or guessing a
fallback filename, to comply with "never modify code" while still producing a genuinely collision-safe
report path.

