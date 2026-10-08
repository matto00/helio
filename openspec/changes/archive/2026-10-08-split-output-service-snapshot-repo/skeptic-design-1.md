## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 24f6de4cf290c216c8ba94359f82d1d35ae88f2a (worktree base, change dir untracked).
Artifacts: ticket.md, proposal.md, design.md, tasks.md.

### What I verified (with evidence)

- **Line citations are accurate.** I read `OutputService.scala` (503 lines) and `NodeSnapshotRepository.scala`
  (458 lines) at base. Every span design.md cites matches: requireUnambiguousRootWhenNeither 170-191,
  resolveExplicitRootId 193-216, rows 336-387, filterCapabilities 389-401, distinctValues 403-427, materializedFor
  429-449, companion validators 457-502; repository filter/sort builders 205-311, `nodeFilterFragment` 196-203.
- **The moved code only touches what it says.** None of the D4 members reference `ctx`. The D1 members use only
  `outputRepo`/`nodeSnapshotRepo`/`pipelineRunRepo`. The D2 members use only `pipelineRootRepo`. `log` is used only
  by `triggerBackfill` (:78), which stays. The `== null` degrade checks therefore keep their meaning when they move
  into classes that receive the same constructor parameters.
- **ExistenceNotLeakedRoutesSpec survives.** `forbiddenProducerCounts` counts `ServiceError.Forbidden(` per file name.
  The only producer is `create` :138, and `create` stays. `filesCallingAccessHelpers` looks for
  `requireAccess|requireOwnerOnly|authorize*`. Only `listByPipeline` (:111) and `create` (:136) call those, and both
  stay. None of the moved methods calls a helper, so none of the new files has to be named in a `Row.sites` set
  (ExistenceNotLeakedRoutesSpec.scala:448-449, :497-512, :525).
- **check-node-root-encoding survives.** Exemptions are keyed on `(file, scope = nearest preceding def, arm, text)`
  (scripts/check-node-root-encoding.mjs:28-38, :114-163). All three NodeSnapshotRepository exemptions
  (`overwriteRowsAction`, `listRows`, `nodeFilterFragment`) sit inside defs that stay. Removing lines between them
  does not change their scope, and no moved line matches `node_step_id IS NULL` or the Slick forms. Adding
  `NodeSnapshotFilterSql.scala` to `TARGET_FILES` adds coverage without needing a new exemption.
- **No other test depends on these files' layout.** I grepped `backend/src/test` for source-file scans, `PrivateMethod`,
  `invokePrivate` and `getDeclared*` against these classes, and for the private member names. The only hits are
  comments in OutputRoutesSpec:1930/1951 and MultiRootIsolationSpec:128. The other source-scanning specs
  (CredentialSurfaceEnumeration, ShareTokenGeneration, SchemaFieldStructuralGuard, SqlEgressSocketFactories) do not
  look at these packages.
- **PR #847 still compiles.** I ran `git fetch origin pull/847/head`, and FETCH_HEAD is ca3f5619376829fbe97cd4ed61bf90c7be7f80d9.
  `git diff --stat 24f6de4cf...FETCH_HEAD` shows no change to `NodeSnapshotRepository.scala`, `OutputService.scala` or
  anything under `infrastructure/`. Its callers use only public `listRows`/`overwriteRows`/`overwriteRowsWith` and the
  constructor (PipelineRunBackfill.scala:75/:157, PipelineRunSucceededWrites.scala:107). None of the four new class
  names exists on FETCH_HEAD. **One overlap:** #847 rewrites line 5 (the `Holds:` line) of
  `services/pipelines/README.md`, and task 2.6 edits that same Holds list. See CR3.
- **The current public bytecode contains mangled accessors.** I ran `javap -public` on a sibling build
  (`.claude/worktrees/task/split-pipeline-run-service/hel-1371/backend/target/...`). Its `NodeSnapshotRepository.scala`
  source is byte-identical to 24f6de4cf (checked with `diff`). The `.class` mtime is CAS-normalized, so the build's
  provenance is inferred from the source match and the presence of HEL-1326's `listFieldCells` in the bytecode. The
  public API today includes:
  - `public String com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$escapeLikeTerm(String)`
  - `public String com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$likeEscapeChar()`

  These are Scala 2.13's expanded-name accessors. They exist because `filterWhereFragment`'s
  `f.columnTerms.collect { case ... }` (an anonymous PartialFunction class) reads those two private members (:277-281).
  D4 moves all of that code out, so **both methods will disappear from `NodeSnapshotRepository`'s public bytecode**.
  D5b(b) filters every name containing `$$` and then requires the diff to be empty. That filter will hide this known,
  real change, and it would equally hide a newly leaked `OutputService$$rowReads`-style accessor, which is the exact
  failure mode the driver asked about. See CR1.
- **Defaults and forwarders.** Today's bytecode carries `rows$default$4/5`, the `$lessinit$greater$default$4..9`
  family, and the companion's static forwarders. D1 keeps the defaulted public `rows`, D3 keeps same-signature
  companion forwarders including `policy`'s default, and D5a keeps the vals strictly `private`. Together these preserve
  them, and the javap diff (once CR1 is fixed) will check it.
