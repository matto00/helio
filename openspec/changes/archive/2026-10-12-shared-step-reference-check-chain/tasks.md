## Standing Constraints

- [C1] The descendant-lane rejection (D4) is an ASSUMED product call under the owner's overnight rule (a). Build it. The
  PR body opens with an "OWNER REVIEW: assumed product call(s)" section. The PR is PARKED-FOR-OWNER, and the auditor
  must not merge it.
- [C2] Behaviour-preserving refactor: existing spec files get no edited or removed assertion. AC2 message pins and new
  tests are additive only.
- [C3] C2 carve-out: an existing fixture that seeds a cyclic graph contrary to its own stated intent may get a
  fixture-only fix restoring that intent (no assertion edits), listed under OWNER REVIEW. Otherwise escalate.

### Backend

- [x] 1.1 Enumerate every existing spec covering step create/update/duplicate reference checks (grep), and record the
  list plus a green baseline run (`[hel1468-guard]` visible)
- [x] 1.2 Red repro (D4) on unmodified code, recording statuses and the run outcome for: update A->lane descendant; update
  lane-transitive; plain-append onto trunk-last's tail; `parentStepId` splice; `rootId` splice; patch-set undo recreating
  a step that lanes to a sibling
- [x] 1.3 Add the shared `referenceChecksF` (D1) with `LaneScope`. Stage order lives only there
- [x] 1.4 Route create, update and duplicate through it. Delete the three inline copies, including `duplicateReferenceChecksF`
- [x] 1.5 Re-run the 1.1 list unmodified (green). Run mutations (a)(b)(c)(d1) plus create call-site (d2') from D2 and record the red tests per path
- [x] 1.6 If 1.2 reproduced: add the dependents closure (parent and lane edges), derive the create seeds from the insert's own
  anchor/reparent logic for every arm (empty when persist would reject the placement), and add the `validateLaneReference` branch (400). Duplicate passes an empty set
- [x] 1.6a Re-run every spec that creates/updates a lane-referencing step, and apply C3 to hits (known: PatchSetUndoLaneSpec
  L141-145)
- [x] 1.6b Record from code how a rollback (PatchSetApplyRollback L248) or update-undo (PatchSetUndoService L247) failure
  with the new 400 is reported; this goes in OWNER REVIEW (skeptic-design-4 notes)
- [x] 1.7 Report whether `PipelineCreateTransaction` / `PatchSetPipelineStepResolvers` carry a drifting lane or ownership chain
- [x] 1.8 Read the frontend lane picker. Report whether it offers descendants and how a 400 surfaces

### Frontend

- [x] 2.1 Find the current tail-step affordance (HEL-943), and decide whether the hel908-tail-attach behaviour still exists

### Tests

- [x] 3.1 AC2: pin messages in the `DuplicateStepReferenceChecksSpec` lane cases, compared against the create/update response
- [x] 3.2 Descendant specs (`VerifiedEmbeddedPostgres.start`) red before 1.6 and green after, plus a mutation (drop the branch -> red)
- [x] 3.3 (NOT repaired - quarantine and HEL-951/HEL-962 left untouched; see report) Repair `e2e/hel908-tail-attach.spec.ts` if possible. Get 3/3 consecutive green on this lane's ports, then remove it from `testIgnore`.
  Otherwise leave it and record why
- [x] 3.4 Full gates: backend `sbt testFull` (nice -n 19), frontend lint/typecheck/jest, and the affected e2e
- [x] 3.5 Write `files-modified.md` (bulleted, backticked, repo-relative paths)
