## Standing Constraints

- [C1] Every `requireAccess(`/`requireOwnerOnly(`/`authorizeResource...(` call and every `ServiceError.Forbidden(` producer stays literally in `PanelService.scala` (ExistenceNotLeakedRoutesSpec guards; pinned count 5).
- [C2] Zero diff under `backend/src/test` (import-only edits only if unavoidable, each justified); total and related-suite test counts equal the 24f6de4cf baseline.
- [C3] Refactor discipline: behaviour-preserving only; bugs/dead code found become follow-ups in the evaluation, never fixed here. Constructor and public/`private[services]` signatures unchanged; `.recover` scopes pinned per design D5a.

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt testFull` (Bash timeout 600000, <=2 concurrent workers), log to the scratchpad; record total + related-suite counts (design D7b)
- [x] 1.2 Record the D2 guard sets (access-helper files, Forbidden-producer counts) and line counts on the unmodified tree (D7c)

### Backend

## 2. Split

- [x] 2.1 Create `ResolvedPanelPatch.scala` (case class moved verbatim); compiles
- [x] 2.2 Create `PanelFormFileSubmission` (submitFormWithFiles, foldFilePlaceholders, storeFormFiles verbatim); `submitForm` delegates its file branch; compiles
- [x] 2.3 Create `PanelBindingChecks` (reject* checks, defaultSizesFor, pure extractors verbatim); compiles
- [x] 2.4 Create `PanelCreateBuilder` (buildForCreate/buildAllForCreate bodies verbatim); `PanelService` keeps `private[services]` delegates with identical signatures and defaults; compiles
- [x] 2.5 Create `PanelUpdateValidation` (update's post-authorize validation chain, D3/D5/D6); compiles
- [x] 2.6 Create `PanelBatchWrites` (batchUpdate post-ACL body incl. audit inside `.recover`'s scope and `classOf[PanelService]` logger; batchCreate post-authorize body); compiles
- [x] 2.7 `PanelService.scala` <= 300 lines (else D8 measured floor, still < 400)  -- D8 floor 321, see test-count-evidence.md, every new file <= 250; `node scripts/check-scala-quality.mjs` passes; eye-check `s"${...}"` for inline FQNs
- [x] 2.8 Update `services/panels/README.md` Holds list

### Tests

## 3. Evidence

- [x] 3.1 Write `move-evidence.md` (D7a: color-moved summary, per-method whitespace-normalised MATCH script + red run, justified list of non-moved changed lines)
- [x] 3.2 Re-run `nice -n 19 sbt testFull`; totals and related-suite counts equal baseline; write `test-count-evidence.md` (D7b) incl. guard scans (D7c)
- [x] 3.3 Confirm `git diff <base>...HEAD -- backend/src/test` empty; pre-commit hooks pass on commit (no HUSKY=0 / -n); write `files-modified.md`