- **Line budget.** By my arithmetic OutputService ends at about 325 lines and NodeSnapshotRepository at about 353,
  close to the design's estimates of ~330 and ~355. AC1 and AC4 allow "meaningfully closer / smaller overage" when the
  split is genuine, and the remaining content (pinned constructor docs, `create`, and companion types that cannot leave
  the file) is honestly accounted for.

### Verdict: REFUTE

### Change Requests

1. **D5b(b) / task 3.2: the `$$` filter turns the API-preservation proof into evidence-shaped non-evidence.**
   The filtered diff will be empty however the change goes, because the change *will* remove two public
   expanded-name methods from `NodeSnapshotRepository`
   (`com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$escapeLikeTerm(String)` and
   `...$$likeEscapeChar()`). A new `$$` accessor on `OutputService` (for example from `rowReads`/`rootResolution`
   being read inside an anonymous class) would also be filtered away. Revise D5b(b) to:
   - (a) commit the **raw**, unfiltered `javap -public` before/after diff to `api-evidence.md` as well;
   - (b) classify every filtered line explicitly, rather than dropping it silently;
   - (c) make the check fail on any `$$`-named member that is **added** to the four checked classes;
   - (d) name the two expected `$$` removals in advance as the only permitted `$$` delta, with the justification that
     an expanded name cannot be called from Scala source and that PR #847 and the rest of the tree reference neither
     (`git grep` both names on HEAD and on FETCH_HEAD and show zero hits);
   - (e) state the same about `$anonfun$` removals, which are expected for every moved method.

   Update C2's wording in design.md, tasks.md and workflow-state.md to match.
2. **D3 duplicates an existing single-concern home instead of finding a seam.** `OutputConfigValidation.scala`
   (157 lines) already exists in the same package. Its doc says it is "write-time validation of an Output's free-form
   `config`", and it already holds `OutputConfigWritePolicy`. D3 creates a new `OutputConfigWriteValidation` whose
   stated concern ("config-write validation shared by every write path") is the same concern, with a name one word
   away. The result is three near-homonyms (`OutputConfigValidation.validate`, `OutputConfigWriteValidation.validateConfig`,
   `OutputConfigWritePolicy`) for one concern, which is the "arbitrary mechanical split" AC1 forbids. Revise D3 to
   move `validateFieldMapping`/`validateConfig`/`mergeConfig` verbatim into `OutputConfigValidation.scala`, either into
   the existing object (about 205 lines, still under budget) or into a clearly scoped section. Alternatively, keep a
   separate file but justify in design.md the concern boundary that separates it from `OutputConfigValidation` and pick
   a name that cannot be confused with it. In both cases, update the inventory, the README and the mutation plan to
   match.
3. **Task 2.6 will conflict with open PR #847 on `services/pipelines/README.md`.** #847 rewrites line 5 (the `Holds:`
   line). This change edits the same line, or a line next to it, to add the Output-family helpers (which are not
   listed there today). Whichever PR merges second then gets a textual conflict. Revise task 2.6 and D5b so that the
   `services/pipelines/README.md` edit lands at least one unchanged line away from line 5, for example as a separate
   "Output family:" sentence after the `Does NOT hold` paragraph. Add a verification step that
   `git merge-tree --write-tree <HEAD> ca3f5619` (or an equivalent trial merge) reports no conflict.
4. **The mutation plan (D5b(c) / task 3.3) contradicts itself.** It says "one per moved concern" but plans three
   mutations for four concerns, lumping `OutputConfigWriteValidation`/`OutputRootResolution` together. Each new file
   is a separate wiring path: the delegation in D1, the member import in D2, the companion forwarders in D3, and the
   member import in D4. One red result cannot prove two paths. Require at least one single-token mutation per new
   file (four in total, or adjusted if CR2 folds D3 into an existing file). Each must be shown red under `testOnly`
   through the **public** entry point (`OutputService.*` or `NodeSnapshotRepository.*`, not the new class directly),
   so it also proves the delegation or forwarder is live, and then reverted. If the suggested
   `materializedFor` `!t.isBefore` mutation turns out green, record that as a test-gap follow-up, choose another
   mutation, and do not drop the concern.

### Non-blocking notes

- D2 and D4 put a member import at the top of the class body while `rootResolution` is declared later (D5a puts it
  after `log`). This should compile in Scala 2.13 templates, but if it does not, put the import after the val rather
  than switching to wrapper methods. Either way the call text stays byte-identical.
- For the D5b(e) red run, the inserted line must be a code line (not starting with `//` or `*`, which the scanner
  skips) and must not contain `root_id`/`rootId`. Otherwise it passes vacuously.
- `assertionStatus` (33 lines, run-history reads) would be a defensible fifth seam that brings OutputService nearer
  250. Keeping it is a reasonable call and is not required.
- When moving `NodeSnapshotRepository`'s `listRowsPaged` doc, note that the phrase "see `hasAnyRow` below" in the
  moved `materializedFor`/`rows` docs, and "`sortCastExpr` below" inside the D4 block, should still be checked after
  the move. They are listed for D5 handling.
